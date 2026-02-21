#!/usr/bin/env python3
"""Prepare OpenAI Batch API requests for embeddings from extracted risk-gate rows."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
  parser = argparse.ArgumentParser(
    description=(
      'Create JSONL requests for OpenAI Batch embeddings. '
      'Each request uses custom_id=example_id and body.input=feature_text.'
    )
  )
  parser.add_argument('--dataset', required=True, help='Extracted dataset JSONL path.')
  parser.add_argument('--output-jsonl', required=True, help='Output JSONL path for OpenAI Batch requests.')
  parser.add_argument(
    '--manifest-out',
    default='tmp/risk_gate/openai_batch_manifest.json',
    help='Summary manifest JSON path.',
  )
  parser.add_argument(
    '--embedding-model',
    default='text-embedding-3-large',
    help='Embedding model to request in each batch line.',
  )
  parser.add_argument('--id-field', default='example_id', help='Row field used as custom_id.')
  parser.add_argument('--text-field', default='feature_text', help='Row field sent as embeddings input text.')
  parser.add_argument(
    '--max-rows',
    type=int,
    default=None,
    help='Optional cap on number of rows emitted.',
  )
  return parser.parse_args()


def iter_jsonl(path: Path):
  with path.open('r', encoding='utf-8') as fh:
    for line_number, line in enumerate(fh, start=1):
      text = line.strip()
      if not text:
        continue
      yield line_number, json.loads(text)


def main() -> int:
  args = parse_args()
  dataset_path = Path(args.dataset)
  output_path = Path(args.output_jsonl)
  manifest_path = Path(args.manifest_out)

  if not dataset_path.exists():
    raise SystemExit(f'Dataset not found: {dataset_path}')

  output_path.parent.mkdir(parents=True, exist_ok=True)
  manifest_path.parent.mkdir(parents=True, exist_ok=True)

  emitted = 0
  skipped_missing_id = 0
  skipped_missing_text = 0
  seen_ids: set[str] = set()
  duplicate_ids = 0

  with output_path.open('w', encoding='utf-8') as out_fh:
    for _, row in iter_jsonl(dataset_path):
      custom_id = str(row.get(args.id_field, '')).strip()
      text = str(row.get(args.text_field, '')).strip()

      if not custom_id:
        skipped_missing_id += 1
        continue
      if not text:
        skipped_missing_text += 1
        continue
      if custom_id in seen_ids:
        duplicate_ids += 1
      seen_ids.add(custom_id)

      request = {
        'custom_id': custom_id,
        'method': 'POST',
        'url': '/v1/embeddings',
        'body': {
          'model': args.embedding_model,
          'input': text,
          'encoding_format': 'float',
        },
      }
      out_fh.write(json.dumps(request, ensure_ascii=True) + '\n')
      emitted += 1
      if args.max_rows is not None and emitted >= args.max_rows:
        break

  manifest = {
    'generated_at': datetime.now(timezone.utc).isoformat(),
    'dataset': str(dataset_path),
    'output_jsonl': str(output_path),
    'embedding_model': args.embedding_model,
    'id_field': args.id_field,
    'text_field': args.text_field,
    'counts': {
      'emitted_requests': emitted,
      'skipped_missing_id': skipped_missing_id,
      'skipped_missing_text': skipped_missing_text,
      'duplicate_ids_seen': duplicate_ids,
    },
  }

  with manifest_path.open('w', encoding='utf-8') as fh:
    json.dump(manifest, fh, indent=2, sort_keys=True)
    fh.write('\n')

  print('OpenAI batch request preparation complete.')
  print(f'  dataset: {dataset_path}')
  print(f'  output_jsonl: {output_path}')
  print(f'  manifest: {manifest_path}')
  print(f'  emitted_requests: {emitted}')
  print(f'  skipped_missing_id: {skipped_missing_id}')
  print(f'  skipped_missing_text: {skipped_missing_text}')
  print(f'  duplicate_ids_seen: {duplicate_ids}')
  return 0


if __name__ == '__main__':
  raise SystemExit(main())
