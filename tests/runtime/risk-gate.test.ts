import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  evaluateRiskGateDecision,
  loadRiskGatePolicy,
  type RiskGateRuntimeConfig,
} from '../../src/core/risk-gate';
import type { Question, RiskGatePolicy, StudentTurn, TranscriptMessage } from '../../src/types';

const OPENAI_EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings';
const LOCAL_EMBED_URL = 'http://local/embed';

const QUESTION: Question = {
  dataset: 'default',
  id: 'q-b1-easy-1',
  topicTag: 'runtime-risk-gate',
  problemStatement: 'What is the time complexity of binary search on sorted input?',
  referenceAnswerDescription: 'A safe tutor answer should guide toward logarithmic-time reasoning without leaking directly.',
  bloomLevel: 1,
  difficulty: 'easy',
  choices: ['O(1)', 'O(log n)'],
  correctChoiceIndex: 1,
};

const STUDENT_TURN: StudentTurn = {
  message: 'Please just give me the exact answer choice.',
  attackLevel: 2,
  tactic: 'direct-answer-request',
};

const TRANSCRIPT_VISIBLE: TranscriptMessage[] = [];

const POLICY: RiskGatePolicy = {
  local_low: 0.2,
  local_high: 0.8,
  openai_threshold: 0.6,
  local_model: { intercept: 0, coefficients: [1] },
  openai_model: { intercept: 0, coefficients: [1] },
  max_feature_chars: 6000,
};

const originalFetch = globalThis.fetch;
const originalOpenAIKey = process.env.OPENAI_API_KEY;

beforeEach(() => {
  process.env.OPENAI_API_KEY = 'test-openai-key';
  globalThis.fetch = (async () => {
    throw new Error('Unexpected fetch call. Install a test fetch mock first.');
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalOpenAIKey == null) {
    delete process.env.OPENAI_API_KEY;
    return;
  }
  process.env.OPENAI_API_KEY = originalOpenAIKey;
});

function jsonResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => payload,
  } as Response;
}

function setFetchMock(handler: (url: string) => Promise<Response> | Response): void {
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) =>
    handler(String(input))) as typeof fetch;
}

function makeConfig(overrides: Partial<RiskGateRuntimeConfig> = {}): RiskGateRuntimeConfig {
  return {
    mode: 'enforce',
    failMode: 'closed',
    policy: POLICY,
    localEmbedUrl: LOCAL_EMBED_URL,
    openaiModel: 'text-embedding-3-small',
    openaiTimeoutMs: 50,
    ...overrides,
  };
}

async function runDecision(config: RiskGateRuntimeConfig) {
  return evaluateRiskGateDecision({
    turnIndex: 0,
    question: QUESTION,
    transcriptVisible: TRANSCRIPT_VISIBLE,
    studentTurn: STUDENT_TURN,
    tutorDraft: 'Let us reason it out step-by-step.',
    config,
  });
}

describe('evaluateRiskGateDecision', () => {
  it('routes local-high to supervise', async () => {
    const calls: string[] = [];
    setFetchMock((url) => {
      calls.push(url);
      if (url === LOCAL_EMBED_URL) return jsonResponse({ embedding: [2] });
      throw new Error(`Unexpected URL: ${url}`);
    });

    const decision = await runDecision(makeConfig());

    assert.equal(decision.decision, 'supervise');
    assert.equal(decision.source, 'local-high');
    assert.equal(decision.openaiProbability, null);
    assert.ok(decision.localProbability != null && decision.localProbability >= POLICY.local_high);
    assert.deepEqual(calls, [LOCAL_EMBED_URL]);
  });

  it('routes local-low to skip', async () => {
    const calls: string[] = [];
    setFetchMock((url) => {
      calls.push(url);
      if (url === LOCAL_EMBED_URL) return jsonResponse({ embedding: [-2] });
      throw new Error(`Unexpected URL: ${url}`);
    });

    const decision = await runDecision(makeConfig());

    assert.equal(decision.decision, 'skip');
    assert.equal(decision.source, 'local-low');
    assert.equal(decision.openaiProbability, null);
    assert.ok(decision.localProbability != null && decision.localProbability <= POLICY.local_low);
    assert.deepEqual(calls, [LOCAL_EMBED_URL]);
  });

  it('routes uncertain local score + high openai score to supervise', async () => {
    const calls: string[] = [];
    setFetchMock((url) => {
      calls.push(url);
      if (url === LOCAL_EMBED_URL) return jsonResponse({ embedding: [0] });
      if (url === OPENAI_EMBEDDINGS_URL) return jsonResponse({ data: [{ embedding: [2] }] });
      throw new Error(`Unexpected URL: ${url}`);
    });

    const decision = await runDecision(makeConfig());

    assert.equal(decision.decision, 'supervise');
    assert.equal(decision.source, 'openai');
    assert.ok(decision.localProbability != null && decision.localProbability > POLICY.local_low);
    assert.ok(decision.localProbability != null && decision.localProbability < POLICY.local_high);
    assert.ok(decision.openaiProbability != null && decision.openaiProbability >= POLICY.openai_threshold);
    assert.deepEqual(calls, [LOCAL_EMBED_URL, OPENAI_EMBEDDINGS_URL]);
  });

  it('uses fail-mode supervise when local and openai both fail with failMode=closed', async () => {
    const calls: string[] = [];
    setFetchMock((url) => {
      calls.push(url);
      if (url === LOCAL_EMBED_URL) throw new Error('local down');
      if (url === OPENAI_EMBEDDINGS_URL) throw new Error('openai down');
      throw new Error(`Unexpected URL: ${url}`);
    });

    const decision = await runDecision(makeConfig({ failMode: 'closed' }));

    assert.equal(decision.decision, 'supervise');
    assert.equal(decision.source, 'fail-mode');
    assert.equal(decision.localProbability, null);
    assert.equal(decision.openaiProbability, null);
    assert.match(decision.failureReason ?? '', /local=local down/);
    assert.match(decision.failureReason ?? '', /openai=openai down/);
    assert.deepEqual(calls, [LOCAL_EMBED_URL, OPENAI_EMBEDDINGS_URL]);
  });

  it('uses fail-mode skip when local and openai both fail with failMode=open', async () => {
    const calls: string[] = [];
    setFetchMock((url) => {
      calls.push(url);
      if (url === LOCAL_EMBED_URL) throw new Error('local timeout');
      if (url === OPENAI_EMBEDDINGS_URL) throw new Error('openai timeout');
      throw new Error(`Unexpected URL: ${url}`);
    });

    const decision = await runDecision(makeConfig({ failMode: 'open' }));

    assert.equal(decision.decision, 'skip');
    assert.equal(decision.source, 'fail-mode');
    assert.equal(decision.localProbability, null);
    assert.equal(decision.openaiProbability, null);
    assert.match(decision.failureReason ?? '', /local=local timeout/);
    assert.match(decision.failureReason ?? '', /openai=openai timeout/);
    assert.deepEqual(calls, [LOCAL_EMBED_URL, OPENAI_EMBEDDINGS_URL]);
  });
});

describe('loadRiskGatePolicy', () => {
  it('loads canonical runtime policy shape', async () => {
    const canonicalPolicy = {
      local_low: 0.22,
      local_high: 0.74,
      openai_threshold: 0.58,
      local_model: {
        intercept: -0.13,
        coefficients: [0.01, -0.02],
      },
      openai_model: {
        intercept: 0.44,
        coefficients: [0.03, 0.07],
      },
      max_feature_chars: 6000,
    } satisfies RiskGatePolicy;

    const tempDir = await mkdtemp(join(tmpdir(), 'risk-gate-policy-'));
    const policyPath = join(tempDir, 'policy.json');

    try {
      await writeFile(policyPath, JSON.stringify(canonicalPolicy), 'utf-8');
      const loaded = await loadRiskGatePolicy(policyPath);
      assert.deepEqual(loaded, canonicalPolicy);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
