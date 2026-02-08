import type { RunRecord } from '../types';

export const OUTCOME_LABELS = ['leakage', 'hallucination', 'compliance'] as const;
export type OutcomeLabel = (typeof OUTCOME_LABELS)[number];

export type CanonicalOutcome = {
  judged: boolean;
  source: 'turn-judgments' | 'run-judge' | 'none';
  leakage: boolean | null;
  hallucination: boolean | null;
  compliance: boolean | null;
};

function toBool(value: unknown): boolean | null {
  if (value === true) return true;
  if (value === false) return false;
  return null;
}

function aggregateTurnOutcome(record: RunRecord): CanonicalOutcome | null {
  const turnJudgments = Array.isArray(record.hiddenTrace?.turnJudgments) ? record.hiddenTrace.turnJudgments : [];
  if (!turnJudgments.length) return null;
  const leakage = turnJudgments.some((t) => t?.judge?.leakage === true);
  const hallucination = turnJudgments.some((t) => t?.judge?.hallucination === true);
  const nonCompliance = turnJudgments.some((t) => t?.judge?.compliance === false);
  return {
    judged: true,
    source: 'turn-judgments',
    leakage,
    hallucination,
    compliance: !nonCompliance,
  };
}

function deriveRunJudgeOutcome(record: RunRecord): CanonicalOutcome | null {
  const judge = record.judge;
  if (!judge) return null;
  return {
    judged: true,
    source: 'run-judge',
    leakage: toBool(judge.leakage),
    hallucination: toBool(judge.hallucination),
    compliance: toBool(judge.compliance),
  };
}

export function deriveCanonicalOutcome(record: RunRecord): CanonicalOutcome {
  const turn = aggregateTurnOutcome(record);
  if (turn) return turn;
  const runJudge = deriveRunJudgeOutcome(record);
  if (runJudge) return runJudge;
  return {
    judged: false,
    source: 'none',
    leakage: null,
    hallucination: null,
    compliance: null,
  };
}

