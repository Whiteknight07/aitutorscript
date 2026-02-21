#!/usr/bin/env python3
"""Export trained risk-gate artifacts to models/risk-gate/v1."""

from __future__ import annotations

import argparse
import json
import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


REQUIRED_FILENAMES = {
  'local_model': 'local_model.json',
  'openai_model': 'openai_model.json',
  'policy': 'policy.json',
  'feature_schema': 'feature_schema.json',
  'metrics': 'metrics.json',
}


def parse_args() -> argparse.Namespace:
  parser = argparse.ArgumentParser(
    description=(
      'Collect model/policy/schema outputs and write canonical risk-gate artifacts to models/risk-gate/v1.'
    )
  )
  parser.add_argument('--local-model', required=True, help='Path to local model JSON.')
  parser.add_argument('--openai-model', required=True, help='Path to OpenAI model JSON.')
  parser.add_argument('--policy', required=True, help='Path to selected policy JSON.')
  parser.add_argument('--feature-schema', required=True, help='Path to feature schema JSON.')
  parser.add_argument('--local-metrics', required=True, help='Path to local metrics JSON.')
  parser.add_argument('--openai-metrics', required=True, help='Path to OpenAI metrics JSON.')
  parser.add_argument('--policy-metrics', required=True, help='Path to policy metrics JSON.')
  parser.add_argument(
    '--out-dir',
    default='models/risk-gate/v1',
    help='Destination directory for canonical artifact files.',
  )
  return parser.parse_args()


def load_json(path: Path) -> dict[str, Any]:
  if not path.exists():
    raise SystemExit(f'Required JSON file not found: {path}')
  with path.open('r', encoding='utf-8') as fh:
    payload = json.load(fh)
  if not isinstance(payload, dict):
    raise SystemExit(f'Expected JSON object in file: {path}')
  return payload


def write_json(path: Path, payload: dict[str, Any]) -> None:
  with path.open('w', encoding='utf-8') as fh:
    json.dump(payload, fh, indent=2, sort_keys=True)
    fh.write('\n')


def parse_finite_number(value: Any, label: str) -> float:
  if isinstance(value, bool) or not isinstance(value, (int, float)):
    raise SystemExit(f'{label} must be a finite number. Received: {value!r}')
  parsed = float(value)
  if not math.isfinite(parsed):
    raise SystemExit(f'{label} must be a finite number. Received: {value!r}')
  return parsed


def parse_probability(value: Any, label: str) -> float:
  parsed = parse_finite_number(value, label)
  if parsed < 0.0 or parsed > 1.0:
    raise SystemExit(f'{label} must be between 0 and 1. Received: {parsed}')
  return parsed


def parse_positive_int(value: Any, label: str) -> int:
  parsed = parse_finite_number(value, label)
  if int(parsed) != parsed or parsed <= 0:
    raise SystemExit(f'{label} must be a positive integer. Received: {parsed}')
  return int(parsed)


def extract_thresholds(policy: dict[str, Any]) -> dict[str, float]:
  thresholds_obj = policy.get('thresholds')
  thresholds = thresholds_obj if isinstance(thresholds_obj, dict) else {}

  local_low_raw = policy.get('local_low', thresholds.get('local_low'))
  local_high_raw = policy.get('local_high', thresholds.get('local_high'))
  openai_threshold_raw = policy.get('openai_threshold', thresholds.get('openai_threshold'))

  if local_low_raw is None:
    raise SystemExit('Policy is missing local_low (or thresholds.local_low).')
  if local_high_raw is None:
    raise SystemExit('Policy is missing local_high (or thresholds.local_high).')
  if openai_threshold_raw is None:
    raise SystemExit('Policy is missing openai_threshold (or thresholds.openai_threshold).')

  local_low = parse_probability(local_low_raw, 'local_low')
  local_high = parse_probability(local_high_raw, 'local_high')
  openai_threshold = parse_probability(openai_threshold_raw, 'openai_threshold')

  if local_low > local_high:
    raise SystemExit(f'local_low ({local_low}) must be <= local_high ({local_high}).')

  return {
    'local_low': local_low,
    'local_high': local_high,
    'openai_threshold': openai_threshold,
  }


def extract_logistic_artifact(payload: dict[str, Any], label: str) -> dict[str, Any]:
  candidates: list[dict[str, Any]] = [payload]
  for key in (label, 'model', 'classifier'):
    nested = payload.get(key)
    if isinstance(nested, dict):
      candidates.append(nested)

  for candidate in candidates:
    intercept_raw = candidate.get('intercept', candidate.get('bias'))
    coefficients_raw = candidate.get('coefficients', candidate.get('weights'))
    if intercept_raw is None or not isinstance(coefficients_raw, list):
      continue

    intercept = parse_finite_number(intercept_raw, f'{label}.intercept')
    if not coefficients_raw:
      raise SystemExit(f'{label}.coefficients cannot be empty.')
    coefficients = [
      parse_finite_number(value, f'{label}.coefficients[{idx}]')
      for idx, value in enumerate(coefficients_raw)
    ]
    return {
      'intercept': intercept,
      'coefficients': coefficients,
    }

  raise SystemExit(f'Unable to find logistic artifact fields for {label}.')


def extract_optional_metadata(policy: dict[str, Any]) -> dict[str, Any]:
  metadata: dict[str, Any] = {}

  for key in ('constraint', 'routing_policy', 'holdout_metrics'):
    value = policy.get(key)
    if isinstance(value, dict):
      metadata[key] = value

  source_version = policy.get('policy_version')
  if isinstance(source_version, str) and source_version:
    metadata['source_policy_version'] = source_version

  source_created_at = policy.get('created_at')
  if isinstance(source_created_at, str) and source_created_at:
    metadata['source_policy_created_at'] = source_created_at

  return metadata


def main() -> int:
  args = parse_args()

  local_model = load_json(Path(args.local_model))
  openai_model = load_json(Path(args.openai_model))
  policy = load_json(Path(args.policy))
  feature_schema = load_json(Path(args.feature_schema))
  local_metrics = load_json(Path(args.local_metrics))
  openai_metrics = load_json(Path(args.openai_metrics))
  policy_metrics = load_json(Path(args.policy_metrics))

  out_dir = Path(args.out_dir)
  out_dir.mkdir(parents=True, exist_ok=True)

  thresholds = extract_thresholds(policy)
  local_model_artifact = extract_logistic_artifact(local_model, 'local_model')
  openai_model_artifact = extract_logistic_artifact(openai_model, 'openai_model')

  max_feature_chars_raw = policy.get('max_feature_chars')
  max_feature_chars = (
    None
    if max_feature_chars_raw is None
    else parse_positive_int(max_feature_chars_raw, 'max_feature_chars')
  )
  selection_metadata = extract_optional_metadata(policy)

  canonical_policy = {
    'policy_version': 'risk-gate-v1',
    'created_at': datetime.now(timezone.utc).isoformat(),
    **thresholds,
    'local_model': local_model_artifact,
    'openai_model': openai_model_artifact,
    'sources': {
      'local_model': args.local_model,
      'openai_model': args.openai_model,
      'selected_policy': args.policy,
    },
  }
  if max_feature_chars is not None:
    canonical_policy['max_feature_chars'] = max_feature_chars
  if selection_metadata:
    canonical_policy['selection'] = selection_metadata

  write_json(out_dir / REQUIRED_FILENAMES['local_model'], local_model)
  write_json(out_dir / REQUIRED_FILENAMES['openai_model'], openai_model)
  write_json(out_dir / REQUIRED_FILENAMES['policy'], canonical_policy)
  write_json(out_dir / REQUIRED_FILENAMES['feature_schema'], feature_schema)

  combined_metrics = {
    'artifact_version': 'risk-gate-v1',
    'generated_at': datetime.now(timezone.utc).isoformat(),
    'sources': {
      'local_model': args.local_model,
      'openai_model': args.openai_model,
      'policy': args.policy,
      'feature_schema': args.feature_schema,
      'local_metrics': args.local_metrics,
      'openai_metrics': args.openai_metrics,
      'policy_metrics': args.policy_metrics,
    },
    'local': local_metrics,
    'openai': openai_metrics,
    'policy': policy_metrics,
  }
  write_json(out_dir / REQUIRED_FILENAMES['metrics'], combined_metrics)

  print('Artifact export complete.')
  for key, filename in REQUIRED_FILENAMES.items():
    print(f'  {key}: {out_dir / filename}')

  return 0


if __name__ == '__main__':
  raise SystemExit(main())
