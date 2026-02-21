#!/usr/bin/env python3
"""Submit prepared OpenAI Batch JSONL to Files API and create a Batch job."""

from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests


def parse_args() -> argparse.Namespace:
  parser = argparse.ArgumentParser(
    description=(
      'Upload prepared batch JSONL to OpenAI Files API and create a Batch job. '
      'Writes submission metadata back to manifest JSON.'
    )
  )
  parser.add_argument(
    '--input-jsonl',
    default='tmp/risk_gate/openai_batch_input.jsonl',
    help='Prepared batch request JSONL path.',
  )
  parser.add_argument(
    '--manifest-path',
    default='tmp/risk_gate/openai_batch_manifest.json',
    help='Manifest JSON path to update with submission metadata.',
  )
  parser.add_argument(
    '--endpoint',
    default='/v1/embeddings',
    help='Batch endpoint. For current risk-gate flow this should stay /v1/embeddings.',
  )
  parser.add_argument(
    '--completion-window',
    default='24h',
    help='Batch completion window (currently 24h).',
  )
  parser.add_argument(
    '--metadata-json',
    default=None,
    help='Optional JSON object string for batch metadata.',
  )
  parser.add_argument(
    '--api-base',
    default='https://api.openai.com/v1',
    help='OpenAI API base URL.',
  )
  parser.add_argument(
    '--timeout-sec',
    type=float,
    default=120.0,
    help='HTTP timeout in seconds.',
  )
  parser.add_argument(
    '--api-key',
    default=None,
    help='Optional API key override. Defaults to OPENAI_API_KEY or .env lookup.',
  )
  return parser.parse_args()


def load_json(path: Path) -> dict[str, Any]:
  if not path.exists():
    return {}
  with path.open('r', encoding='utf-8') as fh:
    payload = json.load(fh)
  if not isinstance(payload, dict):
    raise SystemExit(f'Expected JSON object in manifest: {path}')
  return payload


def write_json(path: Path, payload: dict[str, Any]) -> None:
  path.parent.mkdir(parents=True, exist_ok=True)
  with path.open('w', encoding='utf-8') as fh:
    json.dump(payload, fh, indent=2, sort_keys=True)
    fh.write('\n')


def parse_metadata_json(raw: str | None) -> dict[str, Any] | None:
  if raw is None:
    return None
  try:
    parsed = json.loads(raw)
  except json.JSONDecodeError as exc:
    raise SystemExit(f'Invalid --metadata-json: {exc}') from exc
  if not isinstance(parsed, dict):
    raise SystemExit('--metadata-json must parse to a JSON object.')
  return parsed


def parse_dotenv(path: Path) -> dict[str, str]:
  values: dict[str, str] = {}
  if not path.exists():
    return values

  for line in path.read_text(encoding='utf-8').splitlines():
    text = line.strip()
    if not text or text.startswith('#'):
      continue
    if text.startswith('export '):
      text = text[len('export '):].strip()
    if '=' not in text:
      continue
    key, raw_value = text.split('=', 1)
    key = key.strip()
    value = raw_value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
      value = value[1:-1]
    values[key] = value
  return values


def resolve_api_key(explicit_key: str | None) -> str:
  if explicit_key:
    return explicit_key
  env_key = os.getenv('OPENAI_API_KEY')
  if env_key:
    return env_key

  dotenv_values = parse_dotenv(Path('.env'))
  dotenv_key = dotenv_values.get('OPENAI_API_KEY')
  if dotenv_key:
    return dotenv_key

  raise SystemExit('OPENAI_API_KEY is not set. Set env var or .env before submitting batch.')


def main() -> int:
  args = parse_args()

  input_path = Path(args.input_jsonl)
  manifest_path = Path(args.manifest_path)
  if not input_path.exists():
    raise SystemExit(f'Input JSONL not found: {input_path}')

  api_key = resolve_api_key(args.api_key)
  metadata = parse_metadata_json(args.metadata_json)
  api_base = args.api_base.rstrip('/')
  headers = {
    'Authorization': f'Bearer {api_key}',
  }

  with input_path.open('rb') as file_handle:
    upload_response = requests.post(
      f'{api_base}/files',
      headers=headers,
      data={'purpose': 'batch'},
      files={'file': (input_path.name, file_handle, 'application/jsonl')},
      timeout=args.timeout_sec,
    )
  if not upload_response.ok:
    raise SystemExit(
      f'File upload failed: HTTP {upload_response.status_code} {upload_response.text[:1000]}'
    )
  upload_payload = upload_response.json()
  input_file_id = upload_payload.get('id')
  if not isinstance(input_file_id, str) or not input_file_id:
    raise SystemExit(f'Upload response missing file id: {upload_payload}')

  batch_body: dict[str, Any] = {
    'input_file_id': input_file_id,
    'endpoint': args.endpoint,
    'completion_window': args.completion_window,
  }
  if metadata:
    batch_body['metadata'] = metadata

  batch_response = requests.post(
    f'{api_base}/batches',
    headers={
      **headers,
      'Content-Type': 'application/json',
    },
    data=json.dumps(batch_body),
    timeout=args.timeout_sec,
  )
  if not batch_response.ok:
    raise SystemExit(
      f'Batch creation failed: HTTP {batch_response.status_code} {batch_response.text[:1000]}'
    )
  batch_payload = batch_response.json()
  batch_id = batch_payload.get('id')
  status = batch_payload.get('status')

  manifest = load_json(manifest_path)
  submission = {
    'submitted_at': datetime.now(timezone.utc).isoformat(),
    'api_base': api_base,
    'input_jsonl': str(input_path),
    'endpoint': args.endpoint,
    'completion_window': args.completion_window,
    'input_file_id': input_file_id,
    'batch_id': batch_id,
    'status': status,
    'request_counts': batch_payload.get('request_counts'),
    'metadata': batch_payload.get('metadata'),
  }
  manifest['submission'] = submission
  write_json(manifest_path, manifest)

  print('OpenAI batch submission complete.')
  print(f'  input_jsonl: {input_path}')
  print(f'  input_file_id: {input_file_id}')
  print(f'  batch_id: {batch_id}')
  print(f'  status: {status}')
  print(f'  manifest_path: {manifest_path}')
  print('')
  print('Next:')
  print(f'  Check status: curl {api_base}/batches/{batch_id} -H \"Authorization: Bearer $OPENAI_API_KEY\"')
  print(
    '  When completed, download output: '
    f'curl {api_base}/files/<output_file_id>/content -H "Authorization: Bearer $OPENAI_API_KEY" '
    '> tmp/risk_gate/openai_batch_output.jsonl'
  )
  return 0


if __name__ == '__main__':
  raise SystemExit(main())
