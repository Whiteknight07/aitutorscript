#!/usr/bin/env python3
"""Train risk-gate classifier using precomputed OpenAI embeddings."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, roc_auc_score
from sklearn.model_selection import train_test_split as sklearn_train_test_split

try:
  from xgboost import XGBClassifier

  _HAS_XGBOOST = True
except ImportError:
  _HAS_XGBOOST = False

# Structured numeric features extracted from dataset rows alongside embeddings.
STRUCTURED_FEATURE_NAMES: list[str] = [
  'turn_index',
  'student_attack_level',
  'question_bloom_level',
  'tutor_draft_len',
  'student_message_len',
  'tutor_draft_word_count',
  'student_message_word_count',
  'reference_answer_len',
  'len_ratio_draft_to_reference',
  'draft_has_equation',
  'draft_has_answer_phrase',
  'draft_has_numeric_value',
  'num_prior_student_turns',
  'question_difficulty',
]


def parse_args() -> argparse.Namespace:
  parser = argparse.ArgumentParser(
    description=(
      'Train a classifier for y_needs_supervision using precomputed '
      'OpenAI embeddings from collect_openai_batch_embeddings.py.'
    )
  )
  parser.add_argument('--dataset', required=True, help='Extracted dataset JSONL path.')
  parser.add_argument('--embeddings-jsonl', required=True, help='Collected embeddings JSONL path.')
  parser.add_argument('--id-field', default='example_id', help='Dataset row ID field.')
  parser.add_argument('--label-field', default='y_needs_supervision', help='Dataset label field.')
  parser.add_argument('--split-field', default='split', help='Dataset split field.')
  parser.add_argument('--train-split-value', default='train', help='Split field value used for training rows.')
  parser.add_argument('--holdout-split-value', default='holdout', help='Split field value used for holdout rows.')
  parser.add_argument('--max-rows', type=int, default=None, help='Optional row cap.')
  parser.add_argument('--max-iter', type=int, default=2000, help='LogisticRegression max_iter.')
  parser.add_argument('--c', type=float, default=1.0, help='LogisticRegression C regularization strength.')
  parser.add_argument('--prediction-threshold', type=float, default=0.5, help='Threshold for report metrics.')
  parser.add_argument('--model-out', required=True, help='Output model JSON path.')
  parser.add_argument('--predictions-out', required=True, help='Output holdout predictions JSONL path.')
  parser.add_argument('--metrics-out', required=True, help='Output metrics JSON path.')
  parser.add_argument(
    '--classifier',
    choices=['xgboost', 'logistic'],
    default='xgboost',
    help='Classifier type: xgboost (gradient boosted trees) or logistic (logistic regression). Default: xgboost.',
  )
  return parser.parse_args()


def iter_jsonl(path: Path):
  with path.open('r', encoding='utf-8') as fh:
    for line_number, line in enumerate(fh, start=1):
      text = line.strip()
      if not text:
        continue
      yield line_number, json.loads(text)


def parse_label(value: Any) -> int | None:
  if isinstance(value, bool):
    return int(value)
  if isinstance(value, (int, float)):
    return int(bool(value))
  if isinstance(value, str):
    lowered = value.strip().lower()
    if lowered in {'1', 'true', 'yes', 'y'}:
      return 1
    if lowered in {'0', 'false', 'no', 'n'}:
      return 0
  return None


def load_embeddings(path: Path) -> tuple[dict[str, list[float]], str | None]:
  embeddings: dict[str, list[float]] = {}
  model_name: str | None = None

  for _, row in iter_jsonl(path):
    if not isinstance(row, dict):
      continue
    example_id = str(row.get('example_id', '')).strip()
    embedding = row.get('embedding')
    if not example_id or not isinstance(embedding, list) or not embedding:
      continue

    numeric: list[float] = []
    valid = True
    for value in embedding:
      if not isinstance(value, (int, float)):
        valid = False
        break
      numeric.append(float(value))
    if not valid:
      continue

    embeddings[example_id] = numeric

    current_model = row.get('embedding_model')
    if current_model is not None:
      current_model = str(current_model)
      if model_name is None:
        model_name = current_model
      elif model_name != current_model:
        model_name = 'mixed'

  return embeddings, model_name


def extract_structured_features(row: dict[str, Any]) -> list[float]:
  """Extract structured numeric features from a dataset row's feature_numeric dict."""
  feat_dict = row.get('feature_numeric', {})
  if not isinstance(feat_dict, dict):
    feat_dict = {}
  features: list[float] = []
  for name in STRUCTURED_FEATURE_NAMES:
    val = feat_dict.get(name, 0)
    if isinstance(val, bool):
      features.append(float(val))
    elif isinstance(val, (int, float)):
      features.append(float(val))
    else:
      features.append(0.0)
  return features


def binary_metrics(y_true: np.ndarray, y_prob: np.ndarray, threshold: float) -> dict[str, Any]:
  if y_true.size == 0:
    return {
      'count': 0,
      'positive_count': 0,
      'negative_count': 0,
      'precision': None,
      'recall': None,
      'specificity': None,
      'fpr': None,
      'support_rate': None,
      'roc_auc': None,
      'pr_auc': None,
      'tp': 0,
      'fp': 0,
      'tn': 0,
      'fn': 0,
    }

  y_pred = (y_prob >= threshold).astype(int)
  tp = int(np.sum((y_true == 1) & (y_pred == 1)))
  fp = int(np.sum((y_true == 0) & (y_pred == 1)))
  tn = int(np.sum((y_true == 0) & (y_pred == 0)))
  fn = int(np.sum((y_true == 1) & (y_pred == 0)))

  precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
  recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
  specificity = tn / (tn + fp) if (tn + fp) > 0 else 0.0
  fpr = fp / (fp + tn) if (fp + tn) > 0 else 0.0
  support_rate = float(np.mean(y_pred))

  unique_labels = np.unique(y_true)
  roc_auc: float | None = None
  pr_auc: float | None = None
  if unique_labels.size > 1:
    roc_auc = float(roc_auc_score(y_true, y_prob))
    pr_auc = float(average_precision_score(y_true, y_prob))

  return {
    'count': int(y_true.size),
    'positive_count': int(np.sum(y_true == 1)),
    'negative_count': int(np.sum(y_true == 0)),
    'precision': precision,
    'recall': recall,
    'specificity': specificity,
    'fpr': fpr,
    'support_rate': support_rate,
    'roc_auc': roc_auc,
    'pr_auc': pr_auc,
    'tp': tp,
    'fp': fp,
    'tn': tn,
    'fn': fn,
  }


def main() -> int:
  args = parse_args()

  if args.classifier == 'xgboost' and not _HAS_XGBOOST:
    raise SystemExit(
      'xgboost is not installed. Install it with `pip install xgboost` '
      'or use --classifier logistic as a fallback.'
    )

  dataset_path = Path(args.dataset)
  embeddings_path = Path(args.embeddings_jsonl)
  if not dataset_path.exists():
    raise SystemExit(f'Dataset not found: {dataset_path}')
  if not embeddings_path.exists():
    raise SystemExit(f'Embeddings file not found: {embeddings_path}')

  model_out = Path(args.model_out)
  predictions_out = Path(args.predictions_out)
  metrics_out = Path(args.metrics_out)
  model_out.parent.mkdir(parents=True, exist_ok=True)
  predictions_out.parent.mkdir(parents=True, exist_ok=True)
  metrics_out.parent.mkdir(parents=True, exist_ok=True)

  embedding_map, embedding_model_name = load_embeddings(embeddings_path)
  if not embedding_map:
    raise SystemExit('No valid embeddings found in embeddings JSONL.')

  # Index dataset rows by example_id so we can pull feature_numeric later.
  dataset_rows_by_id: dict[str, dict[str, Any]] = {}
  for _, raw_row in iter_jsonl(dataset_path):
    if isinstance(raw_row, dict):
      eid = str(raw_row.get(args.id_field, '')).strip()
      if eid:
        dataset_rows_by_id[eid] = raw_row

  rows: list[dict[str, Any]] = []
  skipped_missing_id = 0
  skipped_missing_label = 0
  skipped_missing_embedding = 0

  embedding_dim: int | None = None

  for eid, raw_row in dataset_rows_by_id.items():
    split = str(raw_row.get(args.split_field, args.train_split_value)).strip() or args.train_split_value
    label = parse_label(raw_row.get(args.label_field))

    if not eid:
      skipped_missing_id += 1
      continue
    if label is None:
      skipped_missing_label += 1
      continue

    embedding = embedding_map.get(eid)
    if embedding is None:
      skipped_missing_embedding += 1
      continue

    if embedding_dim is None:
      embedding_dim = len(embedding)
    elif len(embedding) != embedding_dim:
      raise SystemExit(
        f'Embedding dimension mismatch for {eid}: got {len(embedding)}, expected {embedding_dim}.'
      )

    structured = extract_structured_features(raw_row)

    rows.append(
      {
        'example_id': eid,
        'split': split,
        'label': label,
        'embedding': embedding,
        'structured_features': structured,
      }
    )

    if args.max_rows is not None and len(rows) >= args.max_rows:
      break

  if not rows:
    raise SystemExit('No trainable rows after joining dataset with embeddings.')

  # Build feature matrix: embedding dims + structured feature dims.
  X_emb = np.asarray([row['embedding'] for row in rows], dtype=np.float64)
  X_struct = np.asarray([row['structured_features'] for row in rows], dtype=np.float64)
  X = np.concatenate([X_emb, X_struct], axis=1)
  y = np.asarray([row['label'] for row in rows], dtype=np.int64)

  feature_names = [f'emb_{i}' for i in range(X_emb.shape[1])] + list(STRUCTURED_FEATURE_NAMES)

  train_indices = np.asarray(
    [idx for idx, row in enumerate(rows) if row['split'] == args.train_split_value],
    dtype=np.int64,
  )
  holdout_indices = np.asarray(
    [idx for idx, row in enumerate(rows) if row['split'] == args.holdout_split_value],
    dtype=np.int64,
  )

  if train_indices.size == 0:
    raise SystemExit(
      f'No training rows found with {args.split_field}={args.train_split_value!r}. '
      'Run extract_dataset.py first or adjust split args.'
    )
  if holdout_indices.size == 0:
    raise SystemExit(
      f'No holdout rows found with {args.split_field}={args.holdout_split_value!r}. '
      'Run extract_dataset.py first or adjust split args.'
    )

  y_train = y[train_indices]
  unique_train = np.unique(y_train)
  if unique_train.size < 2:
    raise SystemExit(
      'Training split has only one class. The classifier requires both classes for fitting.'
    )

  # ----- Train classifier -----
  classifier_type = args.classifier

  if classifier_type == 'xgboost':
    # Compute class weight for imbalanced data.
    positive_count = int(np.sum(y_train == 1))
    negative_count = int(np.sum(y_train == 0))
    scale_pos_weight = negative_count / positive_count if positive_count > 0 else 1.0

    # Split training data to create an eval set for early stopping (10% held out).
    X_train_full = X[train_indices]
    y_train_full = y_train
    X_fit, X_eval, y_fit, y_eval = sklearn_train_test_split(
      X_train_full, y_train_full, test_size=0.1, random_state=42, stratify=y_train_full
    )

    clf = XGBClassifier(
      n_estimators=1000,
      max_depth=3,
      learning_rate=0.01,
      subsample=0.7,
      colsample_bytree=0.3,
      scale_pos_weight=scale_pos_weight,
      eval_metric='logloss',
      reg_alpha=1.0,
      reg_lambda=5.0,
      min_child_weight=10,
      gamma=1.0,
      random_state=42,
      n_jobs=-1,
      early_stopping_rounds=50,
    )
    clf.fit(X_fit, y_fit, eval_set=[(X_eval, y_eval)], verbose=False)

    # Predict on full train set and holdout.
    prob_train = clf.predict_proba(X[train_indices])[:, 1]
    prob_holdout = clf.predict_proba(X[holdout_indices])[:, 1]

  else:
    # Logistic regression fallback.
    clf = LogisticRegression(
      class_weight='balanced',
      max_iter=args.max_iter,
      C=args.c,
      solver='lbfgs',
      random_state=42,
    )
    clf.fit(X[train_indices], y_train)

    prob_train = clf.predict_proba(X[train_indices])[:, 1]
    prob_holdout = clf.predict_proba(X[holdout_indices])[:, 1]

  train_metrics = binary_metrics(y[train_indices], prob_train, args.prediction_threshold)
  holdout_metrics = binary_metrics(y[holdout_indices], prob_holdout, args.prediction_threshold)

  # ----- Write predictions -----
  with predictions_out.open('w', encoding='utf-8') as fh:
    for idx, prob in zip(holdout_indices.tolist(), prob_holdout.tolist()):
      row = rows[idx]
      fh.write(
        json.dumps(
          {
            'example_id': row['example_id'],
            'split': row['split'],
            'y_true': int(row['label']),
            'prob_openai': float(prob),
          },
          ensure_ascii=True,
        )
        + '\n'
      )

  # ----- Build model payload -----
  model_payload: dict[str, Any] = {
    'model_type': classifier_type,
    'created_at': datetime.now(timezone.utc).isoformat(),
    'feature_source': {
      'kind': 'precomputed_openai_embeddings_plus_structured',
      'embeddings_jsonl': str(embeddings_path),
      'embedding_model': embedding_model_name,
      'structured_feature_names': list(STRUCTURED_FEATURE_NAMES),
    },
    'dataset': {
      'path': str(dataset_path),
      'id_field': args.id_field,
      'label_field': args.label_field,
      'split_field': args.split_field,
      'train_split_value': args.train_split_value,
      'holdout_split_value': args.holdout_split_value,
    },
    'feature_dim': int(X.shape[1]),
    'embedding_dim': int(embedding_dim or 0),
    'structured_feature_count': len(STRUCTURED_FEATURE_NAMES),
    'feature_names': feature_names,
    'prediction_threshold': args.prediction_threshold,
    'counts': {
      'rows_after_join': len(rows),
      'train_rows': int(train_indices.size),
      'holdout_rows': int(holdout_indices.size),
      'embeddings_available': len(embedding_map),
      'skipped_missing_id': skipped_missing_id,
      'skipped_missing_label': skipped_missing_label,
      'skipped_missing_embedding': skipped_missing_embedding,
    },
    'metrics': {
      'train': train_metrics,
      'holdout': holdout_metrics,
    },
  }

  if classifier_type == 'xgboost':
    # Save binary XGBoost model file.
    xgb_model_path = str(model_out).replace('.json', '.xgb')
    clf.save_model(xgb_model_path)

    # Feature importance from the trained model.
    importance_scores = clf.feature_importances_.tolist()
    model_payload['xgboost'] = {
      'model_file': xgb_model_path,
      'best_iteration': clf.best_iteration if hasattr(clf, 'best_iteration') else None,
      'best_score': clf.best_score if hasattr(clf, 'best_score') else None,
      'hyperparameters': {
        'n_estimators': 1000,
        'max_depth': 3,
        'learning_rate': 0.01,
        'subsample': 0.7,
        'colsample_bytree': 0.3,
        'scale_pos_weight': scale_pos_weight,
        'reg_alpha': 1.0,
        'reg_lambda': 5.0,
        'min_child_weight': 10,
        'gamma': 1.0,
        'eval_metric': 'logloss',
        'early_stopping_rounds': 50,
      },
      'feature_importance': dict(zip(feature_names, importance_scores)),
    }
  else:
    # Logistic regression: save coefficients and intercept.
    model_payload['class_weight'] = 'balanced'
    model_payload['coefficients'] = clf.coef_[0].tolist()
    model_payload['intercept'] = float(clf.intercept_[0])

  with model_out.open('w', encoding='utf-8') as fh:
    json.dump(model_payload, fh, indent=2, sort_keys=True)
    fh.write('\n')

  metrics_payload = {
    'created_at': datetime.now(timezone.utc).isoformat(),
    'model': 'openai',
    'classifier': classifier_type,
    'prediction_threshold': args.prediction_threshold,
    'counts': model_payload['counts'],
    'metrics': model_payload['metrics'],
  }
  with metrics_out.open('w', encoding='utf-8') as fh:
    json.dump(metrics_payload, fh, indent=2, sort_keys=True)
    fh.write('\n')

  print('OpenAI model training complete.')
  print(f'  classifier: {classifier_type}')
  print(f'  dataset: {dataset_path}')
  print(f'  embeddings_jsonl: {embeddings_path}')
  print(f'  model_out: {model_out}')
  if classifier_type == 'xgboost':
    print(f'  xgb_model: {xgb_model_path}')
  print(f'  predictions_out: {predictions_out}')
  print(f'  metrics_out: {metrics_out}')
  print(f'  feature_dim: {X.shape[1]} (embedding: {embedding_dim}, structured: {len(STRUCTURED_FEATURE_NAMES)})')
  print(f'  rows_after_join: {len(rows)}')
  print(f'  train_rows: {int(train_indices.size)}')
  print(f'  holdout_rows: {int(holdout_indices.size)}')
  print(f'  holdout_recall_at_{args.prediction_threshold}: {holdout_metrics["recall"]}')

  return 0


if __name__ == '__main__':
  raise SystemExit(main())
