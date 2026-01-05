import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from '../utils/args';
import { simulateConversation } from './conversation';
import { generateQuestionsBatch } from '../agents/question-gen';
import { getTutorModel, getSupervisorModel, type TutorId, type SupervisorId } from '../config';
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
  
  let questions: Question[];
  if (args.dynamicQuestions) {
    // Dynamic generation
    // eslint-disable-next-line no-console
    console.log(
      `generating questions: bloomLevels=${args.bloomLevels.join(',')} difficulties=${args.difficulties.join(',')} perCell=${args.questionsPerCell}`
    );
    questions = await generateDataset({ runId, args, datasetCalls });
    // eslint-disable-next-line no-console
    console.log(`generated ${questions.length} questions`);
  } else {
    // Load static questions from data/questions.json
    const staticPath = join(process.cwd(), 'data', 'questions.json');
    // eslint-disable-next-line no-console
    console.log(`loading static questions from ${staticPath}`);
    try {
      const raw = await readFile(staticPath, 'utf-8');
      const data = JSON.parse(raw);
      const allQuestions: Question[] = data.questions;
      
      // Filter by requested bloom levels and difficulties
      questions = allQuestions.filter(
        (q) =>
          args.bloomLevels.includes(q.bloomLevel) &&
          args.difficulties.includes(q.difficulty)
      );
      // eslint-disable-next-line no-console
      console.log(`loaded ${questions.length} questions (filtered from ${allQuestions.length})`);
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error(`Failed to load static questions: ${err.message}`);
      // eslint-disable-next-line no-console
      console.error('Run "pnpm generate-questions" to create data/questions.json, or use --dynamic');
      throw err;
    }
  }

  await writeFile(
    join(runOutDir, 'questions.json'),
    JSON.stringify(
      {
        runId,
        createdAtIso,
        questionGeneratorModel: args.questionModel,
        bloomLevels: args.bloomLevels,
        difficulties: args.difficulties,
        questionsPerCell: args.questionsPerCell,
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

  // Calculate total runs based on new structure:
  // For each question × tutor:
  //   - 1 run for 'single' condition (if enabled)
  //   - N runs for 'dual-loop' condition (one per supervisor, if enabled)
  const hasSingle = args.conditions.includes('single');
  const hasDualLoop = args.conditions.includes('dual-loop');
  const runsPerQuestionTutor = (hasSingle ? 1 : 0) + (hasDualLoop ? args.supervisors.length : 0);
  const totalRuns = questions.length * args.tutors.length * runsPerQuestionTutor;
  const plannedRuns = args.maxRuns != null ? Math.min(totalRuns, args.maxRuns) : totalRuns;
  let runIndex = 0;
  let completedRuns = 0;
  let current:
    | {
        index: number;
        questionId: string;
        bloomLevel: number;
        difficulty: string;
        tutorId: string;
        supervisorId: string | null;
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

  // Helper to run a single experiment
  async function runSingleExperiment(
    question: Question,
    tutorId: TutorId,
    supervisorId: SupervisorId | null,
    condition: 'single' | 'dual-loop'
  ) {
    if (runIndex >= plannedRuns) return;
    
    const calls: TimedCallRecord[] = [];
    const t0 = Date.now();
    const tutorModel = getTutorModel(tutorId);
    const supervisorModel = supervisorId ? getSupervisorModel(supervisorId) : null;
    const pairingId = supervisorId ? `${tutorId}-${supervisorId}` : `${tutorId}-single`;

    runIndex += 1;
    const prefix = `[${runIndex}/${plannedRuns}] q=${question.id} bloom=${question.bloomLevel} diff=${question.difficulty} tutor=${tutorId} sup=${supervisorId ?? 'none'} cond=${condition}`;
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
      bloomLevel: question.bloomLevel,
      difficulty: question.difficulty,
      tutorId,
      supervisorId,
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
      supervisorModel,
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
          supervisorModel,
        },
        tutorId,
        supervisorId,
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
        ? ` judge(leak=${record.judge.leakage ? 'Y' : 'N'} hall=${record.judge.hallucination ? 'Y' : 'N'} comp=${record.judge.compliance ? 'Y' : 'N'})`
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

  try {
  // New structure: question → tutor → (single once, then dual-loop per supervisor)
  // This avoids redundant single runs and makes the matrix tutor × supervision mode
  for (const question of questions) {
    for (const tutorId of args.tutors) {
      // Run 'single' condition once per tutor (no supervisor)
      if (hasSingle) {
        await runSingleExperiment(question, tutorId, null, 'single');
        if (runIndex >= plannedRuns) break;
      }
      
      // Run 'dual-loop' for each supervisor
      if (hasDualLoop) {
        for (const supervisorId of args.supervisors) {
          await runSingleExperiment(question, tutorId, supervisorId, 'dual-loop');
          if (runIndex >= plannedRuns) break;
        }
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
  current: { index: number; questionId: string; bloomLevel: number; difficulty: string; tutorId: string; supervisorId: string | null; condition: string } | null;
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
  const questions: Question[] = [];
  const seenIds = new Set<string>();

  // Generate questions for each combination of Bloom level and difficulty
  for (const bloomLevel of args.bloomLevels) {
    for (const difficulty of args.difficulties) {
      const batch = await generateQuestionsBatch({
        calls: datasetCalls,
        model: args.questionModel,
        bloomLevel,
        difficulty,
        count: args.questionsPerCell,
        runId,
      });

      for (const q of batch) {
        if (seenIds.has(q.id)) continue;
        seenIds.add(q.id);
        questions.push(q);
      }
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
