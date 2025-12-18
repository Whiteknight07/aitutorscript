"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TurnJudgeResultSchema = exports.JudgeResultSchema = exports.SupervisorVerdictSchema = exports.StudentTurnSchema = exports.StudentGoalSchema = exports.QuestionBatchSchema = exports.QuestionSchema = exports.PairingIdSchema = exports.ConditionSchema = void 0;
const zod_1 = require("zod");
exports.ConditionSchema = zod_1.z.enum(['single', 'dual-loop']);
exports.PairingIdSchema = zod_1.z.enum([
    'gpt5-gpt5',
    'gemini-gemini',
    'gpt5-gemini',
    'gemini-gpt5',
]);
exports.QuestionSchema = zod_1.z.object({
    id: zod_1.z.string().min(1),
    difficulty: zod_1.z.number().int().min(1).max(5),
    topicTag: zod_1.z.string().min(1),
    problemStatement: zod_1.z.string().min(20),
    referenceAnswerDescription: zod_1.z.string().min(10),
});
exports.QuestionBatchSchema = zod_1.z.object({
    questions: zod_1.z.array(exports.QuestionSchema).min(1),
});
exports.StudentGoalSchema = zod_1.z.enum([
    'get_key_steps',
    'get_final_answer',
    'get_full_code',
]);
exports.StudentTurnSchema = zod_1.z.object({
    message: zod_1.z.string().min(1),
    attackLevel: zod_1.z.number().int().min(1),
    tactic: zod_1.z.string().min(1),
    goal: exports.StudentGoalSchema,
});
exports.SupervisorVerdictSchema = zod_1.z.object({
    approved: zod_1.z.boolean(),
    violations: zod_1.z.array(zod_1.z.string()),
    feedbackToTutor: zod_1.z.string(),
    safeResponseToStudent: zod_1.z.string(),
});
exports.JudgeResultSchema = zod_1.z.object({
    leakage: zod_1.z.boolean(),
    compliance: zod_1.z.boolean(),
    pedagogyHelpfulness: zod_1.z.number().int().min(1).max(5),
    studentGotWhatTheyWanted: zod_1.z.boolean(),
    notes: zod_1.z.string().optional(),
});
exports.TurnJudgeResultSchema = zod_1.z.object({
    leakage: zod_1.z.boolean(),
    compliance: zod_1.z.boolean(),
    pedagogyHelpfulness: zod_1.z.number().int().min(1).max(5),
    studentGotWhatTheyWanted: zod_1.z.boolean(),
    shouldTerminate: zod_1.z.boolean(),
    terminationReason: zod_1.z.enum(['leakage', 'goal', 'none']),
    notes: zod_1.z.string().optional(),
});
