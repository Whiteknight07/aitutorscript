#!/usr/bin/env python3
"""Sweep risk-gate policy thresholds under a recall constraint on holdout predictions."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np


def parse_args() -> argparse.Namespace:
  parser = argparse.ArgumentParser(
    description=(
      'Sweep local_low, local_high, and openai_threshold. '
      'Select best policy with recall >= target on holdout y_needs_supervision.'
    )
  )
  parser.add_argument('--local-predictions', required=True, help='JSONL with {example_id, y_true, prob_local}.')
  parser.add_argument('--openai-predictions', required=True, help='JSONL with {example_id, y_true, prob_openai}.')
  parser.add_argument('--id-field', default='example_id', help='Prediction ID field name.')
  parser.add_argument('--label-field', default='y_true', help='Prediction label field name.')
  parser.add_argument('--local-prob-field', default='prob_local', help='Local probability field name.')
  parser.add_argument('--openai-prob-field', default='prob_openai', help='OpenAI probability field name.')
  parser.add_argument('--recall-target', type=float, default=0.99, help='Minimum recall constraint for positives.')
  parser.add_argument('--local-low-start', type=float, default=0.0)
  parser.add_argument('--local-low-stop', type=float, default=0.5)
  parser.add_argument('--local-low-step', type=float, default=0.02)
  parser.add_argument('--local-high-start', type=float, default=0.5)
  parser.add_argument('--local-high-stop', type=float, default=1.0)
  parser.add_argument('--local-high-step', type=float, default=0.02)
  parser.add_argument('--openai-start', type=float, default=0.0)
  parser.add_argument('--openai-stop', type=float, default=1.0)
  parser.add_argument('--openai-step', type=float, default=0.02)
  parser.add_argument('--output-policy', required=True, help='Output policy JSON path.')
  parser.add_argument('--output-metrics', required=True, help='Output sweep metrics JSON path.')
  return parser.parse_args()


def iter_jsonl(path: Path):
  with path.open('r', encoding='utf-8') as fh:
    for _, line in enumerate(fh, start=1):
      text = line.strip()
      if not text:
        continue
      yield json.loads(text)


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


def load_prediction_map(path: Path, id_field: str, label_field: str, prob_field: str) -> dict[str, dict[str, float | int]]:
  pred_map: dict[str, dict[str, float | int]] = {}
  for row in iter_jsonl(path):
    if not isinstance(row, dict):
      continue

    example_id = str(row.get(id_field, '')).strip()
    label = parse_label(row.get(label_field))
    prob_raw = row.get(prob_field)

    if not example_id or label is None:
      continue
    if not isinstance(prob_raw, (int, float)):
      continue

    prob = float(prob_raw)
    if prob < 0.0 or prob > 1.0:
      continue

    pred_map[example_id] = {
      'label': int(label),
      'prob': prob,
    }
  return pred_map


def float_range(start: float, stop: float, step: float) -> list[float]:
  if step <= 0:
    raise SystemExit('Sweep step values must be > 0.')
  values: list[float] = []
  current = start
  epsilon = step / 1000.0
  while current <= stop + epsilon:
    values.append(round(current, 6))
    current += step
  return values


def compute_metrics(y_true: np.ndarray, y_pred: np.ndarray, routed_to_openai: np.ndarray) -> dict[str, Any]:
  tp = int(np.sum((y_true == 1) & (y_pred == 1)))
  fp = int(np.sum((y_true == 0) & (y_pred == 1)))
  tn = int(np.sum((y_true == 0) & (y_pred == 0)))
  fn = int(np.sum((y_true == 1) & (y_pred == 0)))

  precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
  recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
  specificity = tn / (tn + fp) if (tn + fp) > 0 else 0.0
  fpr = fp / (fp + tn) if (fp + tn) > 0 else 0.0
  support_rate = float(np.mean(y_pred))
  openai_share = float(np.mean(routed_to_openai))

  return {
    'tp': tp,
    'fp': fp,
    'tn': tn,
    'fn': fn,
    'precision': precision,
    'recall': recall,
    'specificity': specificity,
    'fpr': fpr,
    'support_rate': support_rate,
    'openai_share': openai_share,
    'count': int(y_true.size),
    'positive_count': int(np.sum(y_true == 1)),
    'negative_count': int(np.sum(y_true == 0)),
  }


def feasible_sort_key(candidate: dict[str, Any]) -> tuple[float, float, float, float, float]:
  return (
    float(candidate['support_rate']),
    float(candidate['openai_share']),
    -float(candidate['precision']),
    float(candidate['fpr']),
    -float(candidate['recall']),
  )


def fallback_sort_key(candidate: dict[str, Any]) -> tuple[float, float, float, float]:
  return (
    -float(candidate['recall']),
    float(candidate['support_rate']),
    float(candidate['fpr']),
    float(candidate['openai_share']),
  )


def main() -> int:
  args = parse_args()

  local_path = Path(args.local_predictions)
  openai_path = Path(args.openai_predictions)
  policy_out = Path(args.output_policy)
  metrics_out = Path(args.output_metrics)

  if not local_path.exists():
    raise SystemExit(f'Local predictions file not found: {local_path}')
  if not openai_path.exists():
    raise SystemExit(f'OpenAI predictions file not found: {openai_path}')

  policy_out.parent.mkdir(parents=True, exist_ok=True)
  metrics_out.parent.mkdir(parents=True, exist_ok=True)

  local_map = load_prediction_map(local_path, args.id_field, args.label_field, args.local_prob_field)
  openai_map = load_prediction_map(openai_path, args.id_field, args.label_field, args.openai_prob_field)

  common_ids = sorted(set(local_map) & set(openai_map))
  if not common_ids:
    raise SystemExit('No overlapping example IDs between local and OpenAI prediction files.')

  dropped_label_mismatch = 0
  labels: list[int] = []
  local_probs: list[float] = []
  openai_probs: list[float] = []

  for example_id in common_ids:
    local_item = local_map[example_id]
    openai_item = openai_map[example_id]

    local_label = int(local_item['label'])
    openai_label = int(openai_item['label'])
    if local_label != openai_label:
      dropped_label_mismatch += 1
      continue

    labels.append(local_label)
    local_probs.append(float(local_item['prob']))
    openai_probs.append(float(openai_item['prob']))

  if not labels:
    raise SystemExit('No usable overlapping rows after removing label mismatches.')

  y_true = np.asarray(labels, dtype=np.int64)
  p_local = np.asarray(local_probs, dtype=np.float64)
  p_openai = np.asarray(openai_probs, dtype=np.float64)

  lows = float_range(args.local_low_start, args.local_low_stop, args.local_low_step)
  highs = float_range(args.local_high_start, args.local_high_stop, args.local_high_step)
  openai_thresholds = float_range(args.openai_start, args.openai_stop, args.openai_step)

  feasible: list[dict[str, Any]] = []
  all_candidates: list[dict[str, Any]] = []
  skipped_invalid_bounds = 0

  for local_low in lows:
    for local_high in highs:
      if local_low > local_high:
        skipped_invalid_bounds += 1
        continue

      local_accept_mask = p_local <= local_low
      local_reject_mask = p_local >= local_high
      routed_to_openai = ~(local_accept_mask | local_reject_mask)

      for openai_threshold in openai_thresholds:
        y_pred = np.where(
          local_accept_mask,
          0,
          np.where(local_reject_mask, 1, (p_openai >= openai_threshold).astype(np.int64)),
        )

        metrics = compute_metrics(y_true, y_pred, routed_to_openai)
        candidate = {
          'local_low': float(local_low),
          'local_high': float(local_high),
          'openai_threshold': float(openai_threshold),
          **metrics,
        }
        all_candidates.append(candidate)
        if metrics['recall'] >= args.recall_target:
          feasible.append(candidate)

  if not all_candidates:
    raise SystemExit('Sweep generated no candidates. Check threshold ranges.')

  constraint_met = len(feasible) > 0
  chosen = min(feasible, key=feasible_sort_key) if feasible else min(all_candidates, key=fallback_sort_key)

  policy_payload = {
    'policy_version': 'risk-gate-v1',
    'created_at': datetime.now(timezone.utc).isoformat(),
    'local_low': chosen['local_low'],
    'local_high': chosen['local_high'],
    'openai_threshold': chosen['openai_threshold'],
    'constraint': {
      'metric': 'recall',
      'target': args.recall_target,
      'satisfied': constraint_met,
    },
    'thresholds': {
      'local_low': chosen['local_low'],
      'local_high': chosen['local_high'],
      'openai_threshold': chosen['openai_threshold'],
    },
    'routing_policy': {
      'when_local_prob_lte_local_low': 'allow_without_supervision',
      'when_local_prob_gte_local_high': 'require_supervision',
      'otherwise_use_openai_prob': 'require_supervision_if_prob_ge_openai_threshold_else_allow',
    },
    'holdout_metrics': {
      'count': chosen['count'],
      'positive_count': chosen['positive_count'],
      'negative_count': chosen['negative_count'],
      'tp': chosen['tp'],
      'fp': chosen['fp'],
      'tn': chosen['tn'],
      'fn': chosen['fn'],
      'precision': chosen['precision'],
      'recall': chosen['recall'],
      'specificity': chosen['specificity'],
      'fpr': chosen['fpr'],
      'support_rate': chosen['support_rate'],
      'openai_share': chosen['openai_share'],
    },
  }

  with policy_out.open('w', encoding='utf-8') as fh:
    json.dump(policy_payload, fh, indent=2, sort_keys=True)
    fh.write('\n')

  top_feasible = sorted(feasible, key=feasible_sort_key)[:25]
  top_overall = sorted(all_candidates, key=fallback_sort_key)[:25]

  metrics_payload = {
    'generated_at': datetime.now(timezone.utc).isoformat(),
    'inputs': {
      'local_predictions': str(local_path),
      'openai_predictions': str(openai_path),
      'id_field': args.id_field,
      'label_field': args.label_field,
      'local_prob_field': args.local_prob_field,
      'openai_prob_field': args.openai_prob_field,
    },
    'counts': {
      'local_ids': len(local_map),
      'openai_ids': len(openai_map),
      'common_ids': len(common_ids),
      'dropped_label_mismatch': dropped_label_mismatch,
      'evaluated_rows': int(y_true.size),
    },
    'sweep': {
      'recall_target': args.recall_target,
      'local_low_values': len(lows),
      'local_high_values': len(highs),
      'openai_threshold_values': len(openai_thresholds),
      'candidate_count': len(all_candidates),
      'feasible_count': len(feasible),
      'skipped_invalid_bounds': skipped_invalid_bounds,
    },
    'selected_policy': policy_payload,
    'top_feasible_candidates': top_feasible,
    'top_overall_candidates': top_overall,
  }

  with metrics_out.open('w', encoding='utf-8') as fh:
    json.dump(metrics_payload, fh, indent=2, sort_keys=True)
    fh.write('\n')

  print('Threshold sweep complete.')
  print(f'  evaluated_rows: {int(y_true.size)}')
  print(f'  candidate_count: {len(all_candidates)}')
  print(f'  feasible_count: {len(feasible)}')
  print(f'  selected_thresholds: local_low={chosen["local_low"]}, local_high={chosen["local_high"]}, openai_threshold={chosen["openai_threshold"]}')
  print(f'  selected_recall: {chosen["recall"]}')
  print(f'  selected_support_rate: {chosen["support_rate"]}')
  print(f'  output_policy: {policy_out}')
  print(f'  output_metrics: {metrics_out}')

  if not constraint_met:
    print('Warning: no candidate met recall target; selected best available fallback by recall.')

  return 0


if __name__ == '__main__':
  raise SystemExit(main())
