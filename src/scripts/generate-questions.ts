/**
 * Script to generate a static set of 36 questions (4 per Bloom x Difficulty cell)
 * and save them to data/questions.json
 * 
 * Usage: pnpm generate-questions
 */

import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { generateQuestionsBatch } from '../agents/question-gen';
import { DEFAULT_MODELS } from '../config';
import type { Difficulty, Question, TimedCallRecord } from '../types';
import { nowIso } from '../utils/util';

const BLOOM_LEVELS = [1, 2, 3];
const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];
const QUESTIONS_PER_CELL = 4;

async function main() {
  const runId = `static_${nowIso().replace(/[:.]/g, '-')}`;
  const model = DEFAULT_MODELS.questionGenerator;
  const calls: TimedCallRecord[] = [];
  const questions: Question[] = [];
  const seenIds = new Set<string>();

  console.log(`Generating ${BLOOM_LEVELS.length * DIFFICULTIES.length * QUESTIONS_PER_CELL} questions...`);
  console.log(`Model: ${model}`);
  console.log(`Matrix: ${BLOOM_LEVELS.length} bloom levels × ${DIFFICULTIES.length} difficulties × ${QUESTIONS_PER_CELL} per cell`);
  console.log('');

  for (const bloomLevel of BLOOM_LEVELS) {
    for (const difficulty of DIFFICULTIES) {
      console.log(`Generating bloom=${bloomLevel} difficulty=${difficulty}...`);
      
      const batch = await generateQuestionsBatch({
        calls,
        model,
        bloomLevel,
        difficulty,
        count: QUESTIONS_PER_CELL,
        runId,
      });

      for (const q of batch) {
        if (seenIds.has(q.id)) {
          q.id = `${q.id}-dup-${seenIds.size}`;
        }
        seenIds.add(q.id);
        questions.push(q);
      }

      console.log(`  Generated ${batch.length} questions`);
    }
  }

  const output = {
    generatedAt: nowIso(),
    model,
    bloomLevels: BLOOM_LEVELS,
    difficulties: DIFFICULTIES,
    questionsPerCell: QUESTIONS_PER_CELL,
    totalQuestions: questions.length,
    questions,
  };

  const outPath = join(process.cwd(), 'data', 'questions.json');
  await writeFile(outPath, JSON.stringify(output, null, 2));

  console.log('');
  console.log(`Generated ${questions.length} questions`);
  console.log(`Saved to: ${outPath}`);
}

main().catch((err) => {
  console.error('Failed to generate questions:', err);
  process.exit(1);
});
