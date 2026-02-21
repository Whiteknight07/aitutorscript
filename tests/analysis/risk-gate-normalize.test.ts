import assert from 'node:assert/strict';
import test from 'node:test';

import type { RunRecord } from '../../src/types';
import { extractRiskGateRunSummary } from '../../src/output/analysis/normalize';

function makeRunRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  const base = {
    runId: 'run_test',
    createdAtIso: '2026-02-20T00:00:00.000Z',
    versions: { node: 'v22.0.0', ai: '5.0.0' },
    config: {},
    question: { id: 'q-b1-easy-1', dataset: 'default', bloomLevel: 1, difficulty: 'easy', prompt: 'stub' },
    pairingId: 'gpt-gemini',
    condition: 'dual-loop',
    turnsRequested: 2,
    maxIters: 2,
    turnsCompleted: 2,
    loopIterationsTotal: null,
    loopTurnIterations: null,
    transcriptVisible: [],
    hiddenTrace: {
      studentTurns: [],
      tutorDrafts: [],
      supervisorVerdicts: [],
      riskGateDecisions: [],
    },
    calls: [],
    totalLatencyMs: 0,
    judge: null,
  };

  return {
    ...base,
    ...overrides,
    hiddenTrace: {
      ...base.hiddenTrace,
      ...(overrides.hiddenTrace ?? {}),
    },
  } as RunRecord;
}

test('extractRiskGateRunSummary derives labels from loopTurnIterations by turnIndex', () => {
  const summary = extractRiskGateRunSummary(
    makeRunRecord({
      loopTurnIterations: [
        { turnIndex: 1, iterationsUsed: 2, initiallyRejected: true, rationale: 'loop label: supervise' },
        { turnIndex: 2, iterationsUsed: 1, initiallyRejected: false, rationale: 'loop label: skip' },
      ],
      hiddenTrace: {
        riskGateDecisions: [
          { turnIndex: 1, decision: 'supervise' },
          { turnIndex: 2, decision: 'skip' },
        ],
      },
    })
  );

  assert.ok(summary);
  assert.equal(summary.truePositive, 1);
  assert.equal(summary.trueNegative, 1);
  assert.equal(summary.falsePositive, 0);
  assert.equal(summary.falseNegative, 0);
  assert.equal(summary.labeledDecisions, 2);
  assert.deepEqual(
    summary.decisions.map((d) => ({ turnIndex: d.turnIndex, labelShouldSupervise: d.labelShouldSupervise })),
    [
      { turnIndex: 1, labelShouldSupervise: true },
      { turnIndex: 2, labelShouldSupervise: false },
    ]
  );
});

test('extractRiskGateRunSummary excludes labelObserved=false rows from confusion counts', () => {
  const summary = extractRiskGateRunSummary(
    makeRunRecord({
      loopTurnIterations: [
        { turnIndex: 1, iterationsUsed: 2, initiallyRejected: true, rationale: 'would be supervise' },
        { turnIndex: 2, iterationsUsed: 1, initiallyRejected: false, rationale: 'skip' },
      ],
      hiddenTrace: {
        riskGateDecisions: [
          { turnIndex: 1, decision: 'supervise', labelObserved: false },
          { turnIndex: 2, decision: 'skip' },
        ],
      },
    })
  );

  assert.ok(summary);
  assert.equal(summary.truePositive, 0);
  assert.equal(summary.falsePositive, 0);
  assert.equal(summary.trueNegative, 1);
  assert.equal(summary.falseNegative, 0);
  assert.equal(summary.labeledDecisions, 1);
  assert.deepEqual(summary.decisions.map((d) => d.labelShouldSupervise), [null, false]);
});

test('extractRiskGateRunSummary is backward-compatible when loop labels are missing', () => {
  const record = makeRunRecord({
    loopTurnIterations: null,
    hiddenTrace: {
      riskGateDecisions: [
        { turnIndex: 1, decision: 'skip' },
        { turnIndex: 2, decision: 'supervise' },
      ],
    },
  });

  assert.doesNotThrow(() => extractRiskGateRunSummary(record));
  const summary = extractRiskGateRunSummary(record);

  assert.ok(summary);
  assert.equal(summary.turnsEvaluated, 2);
  assert.equal(summary.superviseDecisions, 1);
  assert.equal(summary.skipDecisions, 1);
  assert.equal(summary.labeledDecisions, 0);
  assert.equal(summary.truePositive, 0);
  assert.equal(summary.falsePositive, 0);
  assert.equal(summary.trueNegative, 0);
  assert.equal(summary.falseNegative, 0);
  assert.equal(summary.recall, null);
  assert.equal(summary.precision, null);
  assert.equal(summary.fnr, null);
  assert.deepEqual(summary.decisions.map((d) => d.labelShouldSupervise), [null, null]);
});
