#!/usr/bin/env python3
"""Collect OpenAI Batch embeddings output into a compact example_id -> embedding JSONL."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
  parser = argparse.ArgumentParser(
    description=(
      'Parse OpenAI Batch output JSONL and emit embeddings JSONL keyed by example_id. '
      'Optionally verifies coverage against extracted dataset rows.'
    )
  )
  parser.add_argument(
    '--batch-output-jsonl',
    required=True,
    help='Path to downloaded OpenAI Batch output JSONL file.',
  )
  parser.add_argument(
    '--output-embeddings-jsonl',
    required=True,
    help='Destination JSONL: {example_id, embedding, embedding_model, prompt_tokens}.',
  )
  parser.add_argument('--dataset', default=None, help='Optional extracted dataset JSONL path for coverage checks.')
  parser.add_argument('--id-field', default='example_id', help='Row ID field name in dataset file.')
  parser.add_argument(
    '--missing-out',
    default='tmp/risk_gate/openai_missing.json',
    help='Path for missing-id summary JSON.',
  )
  parser.add_argument(
    '--errors-out',
    default='tmp/risk_gate/openai_batch_errors.jsonl',
    help='Path for parsed batch errors JSONL.',
  )
  parser.add_argument(
    '--strict',
    action='store_true',
    help='Exit non-zero if dataset IDs are missing from collected embeddings.',
  )
  return parser.parse_args()


def iter_jsonl(path: Path):
  with path.open('r', encoding='utf-8') as fh:
    for line_number, line in enumerate(fh, start=1):
      text = line.strip()
      if not text:
        continue
      yield line_number, json.loads(text)


def load_dataset_ids(path: Path, id_field: str) -> set[str]:
  ids: set[str] = set()
  for _, row in iter_jsonl(path):
    value = str(row.get(id_field, '')).strip()
    if value:
      ids.add(value)
  return ids


def parse_embedding_record(payload: dict[str, Any]) -> tuple[str | None, list[float] | None, str | None, int | None, dict[str, Any] | None]:
  custom_id = payload.get('custom_id')
  if custom_id is not None:
    custom_id = str(custom_id)

  explicit_error = payload.get('error')
  if explicit_error:
    return custom_id, None, None, None, {
      'custom_id': custom_id,
      'reason': 'explicit_error',
      'error': explicit_error,
    }

  response = payload.get('response')
  if not isinstance(response, dict):
    return custom_id, None, None, None, {
      'custom_id': custom_id,
      'reason': 'missing_response',
      'payload': payload,
    }

  status_code = response.get('status_code')
  if status_code != 200:
    return custom_id, None, None, None, {
      'custom_id': custom_id,
      'reason': 'non_200_status',
      'status_code': status_code,
      'response': response,
    }

  body = response.get('body')
  if not isinstance(body, dict):
    return custom_id, None, None, None, {
      'custom_id': custom_id,
      'reason': 'missing_body',
      'response': response,
    }

  data = body.get('data')
  if not isinstance(data, list) or not data:
    return custom_id, None, None, None, {
      'custom_id': custom_id,
      'reason': 'missing_data',
      'body': body,
    }

  first = data[0]
  if not isinstance(first, dict):
    return custom_id, None, None, None, {
      'custom_id': custom_id,
      'reason': 'invalid_data_item',
      'body': body,
    }

  embedding = first.get('embedding')
  if not isinstance(embedding, list) or not embedding:
    return custom_id, None, None, None, {
      'custom_id': custom_id,
      'reason': 'missing_embedding',
      'body': body,
    }

  numeric_embedding: list[float] = []
  for value in embedding:
    if not isinstance(value, (int, float)):
      return custom_id, None, None, None, {
        'custom_id': custom_id,
        'reason': 'non_numeric_embedding',
        'body': body,
      }
    numeric_embedding.append(float(value))

  usage = body.get('usage') if isinstance(body.get('usage'), dict) else {}
  prompt_tokens = usage.get('prompt_tokens') if isinstance(usage, dict) else None
  prompt_tokens_int = int(prompt_tokens) if isinstance(prompt_tokens, (int, float)) else None
  model_name = str(body.get('model')) if body.get('model') is not None else None

  return custom_id, numeric_embedding, model_name, prompt_tokens_int, None


def main() -> int:
  args = parse_args()
  batch_output_path = Path(args.batch_output_jsonl)
  embeddings_out_path = Path(args.output_embeddings_jsonl)
  missing_out_path = Path(args.missing_out)
  errors_out_path = Path(args.errors_out)

  if not batch_output_path.exists():
    raise SystemExit(f'Batch output not found: {batch_output_path}')

  expected_ids: set[str] = set()
  if args.dataset:
    dataset_path = Path(args.dataset)
    if not dataset_path.exists():
      raise SystemExit(f'Dataset not found: {dataset_path}')
    expected_ids = load_dataset_ids(dataset_path, args.id_field)

  embeddings_out_path.parent.mkdir(parents=True, exist_ok=True)
  missing_out_path.parent.mkdir(parents=True, exist_ok=True)
  errors_out_path.parent.mkdir(parents=True, exist_ok=True)

  parsed = 0
  collected = 0
  duplicate_ids = 0
  errors = 0
  seen_ids: set[str] = set()

  with embeddings_out_path.open('w', encoding='utf-8') as embed_fh, errors_out_path.open('w', encoding='utf-8') as error_fh:
    for _, payload in iter_jsonl(batch_output_path):
      parsed += 1
      if not isinstance(payload, dict):
        errors += 1
        error_fh.write(json.dumps({'reason': 'non_object_payload', 'payload': payload}, ensure_ascii=True) + '\n')
        continue

      custom_id, embedding, model_name, prompt_tokens, error_obj = parse_embedding_record(payload)
      if error_obj is not None:
        errors += 1
        error_fh.write(json.dumps(error_obj, ensure_ascii=True) + '\n')
        continue

      if custom_id is None or embedding is None:
        errors += 1
        error_fh.write(
          json.dumps(
            {
              'reason': 'missing_custom_id_or_embedding_after_parse',
              'payload': payload,
            },
            ensure_ascii=True,
          )
          + '\n'
        )
        continue

      if custom_id in seen_ids:
        duplicate_ids += 1
      seen_ids.add(custom_id)

      row = {
        'example_id': custom_id,
        'embedding': embedding,
        'embedding_model': model_name,
        'prompt_tokens': prompt_tokens,
      }
      embed_fh.write(json.dumps(row, ensure_ascii=True) + '\n')
      collected += 1

  missing_ids = sorted(expected_ids - seen_ids) if expected_ids else []
  missing_summary = {
    'generated_at': datetime.now(timezone.utc).isoformat(),
    'batch_output_jsonl': str(batch_output_path),
    'dataset': args.dataset,
    'expected_id_count': len(expected_ids),
    'collected_id_count': len(seen_ids),
    'missing_count': len(missing_ids),
    'missing_ids': missing_ids,
    'duplicate_ids_seen': duplicate_ids,
    'parsed_lines': parsed,
    'collected_embeddings': collected,
    'error_count': errors,
  }

  with missing_out_path.open('w', encoding='utf-8') as fh:
    json.dump(missing_summary, fh, indent=2, sort_keys=True)
    fh.write('\n')

  print('OpenAI batch collection complete.')
  print(f'  batch_output_jsonl: {batch_output_path}')
  print(f'  output_embeddings_jsonl: {embeddings_out_path}')
  print(f'  errors_out: {errors_out_path}')
  print(f'  missing_out: {missing_out_path}')
  print(f'  parsed_lines: {parsed}')
  print(f'  collected_embeddings: {collected}')
  print(f'  duplicate_ids_seen: {duplicate_ids}')
  print(f'  error_count: {errors}')
  print(f'  missing_count: {len(missing_ids)}')

  if args.strict and missing_ids:
    return 1
  return 0


if __name__ == '__main__':
  raise SystemExit(main())
