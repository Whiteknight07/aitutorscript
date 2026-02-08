# ICER V2 Experiment Protocol

## Scope
This protocol defines the v2 benchmark for adversarial tutoring safety in this repository (`feat/v2-paper-recipes`).

- Unit of analysis: one run (`question × tutor × condition × [supervisor if dual-loop]`)
- Primary implementation references:
  - `src/utils/args.ts`
  - `src/core/experiment.ts`
  - `src/core/conversation.ts`
  - `src/agents/judge.ts`
  - `src/output/summary.ts`

## Exact Experiment Matrix

### Factors
- Questions (`Q`): selected by dataset/filters
- Tutors (`T`): `gpt`, `gemini` (default: both)
- Supervisors (`S`): `gpt`, `gemini` (default: both)
- Conditions (`C`): `single`, `dual-loop` (default: both)

### Run construction (exact)
Runs are built as:
- `single`: for each question and tutor, one run with no supervisor
- `dual-loop`: for each question, tutor, and supervisor, one run

Total planned runs:
- `N = Q × (I_single × |T| + I_dual × |T| × |S|)`
- `I_single = 1` when `single` is in `--conditions`, else `0`
- `I_dual = 1` when `dual-loop` is in `--conditions`, else `0`

### Default matrix (no CLI overrides)
- Dataset: `default` (static `data/questions.json`)
- Default filters: Bloom `1,2,3`; difficulties `easy,medium,hard`
- Current static question count in repo: `Q = 54`
- `|T| = 2`, `|S| = 2`, both conditions enabled
- Total: `54 × (2 + 4) = 324` runs

### Smoke profile (as currently implemented)
`--smoke` sets:
- Bloom: `1`
- Difficulty: `easy`
- Turns: `2`
- Tutors: `gemini`
- Supervisors: `gemini`
- Conditions: `single`
- Parallel: `1`

Note: with static dataset mode (default), smoke does **not** force one question; it filters to all matching questions. In current data, that is 6 questions.

## Outcomes

### Primary outcome
1. Leakage rate (turn-level):
- Definition: fraction of judged runs with any `turnJudge.leakage=true`
- Source: `hiddenTrace.turnJudgments` aggregated by `src/output/summary.ts`
- Denominator: `nJudged` (runs with turn judgments)

### Secondary outcomes
1. Compliance rate (turn-level aggregation)
- Run is compliant only if no turn has `compliance=false`
2. Hallucination rate (turn-level aggregation)
- Run is hallucination-positive if any turn has `hallucination=true`
3. Dual-loop control outcomes (`dual-loop` only)
- `loopFixRate`
- `avgIterationsPerTurn`
- `iterationDistribution`
- intervention counts/rates
4. Operational outcome
- `avgLatencyMs` per run

### Important metric caveat
Turn-level judging is only active when both are true:
- judge enabled (default; disabled by `--noJudge`)
- early stop enabled (default; disabled by `--noEarlyStop`)

If `--noEarlyStop` is used, final run-level judge still executes, but `summary.json` judged denominators can be zero because summary aggregation uses turn judgments.

## Disagreement Policy

### Tutor vs supervisor disagreement (dual-loop)
- Supervisor is authoritative for release to student.
- If supervisor approves a draft, draft is sent.
- If supervisor rejects all `--maxIters` drafts, supervisor `safeResponseToStudent` is sent.
- Record all drafts and verdicts in `hiddenTrace` for audit.

### Judge disagreement handling
There are two judge signals:
- turn-level judge (`turnJudge_*`) used for early stop and summary metrics
- final judge (`judge_*`) stored per run

Policy for ICER reporting:
1. Primary analysis uses turn-level aggregation from `summary.json`.
2. If turn and final judge disagree, classify as `discordant` for audit tables.
3. Report discordance rate and include at least one example transcript per discordance class in appendix.
4. Do not overwrite raw judge outputs; adjudication labels must be additive in analysis artifacts.

## Cost-Control Policy

1. Stage-gated execution
- Stage A: smoke check (`pnpm smoke`)
- Stage B: pilot (`--maxRuns`, smaller `--turns`)
- Stage C: full matrix

2. Hard budget controls
- Cap with `--maxRuns`
- Limit concurrency with `--parallel`
- Reduce per-run call volume via `--turns` and `--maxIters`

3. Scope controls
- Restrict model sets with `--tutors`, `--supervisors`, `--conditions`
- Restrict question set with `--dataset`, `--questionLimit`, `--bloomLevels`, `--difficulties`, `--courseLevels`, `--skillTags`

4. Judge-cost controls
- For throughput-only dry runs: `--noJudge`
- For outcome runs: keep default judge+early-stop ON for metric completeness

5. Required logging
- Persist `run-config.json`, `raw.jsonl`, `summary.json`, `analysis.json`, `report.html` per run directory

## Ablation Plan

A0. Single-pass baseline
- `--conditions single`
- Purpose: leakage/compliance without supervisory control loop

A1. Dual-loop same-model
- `--conditions dual-loop --tutors gpt --supervisors gpt` and `gemini/gemini`
- Purpose: isolate loop effect without cross-model mismatch

A2. Dual-loop cross-model
- `--conditions dual-loop --tutors gpt,gemini --supervisors gpt,gemini`
- Analyze off-diagonal pairs (`gpt-gemini`, `gemini-gpt`)
- Purpose: test whether heterogeneity changes leak prevention and latency

A3. Early-stop sensitivity
- Repeat selected cells with `--noEarlyStop`
- Purpose: check truncation effects on leakage detection and latency

A4. Judge-off throughput sanity (non-primary)
- `--noJudge`
- Purpose: estimate pure generation throughput/cost; exclude from primary outcome reporting

## Threat-to-Validity Checklist

### Construct validity
- [ ] Leakage definition is fixed before running (from judge prompt spec)
- [ ] Compliance interpreted independently of leakage
- [ ] Hallucination evaluated against reference answer + domain knowledge

### Internal validity
- [ ] Same question set across compared conditions
- [ ] Same student and judge model across compared conditions (unless explicit ablation)
- [ ] Same `--turns`, `--maxIters`, and early-stop policy across compared conditions
- [ ] No mixing judged and non-judged runs in one primary denominator

### External validity
- [ ] Report dataset source (`default` vs `canterbury`) and filters
- [ ] Report model IDs exactly as executed
- [ ] Report run date and API environment summary

### Statistical conclusion validity
- [ ] Pre-specify primary outcome and denominator (`nJudged`)
- [ ] Report per-cell run counts, not only pooled means
- [ ] Report discordance rate for turn-vs-final judge
- [ ] Separate exploratory analyses from pre-registered outcomes

### Reproducibility
- [ ] Save `run-config.json` for every run
- [ ] Save immutable raw outputs (`raw.jsonl`)
- [ ] Keep protocol and runbook versioned in `docs/`
