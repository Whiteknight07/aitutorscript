import {
  ConditionSchema,
  CsbenchFormat,
  CsbenchFormatSchema,
  Difficulty,
  DifficultySchema,
  RiskGateFailMode,
  RiskGateFailModeSchema,
  RiskGateMode,
  RiskGateModeSchema,
} from '../types';
import { DEFAULT_MODELS, PAIRING_IDS, parsePairingId, type PairingId, TUTOR_IDS, SUPERVISOR_IDS, parseTutorId, parseSupervisorId, type TutorId, type SupervisorId } from '../config';

export type CliArgs = {
  questionsPerCell: number;
  bloomLevels: number[];
  difficulties: Difficulty[];
  dataset: 'default' | 'canterbury' | 'csbench' | 'pairwise' | 'overlap-csbench-pairwise';
  questionLimit: number | null;
  courseLevels: string[];
  skillTags: string[];
  csbenchPath: string;
  pairwiseDir: string;
  overlapPath: string;
  csbenchFormats: CsbenchFormat[];
  turns: number;
  maxIters: number;
  maxRuns: number | null;
  parallel: number;
  earlyStop: boolean;
  outDir: string;
  pairings: PairingId[];
  tutors: TutorId[];
  supervisors: SupervisorId[];
  conditions: Array<ReturnType<typeof ConditionSchema.parse>>;
  questionModel: string;
  studentModel: string;
  judgeModel: string;
  enableJudge: boolean;
  dynamicQuestions: boolean;
  smoke: boolean;
  verbose: boolean;
  riskGateMode: RiskGateMode;
  riskGateFailMode: RiskGateFailMode;
  riskGatePolicyPath: string | null;
  riskGateLocalEmbedUrl: string | null;
  riskGateOpenAIModel: string;
  riskGateOpenAITimeoutMs: number;
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
  const dynamicQuestions = raw['dynamic'] === true;
  const riskGateModeRaw = raw['riskGateMode']
    ? String(raw['riskGateMode'])
    : raw['riskGate'] === true
      ? 'enforce'
      : 'off';
  const riskGateMode = RiskGateModeSchema.parse(riskGateModeRaw);
  const riskGateFailMode = RiskGateFailModeSchema.parse(
    raw['riskGateFailMode'] ? String(raw['riskGateFailMode']) : 'closed'
  );
  const riskGatePolicyPath = raw['riskGatePolicyPath']
    ? String(raw['riskGatePolicyPath'])
    : process.env.RISK_GATE_POLICY_PATH ?? null;
  const riskGateLocalEmbedUrl = raw['riskGateLocalEmbedUrl']
    ? String(raw['riskGateLocalEmbedUrl'])
    : process.env.RISK_GATE_LOCAL_EMBED_URL ?? null;
  const riskGateOpenAIModel = raw['riskGateOpenAIModel']
    ? String(raw['riskGateOpenAIModel'])
    : process.env.RISK_GATE_OPENAI_MODEL ?? 'text-embedding-3-small';
  const riskGateOpenAITimeoutMs = raw['riskGateOpenAITimeoutMs']
    ? parseIntFlag(String(raw['riskGateOpenAITimeoutMs']), 'riskGateOpenAITimeoutMs')
    : 8000;
  if (riskGateOpenAITimeoutMs <= 0) {
    throw new Error(`Invalid value for --riskGateOpenAITimeoutMs: ${riskGateOpenAITimeoutMs}`);
  }

  const questionsPerCell = raw['questionsPerCell']
    ? parseIntFlag(String(raw['questionsPerCell']), 'questionsPerCell')
    : smoke
      ? 1
      : 1;

  const datasetRaw = raw['dataset'] ? String(raw['dataset']) : 'csbench';
  if (
    datasetRaw !== 'default' &&
    datasetRaw !== 'canterbury' &&
    datasetRaw !== 'csbench' &&
    datasetRaw !== 'pairwise' &&
    datasetRaw !== 'overlap-csbench-pairwise'
  ) {
    throw new Error(
      `Invalid dataset: "${datasetRaw}". Use "default", "canterbury", "csbench", "pairwise", or "overlap-csbench-pairwise".`
    );
  }
  const dataset = datasetRaw as 'default' | 'canterbury' | 'csbench' | 'pairwise' | 'overlap-csbench-pairwise';

  const questionLimit = raw['questionLimit']
    ? parseIntFlag(String(raw['questionLimit']), 'questionLimit')
    : smoke
      ? 1
    : dataset === 'canterbury'
      ? 100
      : null;

  const csbenchPath = raw['csbenchPath'] ? String(raw['csbenchPath']) : 'test.jsonl';
  const pairwiseDir = raw['pairwiseDir'] ? String(raw['pairwiseDir']) : 'data/pairwise';
  const overlapPath = raw['overlapPath']
    ? String(raw['overlapPath'])
    : 'overlap-csbench-pairwise/questions.json';
  const csbenchFormatsRaw =
    raw['csbenchFormats'] != null
      ? parseListFlag(String(raw['csbenchFormats']))
      : ['multiple-choice', 'assertion', 'fill-in-the-blank', 'open-ended'];
  const csbenchFormats = csbenchFormatsRaw.map((format) =>
    CsbenchFormatSchema.parse(format.toLowerCase())
  );

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

  const parallel = raw['parallel']
    ? parseIntFlag(String(raw['parallel']), 'parallel')
    : smoke
      ? 1
      : 5;

  const outDir = raw['outDir'] ? String(raw['outDir']) : 'results';

  // Use centralized config for model defaults
  const questionModel = raw['questionModel']
    ? String(raw['questionModel'])
    : DEFAULT_MODELS.questionGenerator;

  const studentModel = raw['studentModel']
    ? String(raw['studentModel'])
    : DEFAULT_MODELS.student;

  const judgeModel = raw['judgeModel'] 
    ? String(raw['judgeModel']) 
    : DEFAULT_MODELS.judge;

  const bloomLevels =
    raw['bloomLevels'] != null
      ? parseListFlag(String(raw['bloomLevels'])).map((d) => Number.parseInt(d, 10))
      : smoke
        ? [1]
        : [1, 2, 3];

  const difficultiesRaw =
    raw['difficulties'] != null
      ? parseListFlag(String(raw['difficulties']))
      : smoke
        ? ['easy']
        : ['easy', 'medium', 'hard'];
  const difficulties = difficultiesRaw.map((d) => DifficultySchema.parse(d));

  const courseLevels = raw['courseLevels'] != null ? parseListFlag(String(raw['courseLevels'])) : [];
  const skillTags = raw['skillTags'] != null ? parseListFlag(String(raw['skillTags'])) : [];

  // Use centralized config for pairing defaults (legacy support)
  const defaultPairings: PairingId[] = smoke
    ? ['gemini-gemini']
    : PAIRING_IDS;
  const pairingsRaw = raw['pairings'] != null ? parseListFlag(String(raw['pairings'])) : defaultPairings;
  const pairings = pairingsRaw.map((p) => parsePairingId(p));

  // New tutor/supervisor based configuration
  const defaultTutors: TutorId[] = smoke ? ['gemini'] : TUTOR_IDS;
  const tutorsRaw = raw['tutors'] != null ? parseListFlag(String(raw['tutors'])) : defaultTutors;
  const tutors = tutorsRaw.map((t) => parseTutorId(t));

  const defaultSupervisors: SupervisorId[] = smoke ? ['gemini'] : SUPERVISOR_IDS;
  const supervisorsRaw = raw['supervisors'] != null ? parseListFlag(String(raw['supervisors'])) : defaultSupervisors;
  const supervisors = supervisorsRaw.map((s) => parseSupervisorId(s));

  const defaultConditions = smoke ? ['single'] : ['single', 'dual-loop'];
  const conditionsRaw = raw['conditions'] != null ? parseListFlag(String(raw['conditions'])) : defaultConditions;
  const conditions = conditionsRaw.map((c) => ConditionSchema.parse(c));

  return {
    questionsPerCell,
    bloomLevels,
    difficulties,
    dataset,
    questionLimit,
    courseLevels,
    skillTags,
    csbenchPath,
    pairwiseDir,
    overlapPath,
    csbenchFormats,
    turns,
    maxIters,
    maxRuns,
    parallel,
    earlyStop,
    outDir,
    pairings,
    tutors,
    supervisors,
    conditions,
    questionModel,
    studentModel,
    judgeModel,
    enableJudge,
    dynamicQuestions,
    smoke,
    verbose,
    riskGateMode,
    riskGateFailMode,
    riskGatePolicyPath,
    riskGateLocalEmbedUrl,
    riskGateOpenAIModel,
    riskGateOpenAITimeoutMs,
  };
}

export function printHelp() {
  // eslint-disable-next-line no-console
  console.log(`
aitutor-harness

Usage:
  pnpm harness [flags]

Flags:
  --dataset NAME           Question source: csbench, default, canterbury, pairwise, overlap-csbench-pairwise (default: csbench)
  --csbenchPath PATH       Path to CS Bench JSONL (default: test.jsonl)
  --pairwiseDir PATH       Path to pairwise question directory (default: data/pairwise)
  --overlapPath PATH       Path to overlap questions JSON (default: overlap-csbench-pairwise/questions.json)
  --csbenchFormats LIST    multiple-choice,assertion,fill-in-the-blank,open-ended (default all)
  --questionLimit N        Max questions to load (default: 100 for canterbury)
  --dynamic                Generate questions dynamically (default: use static data/questions.json)
  --questionsPerCell N     Questions per Bloom x Difficulty cell (default 1, only with --dynamic)
  --bloomLevels 1,2,3      Bloom's taxonomy levels (default 1,2,3; smoke=1)
                           1=Remember, 2=Understand, 3=Apply
  --difficulties LIST      easy,medium,hard (default all; smoke=easy)
  --courseLevels LIST      Filter tags (e.g., CS1,CS2) for Canterbury dataset
  --skillTags LIST         Filter tags (e.g., Skill-PureKnowledgeRecall) for Canterbury dataset
  --turns N                Turns per conversation (default 6; smoke=2)
  --maxIters N             Max tutor revision loops (default 5)
  --maxRuns N              Stop after N completed runs (default unlimited)
  --parallel N             Run N experiments concurrently (default 5; smoke=1)
  --outDir DIR             Output directory (default results)
  --pairings LIST          ${PAIRING_IDS.join(',')} (legacy, use --tutors/--supervisors instead)
  --tutors LIST            ${TUTOR_IDS.join(',')} (default all; smoke=gemini)
  --supervisors LIST       ${SUPERVISOR_IDS.join(',')} (default all; smoke=gemini)
  --conditions LIST        single,dual-loop (default all; smoke=single)
  --questionModel ID       Model for question generation (default from config.ts)
  --studentModel ID        Model for student attacker (default from config.ts)
  --judgeModel ID          Model for judge pass (default from config.ts)
  --noJudge                Disable judge pass
  --noEarlyStop            Disable early stopping (otherwise stops when judge detects leakage or attacker goal success)
  --verbose                Extra per-turn logs (can be noisy)
  --riskGate               Shortcut for --riskGateMode enforce
  --riskGateMode MODE      off,shadow,enforce (default off)
  --riskGatePolicyPath P   Path to risk gate policy JSON
  --riskGateLocalEmbedUrl U Local embedding endpoint URL
  --riskGateOpenAIModel ID OpenAI embedding model (default text-embedding-3-small)
  --riskGateFailMode MODE  closed,open (default closed)
  --riskGateOpenAITimeoutMs N Timeout in ms for embedding calls (default 8000)
  --smoke                  1 question (bloom 1, easy), 2 turns, minimal variants
  --help                   Show help

Question Source:
  By default, questions are loaded from test.jsonl at the repo root (CS Bench JSONL).
  Use --csbenchPath to point to a different CS Bench JSONL file.
  Use --csbenchFormats to filter formats.
  Use --dataset default to load data/questions.json (36 static questions).
  Use --dataset canterbury to load data/canterbury/questions-p*.html.
  Use --dataset pairwise to load pairwise questions from data/pairwise (or --pairwiseDir).
  Use --dataset overlap-csbench-pairwise to load mixed overlap questions from --overlapPath.
  Use --dynamic to generate questions at runtime instead.
  Build overlap dataset with: pnpm build:overlap-dataset
  Run harness on overlap only with: pnpm harness:overlap
  To regenerate static questions: pnpm generate-questions

Models:
  Use provider-qualified model IDs like "openai/gpt-5.1" and "google/gemini-3-flash-preview".
  Configure defaults in src/config.ts.
  Harness model calls route through OpenRouter SDK.
  Requires OPENROUTER_API_KEY.
  OPENAI_API_KEY is only needed for risk-gate embedding flows.
  GEMINI_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY are legacy direct-Gemini keys.
`.trim());
}
