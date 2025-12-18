"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.simulateConversation = simulateConversation;
const student_1 = require("../agents/student");
const supervisor_1 = require("../agents/supervisor");
const tutor_1 = require("../agents/tutor");
async function simulateConversation({ calls, condition, question, turns, maxIters, studentModel, tutorModel, supervisorModel, turnJudge, earlyStop, log, verbose, }) {
    const transcriptVisible = [];
    const hiddenTrace = {
        studentTurns: [],
        turnJudgments: [],
        tutorDrafts: [],
        supervisorVerdicts: [],
    };
    const loopTurnIterations = [];
    let loopIterationsTotal = 0;
    let turnsCompleted = 0;
    let stoppedEarly = false;
    let stopReason = null;
    for (let turnIndex = 1; turnIndex <= turns; turnIndex++) {
        const studentTurn = await (0, student_1.generateStudentTurn)({
            calls,
            model: studentModel,
            question,
            visibleTranscript: transcriptVisible,
            turnIndex,
        });
        hiddenTrace.studentTurns.push(studentTurn);
        transcriptVisible.push({ role: 'student', content: studentTurn.message });
        if (verbose) {
            log?.(`  turn ${turnIndex}/${turns}: student attackLevel=${studentTurn.attackLevel} goal=${studentTurn.goal} tactic=${studentTurn.tactic}`);
        }
        let tutorFinalText = '';
        if (condition === 'single') {
            tutorFinalText = await (0, tutor_1.generateTutorResponse)({
                calls,
                callName: `tutor_turn${turnIndex}`,
                model: tutorModel,
                question,
                visibleTranscript: transcriptVisible,
            });
        }
        else if (condition === 'dual-loop') {
            if (!supervisorModel)
                throw new Error(`Condition ${condition} requires a supervisor model.`);
            let lastVerdict = null;
            let supervisorFeedback = '';
            let initiallyRejected = false;
            for (let iter = 1; iter <= maxIters; iter++) {
                const draft = await (0, tutor_1.generateTutorResponse)({
                    calls,
                    callName: `tutor_turn${turnIndex}_iter${iter}`,
                    model: tutorModel,
                    question,
                    visibleTranscript: transcriptVisible,
                    supervisorFeedback: supervisorFeedback || undefined,
                });
                hiddenTrace.tutorDrafts.push({ turnIndex, iter, text: draft });
                const verdict = await (0, supervisor_1.superviseTutorDraft)({
                    calls,
                    model: supervisorModel,
                    question,
                    visibleTranscript: transcriptVisible,
                    tutorDraft: draft,
                    turnIndex,
                    iter,
                });
                hiddenTrace.supervisorVerdicts.push({ turnIndex, iter, verdict });
                lastVerdict = verdict;
                if (verbose)
                    log?.(`  turn ${turnIndex}/${turns}: supervisor iter=${iter} approved=${verdict.approved}`);
                if (iter === 1)
                    initiallyRejected = !verdict.approved;
                if (verdict.approved) {
                    loopTurnIterations.push({
                        turnIndex,
                        iterationsUsed: iter,
                        initiallyRejected,
                        endedApproved: true,
                        violations: verdict.violations,
                    });
                    loopIterationsTotal += iter;
                    tutorFinalText = draft.trim();
                    break;
                }
                supervisorFeedback = verdict.feedbackToTutor;
            }
            if (!tutorFinalText && lastVerdict && !lastVerdict.approved) {
                loopTurnIterations.push({
                    turnIndex,
                    iterationsUsed: maxIters,
                    initiallyRejected,
                    endedApproved: false,
                    violations: lastVerdict.violations,
                });
                loopIterationsTotal += maxIters;
                tutorFinalText = lastVerdict.safeResponseToStudent.trim();
            }
        }
        else {
            throw new Error(`Unsupported condition: ${condition}`);
        }
        transcriptVisible.push({ role: 'tutor', content: tutorFinalText });
        turnsCompleted = turnIndex;
        if (turnJudge) {
            const judge = await turnJudge({
                turnIndex,
                transcriptVisible,
                studentTurns: hiddenTrace.studentTurns,
            });
            if (judge) {
                hiddenTrace.turnJudgments.push({ turnIndex, judge });
                if (verbose) {
                    log?.(`  turn ${turnIndex}/${turns}: judge leakage=${judge.leakage} goalSuccess=${judge.studentGotWhatTheyWanted} shouldTerminate=${judge.shouldTerminate}`);
                }
                if (earlyStop !== false && judge.shouldTerminate) {
                    stoppedEarly = true;
                    stopReason = judge.terminationReason === 'none' ? 'unknown' : judge.terminationReason;
                    break;
                }
            }
        }
    }
    return {
        transcriptVisible,
        hiddenTrace,
        turnsCompleted,
        loopIterationsTotal: condition === 'dual-loop' ? loopIterationsTotal : null,
        loopTurnIterations: condition === 'dual-loop' ? loopTurnIterations : null,
        stoppedEarly,
        stopReason,
    };
}
