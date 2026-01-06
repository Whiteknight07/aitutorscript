import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import pLimit from 'p-limit';
import { Mutex } from 'async-mutex';
import cliProgress from 'cli-progress';
import { parseArgs } from '../utils/args';
import { simulateConversation } from './conversation';
import { generateQuestionsBatch } from '../agents/question-gen';
import { getTutorModel, getSupervisorModel, type TutorId, type SupervisorId } from '../config';
import { createJsonlWriter, ensureDir, nowIso } from '../utils/util';
import type { Question, RunRecord, TimedCallRecord } from '../types';
import { runJudgeIfEnabled, runTurnJudge } from '../agents/judge';
import { SummaryAggregator } from '../output/summary';
import { renderReportHtml } from '../output/report';

// Type for a single run configuration
type RunConfig = {
  question: Question;
  tutorId: TutorId;
  supervisorId: SupervisorId | null;
  condition: 'single' | 'dual-loop';
};

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
  console.log(`\n🚀 AI Tutor Benchmark Harness`);
  // eslint-disable-next-line no-console
  console.log(`${'─'.repeat(50)}`);
  // eslint-disable-next-line no-console
  console.log(`📁 Run ID: ${runId}`);
  // eslint-disable-next-line no-console
  console.log(`📂 Output: ${runOutDir}`);
  // eslint-disable-next-line no-console
  console.log(`🤖 Models: question=${args.questionModel.split('/').pop()}`);
  // eslint-disable-next-line no-console
  console.log(`          student=${args.studentModel.split('/').pop()}`);
  // eslint-disable-next-line no-console
  console.log(`          judge=${args.enableJudge ? args.judgeModel.split('/').pop() : '(disabled)'}`);
  // eslint-disable-next-line no-console
  console.log(`⚡ Parallel: ${args.parallel} concurrent runs`);
  
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
    // eslint-disable-next-line no-console
    console.log(`\n📝 Generating questions: bloom=[${args.bloomLevels.join(',')}] diff=[${args.difficulties.join(',')}] perCell=${args.questionsPerCell}`);
    questions = await generateDataset({ runId, args, datasetCalls });
    // eslint-disable-next-line no-console
    console.log(`✅ Generated ${questions.length} questions`);
  } else {
    const staticPath = join(process.cwd(), 'data', 'questions.json');
    // eslint-disable-next-line no-console
    console.log(`\n📝 Loading questions from ${staticPath}`);
    try {
      const raw = await readFile(staticPath, 'utf-8');
      const data = JSON.parse(raw);
      const allQuestions: Question[] = data.questions;
      
      questions = allQuestions.filter(
        (q) =>
          args.bloomLevels.includes(q.bloomLevel) &&
          args.difficulties.includes(q.difficulty)
      );
      // eslint-disable-next-line no-console
      console.log(`✅ Loaded ${questions.length} questions (filtered from ${allQuestions.length})`);
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error(`❌ Failed to load static questions: ${err.message}`);
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

  // Build all run configurations upfront
  const hasSingle = args.conditions.includes('single');
  const hasDualLoop = args.conditions.includes('dual-loop');
  
  const allRuns: RunConfig[] = [];
  for (const question of questions) {
    for (const tutorId of args.tutors) {
      if (hasSingle) {
        allRuns.push({ question, tutorId, supervisorId: null, condition: 'single' });
      }
      if (hasDualLoop) {
        for (const supervisorId of args.supervisors) {
          allRuns.push({ question, tutorId, supervisorId, condition: 'dual-loop' });
        }
      }
    }
  }

  // Apply maxRuns limit
  const runsToExecute = args.maxRuns != null ? allRuns.slice(0, args.maxRuns) : allRuns;
  const plannedRuns = runsToExecute.length;

  // eslint-disable-next-line no-console
  console.log(`\n📊 Experiment Matrix:`);
  // eslint-disable-next-line no-console
  console.log(`   Questions: ${questions.length}`);
  // eslint-disable-next-line no-console
  console.log(`   Tutors: [${args.tutors.join(', ')}]`);
  // eslint-disable-next-line no-console
  console.log(`   Supervisors: [${args.supervisors.join(', ')}]`);
  // eslint-disable-next-line no-console
  console.log(`   Conditions: [${args.conditions.join(', ')}]`);
  // eslint-disable-next-line no-console
  console.log(`   Total runs: ${plannedRuns}${args.maxRuns ? ` (capped from ${allRuns.length})` : ''}`);
  // eslint-disable-next-line no-console
  console.log(`${'─'.repeat(50)}\n`);

  // Thread-safe counters and state
  const stateMutex = new Mutex();
  let completedRuns = 0;
  let leakageCount = 0;
  let complianceCount = 0;
  const allStart = Date.now();

  // Create beautiful progress bar
  const progressBar = new cliProgress.SingleBar({
    format: '🔬 Progress |{bar}| {percentage}% | {value}/{total} runs | ⏱️  {duration_formatted} | ETA: {eta_formatted} | 🚨 Leaks: {leaks} | ✅ Compliant: {compliant}',
    barCompleteChar: '█',
    barIncompleteChar: '░',
    hideCursor: true,
    clearOnComplete: false,
    stopOnComplete: true,
  }, cliProgress.Presets.shades_classic);

  progressBar.start(plannedRuns, 0, {
    leaks: 0,
    compliant: 0,
  });

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

  // Create concurrency limiter
  const limit = pLimit(args.parallel);

  // Helper to run a single experiment
  async function executeRun(runConfig: RunConfig, runIdx: number): Promise<RunRecord | null> {
    const { question, tutorId, supervisorId, condition } = runConfig;
    
    const calls: TimedCallRecord[] = [];
    const t0 = Date.now();
    const tutorModel = getTutorModel(tutorId);
    const supervisorModel = supervisorId ? getSupervisorModel(supervisorId) : null;
    const pairingId = supervisorId ? `${tutorId}-${supervisorId}` : `${tutorId}-single`;

    try {
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
        log: () => {}, // Suppress verbose logs during parallel execution
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

      // Thread-safe state updates
      const release = await stateMutex.acquire();
      try {
        await rawWriter.write(record);
        aggregator.add(record);
        recordsForReport.push(record);
        completedRuns++;
        
        if (judge?.leakage) leakageCount++;
        if (judge?.compliance) complianceCount++;
        
        // Update progress bar
        progressBar.update(completedRuns, {
          leaks: leakageCount,
          compliant: complianceCount,
        });

        // Write partial outputs after each run
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
          current: {
            index: runIdx + 1,
            questionId: question.id,
            bloomLevel: question.bloomLevel,
            difficulty: question.difficulty,
            tutorId,
            supervisorId,
            condition,
          },
          error: null,
        });
      } finally {
        release();
      }

      return record;
    } catch (err: any) {
      // Log error but don't crash the whole batch
      // eslint-disable-next-line no-console
      console.error(`\n⚠️  Run ${runIdx + 1} failed: ${err.message}`);
      return null;
    }
  }

  try {
    // Execute all runs with controlled parallelism
    await Promise.all(
      runsToExecute.map((runConfig, idx) =>
        limit(() => executeRun(runConfig, idx))
      )
    );

    progressBar.stop();

    const totalTime = Date.now() - allStart;
    const avgTimePerRun = completedRuns > 0 ? totalTime / completedRuns : 0;

    // Final summary
    // eslint-disable-next-line no-console
    console.log(`\n${'─'.repeat(50)}`);
    // eslint-disable-next-line no-console
    console.log(`✅ Experiment Complete!`);
    // eslint-disable-next-line no-console
    console.log(`${'─'.repeat(50)}`);
    // eslint-disable-next-line no-console
    console.log(`📊 Results:`);
    // eslint-disable-next-line no-console
    console.log(`   Completed: ${completedRuns}/${plannedRuns} runs`);
    // eslint-disable-next-line no-console
    console.log(`   Leakage rate: ${completedRuns > 0 ? ((leakageCount / completedRuns) * 100).toFixed(1) : 0}% (${leakageCount}/${completedRuns})`);
    // eslint-disable-next-line no-console
    console.log(`   Compliance rate: ${completedRuns > 0 ? ((complianceCount / completedRuns) * 100).toFixed(1) : 0}% (${complianceCount}/${completedRuns})`);
    // eslint-disable-next-line no-console
    console.log(`\n⏱️  Timing:`);
    // eslint-disable-next-line no-console
    console.log(`   Total time: ${formatDuration(totalTime)}`);
    // eslint-disable-next-line no-console
    console.log(`   Avg per run: ${formatDuration(avgTimePerRun)}`);
    // eslint-disable-next-line no-console
    console.log(`   Parallelism: ${args.parallel}x`);
    // eslint-disable-next-line no-console
    console.log(`\n📁 Output files:`);
    // eslint-disable-next-line no-console
    console.log(`   ${join(runOutDir, 'raw.jsonl')}`);
    // eslint-disable-next-line no-console
    console.log(`   ${join(runOutDir, 'summary.json')}`);
    // eslint-disable-next-line no-console
    console.log(`   ${join(runOutDir, 'report.html')}`);
    // eslint-disable-next-line no-console
    console.log(`${'─'.repeat(50)}\n`);

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

  } catch (err: any) {
    progressBar.stop();
    
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
      current: null,
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

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
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
