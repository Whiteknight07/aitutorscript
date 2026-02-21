#!/usr/bin/env python3
"""Train risk-gate logistic regression using embeddings from a local endpoint."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import requests
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, roc_auc_score


def parse_args() -> argparse.Namespace:
  parser = argparse.ArgumentParser(
    description=(
      'Train balanced logistic regression for y_needs_supervision using embeddings from a local endpoint. '
      'Exports model JSON, holdout predictions JSONL, and metrics JSON.'
    )
  )
  parser.add_argument('--dataset', required=True, help='Extracted dataset JSONL path.')
  parser.add_argument(
    '--embedding-url',
    default='http://localhost:11434/api/embeddings',
    help='Local embedding endpoint URL.',
  )
  parser.add_argument(
    '--embedding-model',
    default='Qwen/Qwen3-Embedding-0.6B',
    help='Embedding model name sent to local endpoint.',
  )
  parser.add_argument(
    '--headers-json',
    default=None,
    help='Optional JSON object string of HTTP headers for embedding requests.',
  )
  parser.add_argument('--id-field', default='example_id', help='Dataset row ID field.')
  parser.add_argument('--text-field', default='feature_text', help='Dataset text field used for embeddings.')
  parser.add_argument('--label-field', default='y_needs_supervision', help='Dataset label field.')
  parser.add_argument('--split-field', default='split', help='Dataset split field.')
  parser.add_argument('--train-split-value', default='train', help='Split field value used for training rows.')
  parser.add_argument('--holdout-split-value', default='holdout', help='Split field value used for holdout rows.')
  parser.add_argument('--cache-jsonl', default='tmp/risk_gate/local_embeddings_cache.jsonl', help='Embedding cache JSONL.')
  parser.add_argument('--timeout-sec', type=float, default=60.0, help='Embedding request timeout in seconds.')
  parser.add_argument('--max-rows', type=int, default=None, help='Optional row cap.')
  parser.add_argument('--max-iter', type=int, default=2000, help='LogisticRegression max_iter.')
  parser.add_argument('--c', type=float, default=1.0, help='LogisticRegression C regularization strength.')
  parser.add_argument('--prediction-threshold', type=float, default=0.5, help='Threshold for report metrics.')
  parser.add_argument('--model-out', required=True, help='Output model JSON path.')
  parser.add_argument('--predictions-out', required=True, help='Output holdout predictions JSONL path.')
  parser.add_argument('--metrics-out', required=True, help='Output metrics JSON path.')
  return parser.parse_args()


def iter_jsonl(path: Path):
  with path.open('r', encoding='utf-8') as fh:
    for line_number, line in enumerate(fh, start=1):
      text = line.strip()
      if not text:
        continue
      yield line_number, json.loads(text)


def load_embedding_cache(path: Path) -> dict[str, list[float]]:
  if not path.exists():
    return {}
  cache: dict[str, list[float]] = {}
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
    if valid:
      cache[example_id] = numeric
  return cache


def write_embedding_cache(path: Path, cache: dict[str, list[float]]) -> None:
  path.parent.mkdir(parents=True, exist_ok=True)
  with path.open('w', encoding='utf-8') as fh:
    for example_id in sorted(cache):
      fh.write(json.dumps({'example_id': example_id, 'embedding': cache[example_id]}, ensure_ascii=True) + '\n')


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


def parse_headers(raw: str | None) -> dict[str, str]:
  if raw is None:
    return {}
  try:
    parsed = json.loads(raw)
  except json.JSONDecodeError as exc:
    raise SystemExit(f'Invalid --headers-json: {exc}') from exc
  if not isinstance(parsed, dict):
    raise SystemExit('--headers-json must be a JSON object')
  headers: dict[str, str] = {}
  for key, value in parsed.items():
    headers[str(key)] = str(value)
  return headers


def fetch_embedding(
  session: requests.Session,
  url: str,
  model: str,
  text: str,
  timeout_sec: float,
  headers: dict[str, str],
) -> list[float]:
  response = session.post(
    url,
    headers=headers,
    json={
      'model': model,
      'input': text,
      'prompt': text,
    },
    timeout=timeout_sec,
  )
  response.raise_for_status()
  payload = response.json()

  if isinstance(payload, dict):
    if isinstance(payload.get('embedding'), list) and payload['embedding']:
      return [float(v) for v in payload['embedding']]

    data = payload.get('data')
    if isinstance(data, list) and data and isinstance(data[0], dict):
      embedding = data[0].get('embedding')
      if isinstance(embedding, list) and embedding:
        return [float(v) for v in embedding]

    embeddings = payload.get('embeddings')
    if isinstance(embeddings, list) and embeddings:
      first = embeddings[0]
      if isinstance(first, list) and first:
        return [float(v) for v in first]

  raise RuntimeError(f'Unable to parse embedding response from {url}: {payload}')


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

  dataset_path = Path(args.dataset)
  if not dataset_path.exists():
    raise SystemExit(f'Dataset not found: {dataset_path}')

  cache_path = Path(args.cache_jsonl)
  model_out = Path(args.model_out)
  predictions_out = Path(args.predictions_out)
  metrics_out = Path(args.metrics_out)

  model_out.parent.mkdir(parents=True, exist_ok=True)
  predictions_out.parent.mkdir(parents=True, exist_ok=True)
  metrics_out.parent.mkdir(parents=True, exist_ok=True)

  rows: list[dict[str, Any]] = []
  skipped_missing_id = 0
  skipped_missing_text = 0
  skipped_missing_label = 0

  for _, row in iter_jsonl(dataset_path):
    if not isinstance(row, dict):
      continue

    example_id = str(row.get(args.id_field, '')).strip()
    text = str(row.get(args.text_field, '')).strip()
    split = str(row.get(args.split_field, args.train_split_value)).strip() or args.train_split_value
    label = parse_label(row.get(args.label_field))

    if not example_id:
      skipped_missing_id += 1
      continue
    if not text:
      skipped_missing_text += 1
      continue
    if label is None:
      skipped_missing_label += 1
      continue

    rows.append(
      {
        'example_id': example_id,
        'split': split,
        'label': label,
        'text': text,
      }
    )

    if args.max_rows is not None and len(rows) >= args.max_rows:
      break

  if not rows:
    raise SystemExit('No valid rows available for training after filtering.')

  headers = parse_headers(args.headers_json)
  cache = load_embedding_cache(cache_path)
  new_embeddings = 0

  session = requests.Session()
  embeddings: list[list[float]] = []
  embedding_dim: int | None = None

  for row in rows:
    example_id = row['example_id']
    embedding = cache.get(example_id)
    if embedding is None:
      embedding = fetch_embedding(
        session=session,
        url=args.embedding_url,
        model=args.embedding_model,
        text=row['text'],
        timeout_sec=args.timeout_sec,
        headers=headers,
      )
      cache[example_id] = embedding
      new_embeddings += 1

    if embedding_dim is None:
      embedding_dim = len(embedding)
    elif len(embedding) != embedding_dim:
      raise SystemExit(
        f'Embedding dimension mismatch for {example_id}: got {len(embedding)}, expected {embedding_dim}.'
      )

    embeddings.append(embedding)

  write_embedding_cache(cache_path, cache)

  X = np.asarray(embeddings, dtype=np.float64)
  y = np.asarray([row['label'] for row in rows], dtype=np.int64)

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
      'Training split has only one class. Logistic regression requires both classes for fitting.'
    )

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

  with predictions_out.open('w', encoding='utf-8') as fh:
    for idx, prob in zip(holdout_indices.tolist(), prob_holdout.tolist()):
      row = rows[idx]
      fh.write(
        json.dumps(
          {
            'example_id': row['example_id'],
            'split': row['split'],
            'y_true': int(row['label']),
            'prob_local': float(prob),
          },
          ensure_ascii=True,
        )
        + '\n'
      )

  model_payload = {
    'model_type': 'logistic_regression',
    'class_weight': 'balanced',
    'created_at': datetime.now(timezone.utc).isoformat(),
    'feature_source': {
      'kind': 'local_embedding_endpoint',
      'embedding_url': args.embedding_url,
      'embedding_model': args.embedding_model,
      'headers': headers,
    },
    'dataset': {
      'path': str(dataset_path),
      'id_field': args.id_field,
      'text_field': args.text_field,
      'label_field': args.label_field,
      'split_field': args.split_field,
      'train_split_value': args.train_split_value,
      'holdout_split_value': args.holdout_split_value,
    },
    'feature_dim': int(embedding_dim or 0),
    'coefficients': clf.coef_[0].tolist(),
    'intercept': float(clf.intercept_[0]),
    'prediction_threshold': args.prediction_threshold,
    'counts': {
      'total_rows': len(rows),
      'train_rows': int(train_indices.size),
      'holdout_rows': int(holdout_indices.size),
      'new_embeddings_fetched': new_embeddings,
      'cache_size': len(cache),
      'skipped_missing_id': skipped_missing_id,
      'skipped_missing_text': skipped_missing_text,
      'skipped_missing_label': skipped_missing_label,
    },
    'metrics': {
      'train': train_metrics,
      'holdout': holdout_metrics,
    },
  }

  with model_out.open('w', encoding='utf-8') as fh:
    json.dump(model_payload, fh, indent=2, sort_keys=True)
    fh.write('\n')

  metrics_payload = {
    'created_at': datetime.now(timezone.utc).isoformat(),
    'model': 'local',
    'prediction_threshold': args.prediction_threshold,
    'counts': model_payload['counts'],
    'metrics': model_payload['metrics'],
  }
  with metrics_out.open('w', encoding='utf-8') as fh:
    json.dump(metrics_payload, fh, indent=2, sort_keys=True)
    fh.write('\n')

  print('Local model training complete.')
  print(f'  dataset: {dataset_path}')
  print(f'  model_out: {model_out}')
  print(f'  predictions_out: {predictions_out}')
  print(f'  metrics_out: {metrics_out}')
  print(f'  total_rows: {len(rows)}')
  print(f'  train_rows: {int(train_indices.size)}')
  print(f'  holdout_rows: {int(holdout_indices.size)}')
  print(f'  new_embeddings_fetched: {new_embeddings}')
  print(f'  holdout_recall_at_{args.prediction_threshold}: {holdout_metrics["recall"]}')

  return 0


if __name__ == '__main__':
  raise SystemExit(main())
