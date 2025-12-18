import { ConditionSchema, PairingIdSchema } from './types';

export type CliArgs = {
  perDifficulty: number;
  difficulties: number[];
  turns: number;
  maxIters: number;
  maxRuns: number | null;
  easyQuestions: number | null;
  mediumQuestions: number | null;
  hardQuestions: number | null;
  earlyStop: boolean;
  outDir: string;
  pairings: Array<ReturnType<typeof PairingIdSchema.parse>>;
  conditions: Array<ReturnType<typeof ConditionSchema.parse>>;
  questionModel: string;
  studentModel: string;
  judgeModel: string;
  enableJudge: boolean;
  smoke: boolean;
  verbose: boolean;
};

function parseIntFlag(value: string | undefined, name: string): number {
  if (value == null) throw new Error(`Missing value for --${name}`);
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid value for --${name}: ${value}`);
  return parsed;
}

function parseListFlag(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);

  const raw: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (!token.startsWith('--')) continue;
    const [key, inlineValue] = token.slice(2).split('=', 2);
    if (inlineValue != null) {
      raw[key] = inlineValue;
      continue;
    }
    const next = args[i + 1];
    if (next == null || next.startsWith('--')) {
      raw[key] = true;
      continue;
    }
    raw[key] = next;
    i++;
  }

  const smoke = raw['smoke'] === true;
  const enableJudge = raw['noJudge'] === true ? false : true;
  const verbose = raw['verbose'] === true;
  const earlyStop = raw['noEarlyStop'] === true ? false : true;

  const perDifficultyProvided = raw['perDifficulty'] != null;
  const difficultiesProvided = raw['difficulties'] != null;

  const perDifficulty = raw['perDifficulty']
    ? parseIntFlag(String(raw['perDifficulty']), 'perDifficulty')
    : smoke
      ? 1
      : 3;

  const turns = raw['turns']
    ? parseIntFlag(String(raw['turns']), 'turns')
    : smoke
      ? 2
      : 6;

  const maxIters = raw['maxIters']
    ? parseIntFlag(String(raw['maxIters']), 'maxIters')
    : 5;

  const maxRuns = raw['maxRuns']
    ? parseIntFlag(String(raw['maxRuns']), 'maxRuns')
    : null;

  const easyQuestionsArg = raw['easyQuestions']
    ? parseIntFlag(String(raw['easyQuestions']), 'easyQuestions')
    : null;
  const mediumQuestionsArg = raw['mediumQuestions']
    ? parseIntFlag(String(raw['mediumQuestions']), 'mediumQuestions')
    : null;
  const hardQuestionsArg = raw['hardQuestions']
    ? parseIntFlag(String(raw['hardQuestions']), 'hardQuestions')
    : null;

  const bucketProvided =
    easyQuestionsArg != null || mediumQuestionsArg != null || hardQuestionsArg != null;

  // Default "full suite" dataset (when user does not specify any dataset flags):
  // 5 easy (d1-2), 5 medium (d3), 5 hard (d4-5)
  const useBucketDefaults = !smoke && !bucketProvided && !perDifficultyProvided && !difficultiesProvided;

  const easyQuestions = useBucketDefaults ? 5 : easyQuestionsArg;
  const mediumQuestions = useBucketDefaults ? 5 : mediumQuestionsArg;
  const hardQuestions = useBucketDefaults ? 5 : hardQuestionsArg;

  const outDir = raw['outDir'] ? String(raw['outDir']) : 'results';

  const questionModel = raw['questionModel']
    ? String(raw['questionModel'])
    : 'google/gemini-3-flash';

  const studentModel = raw['studentModel']
    ? String(raw['studentModel'])
    : 'google/gemini-3-flash';

  const judgeModel = raw['judgeModel'] ? String(raw['judgeModel']) : 'google/gemini-2.0-flash';

  const difficulties =
    raw['difficulties'] != null
      ? parseListFlag(String(raw['difficulties'])).map((d) => Number.parseInt(d, 10))
      : smoke
        ? [1]
        : [1, 2, 3, 4, 5];

  const defaultPairings = smoke
    ? ['gemini-gemini']
    : ['gpt5-gpt5', 'gemini-gemini', 'gpt5-gemini', 'gemini-gpt5'];
  const pairingsRaw = raw['pairings'] != null ? parseListFlag(String(raw['pairings'])) : defaultPairings;
  const pairings = pairingsRaw.map((p) => PairingIdSchema.parse(p));

  const defaultConditions = smoke ? ['single'] : ['single', 'dual-loop'];
  const conditionsRaw = raw['conditions'] != null ? parseListFlag(String(raw['conditions'])) : defaultConditions;
  const conditions = conditionsRaw.map((c) => ConditionSchema.parse(c));

  return {
    perDifficulty,
    difficulties,
    turns,
    maxIters,
    maxRuns,
    easyQuestions,
    mediumQuestions,
    hardQuestions,
    earlyStop,
    outDir,
    pairings,
    conditions,
    questionModel,
    studentModel,
    judgeModel,
    enableJudge,
    smoke,
    verbose,
  };
}

export function printHelp() {
  // eslint-disable-next-line no-console
  console.log(`
aitutor-harness

Usage:
  pnpm harness [flags]

Flags:
  --easyQuestions N        Generate N easy questions (difficulty 1-2)
  --mediumQuestions N      Generate N medium questions (difficulty 3)
  --hardQuestions N        Generate N hard questions (difficulty 4-5)
  --perDifficulty N        Questions per difficulty (default 3; smoke=1)
  --difficulties 1,2,3     Difficulty levels to generate (default 1-5; smoke=1)
  --turns N                Turns per conversation (default 6; smoke=2)
  --maxIters N             Max tutor revision loops (default 5)
  --maxRuns N              Stop after N completed runs (default unlimited)
  --outDir DIR             Output directory (default results)
  --pairings LIST          gpt5-gpt5,gemini-gemini,gpt5-gemini,gemini-gpt5 (default all; smoke=gemini-gemini)
  --conditions LIST        single,dual-loop (default all; smoke=single)
  --questionModel ID       Model for question generation (default google/gemini-3-flash)
  --studentModel ID        Model for student attacker (default google/gemini-3-flash)
  --judgeModel ID          Model for judge pass (default google/gemini-2.0-flash)
  --noJudge                Disable judge pass
  --noEarlyStop            Disable early stopping (otherwise stops when judge detects leakage or attacker goal success)
  --verbose                Extra per-turn logs (can be noisy)
  --smoke                  1 question (difficulty 1), 2 turns, minimal variants
  --help                   Show help

Models:
  Use AI Gateway IDs like "openai/gpt-5.1" and "google/gemini-3-flash".
  Requires AI_GATEWAY_API_KEY (or install provider modules and set provider keys).
`.trim());
}
