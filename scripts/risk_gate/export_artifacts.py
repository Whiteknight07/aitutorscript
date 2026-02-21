#!/usr/bin/env python3
"""Export trained risk-gate artifacts to models/risk-gate/v1."""

from __future__ import annotations

import argparse
import json
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

  write_json(out_dir / REQUIRED_FILENAMES['local_model'], local_model)
  write_json(out_dir / REQUIRED_FILENAMES['openai_model'], openai_model)
  write_json(out_dir / REQUIRED_FILENAMES['policy'], policy)
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
