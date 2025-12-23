import { z } from 'zod';
import { timedGenerateObject } from '../core/llm';
import { Question, QuestionBatchSchema, QuestionSchema, TimedCallRecord } from '../types';

const QUESTION_GEN_SYSTEM = [
  'You generate software engineering and operating systems tutoring questions for an experiment harness.',
  'Focus on practical SE concepts and OS fundamentals that students commonly struggle with.',
  'All questions MUST be multiple-choice (4 options).',
  'Return JSON that matches the provided schema exactly.',
  'Do not include full solutions or full code.',
  'The "referenceAnswerDescription" must be a short explanation (no code, no long derivations).',
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
  const topicExamples = [
    // OS topics
    'process-management', 'memory-management', 'virtual-memory', 'paging', 'segmentation',
    'scheduling-algorithms', 'deadlocks', 'synchronization', 'semaphores', 'mutexes',
    'file-systems', 'io-systems', 'interrupts', 'system-calls', 'kernel-vs-user-mode',
    'threads-vs-processes', 'ipc', 'cpu-scheduling', 'memory-allocation', 'page-replacement',
    // SE topics
    'design-patterns', 'solid-principles', 'version-control', 'testing-strategies',
    'code-review', 'refactoring', 'api-design', 'database-design', 'caching',
    'microservices', 'monolith-vs-microservices', 'ci-cd', 'debugging', 'logging',
    'error-handling', 'concurrency', 'race-conditions', 'dependency-injection',
    'clean-code', 'technical-debt', 'scalability', 'load-balancing',
  ];

  const prompt = [
    `Generate exactly ${count} distinct multiple-choice questions (MCQs) at difficulty ${difficulty} (1=easiest, 5=hardest) about software engineering and operating systems.`,
    '',
    'Topic focus (choose from these or similar):',
    topicExamples.join(', '),
    '',
    'Each question MUST include (match schema exactly):',
    '- id (string; unique; use a stable pattern like "q-d{difficulty}-{index}")',
    '- difficulty (number; must equal the requested difficulty)',
    '- topicTag (short tag from the topics above or similar)',
    '- problemStatement (the stem only; do NOT embed the options in the stem)',
    '- choices (array of exactly 4 strings; plausible distractors; no "all of the above")',
    '- correctChoiceIndex (0-3; points to the correct element in choices)',
    '- referenceAnswerDescription (brief justification: why the correct option is correct; 2-4 sentences; no code)',
    '',
    'Preferred MCQ styles:',
    '- OS fundamentals: scheduling, virtual memory, paging, synchronization, deadlocks, file systems, syscalls, kernel vs user mode',
    '- SE fundamentals: testing, debugging, APIs, version control, design trade-offs, concurrency/race conditions, reliability',
    '- Scenario-based reasoning and trade-offs (avoid trivia)',
    '',
    `Run id context (for uniqueness): ${runId}`,
    '',
    'Keep stems self-contained and practical.',
  ].join('\n');

  const maxAttempts = 3;
  let lastError: unknown = null;
  let lastText: string | null = null;

  let object: z.infer<typeof QuestionBatchSchema> | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await timedGenerateObject<z.infer<typeof QuestionBatchSchema>>({
        calls,
        name: `questionGen_d${difficulty}_a${attempt}`,
        model,
        system: QUESTION_GEN_SYSTEM,
        prompt:
          attempt === 1
            ? prompt
            : [
                prompt,
                '',
                'IMPORTANT: Your previous output did not match the schema.',
                'Output ONLY valid JSON matching the schema exactly.',
                'Constraints recap:',
                '- Each question must include choices (exactly 4 strings).',
                '- correctChoiceIndex must be an integer 0-3.',
                '',
                lastText ? 'Previous invalid output (for repair):\n' + lastText : '',
                lastError instanceof Error ? 'Error context:\n' + lastError.message : '',
              ]
                .filter(Boolean)
                .join('\n'),
        schema: QuestionBatchSchema,
        schemaName: 'QuestionBatchSchema',
      });
      object = res.object;
      break;
    } catch (err: any) {
      lastError = err;
      lastText = typeof err?.text === 'string' ? err.text : null;
    }
  }

  if (!object) {
    throw new Error(`Question generation failed for difficulty ${difficulty}.`);
  }

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
      choices: Array.isArray((q0 as any).choices)
        ? (q0 as any).choices.map((c: any) => String(c ?? '').trim()).filter(Boolean)
        : [],
      correctChoiceIndex:
        typeof (q0 as any).correctChoiceIndex === 'number'
          ? (q0 as any).correctChoiceIndex
          : Number((q0 as any).correctChoiceIndex),
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
