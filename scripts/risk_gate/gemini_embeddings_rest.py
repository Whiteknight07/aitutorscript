#!/usr/bin/env python3
"""
Embed all tutor draft texts using the Gemini REST API (batchEmbedContents).

Reads:  tmp/risk_gate/turn_dataset.jsonl
Writes: tmp/risk_gate/gemini_draft_embeddings.jsonl  (incremental, resume-safe)
"""

import json, os, sys, time, pathlib, urllib.request, urllib.error

API_KEY = "AIzaSyDrP0ya330S_q8fxO-vcBRAnKawMGoV7_U"
MODEL = "gemini-embedding-2-preview"
BATCH_URL = (
    f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}"
    f":batchEmbedContents?key={API_KEY}"
)
BATCH_SIZE = 10           # smaller batches = fewer RPM per request
MIN_TEXT_LEN = 10         # skip drafts shorter than this
SLEEP_BETWEEN = 0.7       # 10 texts * ~85 req/min = ~850 texts/min
BACKOFF_START = 5         # initial retry wait on 429
BACKOFF_MAX = 60          # max retry wait

ROOT = pathlib.Path(__file__).resolve().parents[2]
INPUT_PATH  = ROOT / "tmp" / "risk_gate" / "turn_dataset.jsonl"
OUTPUT_PATH = ROOT / "tmp" / "risk_gate" / "gemini_draft_embeddings.jsonl"


def load_input_rows():
    """Return list of (example_id, text) from the dataset."""
    rows = []
    with open(INPUT_PATH) as f:
        for line in f:
            row = json.loads(line)
            eid = row["example_id"]
            draft = row.get("tutor_draft_iter1") or {}
            text = draft.get("text", "") if isinstance(draft, dict) else ""
            if len(text.strip()) < MIN_TEXT_LEN:
                continue
            rows.append((eid, text))
    return rows


def load_done_ids():
    """Return set of example_ids already in the output file."""
    done = set()
    if OUTPUT_PATH.exists():
        with open(OUTPUT_PATH) as f:
            for line in f:
                try:
                    done.add(json.loads(line)["example_id"])
                except Exception:
                    pass
    return done


def call_batch_embed(texts: list[str]) -> list[list[float]]:
    """Call batchEmbedContents. Returns list of embedding vectors."""
    body = {
        "requests": [
            {
                "model": f"models/{MODEL}",
                "content": {"parts": [{"text": t}]},
            }
            for t in texts
        ]
    }
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        BATCH_URL,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    backoff = BACKOFF_START
    while True:
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                result = json.loads(resp.read())
            return [e["values"] for e in result["embeddings"]]
        except urllib.error.HTTPError as e:
            if e.code == 429:
                print(f"  429 rate-limited — backing off {backoff}s …")
                time.sleep(backoff)
                backoff = min(backoff * 2, BACKOFF_MAX)
                continue
            else:
                raise
        except urllib.error.URLError as e:
            print(f"  Network error: {e} — retrying in {backoff}s …")
            time.sleep(backoff)
            backoff = min(backoff * 2, BACKOFF_MAX)
            continue


def main():
    t0 = time.time()

    # 1. Load data
    rows = load_input_rows()
    print(f"Loaded {len(rows)} rows with valid draft text from {INPUT_PATH.name}")

    # 2. Resume support
    done_ids = load_done_ids()
    if done_ids:
        print(f"Resuming — {len(done_ids)} already embedded, skipping them")
    todo = [(eid, text) for eid, text in rows if eid not in done_ids]
    print(f"To embed: {len(todo)}")

    if not todo:
        print("Nothing to do.")
        return

    # 3. Process in batches
    total_embedded = 0
    errors = 0
    out_f = open(OUTPUT_PATH, "a")

    try:
        for i in range(0, len(todo), BATCH_SIZE):
            batch = todo[i : i + BATCH_SIZE]
            eids = [eid for eid, _ in batch]
            texts = [text for _, text in batch]

            try:
                vectors = call_batch_embed(texts)
            except Exception as e:
                print(f"  ERROR on batch starting at {i}: {e}")
                errors += len(batch)
                continue

            for eid, vec in zip(eids, vectors):
                out_f.write(
                    json.dumps(
                        {
                            "example_id": eid,
                            "embedding": vec,
                            "embedding_model": MODEL,
                        }
                    )
                    + "\n"
                )
            out_f.flush()
            total_embedded += len(vectors)

            if total_embedded % 1000 < BATCH_SIZE:
                elapsed = time.time() - t0
                rate = total_embedded / elapsed if elapsed else 0
                print(
                    f"  Progress: {total_embedded}/{len(todo)} "
                    f"({total_embedded*100//len(todo)}%) — "
                    f"{rate:.0f} emb/s — {elapsed:.1f}s elapsed"
                )

            time.sleep(SLEEP_BETWEEN)
    finally:
        out_f.close()

    elapsed = time.time() - t0
    print(f"\nDone.  Total time: {elapsed:.1f}s")
    print(f"  Embeddings written: {total_embedded}")
    print(f"  Errors (skipped):   {errors}")
    print(f"  Output: {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
