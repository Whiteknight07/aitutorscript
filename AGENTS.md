# Repository Guidelines

## Project Structure & Module Organization

- `src/`: TypeScript source code for the CLI harness.
  - `src/cli.ts`: CLI entrypoint (loads env, parses args, starts run).
  - `src/run.ts`: Orchestrates dataset generation, experiment matrix, logging, and report writing.
  - `src/conversation.ts`: Simulates multi-turn conversations and optional early stopping.
  - `src/question-gen.ts`, `src/student-attacker.ts`: JSON-structured generation via AI SDK.
  - `src/tutor.ts`, `src/supervisor.ts`: Tutor drafting and supervisor verdict logic.
  - `src/judge.ts`: Judge scoring (and per-turn judge for early stop).
  - `src/report.ts`: Self-contained `report.html` renderer.
- `dist/`: Compiled JavaScript output from `tsc`.
- `results/`: Output folders per run (`results/<runId>/…`) containing `raw.jsonl`, `summary.json`, and `report.html`.

## Build, Test, and Development Commands

- `pnpm build`: Compile TypeScript to `dist/`.
- `pnpm harness -- [flags]`: Build and run the harness.
- `pnpm smoke`: Small, fast run for sanity checking.
- `pnpm test`: No automated tests (prints a message and exits 0).

## Coding Style & Naming Conventions

- Language: TypeScript (Node).
- Use 2-space indentation and keep functions small and single-purpose.
- Prefer descriptive names (e.g., `turnIndex`, `plannedRuns`) over abbreviations.
- Output files follow `results/<runId>/…` and questions use IDs like `q-d{difficulty}-{n}`.

## Testing Guidelines

- No test framework is configured yet. Validate changes by running:
  - `pnpm smoke`
  - a small capped run: `pnpm harness -- --maxRuns 5 --turns 2 --noJudge`

## Commit & Pull Request Guidelines

- This repo may not be a Git repository in your environment; if you add Git later:
  - Use imperative commits (e.g., “Add report banner”, “Fix judge schema retry”).
  - PRs should include: purpose, CLI flags used to validate, and a screenshot of `report.html` when UI changes.

## Security & Configuration Tips

- Preferred auth is AI Gateway: set `AI_GATEWAY_API_KEY` in `.env`.
- Logs may contain prompts and model outputs; avoid committing `results/` and secrets.

