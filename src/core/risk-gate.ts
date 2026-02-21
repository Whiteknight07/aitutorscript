import { readFile } from 'node:fs/promises';

import { hrNowMs } from '../utils/util';
import type {
  Question,
  RiskGateDecision,
  RiskGateFailMode,
  RiskGateLogisticModelArtifact,
  RiskGateMode,
  RiskGatePolicy,
  RiskGateStats,
  StudentTurn,
  TranscriptMessage,
} from '../types';

const OPENAI_EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings';

export type RiskGateRuntimeConfig = {
  mode: RiskGateMode;
  failMode: RiskGateFailMode;
  policy: RiskGatePolicy;
  localEmbedUrl: string | null;
  openaiModel: string;
  openaiTimeoutMs: number;
};

export async function loadRiskGatePolicy(policyPath: string): Promise<RiskGatePolicy> {
  const raw = await readFile(policyPath, 'utf-8');
  const parsed = JSON.parse(raw) as unknown;
  const policy = parsePolicy(parsed);

  if (policy.local_low > policy.local_high) {
    throw new Error(
      `Invalid risk gate policy: local_low (${policy.local_low}) must be <= local_high (${policy.local_high}).`
    );
  }

  return policy;
}

export function buildRiskGateFeatureText({
  question,
  transcriptVisible,
  studentTurn,
  tutorDraft,
  maxChars,
}: {
  question: Question;
  transcriptVisible: TranscriptMessage[];
  studentTurn: StudentTurn;
  tutorDraft: string;
  maxChars?: number;
}): string {
  const transcriptText =
    transcriptVisible.length === 0
      ? '(empty)'
      : transcriptVisible.map((m, idx) => `${idx + 1}. ${m.role.toUpperCase()}: ${m.content}`).join('\n');
  const choicesText = question.choices.map((choice, idx) => `${idx}. ${choice}`).join('\n');

  const featureText = [
    `QUESTION_ID: ${question.id}`,
    `BLOOM_LEVEL: ${question.bloomLevel}`,
    `DIFFICULTY: ${question.difficulty}`,
    `TOPIC: ${question.topicTag}`,
    'PROBLEM:',
    question.problemStatement,
    'CHOICES:',
    choicesText,
    'REFERENCE_ANSWER_OUTLINE:',
    question.referenceAnswerDescription,
    'VISIBLE_TRANSCRIPT:',
    transcriptText,
    `LATEST_STUDENT_ATTACK_LEVEL: ${studentTurn.attackLevel}`,
    `LATEST_STUDENT_TACTIC: ${studentTurn.tactic}`,
    'LATEST_STUDENT_MESSAGE:',
    studentTurn.message,
    'TUTOR_DRAFT:',
    tutorDraft,
  ].join('\n');

  if (maxChars && maxChars > 0 && featureText.length > maxChars) {
    return featureText.slice(0, maxChars);
  }
  return featureText;
}

export async function evaluateRiskGateDecision({
  turnIndex,
  question,
  transcriptVisible,
  studentTurn,
  tutorDraft,
  config,
}: {
  turnIndex: number;
  question: Question;
  transcriptVisible: TranscriptMessage[];
  studentTurn: StudentTurn;
  tutorDraft: string;
  config: RiskGateRuntimeConfig;
}): Promise<RiskGateDecision> {
  const startedMs = hrNowMs();
  const featureText = buildRiskGateFeatureText({
    question,
    transcriptVisible,
    studentTurn,
    tutorDraft,
    maxChars: config.policy.max_feature_chars,
  });

  let localProbability: number | null = null;
  let openaiProbability: number | null = null;
  const failures: string[] = [];

  const finalize = (
    decision: RiskGateDecision['decision'],
    source: RiskGateDecision['source'],
    failureReason?: string
  ): RiskGateDecision => ({
    turnIndex,
    mode: config.mode,
    decision,
    source,
    localProbability,
    openaiProbability,
    latencyMs: Math.max(0, hrNowMs() - startedMs),
    ...(failureReason ? { failureReason } : {}),
  });

  if (config.mode === 'off') {
    return finalize('supervise', 'fail-mode');
  }

  const failDecision = config.failMode === 'closed' ? 'supervise' : 'skip';

  try {
    if (!config.localEmbedUrl) {
      throw new Error('Local embedding URL is not configured.');
    }

    const localEmbedding = await requestLocalEmbedding({
      url: config.localEmbedUrl,
      text: featureText,
      timeoutMs: config.openaiTimeoutMs,
    });
    localProbability = logisticScore(localEmbedding, config.policy.local_model);

    if (localProbability >= config.policy.local_high) {
      return finalize('supervise', 'local-high');
    }
    if (localProbability <= config.policy.local_low) {
      return finalize('skip', 'local-low');
    }

    try {
      openaiProbability = await scoreWithOpenAI({
        text: featureText,
        model: config.openaiModel,
        timeoutMs: config.openaiTimeoutMs,
        artifact: config.policy.openai_model ?? config.policy.local_model,
      });
      return finalize(openaiProbability >= config.policy.openai_threshold ? 'supervise' : 'skip', 'openai');
    } catch (err) {
      failures.push(`openai=${formatError(err)}`);
      return finalize(failDecision, 'fail-mode', failures.join(' | '));
    }
  } catch (localErr) {
    failures.push(`local=${formatError(localErr)}`);
    try {
      openaiProbability = await scoreWithOpenAI({
        text: featureText,
        model: config.openaiModel,
        timeoutMs: config.openaiTimeoutMs,
        artifact: config.policy.openai_model ?? config.policy.local_model,
      });
      return finalize(
        openaiProbability >= config.policy.openai_threshold ? 'supervise' : 'skip',
        'openai-fallback',
        failures.join(' | ')
      );
    } catch (openaiErr) {
      failures.push(`openai=${formatError(openaiErr)}`);
      return finalize(failDecision, 'fail-mode', failures.join(' | '));
    }
  }
}

export function summarizeRiskGateDecisions({
  decisions,
  mode,
}: {
  decisions: RiskGateDecision[];
  mode: RiskGateMode;
}): RiskGateStats {
  const stats: RiskGateStats = {
    evaluatedTurns: decisions.length,
    superviseCount: 0,
    skipCount: 0,
    enforcedSuperviseCount: 0,
    enforcedSkipCount: 0,
    localHighCount: 0,
    localLowCount: 0,
    openaiCount: 0,
    openaiFallbackCount: 0,
    failModeCount: 0,
    failureCount: 0,
  };

  for (const decision of decisions) {
    if (decision.decision === 'supervise') stats.superviseCount += 1;
    if (decision.decision === 'skip') stats.skipCount += 1;

    if (mode === 'enforce') {
      if (decision.decision === 'supervise') stats.enforcedSuperviseCount += 1;
      if (decision.decision === 'skip') stats.enforcedSkipCount += 1;
    }

    if (decision.source === 'local-high') stats.localHighCount += 1;
    if (decision.source === 'local-low') stats.localLowCount += 1;
    if (decision.source === 'openai') stats.openaiCount += 1;
    if (decision.source === 'openai-fallback') stats.openaiFallbackCount += 1;
    if (decision.source === 'fail-mode') stats.failModeCount += 1;
    if (decision.failureReason) stats.failureCount += 1;
  }

  return stats;
}

async function requestLocalEmbedding({
  url,
  text,
  timeoutMs,
}: {
  url: string;
  text: string;
  timeoutMs: number;
}): Promise<number[]> {
  const payload = await postJsonWithTimeout({
    url,
    headers: { 'Content-Type': 'application/json' },
    body: { input: text, text },
    timeoutMs,
  });
  return extractEmbedding(payload);
}

async function scoreWithOpenAI({
  text,
  model,
  timeoutMs,
  artifact,
}: {
  text: string;
  model: string;
  timeoutMs: number;
  artifact: RiskGateLogisticModelArtifact;
}): Promise<number> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set.');

  const payload = await postJsonWithTimeout({
    url: OPENAI_EMBEDDINGS_URL,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: {
      model,
      input: text,
    },
    timeoutMs,
  });

  const embedding = extractEmbedding(payload);
  return logisticScore(embedding, artifact);
}

async function postJsonWithTimeout({
  url,
  headers,
  body,
  timeoutMs,
}: {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  timeoutMs: number;
}): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status} ${response.statusText}: ${truncateForError(JSON.stringify(payload ?? {}), 400)}`
      );
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function extractEmbedding(value: unknown): number[] {
  if (Array.isArray(value)) return validateEmbedding(value, 'embedding');
  const obj = toRecord(value, 'embedding response');

  const direct = obj['embedding'];
  if (Array.isArray(direct)) return validateEmbedding(direct, 'embedding');

  const data = obj['data'];
  if (Array.isArray(data) && data.length > 0) {
    const first = toRecord(data[0], 'embedding data[0]');
    if (Array.isArray(first['embedding'])) return validateEmbedding(first['embedding'], 'data[0].embedding');
  }

  throw new Error('Embedding response did not include an embedding array.');
}

function validateEmbedding(value: unknown[], label: string): number[] {
  if (value.length === 0) throw new Error(`Invalid ${label}: empty array.`);
  return value.map((n, idx) => {
    if (typeof n !== 'number' || !Number.isFinite(n)) {
      throw new Error(`Invalid ${label} at index ${idx}: expected finite number.`);
    }
    return n;
  });
}

function logisticScore(embedding: number[], artifact: RiskGateLogisticModelArtifact): number {
  if (embedding.length !== artifact.coefficients.length) {
    throw new Error(
      `Embedding dimension mismatch: got ${embedding.length}, expected ${artifact.coefficients.length}.`
    );
  }

  let linear = artifact.intercept;
  for (let i = 0; i < embedding.length; i++) {
    linear += artifact.coefficients[i] * embedding[i];
  }

  const clamped = Math.max(-60, Math.min(60, linear));
  return 1 / (1 + Math.exp(-clamped));
}

function parsePolicy(value: unknown): RiskGatePolicy {
  const obj = toRecord(value, 'risk gate policy');

  const local_low = parseProbability(obj['local_low'], 'local_low');
  const local_high = parseProbability(obj['local_high'], 'local_high');
  const openai_threshold = parseProbability(obj['openai_threshold'], 'openai_threshold');

  const localModelRaw =
    obj['local_model'] ?? obj['localModel'] ?? obj['model'] ?? obj['classifier'];
  if (localModelRaw == null) {
    throw new Error('Risk gate policy is missing local_model.');
  }
  const local_model = parseLogisticArtifact(localModelRaw, 'local_model');

  const openaiModelRaw = obj['openai_model'] ?? obj['openaiModel'];
  const openai_model = openaiModelRaw == null ? undefined : parseLogisticArtifact(openaiModelRaw, 'openai_model');

  const max_feature_chars =
    obj['max_feature_chars'] == null ? undefined : parsePositiveInt(obj['max_feature_chars'], 'max_feature_chars');

  return {
    local_low,
    local_high,
    openai_threshold,
    local_model,
    ...(openai_model ? { openai_model } : {}),
    ...(max_feature_chars ? { max_feature_chars } : {}),
  };
}

function parseLogisticArtifact(value: unknown, label: string): RiskGateLogisticModelArtifact {
  const obj = toRecord(value, label);
  const interceptRaw = obj['intercept'] ?? obj['bias'];
  const coefficientsRaw = obj['coefficients'] ?? obj['weights'];
  if (interceptRaw == null) throw new Error(`Risk gate ${label} is missing intercept.`);
  if (!Array.isArray(coefficientsRaw)) throw new Error(`Risk gate ${label} is missing coefficients array.`);

  const intercept = parseFiniteNumber(interceptRaw, `${label}.intercept`);
  const coefficients = coefficientsRaw.map((v, idx) => parseFiniteNumber(v, `${label}.coefficients[${idx}]`));

  if (coefficients.length === 0) {
    throw new Error(`Risk gate ${label}.coefficients cannot be empty.`);
  }

  return {
    intercept,
    coefficients,
  };
}

function parseProbability(value: unknown, label: string): number {
  const parsed = parseFiniteNumber(value, label);
  if (parsed < 0 || parsed > 1) {
    throw new Error(`Risk gate ${label} must be between 0 and 1. Received: ${parsed}`);
  }
  return parsed;
}

function parsePositiveInt(value: unknown, label: string): number {
  const parsed = parseFiniteNumber(value, label);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Risk gate ${label} must be a positive integer. Received: ${parsed}`);
  }
  return parsed;
}

function parseFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Risk gate ${label} must be a finite number.`);
  }
  return value;
}

function toRecord(value: unknown, label: string): Record<string, unknown> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Expected ${label} to be an object.`);
  }
  return value as Record<string, unknown>;
}

function truncateForError(input: string, maxChars: number): string {
  if (input.length <= maxChars) return input;
  return `${input.slice(0, maxChars)}...`;
}

function formatError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
