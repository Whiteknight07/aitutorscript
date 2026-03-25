#!/usr/bin/env python3
"""
Submit Gemini embedding batch jobs for tutor draft texts.

Creates two batch jobs:
  1. draft-only  — embed tutor_draft_iter1.text
  2. fulltext    — embed feature_text

Uses the google-genai SDK to upload JSONL files and create embedding batch jobs.
"""

import json
import os
import sys
import time
from pathlib import Path

from google import genai
from google.genai import types

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
API_KEY = "AIzaSyDrP0ya330S_q8fxO-vcBRAnKawMGoV7_U"
MODEL = "gemini-embedding-2-preview"
DATASET_PATH = Path("tmp/risk_gate/turn_dataset.jsonl")
TMP_DIR = Path("tmp/risk_gate")

MAX_FILE_BYTES = 2_000_000_000  # 2 GB safety limit
MAX_LINES_PER_FILE = 100_000    # Gemini batch limit

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def read_dataset(path: Path):
    """Read the JSONL dataset and yield (example_id, draft_text, feature_text)."""
    with open(path) as f:
        for line in f:
            row = json.loads(line)
            example_id = row["example_id"]
            draft_text = row.get("tutor_draft_iter1", {}).get("text", "")
            feature_text = row.get("feature_text", "")
            yield example_id, draft_text, feature_text


def make_batch_line(example_id: str, text: str) -> str:
    """Return a single Gemini-batch-format JSON line."""
    obj = {
        "key": example_id,
        "request": {
            "content": {"parts": [{"text": text}]},
        },
    }
    return json.dumps(obj, ensure_ascii=False)


def write_batch_jsonl(rows, output_prefix: str):
    """
    Write batch input JSONL file(s).  Splits into parts if the file would
    exceed MAX_FILE_BYTES or MAX_LINES_PER_FILE.

    Returns a list of file paths written.
    """
    files_written: list[Path] = []
    part = 0
    current_size = 0
    current_lines = 0
    fh = None

    def _open_next():
        nonlocal fh, part, current_size, current_lines
        if fh:
            fh.close()
        suffix = f"_part{part}" if part > 0 or files_written else ""
        # If this is the first part, write without suffix; we'll rename later
        # if we never need a second part.
        path = TMP_DIR / f"{output_prefix}{suffix}.jsonl"
        fh = open(path, "w")
        files_written.append(path)
        current_size = 0
        current_lines = 0
        part += 1

    _open_next()

    for example_id, text in rows:
        line = make_batch_line(example_id, text) + "\n"
        line_bytes = len(line.encode("utf-8"))

        if current_lines >= MAX_LINES_PER_FILE or (current_size + line_bytes) > MAX_FILE_BYTES:
            _open_next()

        fh.write(line)
        current_size += line_bytes
        current_lines += 1

    if fh:
        fh.close()

    # If we wrote only one file but it got the _part0 suffix, rename it
    if len(files_written) == 1 and "_part" in files_written[0].name:
        clean = TMP_DIR / f"{output_prefix}.jsonl"
        files_written[0].rename(clean)
        files_written[0] = clean

    return files_written


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print("=== Gemini Embedding Batch Submission ===\n")

    # 1. Read dataset
    print(f"Reading dataset from {DATASET_PATH} ...")
    draft_rows = []
    fulltext_rows = []
    for eid, draft, feature in read_dataset(DATASET_PATH):
        if draft:
            draft_rows.append((eid, draft))
        if feature:
            fulltext_rows.append((eid, feature))
    print(f"  draft rows:    {len(draft_rows):,}")
    print(f"  fulltext rows: {len(fulltext_rows):,}")

    # 2. Write JSONL input files
    print("\nWriting batch input JSONL files ...")
    draft_files = write_batch_jsonl(draft_rows, "gemini_batch_draft_input")
    fulltext_files = write_batch_jsonl(fulltext_rows, "gemini_batch_fulltext_input")

    for f in draft_files + fulltext_files:
        sz = f.stat().st_size
        lines = sum(1 for _ in open(f))
        print(f"  {f.name}: {lines:,} lines, {sz / 1e6:.1f} MB")

    # 3. Submit batch jobs
    print("\nConnecting to Gemini API ...")
    client = genai.Client(api_key=API_KEY)

    manifest = {"jobs": [], "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}

    all_files = [
        ("draft", draft_files),
        ("fulltext", fulltext_files),
    ]

    for label, file_list in all_files:
        for file_path in file_list:
            print(f"\n--- Uploading {file_path.name} ---")
            uploaded = client.files.upload(
                file=str(file_path),
                config=types.UploadFileConfig(
                    display_name=file_path.stem,
                    mime_type="jsonl",
                ),
            )
            print(f"  Uploaded: {uploaded.name}")

            display = f"risk-gate-{label}-{file_path.stem}"
            print(f"  Submitting batch job: {display} ...")
            batch_job = client.batches.create_embeddings(
                model=MODEL,
                src={"file_name": uploaded.name},
                config={"display_name": display},
            )
            print(f"  Batch job name: {batch_job.name}")
            print(f"  State:          {batch_job.state}")

            manifest["jobs"].append({
                "label": label,
                "input_file": str(file_path),
                "uploaded_file_name": uploaded.name,
                "batch_job_name": batch_job.name,
                "display_name": display,
                "model": MODEL,
                "state": str(batch_job.state),
            })

    # 4. Save manifest
    manifest_path = TMP_DIR / "gemini_batch_manifest.json"
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"\nManifest saved to {manifest_path}")

    # 5. Summary
    print("\n=== Summary ===")
    for job in manifest["jobs"]:
        print(f"  [{job['label']}] {job['batch_job_name']}  ({job['state']})")

    print("\nDone. Use the batch job names above to poll for completion.")


if __name__ == "__main__":
    main()
