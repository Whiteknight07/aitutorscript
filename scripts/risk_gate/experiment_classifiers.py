#!/usr/bin/env python3
"""Experiment: compare multiple classifiers on risk-gate embeddings + structured features."""

from __future__ import annotations

import json
import time
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, roc_auc_score
from sklearn.neural_network import MLPClassifier
from sklearn.svm import SVC
from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler
from sklearn.utils.class_weight import compute_sample_weight
from xgboost import XGBClassifier

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
BASE = Path(__file__).resolve().parents[2]  # repo root
DATASET_PATH = BASE / "tmp/risk_gate/turn_dataset.jsonl"
EMBEDDINGS_PATH = BASE / "tmp/risk_gate/openai_embeddings.jsonl"

STRUCTURED_FEATURE_NAMES: list[str] = [
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
# Helpers (borrowed from train_openai_model.py)
# ---------------------------------------------------------------------------

def iter_jsonl(path: Path):
    with path.open("r", encoding="utf-8") as fh:
        for line in fh:
            text = line.strip()
            if not text:
                continue
            yield json.loads(text)


def parse_label(value) -> int | None:
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (int, float)):
        return int(bool(value))
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"1", "true", "yes", "y"}:
            return 1
        if lowered in {"0", "false", "no", "n"}:
            return 0
    return None


def extract_structured_features(row: dict) -> list[float]:
    feat_dict = row.get("feature_numeric", {})
    if not isinstance(feat_dict, dict):
        feat_dict = {}
    features: list[float] = []
    for name in STRUCTURED_FEATURE_NAMES:
        val = feat_dict.get(name, 0)
        if isinstance(val, bool):
            features.append(float(val))
        elif isinstance(val, (int, float)):
            features.append(float(val))
        else:
            features.append(0.0)
    return features


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

def load_data():
    print("Loading embeddings...")
    embedding_map: dict[str, list[float]] = {}
    for row in iter_jsonl(EMBEDDINGS_PATH):
        eid = str(row.get("example_id", "")).strip()
        emb = row.get("embedding")
        if eid and isinstance(emb, list) and emb:
            embedding_map[eid] = [float(v) for v in emb]
    print(f"  Loaded {len(embedding_map)} embeddings")

    print("Loading dataset and joining...")
    rows = []
    for raw in iter_jsonl(DATASET_PATH):
        eid = str(raw.get("example_id", "")).strip()
        label = parse_label(raw.get("y_needs_supervision"))
        split = str(raw.get("split", "")).strip()
        if not eid or label is None or not split:
            continue
        emb = embedding_map.get(eid)
        if emb is None:
            continue
        rows.append({
            "example_id": eid,
            "split": split,
            "label": label,
            "embedding": emb,
            "structured": extract_structured_features(raw),
        })

    X_emb = np.asarray([r["embedding"] for r in rows], dtype=np.float32)
    X_struct = np.asarray([r["structured"] for r in rows], dtype=np.float32)
    y = np.asarray([r["label"] for r in rows], dtype=np.int64)
    splits = np.array([r["split"] for r in rows])

    train_mask = splits == "train"
    hold_mask = splits == "holdout"

    print(f"  Total rows: {len(rows)}")
    print(f"  Train: {train_mask.sum()}, Holdout: {hold_mask.sum()}")
    print(f"  Positive rate (train): {y[train_mask].mean():.4f}")
    print(f"  Positive rate (holdout): {y[hold_mask].mean():.4f}")
    print(f"  Embedding dim: {X_emb.shape[1]}, Structured features: {X_struct.shape[1]}")
    print()

    return X_emb, X_struct, y, train_mask, hold_mask


# ---------------------------------------------------------------------------
# Evaluation
# ---------------------------------------------------------------------------

def evaluate(name: str, y_true: np.ndarray, y_prob: np.ndarray) -> dict:
    roc = float(roc_auc_score(y_true, y_prob))
    pr = float(average_precision_score(y_true, y_prob))
    return {"name": name, "roc_auc": roc, "pr_auc": pr}


# ---------------------------------------------------------------------------
# Experiments
# ---------------------------------------------------------------------------

def run_experiments(X_emb, X_struct, y, train_mask, hold_mask):
    results = []

    X_emb_train, X_emb_hold = X_emb[train_mask], X_emb[hold_mask]
    X_struct_train, X_struct_hold = X_struct[train_mask], X_struct[hold_mask]
    y_train, y_hold = y[train_mask], y[hold_mask]

    # Combined features (unscaled)
    X_combined_train = np.concatenate([X_emb_train, X_struct_train], axis=1)
    X_combined_hold = np.concatenate([X_emb_hold, X_struct_hold], axis=1)

    # Combined features (structured scaled)
    scaler = StandardScaler()
    X_struct_train_sc = scaler.fit_transform(X_struct_train)
    X_struct_hold_sc = scaler.transform(X_struct_hold)
    X_combined_sc_train = np.concatenate([X_emb_train, X_struct_train_sc], axis=1)
    X_combined_sc_hold = np.concatenate([X_emb_hold, X_struct_hold_sc], axis=1)

    # Sample weights for balanced classes (for MLP)
    sw_train = compute_sample_weight("balanced", y_train)

    # ---- (a) LogisticRegression, embeddings only ----
    print("(a) LogisticRegression (embeddings only)...")
    t0 = time.time()
    lr_emb = LogisticRegression(C=1.0, class_weight="balanced", max_iter=5000, solver="lbfgs", random_state=42)
    lr_emb.fit(X_emb_train, y_train)
    prob = lr_emb.predict_proba(X_emb_hold)[:, 1]
    r = evaluate("LR (emb only)", y_hold, prob)
    r["time"] = time.time() - t0
    results.append(r)
    print(f"    ROC AUC={r['roc_auc']:.4f}  PR AUC={r['pr_auc']:.4f}  ({r['time']:.1f}s)")

    # ---- (b) LogisticRegression, embeddings + structured ----
    print("(b) LogisticRegression (emb + structured)...")
    t0 = time.time()
    lr_comb = LogisticRegression(C=1.0, class_weight="balanced", max_iter=5000, solver="lbfgs", random_state=42)
    lr_comb.fit(X_combined_train, y_train)
    prob = lr_comb.predict_proba(X_combined_hold)[:, 1]
    r = evaluate("LR (emb+struct)", y_hold, prob)
    r["time"] = time.time() - t0
    results.append(r)
    print(f"    ROC AUC={r['roc_auc']:.4f}  PR AUC={r['pr_auc']:.4f}  ({r['time']:.1f}s)")

    # ---- (c) MLP, embeddings only ----
    print("(c) MLPClassifier (embeddings only)...")
    t0 = time.time()
    mlp_emb = MLPClassifier(
        hidden_layer_sizes=(256, 64), max_iter=200, early_stopping=True,
        random_state=42, validation_fraction=0.1,
    )
    mlp_emb.fit(X_emb_train, y_train, sample_weight=sw_train)
    prob = mlp_emb.predict_proba(X_emb_hold)[:, 1]
    r = evaluate("MLP (emb only)", y_hold, prob)
    r["time"] = time.time() - t0
    results.append(r)
    print(f"    ROC AUC={r['roc_auc']:.4f}  PR AUC={r['pr_auc']:.4f}  ({r['time']:.1f}s)")

    # ---- (d) MLP, embeddings + structured (scaled) ----
    print("(d) MLPClassifier (emb + structured, scaled)...")
    t0 = time.time()
    mlp_comb = MLPClassifier(
        hidden_layer_sizes=(256, 64), max_iter=200, early_stopping=True,
        random_state=42, validation_fraction=0.1,
    )
    mlp_comb.fit(X_combined_sc_train, y_train, sample_weight=sw_train)
    prob = mlp_comb.predict_proba(X_combined_sc_hold)[:, 1]
    r = evaluate("MLP (emb+struct sc)", y_hold, prob)
    r["time"] = time.time() - t0
    results.append(r)
    print(f"    ROC AUC={r['roc_auc']:.4f}  PR AUC={r['pr_auc']:.4f}  ({r['time']:.1f}s)")

    # ---- (e) SVM RBF ----
    n_train = X_emb_train.shape[0]
    SVM_CAP = 5000
    if n_train > SVM_CAP:
        print(f"(e) SVM RBF (subsampled to {SVM_CAP} from {n_train})...")
        rng = np.random.RandomState(42)
        idx = rng.choice(n_train, SVM_CAP, replace=False)
        X_svm_train = X_emb_train[idx]
        y_svm_train = y_train[idx]
    else:
        print("(e) SVM RBF (embeddings only)...")
        X_svm_train = X_emb_train
        y_svm_train = y_train
    t0 = time.time()
    svm = SVC(kernel="rbf", probability=True, class_weight="balanced", C=1.0, random_state=42)
    svm.fit(X_svm_train, y_svm_train)
    prob = svm.predict_proba(X_emb_hold)[:, 1]
    r = evaluate("SVM RBF (emb only)", y_hold, prob)
    r["time"] = time.time() - t0
    results.append(r)
    print(f"    ROC AUC={r['roc_auc']:.4f}  PR AUC={r['pr_auc']:.4f}  ({r['time']:.1f}s)")

    # ---- (f) PCA(128) + LR ----
    print("(f) PCA(128) + LogisticRegression...")
    t0 = time.time()
    pca128 = PCA(n_components=128, random_state=42)
    X_pca128_train = pca128.fit_transform(X_emb_train)
    X_pca128_hold = pca128.transform(X_emb_hold)
    lr_pca128 = LogisticRegression(C=1.0, class_weight="balanced", max_iter=5000, solver="lbfgs", random_state=42)
    lr_pca128.fit(X_pca128_train, y_train)
    prob = lr_pca128.predict_proba(X_pca128_hold)[:, 1]
    r = evaluate("PCA(128)+LR", y_hold, prob)
    r["time"] = time.time() - t0
    results.append(r)
    print(f"    ROC AUC={r['roc_auc']:.4f}  PR AUC={r['pr_auc']:.4f}  ({r['time']:.1f}s)")

    # ---- (g) PCA(256) + LR ----
    print("(g) PCA(256) + LogisticRegression...")
    t0 = time.time()
    pca256 = PCA(n_components=256, random_state=42)
    X_pca256_train = pca256.fit_transform(X_emb_train)
    X_pca256_hold = pca256.transform(X_emb_hold)
    lr_pca256 = LogisticRegression(C=1.0, class_weight="balanced", max_iter=5000, solver="lbfgs", random_state=42)
    lr_pca256.fit(X_pca256_train, y_train)
    prob = lr_pca256.predict_proba(X_pca256_hold)[:, 1]
    r = evaluate("PCA(256)+LR", y_hold, prob)
    r["time"] = time.time() - t0
    results.append(r)
    print(f"    ROC AUC={r['roc_auc']:.4f}  PR AUC={r['pr_auc']:.4f}  ({r['time']:.1f}s)")

    # ---- (h) PCA(128) + XGBoost (regularized) ----
    print("(h) PCA(128) + XGBoost (regularized)...")
    t0 = time.time()
    # Reuse PCA(128) from above
    pos = int(y_train.sum())
    neg = int((y_train == 0).sum())
    spw = neg / pos if pos > 0 else 1.0

    xgb = XGBClassifier(
        max_depth=3,
        n_estimators=300,
        learning_rate=0.01,
        subsample=0.7,
        colsample_bytree=0.5,
        reg_alpha=1.0,
        reg_lambda=5.0,
        min_child_weight=10,
        scale_pos_weight=spw,
        eval_metric="logloss",
        random_state=42,
        n_jobs=-1,
    )
    xgb.fit(X_pca128_train, y_train)
    prob = xgb.predict_proba(X_pca128_hold)[:, 1]
    r = evaluate("PCA(128)+XGB", y_hold, prob)
    r["time"] = time.time() - t0
    results.append(r)
    print(f"    ROC AUC={r['roc_auc']:.4f}  PR AUC={r['pr_auc']:.4f}  ({r['time']:.1f}s)")

    return results


# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

def print_summary(results):
    print()
    print("=" * 72)
    print("SUMMARY: Holdout Metrics")
    print("=" * 72)
    header = f"{'Model':<25} {'ROC AUC':>10} {'PR AUC':>10} {'Time (s)':>10}"
    print(header)
    print("-" * 72)
    for r in sorted(results, key=lambda x: -x["roc_auc"]):
        print(f"{r['name']:<25} {r['roc_auc']:>10.4f} {r['pr_auc']:>10.4f} {r['time']:>10.1f}")
    print("-" * 72)
    best_roc = max(results, key=lambda x: x["roc_auc"])
    best_pr = max(results, key=lambda x: x["pr_auc"])
    print(f"Best ROC AUC: {best_roc['name']} ({best_roc['roc_auc']:.4f})")
    print(f"Best PR AUC:  {best_pr['name']} ({best_pr['pr_auc']:.4f})")
    print("=" * 72)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    X_emb, X_struct, y, train_mask, hold_mask = load_data()
    results = run_experiments(X_emb, X_struct, y, train_mask, hold_mask)
    print_summary(results)
