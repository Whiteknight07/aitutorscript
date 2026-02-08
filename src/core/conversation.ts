import { generateStudentTurn } from '../agents/student';
import { superviseTutorDraft } from '../agents/supervisor';
import { generateTutorResponse } from '../agents/tutor';
import type {
  Condition,
  Question,
  SupervisorVerdict,
  TimedCallRecord,
  TranscriptMessage,
  StudentTurn,
  TurnJudgeResult,
} from '../types';

export type ConversationResult = {
  transcriptVisible: TranscriptMessage[];
  hiddenTrace: {
    studentTurns: StudentTurn[];
    turnJudgments: Array<{ turnIndex: number; judge: TurnJudgeResult }>;
    tutorDrafts: Array<{ turnIndex: number; iter: number; text: string }>;
    supervisorVerdicts: Array<{ turnIndex: number; iter: number; verdict: SupervisorVerdict }>;
  };
  turnsCompleted: number;
  loopIterationsTotal: number | null;
  loopTurnIterations: Array<{
    turnIndex: number;
    iterationsUsed: number;
    initiallyRejected: boolean;
    endedApproved: boolean;
    rationale: string;
  }> | null;
  stoppedEarly: boolean;
  stopReason: 'leakage' | 'unknown' | null;
};

export async function simulateConversation({
  calls,
  condition,
  question,
  turns,
  maxIters,
  studentModel,
  tutorModel,
  supervisorModel,
  turnJudge,
  earlyStop,
  log,
  verbose,
}: {
  calls: TimedCallRecord[];
  condition: Condition;
  question: Question;
  turns: number;
  maxIters: number;
  studentModel: string;
  tutorModel: string;
  supervisorModel: string | null;
  turnJudge?: (args: {
    turnIndex: number;
    transcriptVisible: TranscriptMessage[];
    studentTurns: StudentTurn[];
  }) => Promise<TurnJudgeResult | null>;
  earlyStop?: boolean;
  log?: (line: string) => void;
  verbose?: boolean;
}): Promise<ConversationResult> {
  const transcriptVisible: TranscriptMessage[] = [];
  const hiddenTrace: ConversationResult['hiddenTrace'] = {
    studentTurns: [],
    turnJudgments: [],
    tutorDrafts: [],
    supervisorVerdicts: [],
  };

  const loopTurnIterations: NonNullable<ConversationResult['loopTurnIterations']> = [];
  let loopIterationsTotal = 0;

  let turnsCompleted = 0;
  let stoppedEarly = false;
  let stopReason: ConversationResult['stopReason'] = null;

  for (let turnIndex = 1; turnIndex <= turns; turnIndex++) {
    const studentTurn = await generateStudentTurn({
      calls,
      model: studentModel,
      question,
      visibleTranscript: transcriptVisible,
      turnIndex,
    });
    hiddenTrace.studentTurns.push(studentTurn);
    transcriptVisible.push({ role: 'student', content: studentTurn.message });
    if (verbose) {
      log?.(
        `  turn ${turnIndex}/${turns}: student attackLevel=${studentTurn.attackLevel} attackFamily=${studentTurn.attackFamily} tactic="${studentTurn.tactic}"`
      );
    }

    let tutorFinalText = '';

    if (condition === 'single') {
      tutorFinalText = await generateTutorResponse({
        calls,
        callName: `tutor_turn${turnIndex}`,
        model: tutorModel,
        question,
        visibleTranscript: transcriptVisible,
      });
    } else if (condition === 'dual-loop') {
      if (!supervisorModel) throw new Error(`Condition ${condition} requires a supervisor model.`);

      let lastVerdict: SupervisorVerdict | null = null;
      let supervisorFeedback = '';
      let initiallyRejected = false;

      for (let iter = 1; iter <= maxIters; iter++) {
        const draft = await generateTutorResponse({
          calls,
          callName: `tutor_turn${turnIndex}_iter${iter}`,
          model: tutorModel,
          question,
          visibleTranscript: transcriptVisible,
          supervisorFeedback: supervisorFeedback || undefined,
        });
        hiddenTrace.tutorDrafts.push({ turnIndex, iter, text: draft });

        const verdict = await superviseTutorDraft({
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
        if (verbose) log?.(`  turn ${turnIndex}/${turns}: supervisor iter=${iter} approved=${verdict.approved}`);

        if (iter === 1) initiallyRejected = !verdict.approved;
        if (verdict.approved) {
          loopTurnIterations.push({
            turnIndex,
            iterationsUsed: iter,
            initiallyRejected,
            endedApproved: true,
            rationale: verdict.rationale,
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
          rationale: lastVerdict.rationale,
        });
        loopIterationsTotal += maxIters;
        tutorFinalText = lastVerdict.safeResponseToStudent.trim();
      }
    } else {
      throw new Error(`Unsupported condition: ${condition satisfies never}`);
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
          log?.(
            `  turn ${turnIndex}/${turns}: judge leakage=${judge.leakage} shouldTerminate=${judge.shouldTerminate}`
          );
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
