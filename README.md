# AI Tutor Experiment Harness (v2)

CLI harness for adversarial tutoring experiments with reproducible outputs (`raw.jsonl`, `summary.json`, `analysis.json`, `report.html`).

## Branch Policy
- v2 target branch is `v2`/`feat/v2-*` workflows, **not `main`**.
- For this worktree package, use `feat/v2-paper-recipes`.

## Setup
1. Install dependencies:
```bash
pnpm install
```
2. Configure API keys in `.env`:
- preferred: `OPENROUTER_API_KEY`
- optional: `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`
3. Build:
```bash
pnpm build
```

## v2 Workflow
1. Validate build + smoke:
```bash
pnpm build
pnpm smoke
```
2. Run pilot (cost-controlled):
```bash
pnpm harness -- --maxRuns 20 --turns 4 --parallel 2
```
3. Run full matrix:
```bash
pnpm harness -- --turns 6 --parallel 5
```
4. Review outputs in `results/run_<timestamp>/`.

See reproducibility docs:
- `docs/ICER_V2_PROTOCOL.md`
- `docs/ICER_V2_RUNBOOK.md`

## CLI Flags (current)

### Matrix controls
- `--tutors LIST` (`gpt,gemini`)
- `--supervisors LIST` (`gpt,gemini`)
- `--conditions LIST` (`single,dual-loop`)

### Conversation controls
- `--turns N` (default `6`, smoke `2`)
- `--maxIters N` (default `5`, dual-loop only)
- `--maxRuns N` (default unlimited)
- `--parallel N` (default `5`, smoke `1`)

### Dataset controls
- `--dataset NAME` (`default` or `canterbury`, default `default`)
- `--questionLimit N` (default `100` for canterbury)
- `--bloomLevels 1,2,3`
- `--difficulties easy,medium,hard`
- `--courseLevels LIST`
- `--skillTags LIST`
- `--dynamic` (generate questions at runtime)
- `--questionsPerCell N` (used with `--dynamic`)

### Model controls
- `--questionModel ID`
- `--studentModel ID`
- `--judgeModel ID`

### Judge and runtime toggles
- `--noJudge`
- `--noEarlyStop`
- `--verbose`
- `--smoke`
- `--help`

## Current Defaults from `src/config.ts`
- Tutor IDs: `gpt`, `gemini`
- Supervisor IDs: `gpt`, `gemini`
- Pairings (legacy IDs):
  - `gpt-gpt`
  - `gemini-gemini`
  - `gpt-gemini`
  - `gemini-gpt`
- Default role models:
  - question generator: `google/gemini-3-flash-preview`
  - student: `google/gemini-3-flash-preview`
  - judge: `google/gemini-3-flash-preview`

## Outputs
Each run writes to `results/run_<ISO>/`:
- `run-config.json`
- `questions.json`
- `raw.jsonl`
- `summary.json`
- `analysis.json`
- `report.html`

## Common Commands
```bash
pnpm build
pnpm smoke
pnpm harness -- --conditions single
pnpm harness -- --conditions dual-loop
pnpm harness -- --tutors gpt --supervisors gemini
pnpm harness -- --dataset canterbury --questionLimit 100
bun run src/scripts/regenerate-report.ts results/run_xxx
```
