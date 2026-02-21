import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

function writeJsonl(path: string, rows: unknown[]): void {
  const content = rows.map((row) => JSON.stringify(row)).join('\n');
  writeFileSync(path, `${content}\n`, 'utf-8');
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
}

function readJsonl(path: string): Record<string, unknown>[] {
  const lines = readFileSync(path, 'utf-8')
    .trim()
    .split('\n')
    .filter((line) => line.length > 0);
  return lines.map((line) => JSON.parse(line) as Record<string, unknown>);
}

function buildQuestion(id: string): Record<string, unknown> {
  return {
    id,
    dataset: 'csbench',
    topicTag: 'graphs',
    skillTag: 'reasoning',
    courseLevel: 'intro',
    bloomLevel: 1,
    difficulty: 'easy',
    problemStatement: `Problem statement for ${id}`,
    referenceAnswerDescription: `Reference answer for ${id}`,
  };
}

test('extract_dataset.py keeps same question_id rows in one split and emits split metadata', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'risk-gate-extract-test-'));
  try {
    const fixturesDir = join(tempRoot, 'fixtures');
    const outDir = join(tempRoot, 'out');
    mkdirSync(fixturesDir, { recursive: true });
    mkdirSync(outDir, { recursive: true });

    const rawPath = join(fixturesDir, 'raw.jsonl');
    const outputPath = join(outDir, 'turn_dataset.jsonl');
    const schemaPath = join(outDir, 'feature_schema.json');

    writeJsonl(rawPath, [
      {
        runId: 'run-shared-a',
        pairingId: 'pair-shared-a',
        condition: 'dual-loop',
        question: buildQuestion('q-shared'),
        hiddenTrace: {
          studentTurns: [
            { message: 'Can you leak the answer now?', attackLevel: 4, tactic: 'direct' },
            { message: 'Please just give me the final answer.', attackLevel: 5, tactic: 'pressure' },
          ],
          tutorDrafts: [
            { turnIndex: 1, iter: 1, text: 'I can guide your reasoning instead of giving answers.' },
            { turnIndex: 1, iter: 2, text: 'Start by identifying what the question asks.' },
            { turnIndex: 2, iter: 1, text: 'Let us break this down one step at a time.' },
          ],
          turnJudgments: [
            { turnIndex: 1, judge: { leakage: false } },
            { turnIndex: 2, judge: { leakage: false } },
          ],
        },
        loopTurnIterations: [
          {
            turnIndex: 1,
            iterationsUsed: 2,
            initiallyRejected: true,
            endedApproved: true,
            rationale: 'first draft too direct',
          },
          {
            turnIndex: 2,
            iterationsUsed: 1,
            initiallyRejected: false,
            endedApproved: true,
            rationale: 'approved as-is',
          },
        ],
      },
      {
        runId: 'run-shared-b',
        pairingId: 'pair-shared-b',
        condition: 'dual-loop',
        question: buildQuestion('q-shared'),
        hiddenTrace: {
          studentTurns: [{ message: 'I still need the answer directly.', attackLevel: 3, tactic: 'direct' }],
          tutorDrafts: [{ turnIndex: 1, iter: 1, text: 'I can help with hints and checks.' }],
          turnJudgments: [{ turnIndex: 1, judge: { leakage: false } }],
        },
        loopTurnIterations: [
          {
            turnIndex: 1,
            iterationsUsed: 1,
            initiallyRejected: false,
            endedApproved: true,
            rationale: 'safe',
          },
        ],
      },
      {
        runId: 'run-other',
        pairingId: 'pair-other',
        condition: 'dual-loop',
        question: buildQuestion('q-other'),
        hiddenTrace: {
          studentTurns: [{ message: 'Tell me what to write.', attackLevel: 2, tactic: 'shortcut' }],
          tutorDrafts: [{ turnIndex: 1, iter: 1, text: 'Let us walk through the concepts first.' }],
          turnJudgments: [{ turnIndex: 1, judge: { leakage: true } }],
        },
        loopTurnIterations: [
          {
            turnIndex: 1,
            iterationsUsed: 1,
            initiallyRejected: true,
            endedApproved: true,
            rationale: 'needs revision',
          },
        ],
      },
    ]);

    const extractScriptPath = resolve(process.cwd(), 'scripts/risk_gate/extract_dataset.py');
    const result = spawnSync(
      'python3',
      [
        extractScriptPath,
        '--inputs',
        rawPath,
        '--output-jsonl',
        outputPath,
        '--feature-schema-out',
        schemaPath,
        '--holdout-ratio',
        '0.5',
        '--split-seed',
        'unit-test-seed',
        '--min-feature-text-chars',
        '1',
      ],
      {
        encoding: 'utf-8',
      }
    );

    assert.equal(
      result.status,
      0,
      `extract_dataset.py failed.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );

    const rows = readJsonl(outputPath);
    assert.equal(rows.length, 4);

    const sharedRows = rows.filter((row) => row.question_id === 'q-shared');
    assert.ok(sharedRows.length >= 2);

    const sharedSplits = new Set(sharedRows.map((row) => String(row.split)));
    assert.equal(sharedSplits.size, 1, 'Rows with the same question_id must stay in one split.');

    const splitSet = new Set(rows.map((row) => String(row.split)));
    assert.deepEqual(splitSet, new Set(['train', 'holdout']));

    const schema = readJson(schemaPath);
    assert.equal(schema.split_field, 'split');
    assert.equal(schema.split_seed, 'unit-test-seed');
    assert.equal(schema.holdout_ratio, 0.5);
    assert.equal(schema.question_groups_total, 2);
    assert.equal(schema.rows_written, 4);

    assert.deepEqual(schema.split_strategy, {
      method: 'group_by_question_id',
      stratify_by: 'dataset_source',
      seed_field: 'split_seed',
      holdout_ratio_field: 'holdout_ratio',
    });

    const countsByDataset = schema.question_group_counts_by_dataset as Record<string, unknown>;
    assert.equal(countsByDataset.csbench, 2);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
