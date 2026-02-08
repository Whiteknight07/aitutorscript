# ICER V2 Runbook

## Branch and Location
- Target branch for v2 work: `feat/v2-*` branches (for this package: `feat/v2-paper-recipes`)
- Do not use `main` for v2 experiment execution or v2 docs updates.

## Prerequisites
1. Install dependencies:
```bash
pnpm install
```
2. Configure credentials (`.env`):
- preferred: `OPENROUTER_API_KEY`
- optional provider keys: `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`
3. Verify build:
```bash
pnpm build
```

## Canonical CLI Surface (v2)
From `src/utils/args.ts`:
- Core controls: `--turns`, `--maxIters`, `--maxRuns`, `--parallel`, `--outDir`
- Matrix: `--tutors`, `--supervisors`, `--conditions`
- Dataset/filtering: `--dataset`, `--questionLimit`, `--bloomLevels`, `--difficulties`, `--courseLevels`, `--skillTags`
- Dynamic generation: `--dynamic`, `--questionsPerCell`
- Model overrides: `--questionModel`, `--studentModel`, `--judgeModel`
- Judge controls: `--noJudge`, `--noEarlyStop`
- Convenience: `--smoke`, `--verbose`, `--help`

## Standard Execution Workflow

### 1) Build and smoke
```bash
pnpm build
pnpm smoke
```

### 2) Pilot run (budget-safe)
```bash
pnpm harness -- --maxRuns 20 --turns 4 --parallel 2
```

### 3) Full v2 matrix run
```bash
pnpm harness -- --turns 6 --parallel 5
```

### 4) Optional focused slices
Single condition:
```bash
pnpm harness -- --conditions single
```
Dual-loop only:
```bash
pnpm harness -- --conditions dual-loop
```
Tutor subset:
```bash
pnpm harness -- --tutors gpt --supervisors gemini
```
Canterbury subset:
```bash
pnpm harness -- --dataset canterbury --questionLimit 100 --courseLevels CS1,CS2
```

## Reproducibility Requirements (per run)
Each run directory `results/run_<timestamp>/` must contain:
- `run-config.json`
- `questions.json`
- `raw.jsonl`
- `summary.json`
- `analysis.json`
- `report.html`

## ICER Reporting Rules
1. Primary outcome source: `summary.json` turn-level judged metrics.
2. Always report:
- run command
- branch name
- run ID
- question source + filters
- tutor/supervisor sets
- condition set
- judge/early-stop toggles
3. If `--noEarlyStop` was used, flag outcome comparability risk (turn-level judged denominators may be zero).
4. If `--noJudge` was used, mark run as non-evaluable for leakage/compliance/hallucination outcomes.

## Disagreement Handling Procedure
1. Extract discordant runs where turn-level and final judge labels differ.
2. Produce audit table with:
- run ID
- pairing/condition
- turn-level aggregate labels
- final judge labels
- notes
3. Keep raw labels immutable; add adjudication as separate analysis fields.

## Cost-Control Procedure
1. Start with smoke.
2. Run pilot with `--maxRuns` and reduced `--parallel`.
3. Scale to full matrix only after pilot sanity checks pass.
4. For dry performance checks, use `--noJudge` (do not include in primary outcomes).

## Regenerating Report From Existing Runs
```bash
bun run src/scripts/regenerate-report.ts results/run_xxx
```

## Publication Checklist
- [ ] Protocol in `docs/ICER_V2_PROTOCOL.md` matches executed flags
- [ ] Runbook in `docs/ICER_V2_RUNBOOK.md` matches executed commands
- [ ] README points users to v2 branch workflow
- [ ] `pnpm build` passes on the branch used for runs
- [ ] Results are kept out of git history (`results/` ignored)
