import { z } from 'zod';
import { timedGenerateObject } from '../core/llm';
import { Question, QuestionBatchSchema, QuestionSchema, TimedCallRecord } from '../types';

const QUESTION_GEN_SYSTEM = [
  'You generate programming/CS tutoring questions for an experiment harness.',
  'Return JSON that matches the provided schema exactly.',
  'Do not include full solutions or full code.',
  'The "referenceAnswerDescription" must be a short high-level outline, not a step-by-step solution.',
].join('\n');

export async function generateQuestionsBatch({
  calls,
  model,
  difficulty,
  count,
  runId,
}: {
  calls: TimedCallRecord[];
  model: string;
  difficulty: number;
  count: number;
  runId: string;
}): Promise<Question[]> {
  const prompt = [
    `Generate exactly ${count} distinct questions at difficulty ${difficulty} (1=easiest, 5=hardest).`,
    '',
    'Each question MUST include:',
    '- id (string; unique; use a stable pattern like "q-d{difficulty}-{index}")',
    '- difficulty (number; must equal the requested difficulty)',
    '- topicTag (short tag like "arrays", "graphs", "dp", "strings", "math", "hashing")',
    '- problemStatement (full problem statement a student sees)',
    '- referenceAnswerDescription (brief outline; no full code; no final numeric answers; no full derivations)',
    '',
    `Run id context (for uniqueness): ${runId}`,
    '',
    'Keep problem statements self-contained with clear input/output examples if relevant.',
  ].join('\n');

  const { object } = await timedGenerateObject<z.infer<typeof QuestionBatchSchema>>({
    calls,
    name: `questionGen_d${difficulty}`,
    model,
    system: QUESTION_GEN_SYSTEM,
    prompt,
    schema: QuestionBatchSchema,
    schemaName: 'QuestionBatchSchema',
  });

  const normalized: Question[] = [];
  const seenIds = new Set<string>();

  for (let i = 0; i < object.questions.length; i++) {
    const q0 = object.questions[i];
    const q1: Question = {
      ...q0,
      id: q0.id?.trim() || `q-d${difficulty}-${i + 1}`,
      difficulty,
      topicTag: q0.topicTag?.trim() || 'unknown',
      problemStatement: q0.problemStatement?.trim() || '',
      referenceAnswerDescription: q0.referenceAnswerDescription?.trim() || '',
    };

    const parsed = QuestionSchema.safeParse(q1);
    if (!parsed.success) continue;
    if (seenIds.has(parsed.data.id)) {
      parsed.data.id = `${parsed.data.id}-${i + 1}`;
    }
    seenIds.add(parsed.data.id);
    normalized.push(parsed.data);
  }

  if (normalized.length === 0) {
    throw new Error(`Question generation produced no valid questions for difficulty ${difficulty}.`);
  }

  return normalized.slice(0, count);
}
