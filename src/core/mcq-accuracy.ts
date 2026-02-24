import pLimit from 'p-limit';
import { z } from 'zod';

import { getQuestionChoices, getQuestionFormat } from '../agents/question-format';
import { timedGenerateObject } from './llm';
import { loadOverlapQuestions } from './overlap';
import type { Question, TimedCallRecord } from '../types';
import { createJsonlWriter, nowIso } from '../utils/util';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

const DEFAULT_MODELS = ['openai/gpt-5.1', 'google/gemini-3-flash-preview'];

const SYSTEM_PROMPT =
  'You are answering a multiple-choice question. Follow the output rule exactly.';

const LetterResponseSchema = z.object({
  letter: z.string().min(1),
});

type OverlapSource = 'csbench' | 'pairwise';

export type OverlapMcqQuestion = {
  question: Question;
  source: OverlapSource;
  choices: string[];
  correctChoiceIndex: number;
  expectedLetter: string;
  allowedLetters: string[];
};

export type McqAccuracyAttemptResult = {
  rawLetter: string | null;
  latencyMs: number | null;
  finishReason: string | null;
  usage: unknown;
  errorType: string | null;
  errorMessage: string | null;
};

export type McqAccuracyRecord = {
  run_id: string;
  timestamp_iso: string;
  question_id: string;
  source: OverlapSource;
  model_id: string;
  choice_count: number;
  allowed_letters: string[];
  predicted: string | null;
  expected: string;
  correct: boolean;
  latency_ms: number | null;
  latency_ms_total: number | null;
  attempts_used: number;
  retry_invalid_budget: number;
  finish_reason: string | null;
  token_input: number | null;
  token_output: number | null;
  token_total: number | null;
  token_reasoning: number | null;
  token_cached_input: number | null;
  raw_usage: unknown;
  error_type: string | null;
  error_message: string | null;
  invalid_reason: string | null;
};

export type McqAccuracyRunOptions = {
  overlapPath: string;
  outDir: string;
  outFile: string;
  questionLimit: number | null;
  parallel: number;
  retryInvalid: number;
  models: string[];
  questions?: Question[];
  attemptFn?: (args: {
    modelId: string;
    questionId: string;
    systemPrompt: string;
    userPrompt: string;
    attempt: number;
  }) => Promise<McqAccuracyAttemptResult>;
};

export type McqAccuracyRunSummary = {
  runId: string;
  outputPath: string;
  totalQuestionsLoaded: number;
  totalQuestionsEvaluated: number;
  totalRecords: number;
  invalidRecords: number;
  accuracyByModel: Record<string, { correct: number; total: number; accuracy: number }>;
};

function parseIntArg(value: string | undefined, flag: string): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid value for ${flag}: "${value}"`);
  }
  return parsed;
}

function parseListArg(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function toOverlapSource(question: Question): OverlapSource | null {
  const source = String((question as any).source ?? '').toLowerCase();
  const dataset = String((question as any).dataset ?? '').toLowerCase();

  if (source === 'csbench' || dataset === 'csbench') return 'csbench';
  if (source === 'pairwise' || dataset === 'pairwise') return 'pairwise';
  return null;
}

function isValidCorrectChoiceIndex(question: Question, choicesLength: number): number | null {
  const raw = (question as any).correctChoiceIndex;
  if (typeof raw !== 'number' || !Number.isInteger(raw)) return null;
  if (raw < 0 || raw >= choicesLength) return null;
  return raw;
}

function lettersForChoiceCount(choiceCount: number): string[] {
  if (!Number.isInteger(choiceCount) || choiceCount < 2) {
    throw new Error(`Invalid choice count: ${choiceCount}`);
  }
  if (choiceCount > LETTERS.length) {
    throw new Error(`Choice count ${choiceCount} exceeds supported maximum ${LETTERS.length}.`);
  }
  return LETTERS.slice(0, choiceCount);
}

function formatAllowedLetterInstruction(allowedLetters: string[]): string {
  if (allowedLetters.length === 0) {
    throw new Error('Allowed letters must not be empty.');
  }

  if (allowedLetters.length === 1) {
    return allowedLetters[0];
  }

  if (allowedLetters.length === 2) {
    return `${allowedLetters[0]} or ${allowedLetters[1]}`;
  }

  const head = allowedLetters.slice(0, -1).join(', ');
  const tail = allowedLetters[allowedLetters.length - 1];
  return `${head}, or ${tail}`;
}

function normalizePredictedLetter(value: string | null): string | null {
  if (!value) return null;
  const trimmed = String(value).trim().toUpperCase();
  if (trimmed.length !== 1) return null;
  return /^[A-Z]$/.test(trimmed) ? trimmed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function usageNumber(usage: unknown, key: string): number | null {
  if (!isRecord(usage)) return null;
  const value = usage[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildUserPrompt(question: Question, choices: string[], allowedLetters: string[]): string {
  const renderedChoices = choices
    .map((choice, idx) => `${allowedLetters[idx]}) ${choice}`)
    .join('\n');

  return [
    question.problemStatement,
    '',
    'Choices:',
    renderedChoices,
    '',
    `Return ONLY one letter: ${formatAllowedLetterInstruction(allowedLetters)}. No explanation.`,
  ].join('\n');
}

export function selectOverlapMcqQuestions(questions: Question[]): OverlapMcqQuestion[] {
  const selected: OverlapMcqQuestion[] = [];

  for (const question of questions) {
    const source = toOverlapSource(question);
    if (!source) continue;

    const format = getQuestionFormat(question);
    if (format !== 'multiple-choice') continue;

    const choices = getQuestionChoices(question);
    if (choices.length < 2) continue;

    const correctChoiceIndex = isValidCorrectChoiceIndex(question, choices.length);
    if (correctChoiceIndex == null) continue;

    const allowedLetters = lettersForChoiceCount(choices.length);

    selected.push({
      question,
      source,
      choices,
      correctChoiceIndex,
      expectedLetter: allowedLetters[correctChoiceIndex],
      allowedLetters,
    });
  }

  return selected;
}

async function defaultAttemptFn({
  modelId,
  questionId,
  systemPrompt,
  userPrompt,
  attempt,
}: {
  modelId: string;
  questionId: string;
  systemPrompt: string;
  userPrompt: string;
  attempt: number;
}): Promise<McqAccuracyAttemptResult> {
  const calls: TimedCallRecord[] = [];

  try {
    const { object } = await timedGenerateObject<{ letter: string }>({
      calls,
      name: `mcq-accuracy:${questionId}:attempt-${attempt}`,
      model: modelId,
      system: systemPrompt,
      prompt: userPrompt,
      schema: LetterResponseSchema,
      schemaName: 'mcq_letter_response',
    });

    const call = calls[calls.length - 1];
    const rawLetter = typeof object.letter === 'string' ? object.letter : null;

    return {
      rawLetter,
      latencyMs: call?.durationMs ?? null,
      finishReason: isRecord(call?.output) && typeof call.output.finishReason === 'string'
        ? String(call.output.finishReason)
        : null,
      usage: call?.usage ?? null,
      errorType: null,
      errorMessage: null,
    };
  } catch (err: any) {
    const call = calls[calls.length - 1];
    const error = isRecord(call?.error) ? call?.error : null;

    return {
      rawLetter: null,
      latencyMs: call?.durationMs ?? null,
      finishReason: null,
      usage: call?.usage ?? null,
      errorType: error && typeof error.name === 'string' ? error.name : err?.name ?? 'Error',
      errorMessage: error && typeof error.message === 'string' ? error.message : String(err?.message ?? err),
    };
  }
}

function computeAccuracyByModel(records: McqAccuracyRecord[]): Record<string, { correct: number; total: number; accuracy: number }> {
  const counters = new Map<string, { correct: number; total: number }>();

  for (const record of records) {
    const prev = counters.get(record.model_id) ?? { correct: 0, total: 0 };
    prev.total += 1;
    if (record.correct) prev.correct += 1;
    counters.set(record.model_id, prev);
  }

  const out: Record<string, { correct: number; total: number; accuracy: number }> = {};
  for (const [modelId, row] of counters.entries()) {
    out[modelId] = {
      ...row,
      accuracy: row.total > 0 ? row.correct / row.total : 0,
    };
  }

  return out;
}

async function evaluateQuestionModel({
  runId,
  entry,
  modelId,
  retryInvalid,
  attemptFn,
}: {
  runId: string;
  entry: OverlapMcqQuestion;
  modelId: string;
  retryInvalid: number;
  attemptFn: McqAccuracyRunOptions['attemptFn'];
}): Promise<McqAccuracyRecord> {
  const maxAttempts = retryInvalid + 1;
  const allowedLetterSet = new Set(entry.allowedLetters);
  const systemPrompt = SYSTEM_PROMPT;
  const userPrompt = buildUserPrompt(entry.question, entry.choices, entry.allowedLetters);

  let attemptsUsed = 0;
  let latencyMsTotal = 0;
  let lastAttempt: McqAccuracyAttemptResult | null = null;
  let predicted: string | null = null;
  let invalidReason: string | null = null;

  const resolvedAttemptFn = attemptFn ?? defaultAttemptFn;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    attemptsUsed = attempt;
    const attemptResult = await resolvedAttemptFn({
      modelId,
      questionId: entry.question.id,
      systemPrompt,
      userPrompt,
      attempt,
    });
    lastAttempt = attemptResult;

    if (attemptResult.latencyMs != null) {
      latencyMsTotal += attemptResult.latencyMs;
    }

    const normalized = normalizePredictedLetter(attemptResult.rawLetter);
    if (!normalized) {
      invalidReason = attemptResult.rawLetter == null ? 'missing_prediction' : 'non_single_letter';
      continue;
    }
    if (!allowedLetterSet.has(normalized)) {
      invalidReason = 'letter_out_of_range';
      continue;
    }

    predicted = normalized;
    invalidReason = null;
    break;
  }

  const usage = lastAttempt?.usage ?? null;

  return {
    run_id: runId,
    timestamp_iso: nowIso(),
    question_id: entry.question.id,
    source: entry.source,
    model_id: modelId,
    choice_count: entry.choices.length,
    allowed_letters: entry.allowedLetters,
    predicted,
    expected: entry.expectedLetter,
    correct: predicted === entry.expectedLetter,
    latency_ms: lastAttempt?.latencyMs ?? null,
    latency_ms_total: lastAttempt != null ? latencyMsTotal : null,
    attempts_used: attemptsUsed,
    retry_invalid_budget: retryInvalid,
    finish_reason: lastAttempt?.finishReason ?? null,
    token_input: usageNumber(usage, 'inputTokens'),
    token_output: usageNumber(usage, 'outputTokens'),
    token_total: usageNumber(usage, 'totalTokens'),
    token_reasoning: usageNumber(usage, 'reasoningTokens'),
    token_cached_input: usageNumber(usage, 'cachedInputTokens'),
    raw_usage: usage,
    error_type: lastAttempt?.errorType ?? null,
    error_message: lastAttempt?.errorMessage ?? null,
    invalid_reason: invalidReason,
  };
}

export async function runOverlapMcqAccuracy(options: McqAccuracyRunOptions): Promise<McqAccuracyRunSummary> {
  const startedAtIso = nowIso();
  const runId = `run_mcq_accuracy_${startedAtIso.replace(/[:.]/g, '-')}`;

  console.error('[mcq-accuracy] Loading questions...');
  const allQuestions = options.questions ?? (await loadOverlapQuestions({
    jsonPath: options.overlapPath,
    limit: null,
  }));
  console.error(`[mcq-accuracy] Loaded ${allQuestions.length} questions`);

  const selectedAll = selectOverlapMcqQuestions(allQuestions);
  const selected = options.questionLimit == null
    ? selectedAll
    : selectedAll.slice(0, Math.max(0, options.questionLimit));
  console.error(`[mcq-accuracy] Selected ${selected.length} MCQ questions (from ${selectedAll.length} eligible)`);

  const writer = await createJsonlWriter(options.outDir, options.outFile);

  try {
    const concurrency = Math.max(1, options.parallel);
    const limiter = pLimit(concurrency);

    const tasks: Array<{ entry: OverlapMcqQuestion; modelId: string }> = [];
    for (const entry of selected) {
      for (const modelId of options.models) {
        tasks.push({ entry, modelId });
      }
    }

    const totalTasks = tasks.length;
    console.error(`[mcq-accuracy] Evaluating ${totalTasks} tasks (${selected.length} questions × ${options.models.length} models, concurrency=${concurrency})`);
    console.error(`[mcq-accuracy] Models: ${options.models.join(', ')}`);

    let completed = 0;
    let correctSoFar = 0;
    const startTime = Date.now();

    const records = await Promise.all(
      tasks.map((task) =>
        limiter(async () => {
          const record = await evaluateQuestionModel({
            runId,
            entry: task.entry,
            modelId: task.modelId,
            retryInvalid: options.retryInvalid,
            attemptFn: options.attemptFn,
          });
          await writer.write(record);

          completed += 1;
          if (record.correct) correctSoFar += 1;
          const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
          const status = record.predicted == null ? 'INVALID' : record.correct ? '✓' : '✗';
          console.error(
            `[mcq-accuracy] [${completed}/${totalTasks}] ${status} ${record.question_id} | ${record.model_id} | predicted=${record.predicted ?? '—'} expected=${record.expected} | ${elapsedSec}s elapsed`
          );

          return record;
        })
      )
    );

    const invalidRecords = records.filter((record) => record.predicted == null).length;
    const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(`[mcq-accuracy] Done — ${correctSoFar}/${totalTasks} correct, ${invalidRecords} invalid, ${totalElapsed}s total`);

    return {
      runId,
      outputPath: writer.path,
      totalQuestionsLoaded: allQuestions.length,
      totalQuestionsEvaluated: selected.length,
      totalRecords: records.length,
      invalidRecords,
      accuracyByModel: computeAccuracyByModel(records),
    };
  } finally {
    await writer.close();
  }
}

export function parseMcqAccuracyArgs(argv: string[]): McqAccuracyRunOptions {
  const overlapPath = argv.includes('--overlapPath')
    ? String(argv[argv.indexOf('--overlapPath') + 1] ?? 'overlap-csbench-pairwise/questions.json')
    : 'overlap-csbench-pairwise/questions.json';

  const outDir = argv.includes('--outDir')
    ? String(argv[argv.indexOf('--outDir') + 1] ?? 'results')
    : 'results';

  const outFileArg = argv.includes('--outFile')
    ? String(argv[argv.indexOf('--outFile') + 1] ?? '').trim()
    : '';

  const questionLimit = argv.includes('--questionLimit')
    ? parseIntArg(String(argv[argv.indexOf('--questionLimit') + 1] ?? ''), '--questionLimit')
    : null;

  const parallel = argv.includes('--parallel')
    ? parseIntArg(String(argv[argv.indexOf('--parallel') + 1] ?? ''), '--parallel') ?? 5
    : 5;

  const retryInvalid = argv.includes('--retryInvalid')
    ? parseIntArg(String(argv[argv.indexOf('--retryInvalid') + 1] ?? ''), '--retryInvalid') ?? 2
    : 2;

  const models = argv.includes('--models')
    ? parseListArg(String(argv[argv.indexOf('--models') + 1] ?? ''))
    : DEFAULT_MODELS;

  if (models.length === 0) {
    throw new Error('No models provided. Use --models with a comma-separated list.');
  }

  const defaultOutFile = `mcq_accuracy_${nowIso().replace(/[:.]/g, '-')}.jsonl`;

  return {
    overlapPath,
    outDir,
    outFile: outFileArg || defaultOutFile,
    questionLimit,
    parallel,
    retryInvalid,
    models,
  };
}

export function printMcqAccuracyHelp(): void {
  // eslint-disable-next-line no-console
  console.log(`
Run closed-book MCQ accuracy on csbench/pairwise overlap questions.

Usage:
  pnpm overlap:mcq-accuracy -- [flags]

Flags:
  --overlapPath PATH   Overlap JSON path (default: overlap-csbench-pairwise/questions.json)
  --outDir DIR         Output directory for JSONL (default: results)
  --outFile FILE       Output JSONL filename (default: mcq_accuracy_<ISO>.jsonl)
  --questionLimit N    Max MCQ questions to evaluate after filtering (default: all)
  --parallel N         Concurrent model calls (default: 5)
  --retryInvalid N     Retries for invalid/non-parseable outputs (default: 2)
  --models LIST        Comma-separated model IDs (default: openai/gpt-5.1,google/gemini-3-flash-preview)
  --help               Show help
`.trim());
}
