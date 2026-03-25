"""
Experiment: Compare OpenAI vs Gemini embeddings for risk-gate classification.

Compares four embedding sources across two labels using LogisticRegression.
"""

import json
import numpy as np
from pathlib import Path
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score, average_precision_score, recall_score

ROOT = Path(__file__).resolve().parents[2]
TMP = ROOT / "tmp" / "risk_gate"


def load_jsonl(path):
    rows = []
    with open(path) as f:
        for line in f:
            rows.append(json.loads(line))
    return rows


def load_dataset():
    return load_jsonl(TMP / "turn_dataset.jsonl")


def load_openai_full_embs():
    """OpenAI full feature_text embeddings (3072-dim)."""
    out = {}
    for row in load_jsonl(TMP / "openai_embeddings.jsonl"):
        out[row["example_id"]] = row["embedding"]
    return out


def load_openai_draft_embs():
    """OpenAI draft-only embeddings from batch output (3072-dim)."""
    out = {}
    for row in load_jsonl(TMP / "openai_cosine_batch_output.jsonl"):
        cid = row["custom_id"]
        if not cid.endswith("::draft"):
            continue
        eid = cid[: -len("::draft")]
        emb = row["response"]["body"]["data"][0]["embedding"]
        out[eid] = emb
    return out


def load_gemini_draft_embs():
    """Gemini draft embeddings (3072-dim, gemini-embedding-2-preview)."""
    out = {}
    for row in load_jsonl(TMP / "gemini_draft_embeddings.jsonl"):
        out[row["example_id"]] = row["embedding"]
    return out


def recall_at_threshold(y_true, y_prob, threshold):
    y_pred = (y_prob >= threshold).astype(int)
    if y_true.sum() == 0:
        return float("nan")
    return recall_score(y_true, y_pred, zero_division=0)


def run_experiment(X_train, y_train, X_hold, y_hold, name):
    clf = LogisticRegression(
        class_weight="balanced", max_iter=5000, solver="lbfgs", random_state=42
    )
    clf.fit(X_train, y_train)
    y_prob = clf.predict_proba(X_hold)[:, 1]
    roc = roc_auc_score(y_hold, y_prob)
    pr = average_precision_score(y_hold, y_prob)
    thresholds = [0.1, 0.2, 0.3, 0.5]
    recalls = {t: recall_at_threshold(y_hold, y_prob, t) for t in thresholds}
    return {"name": name, "roc_auc": roc, "pr_auc": pr, "recalls": recalls, "dim": X_train.shape[1]}


def print_table(results, label_name):
    results = sorted(results, key=lambda r: r["roc_auc"], reverse=True)
    header = f"{'Model':<48} {'Dim':>5} {'ROC AUC':>8} {'PR AUC':>8} {'R@0.1':>6} {'R@0.2':>6} {'R@0.3':>6} {'R@0.5':>6}"
    print(f"\n{'='*100}")
    print(f"  Label: {label_name}")
    print(f"{'='*100}")
    print(header)
    print("-" * 100)
    for r in results:
        rec = r["recalls"]
        print(
            f"{r['name']:<48} {r['dim']:>5} {r['roc_auc']:>8.4f} {r['pr_auc']:>8.4f} "
            f"{rec[0.1]:>6.3f} {rec[0.2]:>6.3f} {rec[0.3]:>6.3f} {rec[0.5]:>6.3f}"
        )


def main():
    print("Loading data...")
    dataset = load_dataset()
    openai_full = load_openai_full_embs()
    openai_draft = load_openai_draft_embs()
    gemini_draft = load_gemini_draft_embs()
    print(f"  Dataset rows: {len(dataset)}")
    print(f"  OpenAI full embs: {len(openai_full)}")
    print(f"  OpenAI draft embs: {len(openai_draft)}")
    print(f"  Gemini draft embs: {len(gemini_draft)}")

    # Find common example_ids across all four sources
    all_ids = set(openai_full) & set(openai_draft) & set(gemini_draft)
    dataset_by_id = {r["example_id"]: r for r in dataset}
    all_ids = all_ids & set(dataset_by_id)
    print(f"  Common example_ids (all 4 sources): {len(all_ids)}")

    # Build arrays
    train_ids = sorted(eid for eid in all_ids if dataset_by_id[eid]["split"] == "train")
    hold_ids = sorted(eid for eid in all_ids if dataset_by_id[eid]["split"] == "holdout")
    print(f"  Train: {len(train_ids)}, Holdout: {len(hold_ids)}")

    def make_arrays(ids, emb_dict):
        return np.array([emb_dict[eid] for eid in ids], dtype=np.float32)

    def make_labels(ids, key):
        return np.array([int(dataset_by_id[eid][key]) for eid in ids], dtype=int)

    # Embedding matrices
    oai_full_train = make_arrays(train_ids, openai_full)
    oai_full_hold = make_arrays(hold_ids, openai_full)
    oai_draft_train = make_arrays(train_ids, openai_draft)
    oai_draft_hold = make_arrays(hold_ids, openai_draft)
    gem_draft_train = make_arrays(train_ids, gemini_draft)
    gem_draft_hold = make_arrays(hold_ids, gemini_draft)
    concat_train = np.concatenate([oai_draft_train, gem_draft_train], axis=1)
    concat_hold = np.concatenate([oai_draft_hold, gem_draft_hold], axis=1)

    # --- Label 1: y_needs_supervision ---
    y_sup_train = make_labels(train_ids, "y_needs_supervision")
    y_sup_hold = make_labels(hold_ids, "y_needs_supervision")

    print(f"\n--- Label distribution: y_needs_supervision ---")
    print(f"  Train: {y_sup_train.sum()} / {len(y_sup_train)} positive ({y_sup_train.mean():.3f})")
    print(f"  Holdout: {y_sup_hold.sum()} / {len(y_sup_hold)} positive ({y_sup_hold.mean():.3f})")

    sup_results = []
    configs = [
        (oai_full_train, oai_full_hold, "OpenAI full-text emb (3072)"),
        (oai_draft_train, oai_draft_hold, "OpenAI draft emb (3072)"),
        (gem_draft_train, gem_draft_hold, "Gemini draft emb (3072)"),
        (concat_train, concat_hold, "OpenAI draft + Gemini draft concat (6144)"),
    ]
    for Xtr, Xho, name in configs:
        print(f"  Training: {name} ...")
        sup_results.append(run_experiment(Xtr, y_sup_train, Xho, y_sup_hold, name))

    print_table(sup_results, "y_needs_supervision (supervisor rejection)")

    # --- Label 2: aux_turn_leakage (skip None) ---
    leak_train_ids = [eid for eid in train_ids if dataset_by_id[eid]["aux_turn_leakage"] is not None]
    leak_hold_ids = [eid for eid in hold_ids if dataset_by_id[eid]["aux_turn_leakage"] is not None]

    y_leak_train = make_labels(leak_train_ids, "aux_turn_leakage")
    y_leak_hold = make_labels(leak_hold_ids, "aux_turn_leakage")

    print(f"\n--- Label distribution: aux_turn_leakage ---")
    print(f"  Train: {y_leak_train.sum()} / {len(y_leak_train)} positive ({y_leak_train.mean():.3f})")
    print(f"  Holdout: {y_leak_hold.sum()} / {len(y_leak_hold)} positive ({y_leak_hold.mean():.3f})")

    oai_full_leak_train = make_arrays(leak_train_ids, openai_full)
    oai_full_leak_hold = make_arrays(leak_hold_ids, openai_full)
    oai_draft_leak_train = make_arrays(leak_train_ids, openai_draft)
    oai_draft_leak_hold = make_arrays(leak_hold_ids, openai_draft)
    gem_draft_leak_train = make_arrays(leak_train_ids, gemini_draft)
    gem_draft_leak_hold = make_arrays(leak_hold_ids, gemini_draft)
    concat_leak_train = np.concatenate([oai_draft_leak_train, gem_draft_leak_train], axis=1)
    concat_leak_hold = np.concatenate([oai_draft_leak_hold, gem_draft_leak_hold], axis=1)

    leak_results = []
    leak_configs = [
        (oai_full_leak_train, oai_full_leak_hold, "OpenAI full-text emb (3072)"),
        (oai_draft_leak_train, oai_draft_leak_hold, "OpenAI draft emb (3072)"),
        (gem_draft_leak_train, gem_draft_leak_hold, "Gemini draft emb (3072)"),
        (concat_leak_train, concat_leak_hold, "OpenAI draft + Gemini draft concat (6144)"),
    ]
    for Xtr, Xho, name in leak_configs:
        print(f"  Training: {name} ...")
        leak_results.append(run_experiment(Xtr, y_leak_train, Xho, y_leak_hold, name))

    print_table(leak_results, "aux_turn_leakage (judge ground truth)")


if __name__ == "__main__":
    main()
