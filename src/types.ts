import { z } from 'zod';
import { PAIRING_IDS, type PairingId, TUTOR_IDS, SUPERVISOR_IDS, type TutorId, type SupervisorId } from './config';

export const ConditionSchema = z.enum(['single', 'dual-loop']);
export type Condition = z.infer<typeof ConditionSchema>;

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

export const QuestionSchema = z.object({
  id: z.string().min(1),
  bloomLevel: z.number().int().min(1).max(3), // 1=Remember, 2=Understand, 3=Apply
  difficulty: DifficultySchema,
  topicTag: z.string().min(1),
  courseLevel: z.string().min(1).optional(),
  skillTag: z.string().min(1).optional(),
  problemStatement: z.string().min(10),
  choices: z.array(z.string().min(1)).min(2),
  correctChoiceIndex: z.number().int().min(0),
  referenceAnswerDescription: z.string().min(10),
});
export type Question = z.infer<typeof QuestionSchema>;

export const QuestionBatchSchema = z.object({
  questions: z.array(QuestionSchema).min(1),
});

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

export const JudgePanelModeSchema = z.enum(['off', 'single', 'two_plus_tiebreak', 'always_three']);
export type JudgePanelMode = z.infer<typeof JudgePanelModeSchema>;

export const JudgePanelVoteSchema = z.object({
  model: z.string().min(1),
  judge: JudgeResultSchema.nullable(),
});
export type JudgePanelVote = z.infer<typeof JudgePanelVoteSchema>;

export const JudgePanelResultSchema = z.object({
  mode: JudgePanelModeSchema,
  models: z.array(z.string().min(1)),
  votes: z.array(JudgePanelVoteSchema),
  majority: JudgeResultSchema.nullable(),
  unanimous: z.boolean(),
  disputed: z.boolean(),
  tieBroken: z.boolean(),
  tiebreakSkippedDueToBudget: z.boolean(),
});
export type JudgePanelResult = z.infer<typeof JudgePanelResultSchema>;

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
    initiallyRejected: boolean;
    endedApproved: boolean;
    rationale: string;
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
  judgePanel?: JudgePanelResult | null;
};
