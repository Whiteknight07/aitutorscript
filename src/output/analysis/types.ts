import type { Condition } from '../../types';

export type LoopSummary = {
  turns: number;
  initiallyRejectedTurns: number;
  fixedTurns: number;
  totalIterations: number;
  interventionCount: number;
};

export type NormalizedRun = {
  runId: string;
  runKey: string;
  createdAtIso: string;
  questionId: string;
  bloomLevel: number | null;
  difficulty: string | null;
  topicTag: string | null;
  pairingId: string;
  condition: Condition;
  tutorId: string;
  tutorLab: string | null;
  supervisorId: string | null;
  supervisorLab: string | null;
  labPairType: 'same-lab' | 'cross-lab' | null;
  turnsRequested: number;
  turnsCompleted: number;
  latencyMs: number | null;
  judged: boolean;
  leakage: boolean | null;
  hallucination: boolean | null;
  compliance: boolean | null;
  endedEarly: boolean;
  earlyReason: string | null;
  earlyStopLeakage: boolean;
  loop: LoopSummary | null;
};

export type TurnRow = {
  runKey: string;
  tutorId: string;
  supervisorId: string | null;
  condition: Condition;
  questionId: string;
  bloomLevel: number | null;
  difficulty: string | null;
  topicTag: string | null;
  turnIndex: number;
  attackLevel: number | null;
  judged: boolean;
  leakage: boolean | null;
  hallucination: boolean | null;
  compliance: boolean | null;
  shouldTerminate: boolean | null;
  terminationReason: string | null;
};

export type RunGroupRow = {
  tutorId?: string | null;
  tutorLab?: string | null;
  supervisorId?: string | null;
  supervisorLab?: string | null;
  labPairType?: string | null;
  condition?: string | null;
  bloomLevel?: number | null;
  difficulty?: string | null;
  topicTag?: string | null;
  questionId?: string | null;
  nRuns: number;
  nJudgedRuns: number;
  leakageCount: number;
  leakageRate: number | null;
  hallucinationCount: number;
  hallucinationRate: number | null;
  complianceCount: number;
  complianceRate: number | null;
  earlyStopCount: number;
  earlyStopRate: number | null;
  earlyStopLeakageCount: number;
  earlyStopOtherCount: number;
  latencyCount: number;
  latencyMeanMs: number | null;
  latencyMedianMs: number | null;
  latencyP90Ms: number | null;
  latencyP95Ms: number | null;
  latencyP99Ms: number | null;
  latencyMinMs: number | null;
  latencyMaxMs: number | null;
  latencyStdMs: number | null;
  loopRuns: number;
  loopTurns: number;
  loopInitiallyRejectedTurns: number;
  loopFixedTurns: number;
  loopTotalIterations: number;
  loopInterventionCount: number;
  loopInterventionRate: number | null;
  loopFixRate: number | null;
  loopAvgIterationsPerTurn: number | null;
  loopAvgInterventionsPerTurn: number | null;
};

export type TurnGroupRow = {
  attackLevel?: number | null;
  turnIndex?: number | null;
  nTurns: number;
  nJudgedTurns: number;
  leakageCount: number;
  leakageRate: number | null;
  hallucinationCount: number;
  hallucinationRate: number | null;
  complianceCount: number;
  complianceRate: number | null;
  terminationCount: number;
  terminationRate: number | null;
};

export type ConditionEffectRow = {
  tutorId: string;
  nSingleRuns: number;
  nDualRuns: number;
  nSingleJudgedRuns: number;
  nDualJudgedRuns: number;
  leakageSingleRate: number | null;
  leakageDualRate: number | null;
  leakageDelta: number | null;
  hallucinationSingleRate: number | null;
  hallucinationDualRate: number | null;
  hallucinationDelta: number | null;
  complianceSingleRate: number | null;
  complianceDualRate: number | null;
  complianceDelta: number | null;
  earlyStopSingleRate: number | null;
  earlyStopDualRate: number | null;
  earlyStopDelta: number | null;
};

export type LabEffectRow = {
  lab: string;
  supervisorCount: number;
  nSingleRuns: number;
  nDualRuns: number;
  nSingleJudgedRuns: number;
  nDualJudgedRuns: number;
  leakageSingleRate: number | null;
  leakageDualRate: number | null;
  leakageDelta: number | null;
  hallucinationSingleRate: number | null;
  hallucinationDualRate: number | null;
  hallucinationDelta: number | null;
  complianceSingleRate: number | null;
  complianceDualRate: number | null;
  complianceDelta: number | null;
  earlyStopSingleRate: number | null;
  earlyStopDualRate: number | null;
  earlyStopDelta: number | null;
};

export type LabPairTypeEffectRow = {
  pairType: 'same-lab' | 'cross-lab';
  nSingleRuns: number;
  nDualRuns: number;
  nSingleJudgedRuns: number;
  nDualJudgedRuns: number;
  leakageSingleRate: number | null;
  leakageDualRate: number | null;
  leakageDelta: number | null;
  hallucinationSingleRate: number | null;
  hallucinationDualRate: number | null;
  hallucinationDelta: number | null;
  complianceSingleRate: number | null;
  complianceDualRate: number | null;
  complianceDelta: number | null;
  earlyStopSingleRate: number | null;
  earlyStopDualRate: number | null;
  earlyStopDelta: number | null;
};

export type LabInteractionRow = {
  tutorLab: string;
  supervisorLab: string;
  nSingleRuns: number;
  nDualRuns: number;
  nSingleJudgedRuns: number;
  nDualJudgedRuns: number;
  leakageSingleRate: number | null;
  leakageDualRate: number | null;
  leakageDelta: number | null;
  complianceSingleRate: number | null;
  complianceDualRate: number | null;
  complianceDelta: number | null;
};

export type TutorPairTypeEffectRow = {
  tutorId: string;
  pairType: 'same-lab' | 'cross-lab';
  nSingleRuns: number;
  nDualRuns: number;
  nSingleJudgedRuns: number;
  nDualJudgedRuns: number;
  leakageSingleRate: number | null;
  leakageDualRate: number | null;
  leakageDelta: number | null;
  complianceSingleRate: number | null;
  complianceDualRate: number | null;
  complianceDelta: number | null;
};

export type BloomDifficultyEffectRow = {
  bloomLevel: number | null;
  difficulty: string | null;
  nSingleRuns: number;
  nDualRuns: number;
  nSingleJudgedRuns: number;
  nDualJudgedRuns: number;
  leakageSingleRate: number | null;
  leakageDualRate: number | null;
  leakageDelta: number | null;
  complianceSingleRate: number | null;
  complianceDualRate: number | null;
  complianceDelta: number | null;
  hallucinationSingleRate: number | null;
  hallucinationDualRate: number | null;
  hallucinationDelta: number | null;
};

export type SurvivalRow = {
  group: string;
  turnIndex: number;
  survivalRate: number | null;
  nRuns: number;
};

export type LabEffectRow = {
  lab: string;
  supervisorCount: number;
  nSingleRuns: number;
  nDualRuns: number;
  nSingleJudgedRuns: number;
  nDualJudgedRuns: number;
  leakageSingleRate: number | null;
  leakageDualRate: number | null;
  leakageDelta: number | null;
  hallucinationSingleRate: number | null;
  hallucinationDualRate: number | null;
  hallucinationDelta: number | null;
  complianceSingleRate: number | null;
  complianceDualRate: number | null;
  complianceDelta: number | null;
  earlyStopSingleRate: number | null;
  earlyStopDualRate: number | null;
  earlyStopDelta: number | null;
};

export type LabPairTypeEffectRow = {
  pairType: 'same-lab' | 'cross-lab';
  nSingleRuns: number;
  nDualRuns: number;
  nSingleJudgedRuns: number;
  nDualJudgedRuns: number;
  leakageSingleRate: number | null;
  leakageDualRate: number | null;
  leakageDelta: number | null;
  hallucinationSingleRate: number | null;
  hallucinationDualRate: number | null;
  hallucinationDelta: number | null;
  complianceSingleRate: number | null;
  complianceDualRate: number | null;
  complianceDelta: number | null;
  earlyStopSingleRate: number | null;
  earlyStopDualRate: number | null;
  earlyStopDelta: number | null;
};

export type AnalysisOutput = {
  meta: {
    runId: string;
    createdAtIso: string;
    generatedAtIso: string;
  };
  totals: {
    runs: number;
    judgedRuns: number;
    totalTurns: number;
    judgedTurns: number;
    conditions: string[];
    tutors: string[];
    supervisors: string[];
    tutorLabs: string[];
    supervisorLabs: string[];
    attackLevels: number[];
  };
  tables: {
    overall: RunGroupRow[];
    byTutor: RunGroupRow[];
    bySupervisor: RunGroupRow[];
    byTutorLab: RunGroupRow[];
    bySupervisorLab: RunGroupRow[];
    byCondition: RunGroupRow[];
    byTutorCondition: RunGroupRow[];
    byTutorSupervisor: RunGroupRow[];
    byLabPair: RunGroupRow[];
    byLabPairType: RunGroupRow[];
    byBloomDifficulty: RunGroupRow[];
    bloomDifficultyEffects: BloomDifficultyEffectRow[];
    byQuestion: RunGroupRow[];
    perTurn: {
      byAttackLevel: TurnGroupRow[];
      byTurnIndex: TurnGroupRow[];
    };
    conditionEffects: ConditionEffectRow[];
    labEffects: LabEffectRow[];
    labPairTypeEffects: LabPairTypeEffectRow[];
    labInteraction: LabInteractionRow[];
    tutorPairTypeEffects: TutorPairTypeEffectRow[];
    survivalByCondition: SurvivalRow[];
    survivalByPairType: SurvivalRow[];
  };
};
