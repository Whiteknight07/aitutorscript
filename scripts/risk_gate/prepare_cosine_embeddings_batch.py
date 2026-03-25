#!/usr/bin/env python3
"""Prepare and submit an OpenAI Batch API request for cosine-similarity embeddings.

For each row in the turn dataset, creates TWO embedding requests:
  - {example_id}::draft  -> tutor_draft_iter1.text
  - {example_id}::ref    -> question.referenceAnswerDescription

These separate embeddings let us compute cosine similarity between the tutor
draft and the reference answer in embedding space.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
DATASET_PATH = Path('tmp/risk_gate/turn_dataset.jsonl')
OUTPUT_JSONL = Path('tmp/risk_gate/openai_cosine_batch_input.jsonl')
MANIFEST_PATH = Path('tmp/risk_gate/openai_cosine_batch_manifest.json')
EMBEDDING_MODEL = 'text-embedding-3-large'
MIN_TEXT_LEN = 10
API_BASE = 'https://api.openai.com/v1'


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def iter_jsonl(path: Path):
    with path.open('r', encoding='utf-8') as fh:
        for line in fh:
            text = line.strip()
            if not text:
                continue
            yield json.loads(text)


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


def resolve_api_key() -> str:
    env_key = os.getenv('OPENAI_API_KEY')
    if env_key:
        return env_key
    dotenv_key = parse_dotenv(Path('.env')).get('OPENAI_API_KEY')
    if dotenv_key:
        return dotenv_key
    raise SystemExit('OPENAI_API_KEY is not set. Set env var or .env before running.')


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('w', encoding='utf-8') as fh:
        json.dump(payload, fh, indent=2, sort_keys=True)
        fh.write('\n')


def make_request(custom_id: str, text: str) -> dict[str, Any]:
    return {
        'custom_id': custom_id,
        'method': 'POST',
        'url': '/v1/embeddings',
        'body': {
            'input': text,
            'model': EMBEDDING_MODEL,
        },
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    if not DATASET_PATH.exists():
        raise SystemExit(f'Dataset not found: {DATASET_PATH}')

    OUTPUT_JSONL.parent.mkdir(parents=True, exist_ok=True)

    total_rows = 0
    emitted = 0
    skipped = 0

    with OUTPUT_JSONL.open('w', encoding='utf-8') as out_fh:
        for row in iter_jsonl(DATASET_PATH):
            total_rows += 1
            example_id = row.get('example_id', '')

            # Extract draft text
            draft_obj = row.get('tutor_draft_iter1') or {}
            draft_text = (draft_obj.get('text') or '').strip()

            # Extract reference answer text
            question_obj = row.get('question') or {}
            ref_text = (question_obj.get('referenceAnswerDescription') or '').strip()

            if len(draft_text) < MIN_TEXT_LEN or len(ref_text) < MIN_TEXT_LEN:
                skipped += 1
                continue

            out_fh.write(json.dumps(make_request(f'{example_id}::draft', draft_text), ensure_ascii=True) + '\n')
            out_fh.write(json.dumps(make_request(f'{example_id}::ref', ref_text), ensure_ascii=True) + '\n')
            emitted += 2

    print(f'Preparation complete.')
    print(f'  total_rows: {total_rows}')
    print(f'  requests_emitted: {emitted}')
    print(f'  rows_skipped: {skipped}')
    print(f'  output: {OUTPUT_JSONL}')

    # ------------------------------------------------------------------
    # Submit batch to OpenAI
    # ------------------------------------------------------------------
    api_key = resolve_api_key()
    headers = {'Authorization': f'Bearer {api_key}'}

    print('\nUploading JSONL to OpenAI Files API ...')
    with OUTPUT_JSONL.open('rb') as fh:
        upload_resp = requests.post(
            f'{API_BASE}/files',
            headers=headers,
            data={'purpose': 'batch'},
            files={'file': (OUTPUT_JSONL.name, fh, 'application/jsonl')},
            timeout=120,
        )
    if not upload_resp.ok:
        raise SystemExit(f'File upload failed: HTTP {upload_resp.status_code} {upload_resp.text[:1000]}')

    file_id = upload_resp.json().get('id')
    print(f'  file_id: {file_id}')

    print('Creating batch job ...')
    batch_body = {
        'input_file_id': file_id,
        'endpoint': '/v1/embeddings',
        'completion_window': '24h',
    }
    batch_resp = requests.post(
        f'{API_BASE}/batches',
        headers={**headers, 'Content-Type': 'application/json'},
        data=json.dumps(batch_body),
        timeout=120,
    )
    if not batch_resp.ok:
        raise SystemExit(f'Batch creation failed: HTTP {batch_resp.status_code} {batch_resp.text[:1000]}')

    batch_payload = batch_resp.json()
    batch_id = batch_payload.get('id')
    status = batch_payload.get('status')

    manifest = {
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'dataset': str(DATASET_PATH),
        'output_jsonl': str(OUTPUT_JSONL),
        'embedding_model': EMBEDDING_MODEL,
        'counts': {
            'total_rows': total_rows,
            'requests_emitted': emitted,
            'rows_skipped': skipped,
        },
        'submission': {
            'submitted_at': datetime.now(timezone.utc).isoformat(),
            'input_file_id': file_id,
            'batch_id': batch_id,
            'status': status,
            'request_counts': batch_payload.get('request_counts'),
        },
    }
    write_json(MANIFEST_PATH, manifest)

    print(f'\nBatch submitted successfully.')
    print(f'  batch_id: {batch_id}')
    print(f'  status: {status}')
    print(f'  manifest: {MANIFEST_PATH}')
    print(f'\nCheck status:')
    print(f'  curl {API_BASE}/batches/{batch_id} -H "Authorization: Bearer $OPENAI_API_KEY"')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
