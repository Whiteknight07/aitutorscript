import { z } from 'zod';
import { timedGenerateObject } from '../core/llm';
import { Difficulty, GeneratedQuestionSchema, Question, QuestionBatchSchema, TimedCallRecord } from '../types';

const QUESTION_GEN_SYSTEM = [
  'You generate software engineering and operating systems tutoring questions for an experiment harness.',
  'Focus on practical SE concepts and OS fundamentals that students commonly struggle with.',
  'All questions MUST be multiple-choice (4 options).',
  'Return JSON that matches the provided schema exactly.',
  'Do not include full solutions or full code.',
  'The "referenceAnswerDescription" must be a short explanation (no code, no long derivations).',
].join('\n');

const BLOOM_DESCRIPTIONS: Record<number, { name: string; description: string; verbs: string }> = {
  1: {
    name: 'Remember',
    description: 'Recall facts, terms, basic concepts, or answers',
    verbs: 'define, list, identify, name, recall, recognize, state',
  },
  2: {
    name: 'Understand',
    description: 'Demonstrate understanding by explaining ideas or concepts',
    verbs: 'explain, describe, interpret, summarize, classify, compare, contrast',
  },
  3: {
    name: 'Apply',
    description: 'Use information in new situations to solve problems',
    verbs: 'apply, implement, solve, use, demonstrate, execute, compute',
  },
};

export async function generateQuestionsBatch({
  calls,
  model,
  bloomLevel,
  difficulty,
  count,
  runId,
}: {
  calls: TimedCallRecord[];
  model: string;
  bloomLevel: number;
  difficulty: Difficulty;
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

  const bloom = BLOOM_DESCRIPTIONS[bloomLevel];
  const prompt = [
    `Generate exactly ${count} distinct multiple-choice questions (MCQs) about software engineering and operating systems.`,
    '',
    `**Bloom's Taxonomy Level ${bloomLevel} (${bloom.name})**: ${bloom.description}`,
    `Action verbs for this level: ${bloom.verbs}`,
    '',
    `**Difficulty: ${difficulty}**`,
    difficulty === 'easy'
      ? 'Easy questions test fundamental concepts with straightforward scenarios.'
      : difficulty === 'medium'
        ? 'Medium questions require connecting multiple concepts or analyzing typical scenarios.'
        : 'Hard questions involve complex scenarios, edge cases, or nuanced trade-offs.',
    '',
    'Topic focus (choose from these or similar):',
    topicExamples.join(', '),
    '',
    'Each question MUST include (match schema exactly):',
    `- id (string; unique; use pattern "q-b${bloomLevel}-${difficulty}-{index}")`,
    `- bloomLevel (number; must equal ${bloomLevel})`,
    `- difficulty (string; must equal "${difficulty}")`,
    '- topicTag (short tag from the topics above or similar)',
    '- problemStatement (the stem only; do NOT embed the options in the stem)',
    '- choices (array of exactly 4 strings; plausible distractors; no "all of the above")',
    '- correctChoiceIndex (0-3; points to the correct element in choices)',
    '- referenceAnswerDescription (brief justification: why the correct option is correct; 2-4 sentences; no code)',
    '',
    'Question design guidelines:',
    '- OS fundamentals: scheduling, virtual memory, paging, synchronization, deadlocks, file systems, syscalls, kernel vs user mode',
    '- SE fundamentals: testing, debugging, APIs, version control, design trade-offs, concurrency/race conditions, reliability',
    `- Ensure questions align with Bloom's Level ${bloomLevel} (${bloom.name}) cognitive demands`,
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
        name: `questionGen_b${bloomLevel}_${difficulty}_a${attempt}`,
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
    throw new Error(`Question generation failed for bloom=${bloomLevel} difficulty=${difficulty}.`);
  }

  const normalized: Question[] = [];
  const seenIds = new Set<string>();

  for (let i = 0; i < object.questions.length; i++) {
    const q0 = object.questions[i];
    const q1: Question = {
      ...q0,
      id: q0.id?.trim() || `q-b${bloomLevel}-${difficulty}-${i + 1}`,
      bloomLevel,
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
      dataset: 'default',
    };

    const parsed = GeneratedQuestionSchema.safeParse(q1);
    if (!parsed.success) continue;
    if (seenIds.has(parsed.data.id)) {
      parsed.data.id = `${parsed.data.id}-${i + 1}`;
    }
    seenIds.add(parsed.data.id);
    normalized.push(parsed.data);
  }

  if (normalized.length === 0) {
    throw new Error(`Question generation produced no valid questions for bloom=${bloomLevel} difficulty=${difficulty}.`);
  }

  return normalized.slice(0, count);
}
