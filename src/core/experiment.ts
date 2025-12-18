import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from '../utils/args';
import { simulateConversation } from './conversation';
import { generateQuestionsBatch } from '../agents/question-gen';
import { getPairingModels } from '../config';
import { createJsonlWriter, ensureDir, nowIso } from '../utils/util';
import type { Question, RunRecord, TimedCallRecord } from '../types';
import { runJudgeIfEnabled, runTurnJudge } from '../agents/judge';
import { SummaryAggregator } from '../output/summary';
import { renderReportHtml } from '../output/report';

export async function runExperiments({
  args,
  envSummary,
}: {
  args: ReturnType<typeof parseArgs>;
  envSummary: Record<string, unknown>;
}) {
  const createdAtIso = nowIso();
  const runId = `run_${createdAtIso.replace(/[:.]/g, '-')}`;

  const runOutDir = join(args.outDir, runId);
  await ensureDir(runOutDir);
  // eslint-disable-next-line no-console
  console.log(`runId=${runId}`);
  // eslint-disable-next-line no-console
  console.log(`outDir=${runOutDir}`);
  // eslint-disable-next-line no-console
  console.log(
    `models: question=${args.questionModel} student=${args.studentModel} judge=${args.enableJudge ? args.judgeModel : '(disabled)'}`
  );
  await writeFile(
    join(runOutDir, 'run-config.json'),
    JSON.stringify(
      {
        runId,
        createdAtIso,
        args,
        envSummary,
      },
      null,
      2
    )
  );

  const datasetCalls: TimedCallRecord[] = [];
  // eslint-disable-next-line no-console
  if (args.easyQuestions != null || args.mediumQuestions != null || args.hardQuestions != null) {
    // eslint-disable-next-line no-console
    console.log(
      `generating questions: easy=${args.easyQuestions ?? 0} medium=${args.mediumQuestions ?? 0} hard=${args.hardQuestions ?? 0} (maps to d1-2, d3, d4-5)`
    );
  } else {
    // eslint-disable-next-line no-console
    console.log(
      `generating questions: difficulties=${args.difficulties.join(',')} perDifficulty=${args.perDifficulty}`
    );
  }
  const questions = await generateDataset({ runId, args, datasetCalls });
  // eslint-disable-next-line no-console
  console.log(`generated ${questions.length} questions`);

  await writeFile(
    join(runOutDir, 'questions.json'),
    JSON.stringify(
      {
        runId,
        createdAtIso,
        questionGeneratorModel: args.questionModel,
        difficulties: args.difficulties,
        perDifficulty: args.perDifficulty,
        calls: datasetCalls,
        questions,
      },
      null,
      2
    )
  );

  const rawWriter = await createJsonlWriter(runOutDir, 'raw.jsonl');
  const aggregator = new SummaryAggregator();
  const recordsForReport: RunRecord[] = [];

  const totalRuns = questions.length * args.pairings.length * args.conditions.length;
  const plannedRuns = args.maxRuns != null ? Math.min(totalRuns, args.maxRuns) : totalRuns;
  let runIndex = 0;
  let completedRuns = 0;
  let current:
    | {
        index: number;
        questionId: string;
        difficulty: number;
        pairingId: string;
        condition: string;
      }
    | null = null;
  const allStart = Date.now();

  await writePartialOutputs({
    runOutDir,
    runId,
    createdAtIso,
    args,
    questions,
    aggregator,
    records: recordsForReport,
    plannedRuns,
    completedRuns,
    state: 'running',
    current: null,
    error: null,
  });

  try {
  // Interleaved schedule by default:
  // question → pairing → condition
  // This makes partial runs (e.g. --maxRuns 50) populate all pairings early.
  for (const question of questions) {
    for (const pairingId of args.pairings) {
      const { tutorModel, supervisorModel } = getPairingModels(pairingId);
      for (const condition of args.conditions) {
        if (runIndex >= plannedRuns) break;
        const calls: TimedCallRecord[] = [];
        const t0 = Date.now();

        runIndex += 1;
        const prefix = `[${runIndex}/${plannedRuns}] q=${question.id} diff=${question.difficulty} pairing=${pairingId} cond=${condition}`;
        const elapsed = Date.now() - allStart;
        const avgPerRunMs = runIndex > 1 ? elapsed / (runIndex - 1) : null;
        const remainingRuns = plannedRuns - runIndex + 1;
        const etaMs = avgPerRunMs != null ? Math.round(avgPerRunMs * (remainingRuns - 1)) : null;
        // eslint-disable-next-line no-console
        console.log(
          `start ${prefix} turns=${args.turns} maxIters=${args.maxIters} judge=${args.enableJudge ? 'on' : 'off'}${
            etaMs != null ? ` eta~${Math.round(etaMs / 1000)}s` : ''
          }`
        );

        current = {
          index: runIndex,
          questionId: question.id,
          difficulty: question.difficulty,
          pairingId,
          condition,
        };

        const conversation = await simulateConversation({
          calls,
          condition,
          question,
          turns: args.turns,
          maxIters: args.maxIters,
          studentModel: args.studentModel,
          tutorModel,
          supervisorModel: condition === 'single' ? null : supervisorModel,
          verbose: args.verbose,
          log: (line) => console.log(line),
          earlyStop: args.earlyStop,
          turnJudge:
            args.enableJudge && args.earlyStop
              ? async ({ turnIndex, transcriptVisible, studentTurns }) =>
                  runTurnJudge({
                    calls,
                    model: args.judgeModel,
                    question,
                    transcriptVisible,
                    studentTurns,
                    turnIndex,
                  })
              : undefined,
        });

        const judge = await runJudgeIfEnabled({
          enabled: args.enableJudge,
          calls,
          model: args.judgeModel,
          question,
          transcriptVisible: conversation.transcriptVisible,
          studentTurns: conversation.hiddenTrace.studentTurns,
        });

        const totalLatencyMs = Date.now() - t0;

        const record: RunRecord = {
          runId,
          createdAtIso,
          versions: {
            node: process.version,
            ai: await getAiVersion(),
          },
          config: {
            args,
            models: {
              questionGeneratorModel: args.questionModel,
              studentAttackerModel: args.studentModel,
              judgeModel: args.judgeModel,
              tutorModel,
              supervisorModel: condition === 'single' ? null : supervisorModel,
            },
          },
          question,
          pairingId,
          condition,
          turnsRequested: args.turns,
          maxIters: args.maxIters,
          turnsCompleted: conversation.turnsCompleted,
          loopIterationsTotal: conversation.loopIterationsTotal,
          loopTurnIterations: conversation.loopTurnIterations,
          transcriptVisible: conversation.transcriptVisible,
          hiddenTrace: conversation.hiddenTrace,
          calls,
          totalLatencyMs,
          judge,
        };

        await rawWriter.write(record);
        aggregator.add(record);
        recordsForReport.push(record);
        completedRuns += 1;
        const judgeBrief =
          record.judge != null
            ? ` judge(leak=${record.judge.leakage ? 'Y' : 'N'} comp=${record.judge.compliance ? 'Y' : 'N'} ped=${record.judge.pedagogyHelpfulness}/5 attacker=${record.judge.studentGotWhatTheyWanted ? 'Y' : 'N'})`
            : '';
        // eslint-disable-next-line no-console
        console.log(`done ${prefix} latency=${Math.round(totalLatencyMs)}ms${judgeBrief}`);

        await writePartialOutputs({
          runOutDir,
          runId,
          createdAtIso,
          args,
          questions,
          aggregator,
          records: recordsForReport,
          plannedRuns,
          completedRuns,
          state: completedRuns >= plannedRuns ? 'complete' : 'running',
          current,
          error: null,
        });
      }
      if (runIndex >= plannedRuns) break;
    }
    if (runIndex >= plannedRuns) break;
  }

  await writePartialOutputs({
    runOutDir,
    runId,
    createdAtIso,
    args,
    questions,
    aggregator,
    records: recordsForReport,
    plannedRuns,
    completedRuns,
    state: 'complete',
    current: null,
    error: null,
  });
  // eslint-disable-next-line no-console
  console.log(`Wrote ${join(runOutDir, 'raw.jsonl')}`);
  // eslint-disable-next-line no-console
  console.log(`Wrote ${join(runOutDir, 'questions.json')}`);
  // eslint-disable-next-line no-console
  console.log(`Wrote ${join(runOutDir, 'summary.json')}`);
  // eslint-disable-next-line no-console
  console.log(`Wrote ${join(runOutDir, 'report.html')}`);
  } catch (err: any) {
    await writePartialOutputs({
      runOutDir,
      runId,
      createdAtIso,
      args,
      questions,
      aggregator,
      records: recordsForReport,
      plannedRuns,
      completedRuns,
      state: 'failed',
      current,
      error: {
        message: String(err?.message ?? err),
        stack: err?.stack,
      },
    });
    throw err;
  } finally {
    await rawWriter.close().catch(() => {});
  }
}

async function writePartialOutputs({
  runOutDir,
  runId,
  createdAtIso,
  args,
  questions,
  aggregator,
  records,
  plannedRuns,
  completedRuns,
  state,
  current,
  error,
}: {
  runOutDir: string;
  runId: string;
  createdAtIso: string;
  args: ReturnType<typeof parseArgs>;
  questions: Question[];
  aggregator: SummaryAggregator;
  records: RunRecord[];
  plannedRuns: number;
  completedRuns: number;
  state: 'running' | 'complete' | 'failed';
  current: { index: number; questionId: string; difficulty: number; pairingId: string; condition: string } | null;
  error: { message: string; stack?: string } | null;
}) {
  const summaryObject = {
    runId,
    createdAtIso,
    args,
    totals: {
      questions: questions.length,
      plannedRuns,
      completedRuns,
    },
    ...aggregator.toSummaryObject(),
  };

  await writeFile(join(runOutDir, 'summary.json'), JSON.stringify(summaryObject, null, 2));
  await writeFile(
    join(runOutDir, 'report.html'),
    renderReportHtml({
      runId,
      createdAtIso,
      args,
      questions,
      summary: summaryObject,
      records,
      status: {
        state,
        plannedRuns,
        completedRuns,
        lastUpdatedAtIso: nowIso(),
        current,
        error,
      },
    })
  );
}

async function generateDataset({
  runId,
  args,
  datasetCalls,
}: {
  runId: string;
  args: ReturnType<typeof parseArgs>;
  datasetCalls: TimedCallRecord[];
}): Promise<Question[]> {
  const hasBuckets =
    args.easyQuestions != null || args.mediumQuestions != null || args.hardQuestions != null;

  const targetByDifficulty = new Map<number, number>();

  if (hasBuckets) {
    const easy = args.easyQuestions ?? 0;
    const medium = args.mediumQuestions ?? 0;
    const hard = args.hardQuestions ?? 0;

    // Option A mapping:
    // easy: difficulty 1-2, medium: 3, hard: 4-5
    const d1 = Math.floor(easy / 2);
    const d2 = easy - d1;
    const d4 = Math.floor(hard / 2);
    const d5 = hard - d4;

    if (d1) targetByDifficulty.set(1, d1);
    if (d2) targetByDifficulty.set(2, d2);
    if (medium) targetByDifficulty.set(3, medium);
    if (d4) targetByDifficulty.set(4, d4);
    if (d5) targetByDifficulty.set(5, d5);
  } else {
    for (const difficulty of args.difficulties) {
      targetByDifficulty.set(difficulty, args.perDifficulty);
    }
  }

  const questions: Question[] = [];
  const seenIds = new Set<string>();

  const diffs = Array.from(targetByDifficulty.keys()).sort((a, b) => a - b);
  for (const difficulty of diffs) {
    const count = targetByDifficulty.get(difficulty) ?? 0;
    if (count <= 0) continue;

    const batch = await generateQuestionsBatch({
      calls: datasetCalls,
      model: args.questionModel,
      difficulty,
      count,
      runId,
    });

    for (const q of batch) {
      if (seenIds.has(q.id)) continue;
      seenIds.add(q.id);
      questions.push(q);
    }
  }

  return questions;
}

async function getAiVersion(): Promise<string> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('ai/package.json').version as string;
  } catch {
    return 'unknown';
  }
}
