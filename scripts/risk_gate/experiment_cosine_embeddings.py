#!/usr/bin/env python3
"""
Experiment: evaluate cosine-embedding features for risk-gate classification.

Loads draft/ref cosine embeddings from the OpenAI Batch API output,
computes cosine similarity per example, and evaluates several LR model
combinations against the holdout set.
"""

import json
import numpy as np
from pathlib import Path
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score, average_precision_score, recall_score

ROOT = Path(__file__).resolve().parents[2]
TMP = ROOT / "tmp" / "risk_gate"

# ── 1. Load cosine batch output (draft & ref embeddings) ────────────────────

draft_embs: dict[str, list[float]] = {}
ref_embs: dict[str, list[float]] = {}

with open(TMP / "openai_cosine_batch_output.jsonl") as f:
    for line in f:
        obj = json.loads(line)
        custom_id: str = obj["custom_id"]
        embedding = obj["response"]["body"]["data"][0]["embedding"]
        # custom_id format: "{example_id}::draft" or "{example_id}::ref"
        example_id, role = custom_id.rsplit("::", 1)
        if role == "draft":
            draft_embs[example_id] = embedding
        elif role == "ref":
            ref_embs[example_id] = embedding

cosine_ids = sorted(set(draft_embs) & set(ref_embs))
print(f"Loaded {len(cosine_ids)} example pairs from cosine batch output")

# ── 2. Compute cosine similarity per example ────────────────────────────────

cosine_sims: dict[str, float] = {}
for eid in cosine_ids:
    d = np.array(draft_embs[eid])
    r = np.array(ref_embs[eid])
    sim = float(np.dot(d, r) / (np.linalg.norm(d) * np.linalg.norm(r) + 1e-12))
    cosine_sims[eid] = sim

# ── 3. Load full-text embeddings ────────────────────────────────────────────

fulltext_embs: dict[str, list[float]] = {}
with open(TMP / "openai_embeddings.jsonl") as f:
    for line in f:
        obj = json.loads(line)
        fulltext_embs[obj["example_id"]] = obj["embedding"]

print(f"Loaded {len(fulltext_embs)} full-text embeddings")

# ── 4. Load dataset (labels + splits) ───────────────────────────────────────

labels: dict[str, int] = {}
splits: dict[str, str] = {}
with open(TMP / "turn_dataset.jsonl") as f:
    for line in f:
        obj = json.loads(line)
        eid = obj["example_id"]
        labels[eid] = int(obj["y_needs_supervision"])
        splits[eid] = obj["split"]

print(f"Loaded {len(labels)} dataset rows")

# ── 5. Build feature matrices for each model variant ────────────────────────

# Common ids: must have cosine embeddings, full-text embedding, and label
all_ids = sorted(
    set(cosine_ids) & set(fulltext_embs) & set(labels)
)
print(f"Common examples across all sources: {len(all_ids)}")

train_ids = [eid for eid in all_ids if splits[eid] == "train"]
hold_ids  = [eid for eid in all_ids if splits[eid] == "holdout"]
print(f"Train: {len(train_ids)}  Holdout: {len(hold_ids)}")

y_train = np.array([labels[eid] for eid in train_ids])
y_hold  = np.array([labels[eid] for eid in hold_ids])

def make_features(ids, feature_fn):
    return np.array([feature_fn(eid) for eid in ids])

def lr():
    return LogisticRegression(
        class_weight="balanced", max_iter=5000, solver="lbfgs", random_state=42
    )

models = {
    "a) Cosine sim alone": lambda eid: [cosine_sims[eid]],
    "b) Full-text + cosine sim": lambda eid: fulltext_embs[eid] + [cosine_sims[eid]],
    "c) Draft emb only": lambda eid: draft_embs[eid],
    "d) Ref emb only": lambda eid: ref_embs[eid],
    "e) Draft + Ref concat": lambda eid: draft_embs[eid] + ref_embs[eid],
    "f) Draft + Ref + cosine sim": lambda eid: draft_embs[eid] + ref_embs[eid] + [cosine_sims[eid]],
    "g) Full-text + Draft + Ref + cosine": lambda eid: fulltext_embs[eid] + draft_embs[eid] + ref_embs[eid] + [cosine_sims[eid]],
}

results = []

for name, feat_fn in models.items():
    X_tr = make_features(train_ids, feat_fn)
    X_ho = make_features(hold_ids, feat_fn)
    dim = X_tr.shape[1]

    clf = lr()
    clf.fit(X_tr, y_train)
    probs = clf.predict_proba(X_ho)[:, 1]

    roc = roc_auc_score(y_hold, probs)
    pr  = average_precision_score(y_hold, probs)
    results.append((name, dim, roc, pr, probs))
    print(f"  {name} (dim={dim}): ROC={roc:.4f}  PR={pr:.4f}")

# ── 6. Print comparison table sorted by ROC AUC ─────────────────────────────

results.sort(key=lambda r: r[2], reverse=True)

print("\n" + "=" * 80)
print(f"{'Model':<45} {'Dim':>5}  {'ROC AUC':>8}  {'PR AUC':>8}")
print("-" * 80)
for name, dim, roc, pr, _ in results:
    print(f"{name:<45} {dim:>5}  {roc:>8.4f}  {pr:>8.4f}")
print("=" * 80)

# ── 7. Best model: recall at various thresholds ─────────────────────────────

best_name, best_dim, best_roc, best_pr, best_probs = results[0]
print(f"\nBest model: {best_name} (ROC AUC={best_roc:.4f})")
print(f"\n{'Threshold':>10}  {'Recall':>8}  {'Precision':>10}  {'N flagged':>10}")
print("-" * 45)
for t in [0.10, 0.15, 0.20, 0.25, 0.30, 0.40, 0.50]:
    preds = (best_probs >= t).astype(int)
    rec = recall_score(y_hold, preds, zero_division=0)
    # precision
    tp = ((preds == 1) & (y_hold == 1)).sum()
    fp = ((preds == 1) & (y_hold == 0)).sum()
    prec = tp / (tp + fp) if (tp + fp) > 0 else 0.0
    flagged = preds.sum()
    print(f"{t:>10.2f}  {rec:>8.4f}  {prec:>10.4f}  {flagged:>10}")
