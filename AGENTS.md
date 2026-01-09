# Repository Guidelines

AI Tutor Harness: A benchmarking framework that tests whether AI tutors leak answers under adversarial student attacks. Uses a judge to evaluate leakage, hallucination, and Socratic compliance.

## Project Structure

```
src/
├── cli.ts                 # CLI entrypoint (loads env, parses args, starts run)
├── config.ts              # Single source of truth for model IDs and pairings
├── types.ts               # Zod schemas and TypeScript types
├── core/
│   ├── experiment.ts      # Orchestrates dataset loading, experiment matrix, logging
│   ├── conversation.ts    # Multi-turn conversation simulation with early stopping
│   └── llm.ts             # LLM abstraction with timing and multi-provider support
├── agents/
│   ├── question-gen.ts    # Question generation via AI SDK
│   ├── student.ts         # Adversarial student attacker simulation
│   ├── tutor.ts           # Tutor drafting logic
│   ├── supervisor.ts      # Supervisor verdict logic (returns `rationale` explaining approval/rejection)
│   └── judge.ts           # Judge scoring (leakage, hallucination, compliance)
├── output/
│   ├── report.ts          # Self-contained report.html renderer
│   ├── summary.ts         # Summary JSON generation
│   └── report/            # Report assets and rendering
├── utils/
│   ├── args.ts            # CLI argument parsing
│   └── util.ts            # Helpers (timing, file I/O, mutex)
└── scripts/
    └── generate-questions.ts  # Script to generate static question set

data/
└── questions.json         # 36 pre-generated questions (4 per Bloom x Difficulty cell)

results/                   # Output folders per run (raw.jsonl, summary.json, report.html)
dist/                      # Compiled JavaScript output from tsc
```

## Build, Test, and Development Commands

```bash
# Build TypeScript to dist/
pnpm build

# Run the harness (builds first via bun)
pnpm harness -- [flags]

# Smoke test: 1 question, bloom 1, easy, 2 turns, minimal variants
pnpm smoke

# Regenerate static questions in data/questions.json
pnpm generate-questions

# No automated tests yet
pnpm test
```

### Validating Changes

```bash
# Quick sanity check
pnpm smoke

# Small capped run without judge overhead
pnpm harness -- --maxRuns 5 --turns 2 --noJudge

# Full run with specific config
pnpm harness -- --tutors gemini --conditions single --turns 4
```

### Key CLI Flags

| Flag | Description | Default |
|------|-------------|---------|
| `--smoke` | Minimal run for sanity checking | - |
| `--turns N` | Turns per conversation | 6 (smoke: 2) |
| `--maxRuns N` | Stop after N runs | unlimited |
| `--parallel N` | Concurrent experiments | 5 (smoke: 1) |
| `--tutors LIST` | gpt, gemini | all |
| `--conditions LIST` | single, dual-loop | all |
| `--noJudge` | Disable judge pass | - |
| `--noEarlyStop` | Disable early stopping on leakage | - |
| `--verbose` | Extra per-turn logs | - |

## Code Style Guidelines

### Language and Formatting

- **Language**: TypeScript (Node.js, ES2022 target)
- **Module**: CommonJS
- **Indentation**: 2 spaces
- **Quotes**: Single quotes for strings
- **Semicolons**: Required
- **Line length**: No strict limit, but keep readable (~100-120 chars)
- **Trailing commas**: Use in multiline arrays/objects

### Imports

Order imports as follows, with blank lines between groups:

```typescript
// 1. Node built-ins
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// 2. External packages
import { generateObject, generateText } from 'ai';
import { z } from 'zod';

// 3. Internal modules (relative paths)
import { Question, SupervisorVerdict } from '../types';
import { timedGenerateObject } from '../core/llm';
```

### Types and Schemas

- Define Zod schemas in `src/types.ts` and derive TypeScript types from them
- Use `z.infer<typeof Schema>` pattern for type derivation
- Export both schema and type together

```typescript
export const QuestionSchema = z.object({
  id: z.string().min(1),
  bloomLevel: z.number().int().min(1).max(3),
  difficulty: DifficultySchema,
});
export type Question = z.infer<typeof QuestionSchema>;
```

### Naming Conventions

- **Files**: kebab-case (`question-gen.ts`, `dual-loop.ts`)
- **Variables/functions**: camelCase (`turnIndex`, `parseArgs`)
- **Types/interfaces**: PascalCase (`Question`, `SupervisorVerdict`)
- **Constants**: SCREAMING_SNAKE_CASE for config (`PAIRING_IDS`, `DEFAULT_MODELS`)
- **Question IDs**: `q-b{bloom}-{difficulty}-{n}` (e.g., `q-b1-easy-1`)
- **Run IDs**: `run_{ISO_timestamp}` (e.g., `run_2026-01-08T10-41-40-225Z`)

### Functions

- Keep functions small and single-purpose
- Prefer descriptive names over abbreviations
- Use async/await over raw promises
- Document complex functions with JSDoc

```typescript
/**
 * Get provider-specific options for a model.
 * - Configures OpenRouter to prefer high-throughput providers
 * - Disables reasoning for GPT-5.1 models
 */
function getProviderOptions(modelId: string): any {
  // ...
}
```

### Error Handling

- Throw descriptive `Error` with context
- Use try/catch for recoverable errors
- Log errors to console.error before re-throwing or exiting

```typescript
if (!isValidTutorId(id)) {
  throw new Error(`Invalid tutor ID: "${id}". Valid options: ${TUTOR_IDS.join(', ')}`);
}
```

### Configuration

- All model IDs live in `src/config.ts` (single source of truth)
- Use OpenRouter format: `provider/model-name` (e.g., `google/gemini-3-flash-preview`)
- Environment variables: `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`

## Output Files

Each run creates `results/<runId>/`:
- `raw.jsonl` - One JSON object per experiment run
- `summary.json` - Aggregated stats (leakage rate, hallucination rate, etc.)
- `report.html` - Self-contained interactive report

## Security Notes

- Preferred auth: Set `OPENROUTER_API_KEY` in `.env`
- Logs contain prompts and model outputs; avoid committing `results/` and secrets
- Never commit `.env` files

## Commit Guidelines

- Use imperative commits: "Add report banner", "Fix judge schema retry"
- PRs should include: purpose, CLI flags used to validate
- Include screenshot of `report.html` when UI changes
