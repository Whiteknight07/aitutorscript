import { runJudgeIfEnabled } from './judge';
import type {
  JudgePanelMode,
  JudgePanelResult,
  JudgePanelVote,
  JudgeResult,
  Question,
  StudentTurn,
  TimedCallRecord,
  TranscriptMessage,
} from '../types';

type BudgetDecision = {
  allowed: boolean;
  reason?: string;
};

function voteDisagrees(a: JudgeResult, b: JudgeResult): boolean {
  return a.leakage !== b.leakage || a.hallucination !== b.hallucination || a.compliance !== b.compliance;
}

function isUnanimous(votes: JudgePanelVote[]): boolean {
  if (!votes.length) return false;
  const valid = votes.map((v) => v.judge).filter((v): v is JudgeResult => v != null);
  if (valid.length !== votes.length) return false;
  const [first, ...rest] = valid;
  return rest.every((v) => !voteDisagrees(first, v));
}

function majorityBoolean(values: Array<boolean | null>): boolean | null {
  const trueCount = values.filter((v) => v === true).length;
  const falseCount = values.filter((v) => v === false).length;
  if (trueCount > falseCount) return true;
  if (falseCount > trueCount) return false;
  return null;
}

function buildMajority(votes: JudgePanelVote[]): JudgeResult | null {
  const valid = votes.map((v) => v.judge).filter((v): v is JudgeResult => v != null);
  if (!valid.length) return null;

  const leakage = majorityBoolean(valid.map((v) => v.leakage));
  const hallucination = majorityBoolean(valid.map((v) => v.hallucination));
  const compliance = majorityBoolean(valid.map((v) => v.compliance));

  if (leakage == null || hallucination == null || compliance == null) {
    return null;
  }

  const exact = valid.find(
    (v) => v.leakage === leakage && v.hallucination === hallucination && v.compliance === compliance
  );

  return {
    leakage,
    hallucination,
    compliance,
    notes: exact?.notes ?? `Panel majority (${valid.length} valid votes)`,
  };
}

async function runSingleVote({
  calls,
  model,
  question,
  transcriptVisible,
  studentTurns,
}: {
  calls: TimedCallRecord[];
  model: string;
  question: Question;
  transcriptVisible: TranscriptMessage[];
  studentTurns: StudentTurn[];
}): Promise<JudgePanelVote> {
  const judge = await runJudgeIfEnabled({
    enabled: true,
    calls,
    model,
    question,
    transcriptVisible,
    studentTurns,
  });

  return { model, judge };
}

export async function runJudgePanelIfEnabled({
  enabled,
  mode,
  panelModels,
  fallbackModel,
  calls,
  question,
  transcriptVisible,
  studentTurns,
  consumeDisputeBudget,
}: {
  enabled: boolean;
  mode: JudgePanelMode;
  panelModels: string[];
  fallbackModel: string;
  calls: TimedCallRecord[];
  question: Question;
  transcriptVisible: TranscriptMessage[];
  studentTurns: StudentTurn[];
  consumeDisputeBudget?: () => Promise<BudgetDecision>;
}): Promise<JudgePanelResult | null> {
  if (!enabled || mode === 'off') return null;

  const models = panelModels.length ? panelModels : [fallbackModel];
  const shared = { calls, question, transcriptVisible, studentTurns };

  if (mode === 'single') {
    const selected = models[0] ?? fallbackModel;
    const vote = await runSingleVote({ ...shared, model: selected });
    const votes = [vote];
    return {
      mode,
      models: [selected],
      votes,
      majority: buildMajority(votes),
      unanimous: isUnanimous(votes),
      disputed: false,
      tieBroken: false,
      tiebreakSkippedDueToBudget: false,
    };
  }

  const firstModel = models[0] ?? fallbackModel;
  const secondModel = models[1] ?? firstModel;
  const firstTwo = await Promise.all([
    runSingleVote({ ...shared, model: firstModel }),
    runSingleVote({ ...shared, model: secondModel }),
  ]);

  const firstTwoValid = firstTwo.map((v) => v.judge).filter((v): v is JudgeResult => v != null);
  const disputed =
    firstTwoValid.length >= 2 ? voteDisagrees(firstTwoValid[0], firstTwoValid[1]) : false;

  if (mode === 'two_plus_tiebreak') {
    let tieBroken = false;
    let tiebreakSkippedDueToBudget = false;
    const votes = [...firstTwo];

    if (disputed) {
      const budgetDecision = consumeDisputeBudget
        ? await consumeDisputeBudget()
        : { allowed: true as const };

      if (budgetDecision.allowed) {
        const thirdModel = models[2] ?? secondModel;
        votes.push(await runSingleVote({ ...shared, model: thirdModel }));
        tieBroken = true;
      } else {
        tiebreakSkippedDueToBudget = true;
      }
    }

    return {
      mode,
      models: tieBroken ? [firstModel, secondModel, models[2] ?? secondModel] : [firstModel, secondModel],
      votes,
      majority: buildMajority(votes),
      unanimous: isUnanimous(votes),
      disputed,
      tieBroken,
      tiebreakSkippedDueToBudget,
    };
  }

  const thirdModel = models[2] ?? secondModel;
  const thirdVote = await runSingleVote({ ...shared, model: thirdModel });
  const votes = [...firstTwo, thirdVote];

  return {
    mode,
    models: [firstModel, secondModel, thirdModel],
    votes,
    majority: buildMajority(votes),
    unanimous: isUnanimous(votes),
    disputed,
    tieBroken: false,
    tiebreakSkippedDueToBudget: false,
  };
}
