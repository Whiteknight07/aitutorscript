import { z } from 'zod';
import { PAIRING_IDS, type PairingId } from './config';

export const ConditionSchema = z.enum(['single', 'dual-loop']);
export type Condition = z.infer<typeof ConditionSchema>;

// Re-export PairingId from config for convenience
export type { PairingId } from './config';

// Create Zod schema dynamically from config
export const PairingIdSchema = z.enum(PAIRING_IDS as [PairingId, ...PairingId[]]);

export type RoleModelConfig = {
  questionGeneratorModel: string;
  studentAttackerModel: string;
  judgeModel: string;
  tutorModel: string;
  supervisorModel: string | null;
};

export const QuestionSchema = z.object({
  id: z.string().min(1),
  difficulty: z.number().int().min(1).max(5),
  topicTag: z.string().min(1),
  problemStatement: z.string().min(20),
  referenceAnswerDescription: z.string().min(10),
});
export type Question = z.infer<typeof QuestionSchema>;

export const QuestionBatchSchema = z.object({
  questions: z.array(QuestionSchema).min(1),
});

export const StudentGoalSchema = z.enum([
  'get_key_steps',
  'get_final_answer',
  'get_full_code',
]);
export type StudentGoal = z.infer<typeof StudentGoalSchema>;

export const StudentTurnSchema = z.object({
  message: z.string().min(1),
  attackLevel: z.number().int().min(1),
  tactic: z.string().min(1),
  goal: StudentGoalSchema,
});
export type StudentTurn = z.infer<typeof StudentTurnSchema>;

export const SupervisorVerdictSchema = z.object({
  approved: z.boolean(),
  violations: z.array(z.string()),
  feedbackToTutor: z.string(),
  safeResponseToStudent: z.string(),
});
export type SupervisorVerdict = z.infer<typeof SupervisorVerdictSchema>;

export const JudgeResultSchema = z.object({
  leakage: z.boolean(),
  compliance: z.boolean(),
  pedagogyHelpfulness: z.number().int().min(1).max(5),
  studentGotWhatTheyWanted: z.boolean(),
  notes: z.string().optional(),
});
export type JudgeResult = z.infer<typeof JudgeResultSchema>;

export const TurnJudgeResultSchema = z.object({
  leakage: z.boolean(),
  compliance: z.boolean(),
  pedagogyHelpfulness: z.number().int().min(1).max(5),
  studentGotWhatTheyWanted: z.boolean(),
  shouldTerminate: z.boolean(),
  terminationReason: z.enum(['leakage', 'goal', 'none']),
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
  pairingId: PairingId;
  condition: Condition;
  turnsRequested: number;
  maxIters: number;
  turnsCompleted: number;
  loopIterationsTotal: number | null;
  loopTurnIterations: Array<{
    turnIndex: number;
    iterationsUsed: number;
    initiallyRejected: boolean;
    endedApproved: boolean;
    violations: string[];
  }> | null;
  transcriptVisible: TranscriptMessage[];
  hiddenTrace: {
    studentTurns: StudentTurn[];
    turnJudgments?: Array<{ turnIndex: number; judge: TurnJudgeResult }>;
    tutorDrafts: Array<{ turnIndex: number; iter: number; text: string }>;
    supervisorVerdicts: Array<{ turnIndex: number; iter: number; verdict: SupervisorVerdict }>;
  };
  calls: TimedCallRecord[];
  totalLatencyMs: number;
  judge: JudgeResult | null;
};
