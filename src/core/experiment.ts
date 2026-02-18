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
import {
  hasBloomDifficulty,
  type Difficulty,
  type JudgeResult,
  type Question,
  type RunRecord,
  type TimedCallRecord,
  type TurnJudgeResult,
} from '../types';
import { runTurnJudge } from '../agents/judge';
import { SummaryAggregator } from '../output/summary';
import { buildAnalysis } from '../output/analysis/index';
import { renderReportHtml } from '../output/report';
import { renderAnalysisDashboard, generateAnalysisCsvs } from '../output/analysis';
import { loadCsbenchQuestions } from './csbench';

// Type for a single run configuration
type RunConfig = {
  question: Question;
  tutorId: TutorId;
  supervisorId: SupervisorId | null;
  condition: 'single' | 'dual-loop';
};

function hasRunLeakage(record: RunRecord): boolean {
  return record.hiddenTrace.turnJudgments?.some((t) => t.judge.leakage) ?? false;
}

function summarizeRunJudgeFromTurnJudgments(
  turnJudgments: Array<{ turnIndex: number; judge: TurnJudgeResult }> | undefined
): JudgeResult | null {
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
  } else if (args.dataset === 'canterbury') {
    const baseDir = join(process.cwd(), 'data', 'canterbury');
    // eslint-disable-next-line no-console
    console.log(`\n📝 Loading Canterbury questions from ${baseDir}`);
    questions = await loadCanterburyQuestions({
      baseDir,
      limit: args.questionLimit,
      bloomLevels: args.bloomLevels,
      difficulties: args.difficulties,
      courseLevels: args.courseLevels,
      skillTags: args.skillTags,
    });
    // eslint-disable-next-line no-console
    console.log(`✅ Loaded ${questions.length} Canterbury questions`);
  } else if (args.dataset === 'csbench') {
    // eslint-disable-next-line no-console
    console.log(`\n📝 Loading CS Bench questions from ${args.csbenchPath}`);
    questions = await loadCsbenchQuestions({
      jsonlPath: args.csbenchPath,
      limit: args.questionLimit,
      formats: args.csbenchFormats,
    });
    // eslint-disable-next-line no-console
    console.log(`✅ Loaded ${questions.length} CS Bench questions`);
  } else if (args.dataset === 'pairwise') {
    // eslint-disable-next-line no-console
    console.log(`\n📝 Loading pairwise questions from ${args.pairwiseDir}`);
    questions = await loadPairwiseQuestions({
      pairwiseDir: args.pairwiseDir,
      limit: args.questionLimit,
    });
    // eslint-disable-next-line no-console
    console.log(`✅ Loaded ${questions.length} pairwise questions`);
  } else {
    const staticPath = join(process.cwd(), 'data', 'questions.json');
    // eslint-disable-next-line no-console
    console.log(`\n📝 Loading questions from ${staticPath}`);
    try {
      const raw = await readFile(staticPath, 'utf-8');
      const data = JSON.parse(raw);
      const allQuestions: Question[] = Array.isArray(data.questions)
        ? data.questions
            .map((q: unknown) => coerceLegacyDefaultQuestion(q))
            .filter((q: Question | null): q is Question => q != null)
        : [];
      
      questions = allQuestions.filter(
        (q) =>
          hasBloomDifficulty(q) &&
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
        dataset: args.dataset,
        questionLimit: args.questionLimit,
        courseLevels: args.courseLevels,
        skillTags: args.skillTags,
        csbenchPath: args.csbenchPath,
        pairwiseDir: args.pairwiseDir,
        csbenchFormats: args.csbenchFormats,
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
          args.enableJudge
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

      const judge = args.enableJudge
        ? summarizeRunJudgeFromTurnJudgments(conversation.hiddenTrace.turnJudgments)
        : null;

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
        
        if (hasRunLeakage(record)) leakageCount++;
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
            pairingId,
            tutorId,
            supervisorId,
            condition,
            ...(hasBloomDifficulty(question)
              ? {
                  bloomLevel: question.bloomLevel,
                  difficulty: question.difficulty,
                }
              : {}),
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
    console.log(`   ${join(runOutDir, 'analysis.json')}`);
    // eslint-disable-next-line no-console
    console.log(`   ${join(runOutDir, 'analysis')}`);
    // eslint-disable-next-line no-console
    console.log(`   ${join(runOutDir, 'report.html')}`);
    // eslint-disable-next-line no-console
    console.log(`   ${join(runOutDir, 'analysis-dashboard.html')}`);
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
  current: {
    index: number;
    questionId: string;
    pairingId: string;
    tutorId: string;
    supervisorId: string | null;
    condition: string;
    bloomLevel?: number;
    difficulty?: string;
  } | null;
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

  const analysis = buildAnalysis({
    runId,
    createdAtIso,
    records,
  });

  await writeFile(join(runOutDir, 'summary.json'), JSON.stringify(summaryObject, null, 2));
  await writeFile(join(runOutDir, 'analysis.json'), JSON.stringify(analysis, null, 2));
  if (state !== 'running') {
    const analysisDir = join(runOutDir, 'analysis');
    await ensureDir(analysisDir);
  }
  await writeFile(
    join(runOutDir, 'report.html'),
    renderReportHtml({
      runId,
      createdAtIso,
      args,
      questions,
      summary: summaryObject,
      analysis,
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

  // Generate analysis dashboard (only when we have data)
  if (records.length > 0) {
    await writeFile(
      join(runOutDir, 'analysis-dashboard.html'),
      renderAnalysisDashboard({ runId, createdAtIso, records, questions })
    );

    // Generate CSV exports
    const csvs = generateAnalysisCsvs(records);
    for (const [filename, content] of Object.entries(csvs)) {
      await writeFile(join(runOutDir, filename), content);
    }
  }
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

const CANTERBURY_PAGES = [
  'questions-p1.html',
  'questions-p2.html',
  'questions-p3.html',
  'questions-p4.html',
  'questions-p5.html',
  'questions-p6.html',
  'questions-p7.html',
];

type CanterburyTagInfo = {
  bloomLevel: number | null;
  difficulty: number | null;
  courseLevel: string | null;
  skillTag: string | null;
  topicTag: string | null;
};

async function loadCanterburyQuestions({
  baseDir,
  limit,
  bloomLevels,
  difficulties,
  courseLevels,
  skillTags,
}: {
  baseDir: string;
  limit: number | null;
  bloomLevels: number[];
  difficulties: Difficulty[];
  courseLevels: string[];
  skillTags: string[];
}): Promise<Question[]> {
  const pages = await Promise.all(
    CANTERBURY_PAGES.map(async (file) => ({
      file,
      html: await readFile(join(baseDir, file), 'utf-8'),
    }))
  );

  const questions: Question[] = [];
  const seenIds = new Set<string>();
  for (const page of pages) {
    const blocks = extractQuestionTables(page.html);
    for (const block of blocks) {
      if (limit != null && questions.length >= limit) return questions;
      const fields = parseQuestionFields(block);
      const candidate = buildCanterburyQuestion(fields, {
        bloomLevels,
        difficulties,
        courseLevels,
        skillTags,
      });
      if (!candidate) continue;
      if (seenIds.has(candidate.id)) continue;
      seenIds.add(candidate.id);
      questions.push(candidate);
    }
  }

  return questions;
}

function extractQuestionTables(html: string): string[] {
  const tables: string[] = [];
  const regex = /<table\s+id="displayQuestionTable"[^>]*>([\s\S]*?)<\/table>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    tables.push(match[1]);
  }
  return tables;
}

function parseQuestionFields(tableHtml: string): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
    const cells = Array.from(rowMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)).map((m) => m[1]);
    if (cells.length >= 2) {
      const key = stripHtml(cells[0]);
      rows.push([key, cells[1]]);
    }
  }
  return rows;
}

function buildCanterburyQuestion(
  rows: Array<[string, string]>,
  {
    bloomLevels,
    difficulties,
    courseLevels,
    skillTags,
  }: {
    bloomLevels: number[];
    difficulties: Difficulty[];
    courseLevels: string[];
    skillTags: string[];
  }
): Question | null {
  const fields = new Map<string, string>();
  for (const [key, value] of rows) {
    if (!fields.has(key)) fields.set(key, value);
  }

  const rawId = fields.get('ID');
  if (!rawId) return null;
  const idMatch = stripHtml(rawId).match(/\d+/);
  if (!idMatch) return null;
  const id = `canterbury-${idMatch[0]}`;

  const questionHtml = fields.get('Question');
  if (!questionHtml) return null;
  const problemStatement = normalizeCanterburyHtml(questionHtml);

  const { choices, correctIndex } = extractChoices(fields);
  if (!choices || choices.length < 2 || correctIndex == null || correctIndex < 0 || correctIndex >= choices.length) {
    return null;
  }

  const referenceHtml = fields.get('Explanation');
  const referenceAnswerDescription = referenceHtml
    ? normalizeCanterburyHtml(referenceHtml)
    : 'No explanation provided.';

  const tagsHtml = fields.get('Tags');
  const tagInfo = parseCanterburyTags(tagsHtml ? stripHtml(tagsHtml) : '');
  if (!tagInfo) return null;

  if (tagInfo.bloomLevel == null || !bloomLevels.includes(tagInfo.bloomLevel)) return null;
  const mappedDifficulty = mapCanterburyDifficulty(tagInfo.difficulty);
  if (!mappedDifficulty || !difficulties.includes(mappedDifficulty)) return null;

  if (courseLevels.length > 0) {
    if (!tagInfo.courseLevel || !courseLevels.includes(tagInfo.courseLevel)) return null;
  }
  if (skillTags.length > 0) {
    if (!tagInfo.skillTag || !skillTags.includes(tagInfo.skillTag)) return null;
  }

  return {
    id,
    dataset: 'canterbury',
    bloomLevel: tagInfo.bloomLevel,
    difficulty: mappedDifficulty,
    topicTag: tagInfo.topicTag || tagInfo.courseLevel || 'canterbury',
    courseLevel: tagInfo.courseLevel ?? undefined,
    skillTag: tagInfo.skillTag ?? undefined,
    problemStatement,
    choices,
    correctChoiceIndex: correctIndex,
    referenceAnswerDescription,
  };
}

function extractChoices(fields: Map<string, string>): { choices: string[]; correctIndex: number | null } {
  const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
  const choices: string[] = [];
  let correctIndex: number | null = null;
  for (const letter of letters) {
    const normal = fields.get(letter);
    const marked = fields.get(`*${letter}*`);
    const raw = marked ?? normal;
    if (!raw) continue;
    const html = normalizeCanterburyHtml(raw);
    const idx = choices.length;
    choices.push(html);
    if (marked != null) correctIndex = idx;
  }
  return { choices, correctIndex };
}

function parseCanterburyTags(tagText: string): CanterburyTagInfo | null {
  if (!tagText) {
    return {
      bloomLevel: null,
      difficulty: null,
      courseLevel: null,
      skillTag: null,
      topicTag: null,
    };
  }
  const tags = tagText
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  let bloomLevel: number | null = null;
  let difficulty: number | null = null;
  let courseLevel: string | null = null;
  let skillTag: string | null = null;
  let topicTag: string | null = null;

  for (const tag of tags) {
    if (tag.startsWith('Bloom-')) {
      const match = tag.match(/Bloom-(\d+)/);
      if (match) bloomLevel = Number.parseInt(match[1], 10);
    }
    if (tag.startsWith('Difficulty-')) {
      const match = tag.match(/Difficulty-(\d+)/);
      if (match) difficulty = Number.parseInt(match[1], 10);
    }
    if (tag === 'CS1' || tag === 'CS2') {
      courseLevel = tag;
    }
    if (tag.startsWith('Skill-') || tag.startsWith('SkillWG-')) {
      if (!skillTag) skillTag = tag;
    }
    if (tag.startsWith('TopicWG-') || tag.startsWith('TopicSimon-')) {
      if (!topicTag) topicTag = tag;
    }
  }

  return { bloomLevel, difficulty, courseLevel, skillTag, topicTag };
}

function mapCanterburyDifficulty(level: number | null): Difficulty | null {
  if (level === 1) return 'easy';
  if (level === 2) return 'medium';
  if (level === 3) return 'hard';
  return null;
}

function coerceLegacyDefaultQuestion(input: unknown): Question | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  const dataset = raw.dataset;

  if (dataset === 'default' || dataset === 'canterbury' || dataset === 'csbench' || dataset === 'pairwise') {
    return raw as Question;
  }

  return {
    ...raw,
    dataset: 'default',
  } as Question;
}

async function loadPairwiseQuestions({
  pairwiseDir,
  limit,
}: {
  pairwiseDir: string;
  limit: number | null;
}): Promise<Question[]> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pairwiseModule = require('./pairwise') as {
    loadPairwiseQuestions?: (args: { pairwiseDir: string; limit: number | null }) => Promise<Question[]>;
  };

  if (typeof pairwiseModule.loadPairwiseQuestions !== 'function') {
    throw new Error('Missing loadPairwiseQuestions export in src/core/pairwise.ts');
  }

  return pairwiseModule.loadPairwiseQuestions({ pairwiseDir, limit });
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCanterburyHtml(html: string): string {
  const trimmed = html.trim();
  const sanitized = trimmed
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/src="img\//g, 'src="data/canterbury/img/')
    .replace(/src='img\//g, "src='data/canterbury/img/")
    .replace(/\s+>/g, '>')
    .replace(/\s+\n/g, '\n')
    .trim();
  return sanitized;
}

async function getAiVersion(): Promise<string> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('ai/package.json').version as string;
  } catch {
    return 'unknown';
  }
}
