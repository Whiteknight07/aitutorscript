# Repository Guidelines

AI Tutor Harness: Benchmarks whether AI tutors leak answers under adversarial student attacks. Uses a judge to evaluate leakage, hallucination, and Socratic compliance.

## Project Structure

```
src/
├── cli.ts              # CLI entrypoint
├── config.ts           # Model IDs and pairings (single source of truth)
├── types.ts            # Zod schemas and TypeScript types
├── core/
│   ├── experiment.ts   # Orchestrates experiment matrix
│   ├── conversation.ts # Multi-turn simulation with early stopping
│   └── llm.ts          # LLM abstraction with timing
├── agents/
│   ├── student.ts      # Adversarial student attacker
│   ├── tutor.ts        # Tutor drafting logic
│   ├── supervisor.ts   # Supervisor verdict (rationale + approval)
│   └── judge.ts        # Leakage/hallucination/compliance scoring
├── output/
│   ├── report.ts       # Self-contained report.html renderer
│   ├── analysis/       # Analysis aggregation and tables
│   └── report/         # Report assets (CSS/JS as template strings)
└── scripts/
    ├── generate-questions.ts
    └── regenerate-report.ts
```

## Build & Run Commands

```bash
pnpm build              # Compile TypeScript to dist/
pnpm harness -- [flags] # Run harness (uses bun directly)
pnpm smoke              # Quick sanity check (1 question, 2 turns)

# Regenerate report from existing run
bun run src/scripts/regenerate-report.ts results/run_xxx
```

### Validation

```bash
pnpm smoke                                    # Fastest check
pnpm harness -- --maxRuns 5 --turns 2 --noJudge  # Small run, no judge
pnpm harness -- --tutors gemini --conditions single --turns 4
```

### Key CLI Flags

| Flag | Description | Default |
|------|-------------|---------|
| `--smoke` | Minimal run | - |
| `--turns N` | Turns per conversation | 6 |
| `--maxRuns N` | Cap total runs | unlimited |
| `--parallel N` | Concurrent experiments | 5 |
| `--tutors LIST` | gpt, gemini | all |
| `--conditions LIST` | single, dual-loop | all |
| `--noJudge` | Skip judge pass | - |
| `--verbose` | Extra logging | - |

## Code Style

### Formatting
- **TypeScript** with ES2022 target, CommonJS modules
- **2 spaces** indentation, **single quotes**, **semicolons required**
- **Trailing commas** in multiline arrays/objects

### Imports (ordered with blank lines between groups)

```typescript
// 1. Node built-ins
import { readFile } from 'node:fs/promises';

// 2. External packages
import { generateObject } from 'ai';
import { z } from 'zod';

// 3. Internal modules
import { Question } from '../types';
import { timedGenerateObject } from '../core/llm';
```

### Types & Schemas

Define Zod schemas in `src/types.ts`, derive types with `z.infer`:

```typescript
export const QuestionSchema = z.object({
  id: z.string().min(1),
  bloomLevel: z.number().int().min(1).max(3),
  difficulty: DifficultySchema,
});
export type Question = z.infer<typeof QuestionSchema>;
```

### Naming

| Element | Convention | Example |
|---------|------------|---------|
| Files | kebab-case | `question-gen.ts` |
| Variables/functions | camelCase | `turnIndex` |
| Types/interfaces | PascalCase | `SupervisorVerdict` |
| Constants | SCREAMING_SNAKE | `PAIRING_IDS` |
| Question IDs | `q-b{bloom}-{diff}-{n}` | `q-b1-easy-1` |
| Run IDs | `run_{ISO}` | `run_2026-01-08T10-41-40-225Z` |

### Functions

- Small, single-purpose functions
- Use async/await over raw promises
- JSDoc for complex functions

### Error Handling

- Throw descriptive errors with context
- Log to console.error before re-throwing

```typescript
if (!isValidTutorId(id)) {
  throw new Error(`Invalid tutor ID: "${id}". Valid: ${TUTOR_IDS.join(', ')}`);
}
```

## Configuration

- Model IDs in `src/config.ts` (OpenRouter format: `provider/model-name`)
- Environment: `OPENROUTER_API_KEY` (preferred), `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`

## Output Files

Each run creates `results/<runId>/`:
- `raw.jsonl` - One JSON object per experiment
- `summary.json` - Aggregated stats
- `analysis.json` - Detailed breakdowns by tutor, condition, bloom, etc.
- `report.html` - Self-contained interactive report

## Report Development

Report is self-contained HTML with embedded CSS/JS in `src/output/report/assets/`:
```bash
# Edit css.ts or js.ts, then:
pnpm build && bun run src/scripts/regenerate-report.ts results/run_xxx
```

## Security

- Never commit `.env` or `results/` (contains prompts/outputs)
- Preferred auth: `OPENROUTER_API_KEY` in `.env`

## Commits

- Imperative style: "Add report banner", "Fix judge retry"
- Include CLI flags used to validate changes
- Screenshot `report.html` for UI changes
