/**
 * Usage:
 *   node --import tsx src/scripts/replay-failures.ts <results/run_xxx>
 */
import 'dotenv/config';

import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

import pLimit from 'p-limit';

import { runTurnJudge } from '../agents/judge';
import {
  getSupervisorModel,
  getTutorModel,
  isValidSupervisorId,
  isValidTutorId,
  type SupervisorId,
  type TutorId,
} from '../config';
import { simulateConversation } from '../core/conversation';
import { loadRiskGatePolicy, type RiskGateRuntimeConfig } from '../core/risk-gate';
import { SummaryAggregator } from '../output/summary';
import type {
  Condition,
  Question,
  RunRecord,
  TimedCallRecord,
  TurnJudgeResult,
} from '../types';
import type { CliArgs } from '../utils/args';
import { createJsonlWriter, ensureDir, nowIso } from '../utils/util';

type StoredRunConfig = {
  runId?: string;
  createdAtIso?: string;
  args?: CliArgs;
  envSummary?: Record<string, unknown>;
};

type RunPlan = {
  question: Question;
  tutorId: TutorId;
  supervisorId: SupervisorId | null;
  condition: Condition;
};

type ReplayKeyParts = {
  questionId: string;
  tutorId: TutorId;
  supervisorId: SupervisorId | null;
  condition: Condition;
};

type ErrorCategory =
  | 'insufficient_balance'
  | 'rate_limit'
  | 'network'
  | 'timeout'
  | 'server_error'
  | 'auth_error'
  | 'invalid_request'
  | 'unknown';

type ErrorSnapshot = {
  category: ErrorCategory;
  retryable: boolean;
  message: string;
  status?: number;
  statusCode?: number;
  code?: string;
  type?: string;
  details?: Record<string, unknown>;
};

type FailedReplayRecord = {
  replayRunId: string;
  sourceRunId: string;
  sourceRunDir: string;
  createdAtIso: string;
  questionId: string;
  pairingId: string;
  condition: Condition;
  tutorId: TutorId;
  supervisorId: SupervisorId | null;
  attempt: number;
  maxAttempts: number;
  durationMs: number;
  error: ErrorSnapshot;
  callErrors: Array<{
    name?: string;
    kind?: string;
    model?: string;
    message: string;
    status?: number;
    statusCode?: number;
    code?: string;
    type?: string;
    details?: Record<string, unknown>;
  }>;
};

const REPLAY_MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 250;
const RETRY_MAX_DELAY_MS = 8000;
const PROGRESS_LOG_INTERVAL_MS = 5000;

function usage(): never {
  // eslint-disable-next-line no-console
  console.error('Usage: node --import tsx src/scripts/replay-failures.ts <results/run_xxx>');
  process.exit(2);
}

function parseJsonOrThrow(text: string, label: string): any {
  try {
    return JSON.parse(text);
  } catch (err: any) {
    throw new Error(`${label} is not valid JSON: ${String(err?.message ?? err)}`);
  }
}

function assertReplayArgs(args: CliArgs | undefined): asserts args is CliArgs {
  if (!args) {
    throw new Error('run-config.json is missing "args".');
  }
  if (!Array.isArray(args.tutors) || args.tutors.length === 0) {
    throw new Error('run-config.json args.tutors is missing or empty.');
  }
  if (!Array.isArray(args.supervisors) || args.supervisors.length === 0) {
    throw new Error('run-config.json args.supervisors is missing or empty.');
  }
  if (!Array.isArray(args.conditions) || args.conditions.length === 0) {
    throw new Error('run-config.json args.conditions is missing or empty.');
  }
}

function toReplayKey(parts: ReplayKeyParts): string {
  return JSON.stringify([
    parts.questionId,
    parts.tutorId,
    parts.supervisorId ?? '',
    parts.condition,
  ]);
}

function isCondition(value: unknown): value is Condition {
  return value === 'single' || value === 'dual-loop';
}

function deriveCondition(record: any): Condition | null {
  if (isCondition(record?.condition)) return record.condition;
  const pairingId = typeof record?.pairingId === 'string' ? record.pairingId : '';
  if (pairingId.endsWith('-single')) return 'single';
  if (pairingId.includes('-')) return 'dual-loop';
  return null;
}

function deriveTutorAndSupervisor(
  record: any,
  condition: Condition
): { tutorId: TutorId; supervisorId: SupervisorId | null } | null {
  const pairingId = typeof record?.pairingId === 'string' ? record.pairingId : '';
  const parts = pairingId.split('-').map((p: string) => p.trim()).filter(Boolean);

  let tutorFromPairing: string | null = null;
  let supervisorFromPairing: string | null = null;

  if (parts.length > 0) {
    tutorFromPairing =
      condition === 'single' && parts[parts.length - 1] === 'single'
        ? parts.slice(0, -1).join('-')
        : parts[0];
    if (condition === 'dual-loop' && parts.length >= 2 && parts[1] !== 'single') {
      supervisorFromPairing = parts[1];
    }
  }

  const cfg = record?.config && typeof record.config === 'object' ? record.config : null;
  const tutorFromConfig = typeof cfg?.tutorId === 'string' ? cfg.tutorId : null;
  const supervisorFromConfig = typeof cfg?.supervisorId === 'string' ? cfg.supervisorId : null;

  const tutorCandidate = tutorFromPairing ?? tutorFromConfig;
  if (!tutorCandidate || !isValidTutorId(tutorCandidate)) return null;

  if (condition === 'single') {
    return {
      tutorId: tutorCandidate,
      supervisorId: null,
    };
  }

  const supervisorCandidate = supervisorFromPairing ?? supervisorFromConfig;
  if (!supervisorCandidate || !isValidSupervisorId(supervisorCandidate)) return null;

  return {
    tutorId: tutorCandidate,
    supervisorId: supervisorCandidate,
  };
}

function buildRunMatrix(questions: Question[], args: CliArgs): RunPlan[] {
  const hasSingle = args.conditions.includes('single');
  const hasDualLoop = args.conditions.includes('dual-loop');

  const allRuns: RunPlan[] = [];
  for (const question of questions) {
    for (const tutorId of args.tutors) {
      if (hasSingle) {
        allRuns.push({
          question,
          tutorId,
          supervisorId: null,
          condition: 'single',
        });
      }
      if (hasDualLoop) {
        for (const supervisorId of args.supervisors) {
          allRuns.push({
            question,
            tutorId,
            supervisorId,
            condition: 'dual-loop',
          });
        }
      }
    }
  }

  return args.maxRuns != null ? allRuns.slice(0, args.maxRuns) : allRuns;
}

function summarizeRunJudgeFromTurnJudgments(
  turnJudgments: Array<{ turnIndex: number; judge: TurnJudgeResult }> | undefined
) {
  if (!turnJudgments || turnJudgments.length === 0) return null;

  const leakage = turnJudgments.some((row) => row.judge.leakage);
  const hallucination = turnJudgments.some((row) => row.judge.hallucination);
  const compliance = turnJudgments.every((row) => row.judge.compliance);

  const notes = leakage
    ? 'Derived from per-turn judge: leakage detected in at least one turn.'
    : hallucination
      ? 'Derived from per-turn judge: no leakage, hallucination detected in at least one turn.'
      : compliance
        ? 'Derived from per-turn judge: no leakage and Socratic compliance maintained.'
        : 'Derived from per-turn judge: no leakage, but Socratic compliance was not maintained.';

  return {
    leakage,
    hallucination,
    compliance,
    notes,
  };
}

async function getAiVersion(): Promise<string> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('ai/package.json').version as string;
  } catch {
    return 'unknown';
  }
}

async function buildRiskGateRuntimeConfig(args: CliArgs): Promise<RiskGateRuntimeConfig | null> {
  const mode = args.riskGateMode ?? 'off';
  if (mode === 'off') return null;

  if (!args.riskGatePolicyPath) {
    throw new Error('Risk gate is enabled in run-config, but riskGatePolicyPath is not set.');
  }

  const policy = await loadRiskGatePolicy(args.riskGatePolicyPath);
  return {
    mode,
    failMode: args.riskGateFailMode ?? 'closed',
    policy,
    localEmbedUrl: args.riskGateLocalEmbedUrl ?? null,
    openaiModel: args.riskGateOpenAIModel ?? 'text-embedding-3-small',
    openaiTimeoutMs: args.riskGateOpenAITimeoutMs ?? 8000,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function calculateRetryDelayMs(failureAttempt: number): number {
  const exponent = Math.max(0, failureAttempt - 1);
  const cappedExponential = Math.min(
    RETRY_MAX_DELAY_MS,
    RETRY_BASE_DELAY_MS * (2 ** exponent)
  );
  const jitterMultiplier = 0.5 + Math.random();

  return Math.max(
    1,
    Math.min(RETRY_MAX_DELAY_MS, Math.round(cappedExponential * jitterMultiplier))
  );
}

function pickStatus(err: any): { status?: number; statusCode?: number } {
  const result: { status?: number; statusCode?: number } = {};

  const directStatus = Number(err?.status);
  if (Number.isFinite(directStatus) && directStatus > 0) {
    result.status = directStatus;
  }

  const directStatusCode = Number(err?.statusCode);
  if (Number.isFinite(directStatusCode) && directStatusCode > 0) {
    result.statusCode = directStatusCode;
  }

  const details = err?.details;
  const detailsStatus = Number(details?.status);
  if (result.status === undefined && Number.isFinite(detailsStatus) && detailsStatus > 0) {
    result.status = detailsStatus;
  }

  const detailsStatusCode = Number(details?.statusCode);
  if (result.statusCode === undefined && Number.isFinite(detailsStatusCode) && detailsStatusCode > 0) {
    result.statusCode = detailsStatusCode;
  }

  return result;
}

function toErrorSnapshot(err: any): ErrorSnapshot {
  const nestedError = err?.error && typeof err.error === 'object' ? err.error : null;
  const nestedCodeRaw = nestedError?.code;
  const nestedCode =
    typeof nestedCodeRaw === 'string' || typeof nestedCodeRaw === 'number'
      ? String(nestedCodeRaw)
      : undefined;
  const message = String(nestedError?.message ?? err?.message ?? err ?? 'Unknown error');
  const lowerMessage = message.toLowerCase();
  const { status, statusCode } = pickStatus(err);
  const code = nestedCode ?? (typeof err?.code === 'string' ? err.code : undefined);
  const type = typeof err?.type === 'string' ? err.type : undefined;
  const details = err?.details && typeof err.details === 'object'
    ? (err.details as Record<string, unknown>)
    : nestedError?.metadata && typeof nestedError.metadata === 'object'
      ? (nestedError.metadata as Record<string, unknown>)
      : undefined;

  const effectiveStatus = status ?? statusCode;

  if (
    effectiveStatus === 402 ||
    code === '402' ||
    lowerMessage.includes('insufficient_quota') ||
    lowerMessage.includes('insufficient balance') ||
    lowerMessage.includes('insufficient credits') ||
    lowerMessage.includes('payment required')
  ) {
    return {
      category: 'insufficient_balance',
      retryable: false,
      message,
      status,
      statusCode,
      code,
      type,
      details,
    };
  }

  if (
    effectiveStatus === 429 ||
    code === '429' ||
    lowerMessage.includes('rate limit') ||
    lowerMessage.includes('too many requests')
  ) {
    return {
      category: 'rate_limit',
      retryable: true,
      message,
      status,
      statusCode,
      code,
      type,
      details,
    };
  }

  if (
    lowerMessage.includes('fetch failed') ||
    lowerMessage.includes('unable to make request') ||
    lowerMessage.includes('network') ||
    lowerMessage.includes('econnreset') ||
    lowerMessage.includes('socket hang up') ||
    lowerMessage.includes('connection reset')
  ) {
    return {
      category: 'network',
      retryable: true,
      message,
      status,
      statusCode,
      code,
      type,
      details,
    };
  }

  if (
    lowerMessage.includes('timeout') ||
    lowerMessage.includes('timed out') ||
    lowerMessage.includes('econnaborted') ||
    effectiveStatus === 408
  ) {
    return {
      category: 'timeout',
      retryable: true,
      message,
      status,
      statusCode,
      code,
      type,
      details,
    };
  }

  if (
    (effectiveStatus !== undefined && effectiveStatus >= 500) ||
    (code !== undefined && /^5\d\d$/.test(code))
  ) {
    return {
      category: 'server_error',
      retryable: true,
      message,
      status,
      statusCode,
      code,
      type,
      details,
    };
  }

  if (
    effectiveStatus === 401 ||
    effectiveStatus === 403 ||
    code === '401' ||
    code === '403' ||
    lowerMessage.includes('unauthorized')
  ) {
    return {
      category: 'auth_error',
      retryable: false,
      message,
      status,
      statusCode,
      code,
      type,
      details,
    };
  }

  if (effectiveStatus !== undefined && effectiveStatus >= 400 && effectiveStatus < 500) {
    return {
      category: 'invalid_request',
      retryable: false,
      message,
      status,
      statusCode,
      code,
      type,
      details,
    };
  }

  return {
    category: 'unknown',
    retryable: false,
    message,
    status,
    statusCode,
    code,
    type,
    details,
  };
}

function extractCallErrors(calls: TimedCallRecord[]): FailedReplayRecord['callErrors'] {
  const output: FailedReplayRecord['callErrors'] = [];

  for (const call of calls) {
    if (!call.error) continue;
    const err: any = call.error;
    const status = Number(err?.details?.status);
    const statusCode = Number(err?.details?.statusCode);
    output.push({
      name: call.name,
      kind: call.kind,
      model: call.model,
      message: String(err?.message ?? 'Unknown call error'),
      status: Number.isFinite(status) ? status : undefined,
      statusCode: Number.isFinite(statusCode) ? statusCode : undefined,
      code: typeof err?.code === 'string' ? err.code : undefined,
      type: typeof err?.type === 'string' ? err.type : undefined,
      details: err?.details && typeof err.details === 'object'
        ? err.details as Record<string, unknown>
        : undefined,
    });
  }

  return output;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

async function main() {
  const runDirArg = process.argv[2];
  if (!runDirArg) usage();

  const sourceRunDir = resolve(runDirArg);

  const runConfig: StoredRunConfig = parseJsonOrThrow(
    await readFile(join(sourceRunDir, 'run-config.json'), 'utf8'),
    'run-config.json'
  );
  const questionsJson = parseJsonOrThrow(
    await readFile(join(sourceRunDir, 'questions.json'), 'utf8'),
    'questions.json'
  );

  assertReplayArgs(runConfig.args);
  const args = runConfig.args;
  const questions = (Array.isArray(questionsJson?.questions) ? questionsJson.questions : []) as Question[];
  if (questions.length === 0) {
    throw new Error('questions.json has no questions.');
  }

  const plannedRuns = buildRunMatrix(questions, args);
  const plannedKeySet = new Set(
    plannedRuns.map((plan) =>
      toReplayKey({
        questionId: plan.question.id,
        tutorId: plan.tutorId,
        supervisorId: plan.supervisorId,
        condition: plan.condition,
      })
    )
  );

  const doneKeys = new Set<string>();
  const rawText = await readFile(join(sourceRunDir, 'raw.jsonl'), 'utf8');
  const lines = rawText.split('\n');
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx]?.trim();
    if (!line) continue;

    let parsed: any;
    try {
      parsed = JSON.parse(line);
    } catch {
      // Ignore incomplete trailing lines from in-progress runs.
      if (idx !== lines.length - 1) {
        // eslint-disable-next-line no-console
        console.warn(`Skipping invalid JSON at raw.jsonl line ${idx + 1}`);
      }
      continue;
    }

    const condition = deriveCondition(parsed);
    if (!condition) continue;
    const ids = deriveTutorAndSupervisor(parsed, condition);
    if (!ids) continue;
    const questionId = typeof parsed?.question?.id === 'string' ? parsed.question.id : null;
    if (!questionId) continue;

    const key = toReplayKey({
      questionId,
      tutorId: ids.tutorId,
      supervisorId: ids.supervisorId,
      condition,
    });
    if (plannedKeySet.has(key)) {
      doneKeys.add(key);
    }
  }

  const missingPlans = plannedRuns.filter(
    (plan) =>
      !doneKeys.has(
        toReplayKey({
          questionId: plan.question.id,
          tutorId: plan.tutorId,
          supervisorId: plan.supervisorId,
          condition: plan.condition,
        })
      )
  );

  const sourceRunId = String(runConfig.runId ?? basename(sourceRunDir));
  const createdAtIso = nowIso();
  const replayRunId = `${sourceRunId}_replay_${createdAtIso.replace(/[:.]/g, '-')}`;
  const outBaseDir = resolve(dirname(sourceRunDir));
  const replayOutDir = join(outBaseDir, replayRunId);
  await ensureDir(replayOutDir);

  const rawWriter = await createJsonlWriter(replayOutDir, 'raw.jsonl');
  const failedWriter = await createJsonlWriter(replayOutDir, 'failed.jsonl');
  const aggregator = new SummaryAggregator();
  const aiVersion = await getAiVersion();
  const riskGate = await buildRiskGateRuntimeConfig(args);

  await writeFile(
    join(replayOutDir, 'run-config.json'),
    JSON.stringify(
      {
        runId: replayRunId,
        createdAtIso,
        args,
        envSummary: runConfig.envSummary ?? null,
        replay: {
          sourceRunDir,
          sourceRunId,
        },
      },
      null,
      2
    )
  );

  const startedAtMs = Date.now();
  const missingCount = missingPlans.length;
  let succeeded = 0;
  let failed = 0;
  let processed = 0;
  let lastProgressLogMs = 0;
  let fatalStopReason: string | null = null;
  const failedByCategory: Record<ErrorCategory, number> = {
    insufficient_balance: 0,
    rate_limit: 0,
    network: 0,
    timeout: 0,
    server_error: 0,
    auth_error: 0,
    invalid_request: 0,
    unknown: 0,
  };

  function maybeLogProgress(force = false): void {
    const nowMs = Date.now();
    if (!force && nowMs - lastProgressLogMs < PROGRESS_LOG_INTERVAL_MS) {
      return;
    }
    lastProgressLogMs = nowMs;

    const elapsedMs = Math.max(1, nowMs - startedAtMs);
    const done = processed;
    const pct = missingCount === 0 ? 100 : (done / missingCount) * 100;
    const rate = done / (elapsedMs / 1000);
    const remaining = Math.max(0, missingCount - done);
    const etaMs = rate > 0 ? (remaining / rate) * 1000 : 0;

    // eslint-disable-next-line no-console
    console.log(
      [
        `[replay] ${done}/${missingCount}`,
        `(${pct.toFixed(1)}%)`,
        `ok=${succeeded}`,
        `fail=${failed}`,
        `rate=${rate.toFixed(2)}/s`,
        `eta=${formatDuration(etaMs)}`,
        fatalStopReason ? `fatalStop=${fatalStopReason}` : null,
      ].filter(Boolean).join(' ')
    );
  }

  // eslint-disable-next-line no-console
  console.log(`Replay start: source=${sourceRunId} missing=${missingCount} parallel=${Math.max(1, args.parallel ?? 1)} maxAttempts=${REPLAY_MAX_ATTEMPTS}`);

  const limit = pLimit(Math.max(1, args.parallel ?? 1));

  async function executeMissingRun(plan: RunPlan): Promise<void> {
    if (fatalStopReason) {
      processed += 1;
      failed += 1;
      failedByCategory.unknown += 1;
      await failedWriter.write({
        replayRunId,
        sourceRunId,
        sourceRunDir,
        createdAtIso: nowIso(),
        questionId: plan.question.id,
        pairingId: plan.supervisorId ? `${plan.tutorId}-${plan.supervisorId}` : `${plan.tutorId}-single`,
        condition: plan.condition,
        tutorId: plan.tutorId,
        supervisorId: plan.supervisorId,
        attempt: 0,
        maxAttempts: REPLAY_MAX_ATTEMPTS,
        durationMs: 0,
        error: {
          category: 'unknown',
          retryable: false,
          message: `Skipped due to fatal stop: ${fatalStopReason}`,
        },
        callErrors: [],
      } satisfies FailedReplayRecord);
      maybeLogProgress();
      return;
    }

    const tutorModel = getTutorModel(plan.tutorId);
    const supervisorModel = plan.supervisorId ? getSupervisorModel(plan.supervisorId) : null;
    const pairingId = plan.supervisorId ? `${plan.tutorId}-${plan.supervisorId}` : `${plan.tutorId}-single`;

    let lastSnapshot: ErrorSnapshot | null = null;
    let lastCallErrors: FailedReplayRecord['callErrors'] = [];

    for (let attempt = 1; attempt <= REPLAY_MAX_ATTEMPTS; attempt += 1) {
      const calls: TimedCallRecord[] = [];
      const attemptStartedMs = Date.now();

      try {
        const conversation = await simulateConversation({
          calls,
          condition: plan.condition,
          question: plan.question,
          turns: args.turns,
          maxIters: args.maxIters,
          studentModel: args.studentModel,
          tutorModel,
          supervisorModel,
          verbose: args.verbose,
          log: () => {},
          earlyStop: args.earlyStop,
          turnJudge:
            args.enableJudge
              ? async ({ turnIndex, transcriptVisible, studentTurns }) =>
                  runTurnJudge({
                    calls,
                    model: args.judgeModel,
                    question: plan.question,
                    transcriptVisible,
                    studentTurns,
                    turnIndex,
                  })
              : undefined,
          riskGate,
        });

        const record: RunRecord = {
          runId: replayRunId,
          createdAtIso,
          versions: {
            node: process.version,
            ai: aiVersion,
          },
          config: {
            args,
            models: {
              questionGeneratorModel: args.questionModel,
              studentAttackerModel: args.studentModel,
              judgeModel: args.judgeModel,
              tutorModel,
              supervisorModel,
            },
            tutorId: plan.tutorId,
            supervisorId: plan.supervisorId,
            replay: {
              sourceRunDir,
              sourceRunId,
            },
          },
          question: plan.question,
          pairingId,
          condition: plan.condition,
          turnsRequested: args.turns,
          maxIters: args.maxIters,
          turnsCompleted: conversation.turnsCompleted,
          loopIterationsTotal: conversation.loopIterationsTotal,
          loopTurnIterations: conversation.loopTurnIterations,
          transcriptVisible: conversation.transcriptVisible,
          hiddenTrace: conversation.hiddenTrace,
          calls,
          totalLatencyMs: Date.now() - attemptStartedMs,
          judge: args.enableJudge
            ? summarizeRunJudgeFromTurnJudgments(conversation.hiddenTrace.turnJudgments)
            : null,
          riskGate: riskGate
            ? {
                mode: riskGate.mode,
                failMode: riskGate.failMode,
                policyPath: args.riskGatePolicyPath,
                localEmbedUrl: riskGate.localEmbedUrl,
                openaiModel: riskGate.openaiModel,
                openaiTimeoutMs: riskGate.openaiTimeoutMs,
                policy: {
                  local_low: riskGate.policy.local_low,
                  local_high: riskGate.policy.local_high,
                  openai_threshold: riskGate.policy.openai_threshold,
                },
                stats: conversation.riskGateStats ?? {
                  evaluatedTurns: 0,
                  superviseCount: 0,
                  skipCount: 0,
                  enforcedSuperviseCount: 0,
                  enforcedSkipCount: 0,
                  localHighCount: 0,
                  localLowCount: 0,
                  openaiCount: 0,
                  openaiFallbackCount: 0,
                  failModeCount: 0,
                  failureCount: 0,
                },
              }
            : undefined,
        };

        await rawWriter.write(record);
        aggregator.add(record);
        succeeded += 1;
        processed += 1;
        maybeLogProgress();
        return;
      } catch (err: any) {
        const snapshot = toErrorSnapshot(err);
        const durationMs = Date.now() - attemptStartedMs;
        const callErrors = extractCallErrors(calls);
        lastSnapshot = snapshot;
        lastCallErrors = callErrors;

        if (snapshot.category === 'insufficient_balance') {
          fatalStopReason = snapshot.message;
        }

        const canRetry =
          attempt < REPLAY_MAX_ATTEMPTS &&
          snapshot.retryable &&
          !fatalStopReason;

        if (!canRetry) {
          failed += 1;
          processed += 1;
          failedByCategory[snapshot.category] += 1;

          await failedWriter.write({
            replayRunId,
            sourceRunId,
            sourceRunDir,
            createdAtIso: nowIso(),
            questionId: plan.question.id,
            pairingId,
            condition: plan.condition,
            tutorId: plan.tutorId,
            supervisorId: plan.supervisorId,
            attempt,
            maxAttempts: REPLAY_MAX_ATTEMPTS,
            durationMs,
            error: snapshot,
            callErrors,
          } satisfies FailedReplayRecord);

          // eslint-disable-next-line no-console
          console.error(
            `[replay][fail] ${plan.question.id} ${pairingId}/${plan.condition} attempt=${attempt}/${REPLAY_MAX_ATTEMPTS} category=${snapshot.category} status=${snapshot.status ?? snapshot.statusCode ?? '-'} msg=${snapshot.message}`
          );
          maybeLogProgress();
          return;
        }

        const delayMs = calculateRetryDelayMs(attempt);
        // eslint-disable-next-line no-console
        console.warn(
          `[replay][retry] ${plan.question.id} ${pairingId}/${plan.condition} attempt=${attempt}/${REPLAY_MAX_ATTEMPTS} category=${snapshot.category} waiting=${delayMs}ms`
        );
        await sleep(delayMs);
      }
    }

    // Defensive fallback: loop should always return.
    failed += 1;
    processed += 1;
    failedByCategory.unknown += 1;
    await failedWriter.write({
      replayRunId,
      sourceRunId,
      sourceRunDir,
      createdAtIso: nowIso(),
      questionId: plan.question.id,
      pairingId,
      condition: plan.condition,
      tutorId: plan.tutorId,
      supervisorId: plan.supervisorId,
      attempt: REPLAY_MAX_ATTEMPTS,
      maxAttempts: REPLAY_MAX_ATTEMPTS,
      durationMs: 0,
      error: lastSnapshot ?? {
        category: 'unknown',
        retryable: false,
        message: 'Replay failed without captured error snapshot.',
      },
      callErrors: lastCallErrors,
    } satisfies FailedReplayRecord);
    maybeLogProgress();
  }

  try {
    await Promise.all(missingPlans.map((plan) => limit(() => executeMissingRun(plan))));
  } finally {
    await rawWriter.close().catch(() => {});
    await failedWriter.close().catch(() => {});
  }

  const completedInSource = plannedRuns.length - missingPlans.length;
  const summary = {
    runId: replayRunId,
    createdAtIso,
    args,
    replay: {
      sourceRunDir,
      sourceRunId,
      planned: plannedRuns.length,
      completed: completedInSource,
      missing: missingPlans.length,
      replayed: missingPlans.length,
      succeeded,
      failed,
      failedByCategory,
      fatalStopReason,
      maxAttemptsPerRun: REPLAY_MAX_ATTEMPTS,
    },
    totals: {
      questions: questions.length,
      plannedRuns: missingPlans.length,
      completedRuns: succeeded,
      failedRuns: failed,
    },
    ...aggregator.toSummaryObject(),
  };
  await writeFile(join(replayOutDir, 'summary.json'), JSON.stringify(summary, null, 2));

  maybeLogProgress(true);

  // eslint-disable-next-line no-console
  console.log(`Replay output: ${replayOutDir}`);
  // eslint-disable-next-line no-console
  console.log(`Replay failures: ${join(replayOutDir, 'failed.jsonl')}`);
  // eslint-disable-next-line no-console
  console.log(
    [
      `planned=${plannedRuns.length}`,
      `completed=${completedInSource}`,
      `missing=${missingPlans.length}`,
      `replayed=${missingPlans.length}`,
      `succeeded=${succeeded}`,
      `failed=${failed}`,
      fatalStopReason ? `fatalStop=true` : 'fatalStop=false',
    ].join(' ')
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
