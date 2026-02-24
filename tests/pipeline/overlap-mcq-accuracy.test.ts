import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  runOverlapMcqAccuracy,
  selectOverlapMcqQuestions,
  type McqAccuracyAttemptResult,
} from '../../src/core/mcq-accuracy';
import type { Question } from '../../src/types';

function parseJsonl(content: string): Record<string, unknown>[] {
  return content
    .trim()
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function buildCsbenchMcq({
  id,
  choices,
  correctChoiceIndex,
}: {
  id: string;
  choices: string[];
  correctChoiceIndex: number;
}): Question {
  return {
    dataset: 'csbench',
    source: 'csbench',
    id,
    csbenchFormat: 'multiple-choice',
    questionFormat: 'multiple-choice',
    topicTag: 'test-topic',
    problemStatement: `Question ${id}?`,
    referenceAnswerDescription: 'Reference',
    choices,
    correctChoiceIndex,
    domain: 'domain',
    subDomain: 'subdomain',
    tag: 'tag',
    csbench: {
      id,
      split: 'test',
      domain: 'domain',
      subDomain: 'subdomain',
      tag: 'tag',
      language: 'en',
      answer: String(correctChoiceIndex + 1),
    },
  } as Question;
}

function buildPairwiseMcq({
  id,
  choices,
  correctChoiceIndex,
}: {
  id: string;
  choices: string[];
  correctChoiceIndex: number;
}): Question {
  return {
    dataset: 'pairwise',
    source: 'pairwise',
    id,
    questionFormat: 'multiple-choice',
    topicTag: 'pairwise-topic',
    problemStatement: `Pairwise ${id}?`,
    referenceAnswerDescription: 'Reference',
    choices,
    correctChoiceIndex,
    metadata: {
      tags: ['tag'],
      source: {
        splitId: 'split',
        questionsFile: 'Questions_x.csv',
        answersFile: null,
        questionsRow: 2,
      },
    },
  } as Question;
}

test('selectOverlapMcqQuestions keeps only MCQ rows with valid answer key and includes 5-choice items', () => {
  const validCsbench = buildCsbenchMcq({
    id: 'csbench-1',
    choices: ['A1', 'B1', 'C1', 'D1'],
    correctChoiceIndex: 2,
  });

  const validPairwiseFiveChoices = buildPairwiseMcq({
    id: 'pairwise-1',
    choices: ['A2', 'B2', 'C2', 'D2', 'E2'],
    correctChoiceIndex: 4,
  });

  const nonMcq = {
    ...buildCsbenchMcq({
      id: 'assertion-1',
      choices: ['True', 'False'],
      correctChoiceIndex: 0,
    }),
    questionFormat: 'assertion',
    csbenchFormat: 'assertion',
  } as Question;

  const invalidKey = {
    ...buildPairwiseMcq({
      id: 'pairwise-invalid',
      choices: ['A', 'B', 'C', 'D'],
      correctChoiceIndex: 1,
    }),
    correctChoiceIndex: 99,
  } as Question;

  const selected = selectOverlapMcqQuestions([
    validCsbench,
    validPairwiseFiveChoices,
    nonMcq,
    invalidKey,
  ]);

  assert.equal(selected.length, 2);

  const pairwise = selected.find((item) => item.question.id === 'pairwise-1');
  assert.ok(pairwise);
  assert.equal(pairwise.source, 'pairwise');
  assert.deepEqual(pairwise.allowedLetters, ['A', 'B', 'C', 'D', 'E']);
  assert.equal(pairwise.expectedLetter, 'E');
});

test('runOverlapMcqAccuracy retries invalid output and then logs valid prediction', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'mcq-accuracy-test-'));

  try {
    const question = buildPairwiseMcq({
      id: 'q-retry-success',
      choices: ['One', 'Two', 'Three', 'Four'],
      correctChoiceIndex: 1,
    });

    const attempts: McqAccuracyAttemptResult[] = [
      {
        rawLetter: 'Z',
        latencyMs: 11,
        finishReason: 'stop',
        usage: { inputTokens: 10, outputTokens: 1, totalTokens: 11 },
        errorType: null,
        errorMessage: null,
      },
      {
        rawLetter: 'b',
        latencyMs: 9,
        finishReason: 'stop',
        usage: { inputTokens: 12, outputTokens: 1, totalTokens: 13 },
        errorType: null,
        errorMessage: null,
      },
    ];

    let callCount = 0;

    const summary = await runOverlapMcqAccuracy({
      overlapPath: 'unused.json',
      outDir: tempDir,
      outFile: 'results.jsonl',
      questionLimit: null,
      parallel: 1,
      retryInvalid: 2,
      models: ['openai/gpt-5.1'],
      questions: [question],
      attemptFn: async () => {
        const out = attempts[Math.min(callCount, attempts.length - 1)];
        callCount += 1;
        return out;
      },
    });

    assert.equal(callCount, 2);
    assert.equal(summary.totalRecords, 1);
    assert.equal(summary.invalidRecords, 0);

    const raw = await readFile(join(tempDir, 'results.jsonl'), 'utf8');
    const rows = parseJsonl(raw);
    assert.equal(rows.length, 1);

    const row = rows[0];
    assert.equal(row.source, 'pairwise');
    assert.equal(row.predicted, 'B');
    assert.equal(row.expected, 'B');
    assert.equal(row.correct, true);
    assert.equal(row.attempts_used, 2);
    assert.equal(row.invalid_reason, null);
    assert.equal(row.token_input, 12);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('runOverlapMcqAccuracy logs invalid record after retries are exhausted', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'mcq-accuracy-test-'));

  try {
    const question = buildCsbenchMcq({
      id: 'q-retry-fail',
      choices: ['A', 'B', 'C', 'D'],
      correctChoiceIndex: 0,
    });

    let callCount = 0;

    const summary = await runOverlapMcqAccuracy({
      overlapPath: 'unused.json',
      outDir: tempDir,
      outFile: 'results.jsonl',
      questionLimit: null,
      parallel: 1,
      retryInvalid: 2,
      models: ['openai/gpt-5.1', 'google/gemini-3-flash-preview'],
      questions: [question],
      attemptFn: async ({ userPrompt }) => {
        callCount += 1;
        assert.match(userPrompt, /Return ONLY one letter: A, B, C, or D\. No explanation\./);

        return {
          rawLetter: null,
          latencyMs: 5,
          finishReason: null,
          usage: null,
          errorType: 'ParseError',
          errorMessage: 'No letter found',
        };
      },
    });

    assert.equal(callCount, 6);
    assert.equal(summary.totalRecords, 2);
    assert.equal(summary.invalidRecords, 2);

    const raw = await readFile(join(tempDir, 'results.jsonl'), 'utf8');
    const rows = parseJsonl(raw);
    assert.equal(rows.length, 2);

    for (const row of rows) {
      assert.equal(row.predicted, null);
      assert.equal(row.correct, false);
      assert.equal(row.attempts_used, 3);
      assert.equal(row.invalid_reason, 'missing_prediction');
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
