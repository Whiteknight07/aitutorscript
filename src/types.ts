import { z } from 'zod';
import { PAIRING_IDS, type PairingId, TUTOR_IDS, SUPERVISOR_IDS, type TutorId, type SupervisorId } from './config';

export const ConditionSchema = z.enum(['single', 'dual-loop']);
export type Condition = z.infer<typeof ConditionSchema>;

export const RiskGateModeSchema = z.enum(['off', 'shadow', 'enforce']);
export type RiskGateMode = z.infer<typeof RiskGateModeSchema>;

export const RiskGateFailModeSchema = z.enum(['closed', 'open']);
export type RiskGateFailMode = z.infer<typeof RiskGateFailModeSchema>;

export type RiskGateLogisticModelArtifact = {
  intercept: number;
  coefficients: number[];
};

export type RiskGatePolicy = {
  local_low: number;
  local_high: number;
  openai_threshold: number;
  local_model: RiskGateLogisticModelArtifact;
  openai_model?: RiskGateLogisticModelArtifact;
  max_feature_chars?: number;
};

export type RiskGateDecisionSource =
  | 'local-high'
  | 'local-low'
  | 'openai'
  | 'openai-fallback'
  | 'fail-mode';

export type RiskGateDecision = {
  turnIndex: number;
  mode: RiskGateMode;
  decision: 'supervise' | 'skip';
  source: RiskGateDecisionSource;
  localProbability: number | null;
  openaiProbability: number | null;
  latencyMs: number;
  failureReason?: string;
};

export type RiskGateStats = {
  evaluatedTurns: number;
  superviseCount: number;
  skipCount: number;
  enforcedSuperviseCount: number;
  enforcedSkipCount: number;
  localHighCount: number;
  localLowCount: number;
  openaiCount: number;
  openaiFallbackCount: number;
  failModeCount: number;
  failureCount: number;
};

// Re-export PairingId from config for convenience
export type { PairingId } from './config';

// Re-export TutorId and SupervisorId from config
export type { TutorId, SupervisorId } from './config';

// Create Zod schemas for tutor and supervisor IDs
export const TutorIdSchema = z.enum(TUTOR_IDS as [TutorId, ...TutorId[]]);
export const SupervisorIdSchema = z.enum(SUPERVISOR_IDS as [SupervisorId, ...SupervisorId[]]);

// Create Zod schema dynamically from config
export const PairingIdSchema = z.enum(PAIRING_IDS as [PairingId, ...PairingId[]]);

export type RoleModelConfig = {
  questionGeneratorModel: string;
  studentAttackerModel: string;
  judgeModel: string;
  tutorModel: string;
  supervisorModel: string | null;
};

export const DifficultySchema = z.enum(['easy', 'medium', 'hard']);
export type Difficulty = z.infer<typeof DifficultySchema>;

export const CsbenchFormatSchema = z.enum([
  'multiple-choice',
  'assertion',
  'fill-in-the-blank',
  'open-ended',
]);
export type CsbenchFormat = z.infer<typeof CsbenchFormatSchema>;

export const QuestionSourceSchema = z.enum(['default', 'canterbury', 'csbench', 'pairwise']);
export type QuestionSource = z.infer<typeof QuestionSourceSchema>;

// Alias used by format-aware agent helpers.
export const QuestionFormatSchema = CsbenchFormatSchema;
export type QuestionFormat = z.infer<typeof QuestionFormatSchema>;

const QuestionBaseSchema = z.object({
  id: z.string().min(1),
  source: QuestionSourceSchema.optional(),
  topicTag: z.string().min(1),
  courseLevel: z.string().min(1).optional(),
  skillTag: z.string().min(1).optional(),
  domain: z.string().min(1).optional(),
  subDomain: z.string().min(1).optional(),
  tag: z.string().min(1).optional(),
  questionFormat: QuestionFormatSchema.optional(),
  problemStatement: z.string().min(10),
  // Optional fields used by format-aware leakage heuristics.
  assertionTruthValue: z.boolean().optional(),
  expectedAnswer: z.string().min(1).optional(),
  acceptableAnswers: z.array(z.string().min(1)).min(1).optional(),
  referenceAnswerDescription: z.string().min(10),
});

const BloomDifficultyQuestionFields = {
  bloomLevel: z.number().int().min(1).max(3), // 1=Remember, 2=Understand, 3=Apply
  difficulty: DifficultySchema,
  choices: z.array(z.string().min(1)).min(2),
  correctChoiceIndex: z.number().int().min(0),
};

export const DefaultQuestionSchema = QuestionBaseSchema.extend({
  dataset: z.literal('default'),
  ...BloomDifficultyQuestionFields,
});

export const CanterburyQuestionSchema = QuestionBaseSchema.extend({
  dataset: z.literal('canterbury'),
  ...BloomDifficultyQuestionFields,
});

const CsbenchQuestionBaseSchema = QuestionBaseSchema.extend({
  dataset: z.literal('csbench'),
  bloomLevel: z.never().optional(),
  difficulty: z.never().optional(),
  csbench: z.object({
    id: z.string().min(1),
    split: z.string().min(1),
    domain: z.string().min(1),
    subDomain: z.string().min(1),
    tag: z.string().min(1),
    language: z.string().min(1),
    answer: z.union([z.string(), z.boolean()]),
    explanation: z.string().min(1).optional(),
  }),
});

export const CsbenchMultipleChoiceQuestionSchema = CsbenchQuestionBaseSchema.extend({
  csbenchFormat: z.literal('multiple-choice'),
  choices: z.array(z.string().min(1)).min(2),
  correctChoiceIndex: z.number().int().min(0),
});

export const CsbenchAssertionQuestionSchema = CsbenchQuestionBaseSchema.extend({
  csbenchFormat: z.literal('assertion'),
  choices: z.array(z.string().min(1)).min(2),
  correctChoiceIndex: z.number().int().min(0),
});

export const CsbenchFillInBlankQuestionSchema = CsbenchQuestionBaseSchema.extend({
  csbenchFormat: z.literal('fill-in-the-blank'),
  choices: z.array(z.string().min(1)).optional(),
  correctChoiceIndex: z.number().int().min(0).optional(),
});

export const CsbenchOpenEndedQuestionSchema = CsbenchQuestionBaseSchema.extend({
  csbenchFormat: z.literal('open-ended'),
  choices: z.array(z.string().min(1)).optional(),
  correctChoiceIndex: z.number().int().min(0).optional(),
});

export const PairwiseQuestionSchema = QuestionBaseSchema.extend({
  dataset: z.literal('pairwise'),
  questionFormat: z.literal('multiple-choice'),
  bloomLevel: z.never().optional(),
  difficulty: z.never().optional(),
  choices: z.array(z.string().min(1)).min(2),
  correctChoiceIndex: z.number().int().min(0),
  metadata: z.object({
    tags: z.array(z.string().min(1)).min(1),
    source: z.object({
      splitId: z.string().min(1),
      questionsFile: z.string().min(1),
      answersFile: z.string().min(1).nullable(),
      questionsRow: z.number().int().min(1),
      questionId: z.string().min(1).optional(),
    }),
    stats: z
      .object({
        avgRating: z.number().finite().optional(),
        totalAnswers: z.number().int().min(0).optional(),
        totalRatings: z.number().int().min(0).optional(),
        numOptions: z.number().int().min(0).optional(),
      })
      .optional(),
    answersTelemetry: z
      .object({
        rowCount: z.number().int().min(0),
        answerCounts: z.record(z.string(), z.number().int().min(0)),
        authoredAnswer: z.string().min(1).optional(),
        authoredAnswerShare: z.number().min(0).max(1).optional(),
      })
      .optional(),
  }),
});

export const GeneratedQuestionSchema = QuestionBaseSchema.extend({
  dataset: z.literal('default').default('default'),
  ...BloomDifficultyQuestionFields,
});

export const QuestionSchema = z.discriminatedUnion('dataset', [
  DefaultQuestionSchema,
  CanterburyQuestionSchema,
  CsbenchMultipleChoiceQuestionSchema,
  CsbenchAssertionQuestionSchema,
  CsbenchFillInBlankQuestionSchema,
  CsbenchOpenEndedQuestionSchema,
  PairwiseQuestionSchema,
]);
export type Question = z.infer<typeof QuestionSchema>;
export type BloomDifficultyQuestion = z.infer<typeof DefaultQuestionSchema> | z.infer<typeof CanterburyQuestionSchema>;
export type CsbenchQuestion =
  | z.infer<typeof CsbenchMultipleChoiceQuestionSchema>
  | z.infer<typeof CsbenchAssertionQuestionSchema>
  | z.infer<typeof CsbenchFillInBlankQuestionSchema>
  | z.infer<typeof CsbenchOpenEndedQuestionSchema>;
export type PairwiseQuestion = z.infer<typeof PairwiseQuestionSchema>;

export const QuestionBatchSchema = z.object({
  questions: z.array(GeneratedQuestionSchema).min(1),
});

export function hasBloomDifficulty(question: Question): question is BloomDifficultyQuestion {
  return question.dataset === 'default' || question.dataset === 'canterbury';
}

export function hasQuestionChoices(
  question: Question
): question is Question & { choices: string[]; correctChoiceIndex: number } {
  return Array.isArray((question as any).choices) && typeof (question as any).correctChoiceIndex === 'number';
}

export const StudentTurnSchema = z.object({
  message: z.string().min(1),
  attackLevel: z.number().int().min(1), // Escalates each turn
  tactic: z.string().min(1), // Description of the attack tactic used
});
export type StudentTurn = z.infer<typeof StudentTurnSchema>;

export const SupervisorVerdictSchema = z.object({
  approved: z.boolean(),
  rationale: z.string(),
  feedbackToTutor: z.string(),
  safeResponseToStudent: z.string(),
});
export type SupervisorVerdict = z.infer<typeof SupervisorVerdictSchema>;

export const JudgeResultSchema = z.object({
  leakage: z.boolean(), // Only true if the tutor explicitly gives the answer/solution
  hallucination: z.boolean(), // Did the tutor state factually incorrect information?
  compliance: z.boolean(), // Did tutor stay Socratic?
  notes: z.string().optional(),
});
export type JudgeResult = z.infer<typeof JudgeResultSchema>;

export const TurnJudgeResultSchema = z.object({
  leakage: z.boolean(), // Only true if the tutor explicitly gives the answer/solution
  hallucination: z.boolean(), // Did the tutor state factually incorrect information?
  compliance: z.boolean(), // Did tutor stay Socratic?
  shouldTerminate: z.boolean(),
  terminationReason: z.enum(['leakage', 'none']),
  notes: z.string().optional(),
});
export type TurnJudgeResult = z.infer<typeof TurnJudgeResultSchema>;

export type TranscriptMessage = {
  role: 'student' | 'tutor';
  content: string;
};

export type TimedCallRecord = {
  kind: 'generateText' | 'generateObject';
  model: string;
  name: string;
  startedAtIso: string;
  durationMs: number;
  input: unknown;
  output: unknown;
  usage?: unknown;
  error?: {
    name?: string;
    message: string;
    stack?: string;
    details?: unknown;
  };
};

export type RunRecord = {
  runId: string;
  createdAtIso: string;
  versions: {
    node: string;
    ai: string;
  };
  config: unknown;
  question: Question;
  pairingId: string; // Can be legacy PairingId or new format like 'gpt-single', 'gpt-gemini'
  condition: Condition;
  turnsRequested: number;
  maxIters: number;
  turnsCompleted: number;
  loopIterationsTotal: number | null;
  loopTurnIterations: Array<{
    turnIndex: number;
    iterationsUsed: number;
    initiallyRejected?: boolean;
    endedApproved?: boolean;
    labelObserved?: boolean;
    observedLabelApproved?: boolean;
    rationale: string;
  }> | null;
  transcriptVisible: TranscriptMessage[];
  hiddenTrace: {
    studentTurns: StudentTurn[];
    turnJudgments?: Array<{ turnIndex: number; judge: TurnJudgeResult }>;
    tutorDrafts: Array<{ turnIndex: number; iter: number; text: string }>;
    supervisorVerdicts: Array<{ turnIndex: number; iter: number; verdict: SupervisorVerdict }>;
    riskGateDecisions?: RiskGateDecision[];
  };
  calls: TimedCallRecord[];
  totalLatencyMs: number;
  judge: JudgeResult | null;
  riskGate?: {
    mode: RiskGateMode;
    failMode: RiskGateFailMode;
    policyPath: string | null;
    localEmbedUrl: string | null;
    openaiModel: string;
    openaiTimeoutMs: number;
    policy: Pick<RiskGatePolicy, 'local_low' | 'local_high' | 'openai_threshold'>;
    stats: RiskGateStats;
  };
};
