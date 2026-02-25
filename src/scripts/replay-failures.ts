/**
 * Usage:
 *   node --import tsx src/scripts/replay-failures.ts <results/run_xxx>
 */
import 'dotenv/config';

import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

import pLimit from 'p-limit';

import { runTurnJudge } from '../agents/judge';
import { getSupervisorModel, getTutorModel, isValidSupervisorId, isValidTutorId, type SupervisorId, type TutorId } from '../config';
import { simulateConversation } from '../core/conversation';
import { loadRiskGatePolicy, type RiskGateRuntimeConfig } from '../core/risk-gate';
import { SummaryAggregator } from '../output/summary';
import type { CliArgs } from '../utils/args';
import { createJsonlWriter, ensureDir, nowIso } from '../utils/util';
import type { Condition, Question, RunRecord, TimedCallRecord, TurnJudgeResult } from '../types';

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

  let succeeded = 0;
  let failed = 0;
  const limit = pLimit(Math.max(1, args.parallel ?? 1));

  async function executeMissingRun(plan: RunPlan): Promise<void> {
    const calls: TimedCallRecord[] = [];
    const started = Date.now();
    const tutorModel = getTutorModel(plan.tutorId);
    const supervisorModel = plan.supervisorId ? getSupervisorModel(plan.supervisorId) : null;
    const pairingId = plan.supervisorId ? `${plan.tutorId}-${plan.supervisorId}` : `${plan.tutorId}-single`;

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
        totalLatencyMs: Date.now() - started,
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
    } catch {
      failed += 1;
    }
  }

  try {
    await Promise.all(missingPlans.map((plan) => limit(() => executeMissingRun(plan))));
  } finally {
    await rawWriter.close().catch(() => {});
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
    },
    totals: {
      questions: questions.length,
      plannedRuns: missingPlans.length,
      completedRuns: succeeded,
    },
    ...aggregator.toSummaryObject(),
  };
  await writeFile(join(replayOutDir, 'summary.json'), JSON.stringify(summary, null, 2));

  // eslint-disable-next-line no-console
  console.log(`Replay output: ${replayOutDir}`);
  // eslint-disable-next-line no-console
  console.log(
    [
      `planned=${plannedRuns.length}`,
      `completed=${completedInSource}`,
      `missing=${missingPlans.length}`,
      `replayed=${missingPlans.length}`,
      `succeeded=${succeeded}`,
      `failed=${failed}`,
    ].join(' ')
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
