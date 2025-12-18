"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runExperiments = runExperiments;
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const conversation_1 = require("./conversation");
const question_gen_1 = require("./question-gen");
const models_1 = require("./models");
const util_1 = require("./util");
const judge_1 = require("./judge");
const summary_1 = require("./summary");
const report_1 = require("./report");
async function runExperiments({ args, envSummary, }) {
    const createdAtIso = (0, util_1.nowIso)();
    const runId = `run_${createdAtIso.replace(/[:.]/g, '-')}`;
    const runOutDir = (0, node_path_1.join)(args.outDir, runId);
    await (0, util_1.ensureDir)(runOutDir);
    // eslint-disable-next-line no-console
    console.log(`runId=${runId}`);
    // eslint-disable-next-line no-console
    console.log(`outDir=${runOutDir}`);
    // eslint-disable-next-line no-console
    console.log(`models: question=${args.questionModel} student=${args.studentModel} judge=${args.enableJudge ? args.judgeModel : '(disabled)'}`);
    await (0, promises_1.writeFile)((0, node_path_1.join)(runOutDir, 'run-config.json'), JSON.stringify({
        runId,
        createdAtIso,
        args,
        envSummary,
    }, null, 2));
    const datasetCalls = [];
    // eslint-disable-next-line no-console
    if (args.easyQuestions != null || args.mediumQuestions != null || args.hardQuestions != null) {
        // eslint-disable-next-line no-console
        console.log(`generating questions: easy=${args.easyQuestions ?? 0} medium=${args.mediumQuestions ?? 0} hard=${args.hardQuestions ?? 0} (maps to d1-2, d3, d4-5)`);
    }
    else {
        // eslint-disable-next-line no-console
        console.log(`generating questions: difficulties=${args.difficulties.join(',')} perDifficulty=${args.perDifficulty}`);
    }
    const questions = await generateDataset({ runId, args, datasetCalls });
    // eslint-disable-next-line no-console
    console.log(`generated ${questions.length} questions`);
    await (0, promises_1.writeFile)((0, node_path_1.join)(runOutDir, 'questions.json'), JSON.stringify({
        runId,
        createdAtIso,
        questionGeneratorModel: args.questionModel,
        difficulties: args.difficulties,
        perDifficulty: args.perDifficulty,
        calls: datasetCalls,
        questions,
    }, null, 2));
    const rawWriter = await (0, util_1.createJsonlWriter)(runOutDir, 'raw.jsonl');
    const aggregator = new summary_1.SummaryAggregator();
    const recordsForReport = [];
    const totalRuns = questions.length * args.pairings.length * args.conditions.length;
    const plannedRuns = args.maxRuns != null ? Math.min(totalRuns, args.maxRuns) : totalRuns;
    let runIndex = 0;
    let completedRuns = 0;
    let current = null;
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
                const { tutorModel, supervisorModel } = (0, models_1.getTutorSupervisorModels)(pairingId);
                for (const condition of args.conditions) {
                    if (runIndex >= plannedRuns)
                        break;
                    const calls = [];
                    const t0 = Date.now();
                    runIndex += 1;
                    const prefix = `[${runIndex}/${plannedRuns}] q=${question.id} diff=${question.difficulty} pairing=${pairingId} cond=${condition}`;
                    const elapsed = Date.now() - allStart;
                    const avgPerRunMs = runIndex > 1 ? elapsed / (runIndex - 1) : null;
                    const remainingRuns = plannedRuns - runIndex + 1;
                    const etaMs = avgPerRunMs != null ? Math.round(avgPerRunMs * (remainingRuns - 1)) : null;
                    // eslint-disable-next-line no-console
                    console.log(`start ${prefix} turns=${args.turns} maxIters=${args.maxIters} judge=${args.enableJudge ? 'on' : 'off'}${etaMs != null ? ` eta~${Math.round(etaMs / 1000)}s` : ''}`);
                    current = {
                        index: runIndex,
                        questionId: question.id,
                        difficulty: question.difficulty,
                        pairingId,
                        condition,
                    };
                    const conversation = await (0, conversation_1.simulateConversation)({
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
                        turnJudge: args.enableJudge && args.earlyStop
                            ? async ({ turnIndex, transcriptVisible, studentTurns }) => (0, judge_1.runTurnJudge)({
                                calls,
                                model: args.judgeModel,
                                question,
                                transcriptVisible,
                                studentTurns,
                                turnIndex,
                            })
                            : undefined,
                    });
                    const judge = await (0, judge_1.runJudgeIfEnabled)({
                        enabled: args.enableJudge,
                        calls,
                        model: args.judgeModel,
                        question,
                        transcriptVisible: conversation.transcriptVisible,
                        studentTurns: conversation.hiddenTrace.studentTurns,
                    });
                    const totalLatencyMs = Date.now() - t0;
                    const record = {
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
                    const judgeBrief = record.judge != null
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
                if (runIndex >= plannedRuns)
                    break;
            }
            if (runIndex >= plannedRuns)
                break;
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
        console.log(`Wrote ${(0, node_path_1.join)(runOutDir, 'raw.jsonl')}`);
        // eslint-disable-next-line no-console
        console.log(`Wrote ${(0, node_path_1.join)(runOutDir, 'questions.json')}`);
        // eslint-disable-next-line no-console
        console.log(`Wrote ${(0, node_path_1.join)(runOutDir, 'summary.json')}`);
        // eslint-disable-next-line no-console
        console.log(`Wrote ${(0, node_path_1.join)(runOutDir, 'report.html')}`);
    }
    catch (err) {
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
    }
    finally {
        await rawWriter.close().catch(() => { });
    }
}
async function writePartialOutputs({ runOutDir, runId, createdAtIso, args, questions, aggregator, records, plannedRuns, completedRuns, state, current, error, }) {
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
    await (0, promises_1.writeFile)((0, node_path_1.join)(runOutDir, 'summary.json'), JSON.stringify(summaryObject, null, 2));
    await (0, promises_1.writeFile)((0, node_path_1.join)(runOutDir, 'report.html'), (0, report_1.renderReportHtml)({
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
            lastUpdatedAtIso: (0, util_1.nowIso)(),
            current,
            error,
        },
    }));
}
async function generateDataset({ runId, args, datasetCalls, }) {
    const hasBuckets = args.easyQuestions != null || args.mediumQuestions != null || args.hardQuestions != null;
    const targetByDifficulty = new Map();
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
        if (d1)
            targetByDifficulty.set(1, d1);
        if (d2)
            targetByDifficulty.set(2, d2);
        if (medium)
            targetByDifficulty.set(3, medium);
        if (d4)
            targetByDifficulty.set(4, d4);
        if (d5)
            targetByDifficulty.set(5, d5);
    }
    else {
        for (const difficulty of args.difficulties) {
            targetByDifficulty.set(difficulty, args.perDifficulty);
        }
    }
    const questions = [];
    const seenIds = new Set();
    const diffs = Array.from(targetByDifficulty.keys()).sort((a, b) => a - b);
    for (const difficulty of diffs) {
        const count = targetByDifficulty.get(difficulty) ?? 0;
        if (count <= 0)
            continue;
        const batch = await (0, question_gen_1.generateQuestionsBatch)({
            calls: datasetCalls,
            model: args.questionModel,
            difficulty,
            count,
            runId,
        });
        for (const q of batch) {
            if (seenIds.has(q.id))
                continue;
            seenIds.add(q.id);
            questions.push(q);
        }
    }
    return questions;
}
async function getAiVersion() {
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        return require('ai/package.json').version;
    }
    catch {
        return 'unknown';
    }
}
