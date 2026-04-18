# AI Tutor Harness

AI Tutor Harness benchmarks whether LLM tutors leak answers under escalating student pressure. It simulates multi-turn tutoring conversations, optionally inserts a second-model supervisor, and scores the student-visible exchange for leakage, hallucination, and Socratic compliance.

This repository is prepared for a public release. The public repo includes one bundled publication dataset and the code needed to run the harness, regenerate reports, and inspect outputs. Large local outputs, scratch artifacts, and non-public source datasets are intentionally excluded from Git.

## What Is Public In This Repo

- Source code for the harness and report generator in `src/`
- Tests in `tests/`
- One publication dataset bundle in `data/publication/run_2026-02-01T12-30-58-782Z/`

## Bundled Dataset

The bundled public dataset is the 900-run Canterbury benchmark:

- Run ID: `run_2026-02-01T12-30-58-782Z`
- Questions: `150`
- Conversations: `900`
- Conditions: `300` single-loop, `600` dual-loop
- Pairings: `gemini-single`, `gpt-single`, `gemini-gpt`, `gemini-gemini`, `gpt-gemini`, `gpt-gpt`

The bundle includes:

- `run-config.json`
- `questions.json`
- `summary.json`
- `analysis.json`
- `raw.jsonl.gz`
- `report.html.gz`
- `SHA256SUMS`

The compressed files are included so the dataset fits within standard GitHub file limits while preserving the original raw run log and self-contained HTML report.

## What Is Not Bundled

The public repo does not track the following local-only assets:

- `results/` run folders
- `tmp/` scratch outputs
- raw/private datasets previously kept under `data/`
- ad hoc report exports under `reports/`
- one-off metrics dumps such as `raw_metrics_*`

If you have local copies of Canterbury, Pairwise, or other private/derived inputs, you can still keep them in the same paths locally; they are simply ignored by Git in this public version.

## Setup

1. Install dependencies:

```bash
pnpm install
```

2. Set credentials:

- `OPENROUTER_API_KEY` for harness model calls
- `OPENAI_API_KEY` only for risk-gate embedding scripts
- `GOOGLE_GENERATIVE_AI_API_KEY` only if you are using legacy direct Gemini flows

3. Build:

```bash
pnpm build
```

## Common Commands

Run the harness:

```bash
pnpm harness -- [flags]
```

Quick sanity check:

```bash
pnpm smoke
```

Run tests:

```bash
pnpm test
```

Regenerate a report from an existing run folder:

```bash
node --import tsx src/scripts/regenerate-report.ts results/run_xxx
```

## Dataset Inputs

The harness supports several input modes:

- `--dataset csbench`
- `--dataset canterbury`
- `--dataset pairwise`
- `--dataset overlap-csbench-pairwise`
- `--dataset default`
- `--dynamic`

In the public repo, only the publication bundle under `data/publication/` is guaranteed to be present. Other dataset modes may require you to supply local files yourself.

Examples:

```bash
pnpm harness -- --maxRuns 5 --turns 2 --noJudge
pnpm harness -- --dataset pairwise --pairwiseDir data/pairwise --turns 4
pnpm harness -- --dataset overlap-csbench-pairwise --mcqOnly --turns 4
```

## Output Layout

Each harness run writes a folder under `results/<runId>/` containing:

- `run-config.json`
- `questions.json`
- `raw.jsonl`
- `summary.json`
- `analysis.json`
- `report.html`

These outputs are intentionally ignored by Git.

## Repository Layout

```text
src/
  agents/        Tutor, student, supervisor, and judge agents
  core/          Harness orchestration and dataset loaders
  output/        Summary, analysis, and self-contained HTML report rendering
  scripts/       Utility scripts for report regeneration and offline analysis
tests/           Runtime, pipeline, and analysis tests
data/publication Bundled public dataset for the paper release
```

## Public Release Notes

- The bundled public artifact is the 900-run dataset above, not the full set of local exploratory runs.
- `results/` and other large local artifacts are kept out of version control on purpose.
- If you want to cite or mirror the public dataset directly, point readers to `data/publication/run_2026-02-01T12-30-58-782Z/`.
