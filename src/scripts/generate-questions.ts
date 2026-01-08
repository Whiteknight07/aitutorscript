/**
 * Script to generate a static set of 100 questions across Bloom x Difficulty cells
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
const TOTAL_QUESTIONS = 100;

function getQuestionsForCell(cellIndex: number, totalCells: number): number {
  const basePerCell = Math.floor(TOTAL_QUESTIONS / totalCells);
  const remainder = TOTAL_QUESTIONS % totalCells;
  return basePerCell + (cellIndex < remainder ? 1 : 0);
}

async function main() {
  const runId = `static_${nowIso().replace(/[:.]/g, '-')}`;
  const model = DEFAULT_MODELS.questionGenerator;
  const calls: TimedCallRecord[] = [];
  const questions: Question[] = [];
  const seenIds = new Set<string>();
  const totalCells = BLOOM_LEVELS.length * DIFFICULTIES.length;

  console.log(`Generating ${TOTAL_QUESTIONS} questions...`);
  console.log(`Model: ${model}`);
  console.log(`Matrix: ${BLOOM_LEVELS.length} bloom levels × ${DIFFICULTIES.length} difficulties (${totalCells} cells total)`);
  console.log('');

  let cellIndex = 0;
  for (const bloomLevel of BLOOM_LEVELS) {
    for (const difficulty of DIFFICULTIES) {
      const count = getQuestionsForCell(cellIndex, totalCells);
      cellIndex++;

      console.log(`Generating bloom=${bloomLevel} difficulty=${difficulty}...`);
      
      const batch = await generateQuestionsBatch({
        calls,
        model,
        bloomLevel,
        difficulty,
        count,
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
    totalQuestionsTarget: TOTAL_QUESTIONS,
    questionsPerCellBase: Math.floor(TOTAL_QUESTIONS / totalCells),
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
