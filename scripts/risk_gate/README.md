# Risk Gate Pipeline (v1)

This folder builds a supervision risk gate from harness outputs.

## Dataset Contract

- Input: `results/*/raw.jsonl`
- Keep only `condition == "dual-loop"`
- Emit one row per turn where tutor first draft is `iter=1`
- Label: `y_needs_supervision = loopTurnIterations.initiallyRejected`
- Split policy: deterministic holdout split by `question_id` (grouped across turns), stratified by `dataset_source`
- Include fields from `question`, `hiddenTrace.studentTurns`, `hiddenTrace.tutorDrafts`, `loopTurnIterations`
- Include `hiddenTrace.turnJudgments[*].judge.leakage` as `aux_turn_leakage`

## Scripts

- `extract_dataset.py`
  - Builds extracted dataset JSONL + `feature_schema.json`
- `prepare_openai_batch_embeddings.py`
  - Builds OpenAI Batch input JSONL for embedding requests
- `collect_openai_batch_embeddings.py`
  - Parses OpenAI Batch output JSONL into `example_id -> embedding`
- `train_local_model.py`
  - Calls configurable local embedding endpoint and trains logistic regression (`class_weight='balanced'`)
- `train_openai_model.py`
  - Trains logistic regression (`class_weight='balanced'`) from precomputed OpenAI embeddings
- `threshold_sweep.py`
  - Sweeps `local_low`, `local_high`, `openai_threshold` and selects best policy with holdout recall constraint
- `export_artifacts.py`
  - Writes canonical artifact files to `models/risk-gate/v1`

## Quick Start

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r scripts/risk_gate/requirements.txt

python3 scripts/risk_gate/extract_dataset.py \
  --input-glob "results/*/raw.jsonl" \
  --output-jsonl tmp/risk_gate/turn_dataset.jsonl \
  --feature-schema-out tmp/risk_gate/feature_schema.json

python3 scripts/risk_gate/prepare_openai_batch_embeddings.py \
  --dataset tmp/risk_gate/turn_dataset.jsonl \
  --output-jsonl tmp/risk_gate/openai_batch_input.jsonl

# Run OpenAI Batch externally, then collect the downloaded output file:
python3 scripts/risk_gate/collect_openai_batch_embeddings.py \
  --dataset tmp/risk_gate/turn_dataset.jsonl \
  --batch-output-jsonl tmp/risk_gate/openai_batch_output.jsonl \
  --output-embeddings-jsonl tmp/risk_gate/openai_embeddings.jsonl

python3 scripts/risk_gate/train_local_model.py \
  --dataset tmp/risk_gate/turn_dataset.jsonl \
  --embedding-url http://localhost:11434/api/embeddings \
  --embedding-model nomic-embed-text \
  --model-out tmp/risk_gate/local_model.json \
  --predictions-out tmp/risk_gate/local_holdout_predictions.jsonl \
  --metrics-out tmp/risk_gate/local_metrics.json

python3 scripts/risk_gate/train_openai_model.py \
  --dataset tmp/risk_gate/turn_dataset.jsonl \
  --embeddings-jsonl tmp/risk_gate/openai_embeddings.jsonl \
  --model-out tmp/risk_gate/openai_model.json \
  --predictions-out tmp/risk_gate/openai_holdout_predictions.jsonl \
  --metrics-out tmp/risk_gate/openai_metrics.json

python3 scripts/risk_gate/threshold_sweep.py \
  --local-predictions tmp/risk_gate/local_holdout_predictions.jsonl \
  --openai-predictions tmp/risk_gate/openai_holdout_predictions.jsonl \
  --recall-target 0.99 \
  --output-policy tmp/risk_gate/policy.json \
  --output-metrics tmp/risk_gate/policy_metrics.json

python3 scripts/risk_gate/export_artifacts.py \
  --local-model tmp/risk_gate/local_model.json \
  --openai-model tmp/risk_gate/openai_model.json \
  --policy tmp/risk_gate/policy.json \
  --feature-schema tmp/risk_gate/feature_schema.json \
  --local-metrics tmp/risk_gate/local_metrics.json \
  --openai-metrics tmp/risk_gate/openai_metrics.json \
  --policy-metrics tmp/risk_gate/policy_metrics.json \
  --out-dir models/risk-gate/v1
```

## Artifact Output

`export_artifacts.py` produces:

- `models/risk-gate/v1/local_model.json`
- `models/risk-gate/v1/openai_model.json`
- `models/risk-gate/v1/policy.json`
- `models/risk-gate/v1/feature_schema.json`
- `models/risk-gate/v1/metrics.json`
