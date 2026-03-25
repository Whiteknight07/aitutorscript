#!/usr/bin/env python3
"""Experiment: TF-IDF cosine similarity + text-overlap features for risk-gate classification.

Computes local text-similarity features (no API needed) and evaluates them alone
and combined with OpenAI embeddings and structured features.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, roc_auc_score
from xgboost import XGBClassifier

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
BASE = Path(__file__).resolve().parents[2]
DATASET_PATH = BASE / "tmp" / "risk_gate" / "turn_dataset.jsonl"
EMBEDDINGS_PATH = BASE / "tmp" / "risk_gate" / "openai_embeddings.jsonl"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def iter_jsonl(path: Path):
    with path.open("r", encoding="utf-8") as fh:
        for line in fh:
            text = line.strip()
            if text:
                yield json.loads(text)


def parse_label(value: Any) -> int | None:
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (int, float)):
        return int(bool(value))
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"1", "true", "yes"}:
            return 1
        if lowered in {"0", "false", "no"}:
            return 0
    return None


def tokenize(text: str) -> list[str]:
    return re.findall(r"\w+", text.lower())


def bigrams(tokens: list[str]) -> set[tuple[str, str]]:
    return {(tokens[i], tokens[i + 1]) for i in range(len(tokens) - 1)}


def extract_numbers(text: str) -> set[str]:
    return set(re.findall(r"-?\d+(?:\.\d+)?", text))


# ---------------------------------------------------------------------------
# Similarity features
# ---------------------------------------------------------------------------
def compute_similarity_features(
    tutor_texts: list[str], ref_texts: list[str]
) -> np.ndarray:
    """Return (N, 5) array of text-similarity features."""
    n = len(tutor_texts)

    # 1. TF-IDF cosine similarity
    vectorizer = TfidfVectorizer(max_features=10000, stop_words="english")
    all_texts = tutor_texts + ref_texts
    tfidf_matrix = vectorizer.fit_transform(all_texts)
    tutor_vecs = tfidf_matrix[:n]
    ref_vecs = tfidf_matrix[n:]
    # Cosine similarity row-by-row (both are sparse CSR)
    # dot product of L2-normalized vectors = cosine sim; TfidfVectorizer default is L2-normed
    cosine_sim = np.array(
        [float(tutor_vecs[i].dot(ref_vecs[i].T).toarray()[0, 0]) for i in range(n)]
    )

    # Pre-tokenize for remaining features
    tutor_tokens = [tokenize(t) for t in tutor_texts]
    ref_tokens = [tokenize(t) for t in ref_texts]

    # 2. Jaccard similarity (word-level)
    jaccard = np.zeros(n)
    for i in range(n):
        s_t = set(tutor_tokens[i])
        s_r = set(ref_tokens[i])
        union = s_t | s_r
        jaccard[i] = len(s_t & s_r) / len(union) if union else 0.0

    # 3. Bigram overlap ratio
    bigram_overlap = np.zeros(n)
    for i in range(n):
        bg_t = bigrams(tutor_tokens[i])
        bg_r = bigrams(ref_tokens[i])
        union = bg_t | bg_r
        bigram_overlap[i] = len(bg_t & bg_r) / len(union) if union else 0.0

    # 4. Substring match score (fraction of reference words in tutor draft)
    substr_score = np.zeros(n)
    for i in range(n):
        r_tokens = ref_tokens[i]
        if r_tokens:
            t_set = set(tutor_tokens[i])
            substr_score[i] = sum(1 for w in r_tokens if w in t_set) / len(r_tokens)

    # 5. Number overlap (bool: do numeric values from reference appear in tutor?)
    number_overlap = np.zeros(n)
    for i in range(n):
        ref_nums = extract_numbers(ref_texts[i])
        if ref_nums:
            tutor_nums = extract_numbers(tutor_texts[i])
            number_overlap[i] = float(bool(ref_nums & tutor_nums))

    return np.column_stack([cosine_sim, jaccard, bigram_overlap, substr_score, number_overlap])


SIMILARITY_FEATURE_NAMES = [
    "tfidf_cosine_sim",
    "jaccard_sim",
    "bigram_overlap",
    "substring_match",
    "number_overlap",
]

STRUCTURED_FEATURE_KEYS = [
    "turn_index",
    "student_attack_level",
    "question_bloom_level",
    "tutor_draft_len",
    "student_message_len",
    "tutor_draft_word_count",
    "student_message_word_count",
    "reference_answer_len",
    "len_ratio_draft_to_reference",
    "draft_has_equation",
    "draft_has_answer_phrase",
    "draft_has_numeric_value",
    "num_prior_student_turns",
    "question_difficulty",
]


# ---------------------------------------------------------------------------
# Metrics helpers
# ---------------------------------------------------------------------------
def compute_recall_at_threshold(y_true: np.ndarray, y_prob: np.ndarray, threshold: float) -> dict[str, Any]:
    y_pred = (y_prob >= threshold).astype(int)
    tp = int(np.sum((y_true == 1) & (y_pred == 1)))
    fp = int(np.sum((y_true == 0) & (y_pred == 1)))
    fn = int(np.sum((y_true == 1) & (y_pred == 0)))
    tn = int(np.sum((y_true == 0) & (y_pred == 0)))
    recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
    precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
    flagged_rate = (tp + fp) / len(y_true) if len(y_true) > 0 else 0.0
    return {
        "recall": recall,
        "precision": precision,
        "flagged_rate": flagged_rate,
        "tp": tp,
        "fp": fp,
        "fn": fn,
        "tn": tn,
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> None:
    print("=" * 80)
    print("EXPERIMENT: TF-IDF Cosine Similarity + Text Overlap Features")
    print("=" * 80)

    # ------------------------------------------------------------------
    # 1. Load dataset
    # ------------------------------------------------------------------
    print("\n[1] Loading dataset...")
    rows: list[dict[str, Any]] = []
    for row in iter_jsonl(DATASET_PATH):
        label = parse_label(row.get("y_needs_supervision"))
        if label is None:
            continue
        tutor_draft_text = (row.get("tutor_draft_iter1") or {}).get("text", "")
        ref_answer_text = (row.get("question") or {}).get("referenceAnswerDescription", "")
        rows.append({
            "example_id": row["example_id"],
            "split": row.get("split", "train"),
            "label": label,
            "tutor_draft_text": tutor_draft_text or "",
            "ref_answer_text": ref_answer_text or "",
            "feature_numeric": row.get("feature_numeric", {}),
        })

    print(f"  Loaded {len(rows)} rows")
    train_rows = [r for r in rows if r["split"] == "train"]
    holdout_rows = [r for r in rows if r["split"] == "holdout"]
    print(f"  Train: {len(train_rows)}  Holdout: {len(holdout_rows)}")
    print(f"  Train pos rate: {sum(r['label'] for r in train_rows) / len(train_rows):.3f}")
    print(f"  Holdout pos rate: {sum(r['label'] for r in holdout_rows) / len(holdout_rows):.3f}")

    # ------------------------------------------------------------------
    # 2. Compute text-similarity features
    # ------------------------------------------------------------------
    print("\n[2] Computing text similarity features...")
    all_tutor_texts = [r["tutor_draft_text"] for r in rows]
    all_ref_texts = [r["ref_answer_text"] for r in rows]
    sim_features = compute_similarity_features(all_tutor_texts, all_ref_texts)
    print(f"  Similarity feature matrix shape: {sim_features.shape}")

    # Print feature distributions
    for i, name in enumerate(SIMILARITY_FEATURE_NAMES):
        col = sim_features[:, i]
        print(f"    {name:25s}  mean={col.mean():.4f}  std={col.std():.4f}  "
              f"min={col.min():.4f}  max={col.max():.4f}")

    # ------------------------------------------------------------------
    # 3. Load OpenAI embeddings
    # ------------------------------------------------------------------
    print("\n[3] Loading OpenAI embeddings...")
    emb_map: dict[str, list[float]] = {}
    for row in iter_jsonl(EMBEDDINGS_PATH):
        eid = row.get("example_id", "")
        emb = row.get("embedding")
        if eid and isinstance(emb, list):
            emb_map[eid] = emb
    print(f"  Loaded {len(emb_map)} embeddings")

    # ------------------------------------------------------------------
    # 4. Build feature matrices
    # ------------------------------------------------------------------
    print("\n[4] Building feature matrices...")
    id_to_idx = {r["example_id"]: i for i, r in enumerate(rows)}
    labels = np.array([r["label"] for r in rows], dtype=np.int64)
    splits = np.array([r["split"] for r in rows])

    train_mask = splits == "train"
    holdout_mask = splits == "holdout"

    # Structured features
    struct_features = np.zeros((len(rows), len(STRUCTURED_FEATURE_KEYS)), dtype=np.float64)
    for i, r in enumerate(rows):
        fn = r["feature_numeric"]
        for j, key in enumerate(STRUCTURED_FEATURE_KEYS):
            val = fn.get(key, 0)
            struct_features[i, j] = float(val) if val is not None else 0.0

    # Embedding features (only for rows that have them)
    emb_dim = None
    emb_features = None
    emb_available = np.zeros(len(rows), dtype=bool)
    for i, r in enumerate(rows):
        emb = emb_map.get(r["example_id"])
        if emb is not None:
            if emb_dim is None:
                emb_dim = len(emb)
                emb_features = np.zeros((len(rows), emb_dim), dtype=np.float64)
            emb_features[i] = emb
            emb_available[i] = True

    n_with_emb = int(emb_available.sum())
    print(f"  Rows with embeddings: {n_with_emb}/{len(rows)}")
    print(f"  Embedding dim: {emb_dim}")
    print(f"  Structured features: {struct_features.shape[1]}")

    # Use only rows that have embeddings for embedding-based models
    # For sim-only models, use all rows
    has_emb_train = train_mask & emb_available
    has_emb_holdout = holdout_mask & emb_available

    print(f"  Train with embeddings: {has_emb_train.sum()}")
    print(f"  Holdout with embeddings: {has_emb_holdout.sum()}")

    # ------------------------------------------------------------------
    # 5. Define model configurations
    # ------------------------------------------------------------------
    thresholds = [0.1, 0.2, 0.3, 0.5]

    configs: list[dict[str, Any]] = [
        {
            "name": "(a) SimFeats + LR",
            "X": sim_features,
            "train_mask": train_mask,
            "holdout_mask": holdout_mask,
            "model_fn": lambda: LogisticRegression(
                class_weight="balanced", max_iter=2000, C=1.0, solver="lbfgs", random_state=42
            ),
        },
        {
            "name": "(b) SimFeats + XGB",
            "X": sim_features,
            "train_mask": train_mask,
            "holdout_mask": holdout_mask,
            "model_fn": lambda: XGBClassifier(
                max_depth=3, n_estimators=200, learning_rate=0.05,
                scale_pos_weight=sum(train_mask & (labels == 0)) / max(sum(train_mask & (labels == 1)), 1),
                random_state=42, eval_metric="logloss", verbosity=0,
            ),
        },
        {
            "name": "(c) Emb+Sim + LR",
            "X": np.hstack([emb_features, sim_features]),
            "train_mask": has_emb_train,
            "holdout_mask": has_emb_holdout,
            "model_fn": lambda: LogisticRegression(
                class_weight="balanced", max_iter=2000, C=1.0, solver="lbfgs", random_state=42
            ),
        },
        {
            "name": "(d) Emb+Sim+Struct + LR",
            "X": np.hstack([emb_features, sim_features, struct_features]),
            "train_mask": has_emb_train,
            "holdout_mask": has_emb_holdout,
            "model_fn": lambda: LogisticRegression(
                class_weight="balanced", max_iter=2000, C=1.0, solver="lbfgs", random_state=42
            ),
        },
        {
            "name": "(e) Emb+Sim+Struct + XGB",
            "X": np.hstack([emb_features, sim_features, struct_features]),
            "train_mask": has_emb_train,
            "holdout_mask": has_emb_holdout,
            "model_fn": lambda: XGBClassifier(
                max_depth=3, n_estimators=500, learning_rate=0.01,
                reg_alpha=1.0, reg_lambda=5.0, min_child_weight=10,
                subsample=0.7, colsample_bytree=0.3,
                scale_pos_weight=sum(has_emb_train & (labels == 0)) / max(sum(has_emb_train & (labels == 1)), 1),
                random_state=42, eval_metric="logloss", verbosity=0,
            ),
        },
    ]

    # ------------------------------------------------------------------
    # 6. Train and evaluate
    # ------------------------------------------------------------------
    print("\n[5] Training and evaluating models...")
    print("=" * 80)

    results: list[dict[str, Any]] = []

    for cfg in configs:
        name = cfg["name"]
        X = cfg["X"]
        tr = cfg["train_mask"]
        ho = cfg["holdout_mask"]
        clf = cfg["model_fn"]()

        X_train, y_train = X[tr], labels[tr]
        X_holdout, y_holdout = X[ho], labels[ho]

        print(f"\n--- {name} ---")
        print(f"  Train: {len(y_train)} (pos={y_train.sum()}, neg={len(y_train)-y_train.sum()})  "
              f"Features: {X_train.shape[1]}")
        print(f"  Holdout: {len(y_holdout)} (pos={y_holdout.sum()}, neg={len(y_holdout)-y_holdout.sum()})")

        clf.fit(X_train, y_train)

        if hasattr(clf, "predict_proba"):
            prob_holdout = clf.predict_proba(X_holdout)[:, 1]
        else:
            prob_holdout = clf.decision_function(X_holdout)

        roc_auc = float(roc_auc_score(y_holdout, prob_holdout)) if len(np.unique(y_holdout)) > 1 else None
        pr_auc = float(average_precision_score(y_holdout, prob_holdout)) if len(np.unique(y_holdout)) > 1 else None

        print(f"  ROC AUC:  {roc_auc:.4f}" if roc_auc else "  ROC AUC:  N/A")
        print(f"  PR AUC:   {pr_auc:.4f}" if pr_auc else "  PR AUC:   N/A")

        threshold_results = {}
        for t in thresholds:
            m = compute_recall_at_threshold(y_holdout, prob_holdout, t)
            threshold_results[t] = m
            print(f"  @{t:.1f}  recall={m['recall']:.3f}  prec={m['precision']:.3f}  "
                  f"flagged={m['flagged_rate']:.3f}  (TP={m['tp']} FP={m['fp']} FN={m['fn']} TN={m['tn']})")

        results.append({
            "name": name,
            "roc_auc": roc_auc,
            "pr_auc": pr_auc,
            "n_features": X_train.shape[1],
            "n_train": len(y_train),
            "n_holdout": len(y_holdout),
            "thresholds": threshold_results,
        })

    # ------------------------------------------------------------------
    # 7. Comprehensive comparison table
    # ------------------------------------------------------------------
    print("\n\n" + "=" * 120)
    print("COMPREHENSIVE COMPARISON TABLE")
    print("=" * 120)

    # Header
    header = f"{'Model':<32s} {'#Feat':>6s} {'ROC AUC':>8s} {'PR AUC':>8s}"
    for t in thresholds:
        header += f" | Rec@{t:.1f}"
        header += f"  Prec@{t:.1f}"
        header += f"  Flag@{t:.1f}"
    print(header)
    print("-" * len(header))

    for r in results:
        line = f"{r['name']:<32s} {r['n_features']:>6d} {r['roc_auc']:>8.4f} {r['pr_auc']:>8.4f}"
        for t in thresholds:
            m = r["thresholds"][t]
            line += f" | {m['recall']:>6.3f}"
            line += f"   {m['precision']:>6.3f}"
            line += f"   {m['flagged_rate']:>6.3f}"
        print(line)

    print("-" * len(header))

    # ------------------------------------------------------------------
    # 8. Feature importance for XGBoost model (e)
    # ------------------------------------------------------------------
    print("\n\nXGBoost (e) Feature Importance (top 25):")
    print("-" * 50)
    last_xgb = configs[-1]
    clf_e = last_xgb["model_fn"]()
    X_e = last_xgb["X"]
    clf_e.fit(X_e[last_xgb["train_mask"]], labels[last_xgb["train_mask"]])
    importances = clf_e.feature_importances_

    # Build feature name list
    feat_names = [f"emb_{i}" for i in range(emb_dim)] + SIMILARITY_FEATURE_NAMES + STRUCTURED_FEATURE_KEYS
    top_idx = np.argsort(importances)[::-1][:25]
    for rank, idx in enumerate(top_idx, 1):
        print(f"  {rank:>3d}. {feat_names[idx]:<35s} {importances[idx]:.4f}")

    print("\nDone.")


if __name__ == "__main__":
    main()
