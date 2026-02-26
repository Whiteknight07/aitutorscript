import { createReadStream } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';

import { labelQuestionBroadConcept, type BroadConcept } from '../core/topic-normalization';

type JsonObject = Record<string, unknown>;

type QuestionRecord = JsonObject & {
  id?: string;
  source?: string;
  dataset?: string;
  questionFormat?: string;
  csbenchFormat?: string;
  domain?: string;
  subDomain?: string;
  tag?: string;
  topicTag?: string;
  problemStatement?: string;
  choices?: unknown[];
  correctChoiceIndex?: number;
};

type AccuracyRecord = {
  question_id: string;
  model_id: string;
  source?: string;
  correct?: boolean;
};

type RunMetadata = {
  runId: string;
  createdAtIso: string | null;
  recordCount: number;
  uniqueQuestionIds: Set<string>;
  sourceCounts: Map<string, number>;
  formatCounts: Map<string, number>;
  tutorModelCounts: Map<string, number>;
  supervisorModelCounts: Map<string, number>;
  judgeModelCounts: Map<string, number>;
  attackerModelCounts: Map<string, number>;
  providerLabelCounts: Map<string, number>;
  maxTurns: number;
  maxObservedAttackLevel: number;
};

type GroupDescriptor = {
  pairingId: string;
  condition: string;
  source: string;
  format: string;
  tutorModelId: string;
  supervisorModelId: string;
  providerLabel: string;
};

type Role = 'attacker' | 'tutor' | 'supervisor' | 'judge';
type LeakType =
  | 'option selection'
  | 'option elimination'
  | 'final numeric/unique result'
  | 'paraphrase-equivalent answer'
  | 'other';

type TempTurnMetrics = {
  visibleLatencyMs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  totalCalls: number;
  roleCallCounts: Record<Role, number>;
};

type DualLoopMetrics = {
  turnCount: number;
  initiallyRejectedCount: number;
  iterationCounts: Map<number, number>;
  iterationValues: number[];
  fallbackCount: number;
  rejectedApprovedSafe: number;
  rejectedApprovedLeaked: number;
  rejectedFallback: number;
  rejectByTurn: Map<number, { total: number; rejected: number }>;
};

type GroupMetrics = {
  descriptor: GroupDescriptor;
  totalConversations: number;
  nonLeakingConversations: number;
  leakageCount: number;
  complianceCount: number;
  hallucinationCount: number;
  firstLeakTurns: number[];
  leakCountsByTurn: Map<number, number>;
  maxTurns: number;
  conversationLatencyMs: number[];
  turnLatencyMs: number[];
  callLatencyMsByRole: Record<Role, number[]>;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  conversationTokenTotals: number[];
  turnTokenTotals: number[];
  conversationInputTotals: number[];
  conversationOutputTotals: number[];
  turnInputTotals: number[];
  turnOutputTotals: number[];
  totalCalls: number;
  totalCallsByRole: Record<Role, number>;
  turnCallCounts: number[];
  turnCallCountsByRole: Record<Role, number[]>;
  totalObservedCost: number;
  callsWithObservedCost: number;
  totalCallRecords: number;
  dualLoop: DualLoopMetrics | null;
};

type ControlledLeakageMetrics = {
  pairingId: string;
  condition: string;
  tutorModelId: string;
  source: string;
  closedBookCorrect: boolean;
  total: number;
  leaked: number;
};

type ConceptLeakageMetrics = {
  pairingId: string;
  condition: string;
  source: string;
  concept: BroadConcept;
  total: number;
  leaked: number;
};

type AccuracyMetrics = {
  modelId: string;
  source: string;
  total: number;
  correct: number;
};

type AccuracyConceptMetrics = {
  modelId: string;
  source: string;
  concept: BroadConcept;
  total: number;
  correct: number;
};

type FileSelection = {
  rawPath: string;
  accuracyPath: string;
  outPath: string;
};

const ROLE_KEYS: Role[] = ['attacker', 'tutor', 'supervisor', 'judge'];
const CONCEPT_FOCUS: BroadConcept[] = ['data-structures', 'algorithms-complexity', 'systems-os'];
const SOURCE_ORDER = ['csbench', 'pairwise'];
const CONDITION_ORDER = ['single', 'dual-loop'];
const PAIRING_ORDER = ['gpt-single', 'gemini-single', 'gpt-gpt', 'gemini-gemini', 'gpt-gemini', 'gemini-gpt'];
const ATTACKER_PROTOCOL_LABEL = 'not explicitly versioned; observed 6-level escalating student attacks';

function usage(): never {
  console.error(
    'Usage: node --import tsx src/scripts/export-publication-metrics.ts [--raw path/to/raw.jsonl] [--accuracy path/to/mcq_accuracy.jsonl] [--out path/to/report.md]'
  );
  process.exit(2);
}

function asObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as JsonObject;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function asNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function asBoolean(value: unknown): boolean | null {
  if (value === true || value === false) return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
    if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  }
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  return null;
}

function normalizeSource(source: string | null): string {
  const normalized = String(source ?? 'unknown').trim().toLowerCase();
  if (normalized === 'peerwise') return 'pairwise';
  return normalized || 'unknown';
}

function labelSource(source: string): string {
  if (source === 'csbench') return 'CSBench';
  if (source === 'pairwise') return 'PeerWise';
  return source;
}

function normalizeFormat(format: string | null): string {
  return String(format ?? 'unknown').trim().toLowerCase() || 'unknown';
}

function providerFromModelId(modelId: string | null): string {
  const value = String(modelId ?? 'none').trim();
  if (!value || value === 'none') return 'none';
  const slashIndex = value.indexOf('/');
  return slashIndex >= 0 ? value.slice(0, slashIndex) : value;
}

function providerLabelForModels(tutorModelId: string, supervisorModelId: string): string {
  if (supervisorModelId === 'none') return 'single/no-supervisor';
  return providerFromModelId(tutorModelId) === providerFromModelId(supervisorModelId)
    ? 'same-provider'
    : 'cross-provider';
}

function getOrCreate<K, V>(map: Map<K, V>, key: K, factory: () => V): V {
  const existing = map.get(key);
  if (existing) return existing;
  const value = factory();
  map.set(key, value);
  return value;
}

function incrementCount(map: Map<string, number>, key: string, increment = 1) {
  map.set(key, (map.get(key) ?? 0) + increment);
}

function incrementNumberKey(map: Map<number, number>, key: number, increment = 1) {
  map.set(key, (map.get(key) ?? 0) + increment);
}

function incrementLeakTypeCount(map: Map<LeakType, number>, key: LeakType, increment = 1) {
  map.set(key, (map.get(key) ?? 0) + increment);
}

function sortNumeric(values: number[]): number[] {
  return [...values].sort((a, b) => a - b);
}

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number | null {
  return percentile(sortNumeric(values), 0.5);
}

function describeNumeric(values: number[]) {
  if (!values.length) {
    return {
      count: 0,
      mean: null,
      median: null,
      p90: null,
      p95: null,
      min: null,
      max: null,
    };
  }

  const sorted = sortNumeric(values);
  return {
    count: values.length,
    mean: mean(values),
    median: percentile(sorted, 0.5),
    p90: percentile(sorted, 0.9),
    p95: percentile(sorted, 0.95),
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

function formatNumber(value: number | null, digits = 2): string {
  if (value == null) return 'NA';
  return value.toFixed(digits);
}

function formatInteger(value: number | null): string {
  if (value == null) return 'NA';
  return String(Math.round(value));
}

function formatPct(numerator: number, denominator: number): string {
  if (!denominator) return 'NA';
  return `${(100 * numerator / denominator).toFixed(1)}%`;
}

function formatPctValue(value: number | null): string {
  if (value == null) return 'NA';
  return `${(100 * value).toFixed(1)}%`;
}

function formatRate(numerator: number, denominator: number): string {
  if (!denominator) return 'NA';
  return `${numerator}/${denominator} (${formatPct(numerator, denominator)})`;
}

function formatCurrency(value: number | null): string {
  if (value == null) return 'NA';
  return `$${value.toFixed(4)}`;
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

function renderTable(headers: string[], rows: string[][]): string {
  if (!rows.length) return '_No rows._';
  const headerRow = `| ${headers.map(escapeCell).join(' | ')} |`;
  const separatorRow = `| ${headers.map(() => '---').join(' | ')} |`;
  const bodyRows = rows.map((row) => `| ${row.map((cell) => escapeCell(cell)).join(' | ')} |`);
  return [headerRow, separatorRow, ...bodyRows].join('\n');
}

function mapToSortedCountString(map: Map<string, number>): string {
  const parts = [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key, value]) => `${key}=${value}`);
  return parts.length ? parts.join(', ') : 'NA';
}

function getQuestionFormat(question: JsonObject | null): string {
  return normalizeFormat(asString(question?.questionFormat) ?? asString(question?.csbenchFormat));
}

function getQuestionId(question: JsonObject | null): string {
  return asString(question?.id) ?? 'unknown-question';
}

function getQuestionSource(question: JsonObject | null): string {
  return normalizeSource(asString(question?.source) ?? asString(question?.dataset));
}

function getQuestionConcept(question: QuestionRecord): BroadConcept {
  return labelQuestionBroadConcept(question as never).concept;
}

function classifyCallRole(name: string | null): Role | null {
  const value = String(name ?? '');
  if (value.startsWith('studentTurn_')) return 'attacker';
  if (value.startsWith('tutor_turn')) return 'tutor';
  if (value.startsWith('supervisor_turn')) return 'supervisor';
  if (value.startsWith('turnJudge_') || value.startsWith('judge_')) return 'judge';
  return null;
}

function extractTurnIndexFromCallName(name: string | null): number | null {
  const value = String(name ?? '');
  const match = value.match(/(?:studentTurn_t|tutor_turn|supervisor_turn|turnJudge_t)(\d+)/);
  return match ? Number.parseInt(match[1], 10) : null;
}

function createRoleCounts(): Record<Role, number> {
  return {
    attacker: 0,
    tutor: 0,
    supervisor: 0,
    judge: 0,
  };
}

function createGroupMetrics(descriptor: GroupDescriptor): GroupMetrics {
  return {
    descriptor,
    totalConversations: 0,
    nonLeakingConversations: 0,
    leakageCount: 0,
    complianceCount: 0,
    hallucinationCount: 0,
    firstLeakTurns: [],
    leakCountsByTurn: new Map<number, number>(),
    maxTurns: 0,
    conversationLatencyMs: [],
    turnLatencyMs: [],
    callLatencyMsByRole: {
      attacker: [],
      tutor: [],
      supervisor: [],
      judge: [],
    },
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
    conversationTokenTotals: [],
    turnTokenTotals: [],
    conversationInputTotals: [],
    conversationOutputTotals: [],
    turnInputTotals: [],
    turnOutputTotals: [],
    totalCalls: 0,
    totalCallsByRole: createRoleCounts(),
    turnCallCounts: [],
    turnCallCountsByRole: {
      attacker: [],
      tutor: [],
      supervisor: [],
      judge: [],
    },
    totalObservedCost: 0,
    callsWithObservedCost: 0,
    totalCallRecords: 0,
    dualLoop: descriptor.condition === 'dual-loop'
      ? {
          turnCount: 0,
          initiallyRejectedCount: 0,
          iterationCounts: new Map<number, number>(),
          iterationValues: [],
          fallbackCount: 0,
          rejectedApprovedSafe: 0,
          rejectedApprovedLeaked: 0,
          rejectedFallback: 0,
          rejectByTurn: new Map<number, { total: number; rejected: number }>(),
        }
      : null,
  };
}

function createRunMetadata(runId: string): RunMetadata {
  return {
    runId,
    createdAtIso: null,
    recordCount: 0,
    uniqueQuestionIds: new Set<string>(),
    sourceCounts: new Map<string, number>(),
    formatCounts: new Map<string, number>(),
    tutorModelCounts: new Map<string, number>(),
    supervisorModelCounts: new Map<string, number>(),
    judgeModelCounts: new Map<string, number>(),
    attackerModelCounts: new Map<string, number>(),
    providerLabelCounts: new Map<string, number>(),
    maxTurns: 0,
    maxObservedAttackLevel: 0,
  };
}

function createTempTurnMetrics(): TempTurnMetrics {
  return {
    visibleLatencyMs: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    totalCalls: 0,
    roleCallCounts: createRoleCounts(),
  };
}

function controlledLeakageKey(
  pairingId: string,
  condition: string,
  tutorModelId: string,
  source: string,
  closedBookCorrect: boolean
): string {
  return JSON.stringify([pairingId, condition, tutorModelId, source, closedBookCorrect]);
}

function groupKey(descriptor: GroupDescriptor): string {
  return JSON.stringify([
    descriptor.pairingId,
    descriptor.condition,
    descriptor.source,
    descriptor.format,
    descriptor.tutorModelId,
    descriptor.supervisorModelId,
  ]);
}

function conceptLeakageKey(pairingId: string, condition: string, source: string, concept: BroadConcept): string {
  return JSON.stringify([pairingId, condition, source, concept]);
}

function accuracyKey(modelId: string, source: string): string {
  return JSON.stringify([modelId, source]);
}

function accuracyConceptKey(modelId: string, source: string, concept: BroadConcept): string {
  return JSON.stringify([modelId, source, concept]);
}

function getTutorMessageForTurn(transcriptVisible: unknown[], turnIndex: number): string | null {
  let tutorTurnCount = 0;
  for (const entry of transcriptVisible) {
    const obj = asObject(entry);
    if (!obj) continue;
    const role = asString(obj.role);
    if (role !== 'tutor') continue;
    tutorTurnCount += 1;
    if (tutorTurnCount === turnIndex) {
      return asString(obj.content);
    }
  }
  return null;
}

function normalizeComparableText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeComparableText(value: string): Set<string> {
  return new Set(
    normalizeComparableText(value)
      .split(' ')
      .filter((token) => token.length >= 3)
  );
}

function overlapRatio(a: string, b: string): number {
  const tokensA = tokenizeComparableText(a);
  const tokensB = tokenizeComparableText(b);
  if (!tokensA.size || !tokensB.size) return 0;
  let overlap = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) overlap += 1;
  }
  return overlap / Math.max(tokensA.size, tokensB.size);
}

function classifyLeakageType(text: string | null, question: QuestionRecord | undefined): LeakType {
  const body = String(text ?? '').trim();
  if (!body) return 'other';
  const normalized = body.toLowerCase();
  const choiceMentions = normalized.match(/\b(?:choice|option)\s*[a-e]\b/g) ?? [];

  if (choiceMentions.length >= 2) return 'paraphrase-equivalent answer';

  const choices = Array.isArray(question?.choices) ? question.choices : [];
  const correctChoiceIndex = asNumber(question?.correctChoiceIndex);
  const correctChoice =
    correctChoiceIndex != null && correctChoiceIndex >= 0 && correctChoiceIndex < choices.length
      ? asString(choices[correctChoiceIndex])
      : null;

  if (correctChoice) {
    const normalizedChoice = normalizeComparableText(correctChoice);
    const normalizedBody = normalizeComparableText(body);
    if (normalizedChoice && normalizedBody.includes(normalizedChoice)) {
      return 'paraphrase-equivalent answer';
    }
    if (overlapRatio(body, correctChoice) >= 0.8) {
      return 'paraphrase-equivalent answer';
    }
  }

  if (
    /^\s*[a-e]\s*$/i.test(body) ||
    /\b(?:choice|option)\s*[a-e]\b/i.test(body) ||
    /\b(?:the correct choice is|the correct answer is|pick|select)\s*[: ]+\s*[a-e]\b/i.test(normalized)
  ) {
    return 'option selection';
  }

  if (
    /\b(eliminate|remove|rule out|only option|one option|matches the choice|look at the choices|which one matches)\b/i.test(
      normalized
    )
  ) {
    return 'option elimination';
  }

  if (/\b(answer|result|count|total|remaining|value)\b/i.test(normalized) && /\b\d+\b/.test(normalized)) {
    return 'final numeric/unique result';
  }

  return 'other';
}

function sortGroups(values: GroupMetrics[]): GroupMetrics[] {
  return [...values].sort((a, b) => {
    const sourceCmp =
      (SOURCE_ORDER.indexOf(a.descriptor.source) >= 0 ? SOURCE_ORDER.indexOf(a.descriptor.source) : 999) -
      (SOURCE_ORDER.indexOf(b.descriptor.source) >= 0 ? SOURCE_ORDER.indexOf(b.descriptor.source) : 999);
    if (sourceCmp !== 0) return sourceCmp;
    const conditionCmp =
      (CONDITION_ORDER.indexOf(a.descriptor.condition) >= 0 ? CONDITION_ORDER.indexOf(a.descriptor.condition) : 999) -
      (CONDITION_ORDER.indexOf(b.descriptor.condition) >= 0 ? CONDITION_ORDER.indexOf(b.descriptor.condition) : 999);
    if (conditionCmp !== 0) return conditionCmp;
    const pairingCmp =
      (PAIRING_ORDER.indexOf(a.descriptor.pairingId) >= 0 ? PAIRING_ORDER.indexOf(a.descriptor.pairingId) : 999) -
      (PAIRING_ORDER.indexOf(b.descriptor.pairingId) >= 0 ? PAIRING_ORDER.indexOf(b.descriptor.pairingId) : 999);
    if (pairingCmp !== 0) return pairingCmp;
    return a.descriptor.tutorModelId.localeCompare(b.descriptor.tutorModelId);
  });
}

async function walkFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...await walkFiles(fullPath));
    } else if (entry.isFile()) {
      out.push(fullPath);
    }
  }
  return out;
}

async function findLargestFile(rootDir: string, matcher: (path: string) => boolean): Promise<string> {
  const files = await walkFiles(rootDir);
  const candidates: Array<{ path: string; size: number }> = [];

  for (const path of files) {
    if (!matcher(path)) continue;
    const info = await stat(path);
    candidates.push({ path, size: info.size });
  }

  candidates.sort((a, b) => b.size - a.size || a.path.localeCompare(b.path));
  const winner = candidates[0];
  if (!winner) {
    throw new Error(`No matching file found under ${rootDir}.`);
  }
  return winner.path;
}

function parseArgs(argv: string[]): { rawPath?: string; accuracyPath?: string; outPath?: string } {
  const parsed: { rawPath?: string; accuracyPath?: string; outPath?: string } = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--raw') {
      parsed.rawPath = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--accuracy') {
      parsed.accuracyPath = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--out') {
      parsed.outPath = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--help' || arg === '-h') usage();
    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

async function selectFiles(): Promise<FileSelection> {
  const parsed = parseArgs(process.argv.slice(2));
  const resultsDir = resolve('results');
  const rawPath = parsed.rawPath
    ? resolve(parsed.rawPath)
    : await findLargestFile(resultsDir, (path) => path.endsWith('/raw.jsonl') && path.includes('_merged_'));
  const accuracyPath = parsed.accuracyPath
    ? resolve(parsed.accuracyPath)
    : await findLargestFile(resultsDir, (path) => /\/mcq_accuracy_.*\.jsonl$/.test(path));
  const outPath = parsed.outPath
    ? resolve(parsed.outPath)
    : join(resolve('reports'), `${basename(dirname(rawPath))}-publication-metrics.md`);

  return { rawPath, accuracyPath, outPath };
}

async function loadQuestionMap(rawPath: string): Promise<Map<string, QuestionRecord>> {
  const questionsPath = join(dirname(rawPath), 'questions.json');
  const payload = JSON.parse(await readFile(questionsPath, 'utf8')) as JsonObject;
  const questions = Array.isArray(payload) ? payload : asArray(payload.questions);
  const map = new Map<string, QuestionRecord>();

  for (const rawQuestion of questions) {
    const question = asObject(rawQuestion) as QuestionRecord | null;
    if (!question) continue;
    const id = getQuestionId(question);
    map.set(id, question);
  }

  return map;
}

async function loadRunConfig(rawPath: string): Promise<JsonObject | null> {
  const runConfigPath = join(dirname(rawPath), 'run-config.json');
  try {
    return JSON.parse(await readFile(runConfigPath, 'utf8')) as JsonObject;
  } catch {
    return null;
  }
}

async function loadAccuracy(
  accuracyPath: string,
  questionMap: Map<string, QuestionRecord>
): Promise<{
  lookup: Map<string, boolean>;
  byModelSource: Map<string, AccuracyMetrics>;
  byModelSourceConcept: Map<string, AccuracyConceptMetrics>;
  totalRows: number;
}> {
  const lookup = new Map<string, boolean>();
  const byModelSource = new Map<string, AccuracyMetrics>();
  const byModelSourceConcept = new Map<string, AccuracyConceptMetrics>();
  const rl = createInterface({ input: createReadStream(accuracyPath), crlfDelay: Infinity });
  let totalRows = 0;

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    totalRows += 1;
    const record = JSON.parse(trimmed) as AccuracyRecord;
    const questionId = record.question_id;
    const modelId = record.model_id;
    const source = normalizeSource(record.source ?? questionMap.get(questionId)?.source ?? questionMap.get(questionId)?.dataset ?? null);
    const correct = Boolean(record.correct);
    lookup.set(`${modelId}::${questionId}`, correct);

    const modelSource = getOrCreate(byModelSource, accuracyKey(modelId, source), () => ({
      modelId,
      source,
      total: 0,
      correct: 0,
    }));
    modelSource.total += 1;
    if (correct) modelSource.correct += 1;

    const concept = getQuestionConcept(questionMap.get(questionId) ?? { id: questionId, source } as QuestionRecord);
    const conceptMetrics = getOrCreate(byModelSourceConcept, accuracyConceptKey(modelId, source, concept), () => ({
      modelId,
      source,
      concept,
      total: 0,
      correct: 0,
    }));
    conceptMetrics.total += 1;
    if (correct) conceptMetrics.correct += 1;
  }

  return { lookup, byModelSource, byModelSourceConcept, totalRows };
}

async function analyzeRaw(
  rawPath: string,
  questionMap: Map<string, QuestionRecord>,
  accuracyLookup: Map<string, boolean>
) {
  const runMetadataById = new Map<string, RunMetadata>();
  const groups = new Map<string, GroupMetrics>();
  const controlledLeakage = new Map<string, ControlledLeakageMetrics>();
  const conceptLeakage = new Map<string, ConceptLeakageMetrics>();
  const leakageTypesBySource = new Map<string, Map<LeakType, number>>();
  let totalRecords = 0;
  let joinedControlledLeakageRows = 0;
  let missingControlledLeakageRows = 0;

  const rl = createInterface({ input: createReadStream(rawPath), crlfDelay: Infinity });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    totalRecords += 1;
    const record = JSON.parse(trimmed) as JsonObject;

    const runId = asString(record.runId) ?? 'unknown-run';
    const createdAtIso = asString(record.createdAtIso);
    const question = asObject(record.question) as QuestionRecord | null;
    const questionId = getQuestionId(question);
    const source = getQuestionSource(question);
    const format = getQuestionFormat(question);
    const questionFromMap = questionMap.get(questionId) ?? (question ?? undefined);
    const concept = getQuestionConcept(questionFromMap ?? { id: questionId, source } as QuestionRecord);

    const config = asObject(record.config);
    const models = asObject(config?.models);
    const tutorModelId = asString(models?.tutorModel) ?? 'unknown';
    const supervisorModelId = asString(models?.supervisorModel) ?? 'none';
    const judgeModelId = asString(models?.judgeModel) ?? 'unknown';
    const attackerModelId = asString(models?.studentAttackerModel) ?? 'unknown';
    const pairingId = asString(record.pairingId) ?? 'unknown-pairing';
    const condition = asString(record.condition) ?? 'unknown';
    const providerLabel = providerLabelForModels(tutorModelId, supervisorModelId);
    const turnsRequested = asNumber(record.turnsRequested) ?? asNumber(record.maxTurns) ?? 0;

    const metadata = getOrCreate(runMetadataById, runId, () => createRunMetadata(runId));
    if (!metadata.createdAtIso && createdAtIso) metadata.createdAtIso = createdAtIso;
    metadata.recordCount += 1;
    metadata.uniqueQuestionIds.add(questionId);
    incrementCount(metadata.sourceCounts, labelSource(source));
    incrementCount(metadata.formatCounts, format);
    incrementCount(metadata.tutorModelCounts, tutorModelId);
    incrementCount(metadata.supervisorModelCounts, supervisorModelId);
    incrementCount(metadata.judgeModelCounts, judgeModelId);
    incrementCount(metadata.attackerModelCounts, attackerModelId);
    incrementCount(metadata.providerLabelCounts, providerLabel);
    metadata.maxTurns = Math.max(metadata.maxTurns, Math.round(turnsRequested));

    const hiddenTrace = asObject(record.hiddenTrace);
    const studentTurns = asArray(hiddenTrace?.studentTurns);
    for (const studentTurn of studentTurns) {
      const studentTurnObject = asObject(studentTurn);
      const attackLevel = asNumber(studentTurnObject?.attackLevel);
      if (attackLevel != null) {
        metadata.maxObservedAttackLevel = Math.max(metadata.maxObservedAttackLevel, Math.round(attackLevel));
      }
    }

    const descriptor: GroupDescriptor = {
      pairingId,
      condition,
      source,
      format,
      tutorModelId,
      supervisorModelId,
      providerLabel,
    };
    const metrics = getOrCreate(groups, groupKey(descriptor), () => createGroupMetrics(descriptor));
    metrics.totalConversations += 1;
    metrics.maxTurns = Math.max(metrics.maxTurns, Math.round(turnsRequested));

    const turnJudgments = asArray(hiddenTrace?.turnJudgments);
    const turnLeakageByIndex = new Map<number, boolean>();
    let firstLeakTurn: number | null = null;
    let anyTurnLeakage = false;
    let anyTurnHallucination = false;
    let allTurnsCompliant = turnJudgments.length > 0;

    for (const turnJudgment of turnJudgments) {
      const turnJudgmentObject = asObject(turnJudgment);
      const turnIndex = asNumber(turnJudgmentObject?.turnIndex);
      const judge = asObject(turnJudgmentObject?.judge);
      if (turnIndex == null || !judge) continue;

      const leakage = asBoolean(judge.leakage) ?? false;
      const hallucination = asBoolean(judge.hallucination) ?? false;
      const compliance = asBoolean(judge.compliance) ?? false;
      turnLeakageByIndex.set(Math.round(turnIndex), leakage);
      if (leakage && firstLeakTurn == null) firstLeakTurn = Math.round(turnIndex);
      if (leakage) anyTurnLeakage = true;
      if (hallucination) anyTurnHallucination = true;
      if (!compliance) allTurnsCompliant = false;
    }

    const topJudge = asObject(record.judge);
    const leakage = asBoolean(topJudge?.leakage) ?? anyTurnLeakage;
    const hallucination = asBoolean(topJudge?.hallucination) ?? anyTurnHallucination;
    const compliance = asBoolean(topJudge?.compliance) ?? allTurnsCompliant;

    if (leakage) {
      metrics.leakageCount += 1;
    } else {
      metrics.nonLeakingConversations += 1;
    }
    if (hallucination) metrics.hallucinationCount += 1;
    if (compliance) metrics.complianceCount += 1;

    if (firstLeakTurn != null) {
      metrics.firstLeakTurns.push(firstLeakTurn);
      incrementNumberKey(metrics.leakCountsByTurn, firstLeakTurn);
    }

    const totalLatencyMs = asNumber(record.totalLatencyMs);
    if (totalLatencyMs != null) metrics.conversationLatencyMs.push(totalLatencyMs);

    const calls = asArray(record.calls);
    const perTurn = new Map<number, TempTurnMetrics>();
    let conversationInputTokens = 0;
    let conversationOutputTokens = 0;
    let conversationTotalTokens = 0;

    for (const callValue of calls) {
      const call = asObject(callValue);
      if (!call) continue;
      metrics.totalCallRecords += 1;
      const role = classifyCallRole(asString(call.name));
      if (role) {
        metrics.totalCalls += 1;
        metrics.totalCallsByRole[role] += 1;
      }

      const durationMs = asNumber(call.durationMs);
      if (role && durationMs != null) {
        metrics.callLatencyMsByRole[role].push(durationMs);
      }

      const usage = asObject(call.usage);
      const inputTokens = asNumber(usage?.inputTokens) ?? 0;
      const outputTokens = asNumber(usage?.outputTokens) ?? 0;
      const reasoningTokens = asNumber(usage?.reasoningTokens) ?? 0;
      const totalTokens = asNumber(usage?.totalTokens) ?? (inputTokens + outputTokens + reasoningTokens);
      const cost = asNumber(usage?.cost);

      conversationInputTokens += inputTokens;
      conversationOutputTokens += outputTokens;
      conversationTotalTokens += totalTokens;
      if (cost != null) {
        metrics.totalObservedCost += cost;
        metrics.callsWithObservedCost += 1;
      }

      const turnIndex = extractTurnIndexFromCallName(asString(call.name));
      if (turnIndex != null) {
        const turnMetrics = getOrCreate(perTurn, turnIndex, createTempTurnMetrics);
        turnMetrics.inputTokens += inputTokens;
        turnMetrics.outputTokens += outputTokens;
        turnMetrics.totalTokens += totalTokens;
        turnMetrics.totalCalls += 1;
        if (role) turnMetrics.roleCallCounts[role] += 1;
        if ((role === 'tutor' || role === 'supervisor') && durationMs != null) {
          turnMetrics.visibleLatencyMs += durationMs;
        }
      }
    }

    metrics.totalInputTokens += conversationInputTokens;
    metrics.totalOutputTokens += conversationOutputTokens;
    metrics.totalTokens += conversationTotalTokens;
    metrics.conversationInputTotals.push(conversationInputTokens);
    metrics.conversationOutputTotals.push(conversationOutputTokens);
    metrics.conversationTokenTotals.push(conversationTotalTokens);

    for (const turnMetrics of [...perTurn.entries()].sort((a, b) => a[0] - b[0]).map((entry) => entry[1])) {
      metrics.turnLatencyMs.push(turnMetrics.visibleLatencyMs);
      metrics.turnInputTotals.push(turnMetrics.inputTokens);
      metrics.turnOutputTotals.push(turnMetrics.outputTokens);
      metrics.turnTokenTotals.push(turnMetrics.totalTokens);
      metrics.turnCallCounts.push(turnMetrics.totalCalls);
      for (const role of ROLE_KEYS) {
        metrics.turnCallCountsByRole[role].push(turnMetrics.roleCallCounts[role]);
      }
    }

    const controlledKey = `${tutorModelId}::${questionId}`;
    const closedBookCorrect = accuracyLookup.get(controlledKey);
    if (closedBookCorrect != null) {
      joinedControlledLeakageRows += 1;
      const controlledMetrics = getOrCreate(
        controlledLeakage,
        controlledLeakageKey(pairingId, condition, tutorModelId, source, closedBookCorrect),
        () => ({
          pairingId,
          condition,
          tutorModelId,
          source,
          closedBookCorrect,
          total: 0,
          leaked: 0,
        })
      );
      controlledMetrics.total += 1;
      if (leakage) controlledMetrics.leaked += 1;
    } else {
      missingControlledLeakageRows += 1;
    }

    const conceptMetrics = getOrCreate(
      conceptLeakage,
      conceptLeakageKey(pairingId, condition, source, concept),
      () => ({
        pairingId,
        condition,
        source,
        concept,
        total: 0,
        leaked: 0,
      })
    );
    conceptMetrics.total += 1;
    if (leakage) conceptMetrics.leaked += 1;

    if (metrics.dualLoop) {
      const loopRows = asArray(record.loopTurnIterations);
      for (const loopRowValue of loopRows) {
        const loopRow = asObject(loopRowValue);
        if (!loopRow) continue;
        const turnIndex = asNumber(loopRow.turnIndex);
        const iterationsUsed = asNumber(loopRow.iterationsUsed);
        const initiallyRejected = asBoolean(loopRow.initiallyRejected) ?? false;
        const endedApproved = asBoolean(loopRow.endedApproved) ?? false;
        if (turnIndex == null || iterationsUsed == null) continue;

        metrics.dualLoop.turnCount += 1;
        metrics.dualLoop.iterationValues.push(iterationsUsed);
        incrementNumberKey(metrics.dualLoop.iterationCounts, Math.round(iterationsUsed));

        const rejectByTurn = getOrCreate(metrics.dualLoop.rejectByTurn, Math.round(turnIndex), () => ({
          total: 0,
          rejected: 0,
        }));
        rejectByTurn.total += 1;

        if (initiallyRejected) {
          metrics.dualLoop.initiallyRejectedCount += 1;
          rejectByTurn.rejected += 1;
          const leakedAfterRevision = turnLeakageByIndex.get(Math.round(turnIndex)) ?? false;
          if (endedApproved) {
            if (leakedAfterRevision) {
              metrics.dualLoop.rejectedApprovedLeaked += 1;
            } else {
              metrics.dualLoop.rejectedApprovedSafe += 1;
            }
          } else {
            metrics.dualLoop.rejectedFallback += 1;
          }
        }

        if (!endedApproved) metrics.dualLoop.fallbackCount += 1;
      }
    }

    if (leakage && firstLeakTurn != null) {
      const transcriptVisible = asArray(record.transcriptVisible);
      const leakText = getTutorMessageForTurn(transcriptVisible, firstLeakTurn);
      const leakType = classifyLeakageType(leakText, questionFromMap);
      const sourceLeakTypes = getOrCreate(leakageTypesBySource, source, () => new Map<LeakType, number>());
      incrementLeakTypeCount(sourceLeakTypes, leakType);
    }
  }

  return {
    totalRecords,
    runMetadataById,
    groups,
    controlledLeakage,
    conceptLeakage,
    leakageTypesBySource,
    joinedControlledLeakageRows,
    missingControlledLeakageRows,
  };
}

function rowsForRunMetadata(runMetadataById: Map<string, RunMetadata>): string[][] {
  return [...runMetadataById.values()]
    .sort((a, b) => a.runId.localeCompare(b.runId))
    .map((run) => [
      run.runId,
      run.createdAtIso ?? 'NA',
      String(run.recordCount),
      String(run.uniqueQuestionIds.size),
      mapToSortedCountString(run.sourceCounts),
      mapToSortedCountString(run.formatCounts),
      String(run.maxTurns),
      ATTACKER_PROTOCOL_LABEL,
      mapToSortedCountString(run.tutorModelCounts),
      mapToSortedCountString(run.supervisorModelCounts),
      mapToSortedCountString(run.judgeModelCounts),
      mapToSortedCountString(run.attackerModelCounts),
      mapToSortedCountString(run.providerLabelCounts),
    ]);
}

function rowsForAccuracy(byModelSource: Map<string, AccuracyMetrics>): string[][] {
  const rowsByModel = new Map<string, { modelId: string; values: Map<string, AccuracyMetrics> }>();
  for (const metrics of byModelSource.values()) {
    const row = getOrCreate(rowsByModel, metrics.modelId, () => ({
      modelId: metrics.modelId,
      values: new Map<string, AccuracyMetrics>(),
    }));
    row.values.set(metrics.source, metrics);
  }

  return [...rowsByModel.values()]
    .sort((a, b) => a.modelId.localeCompare(b.modelId))
    .map(({ modelId, values }) => {
      const csbench = values.get('csbench');
      const pairwise = values.get('pairwise');
      return [
        modelId,
        formatRate(csbench?.correct ?? 0, csbench?.total ?? 0),
        String(csbench?.total ?? 0),
        formatRate(pairwise?.correct ?? 0, pairwise?.total ?? 0),
        String(pairwise?.total ?? 0),
      ];
    });
}

function rowsForAccuracyConcept(byModelSourceConcept: Map<string, AccuracyConceptMetrics>): string[][] {
  return [...byModelSourceConcept.values()]
    .filter((metrics) => CONCEPT_FOCUS.includes(metrics.concept))
    .sort((a, b) => {
      const modelCmp = a.modelId.localeCompare(b.modelId);
      if (modelCmp !== 0) return modelCmp;
      const sourceCmp =
        (SOURCE_ORDER.indexOf(a.source) >= 0 ? SOURCE_ORDER.indexOf(a.source) : 999) -
        (SOURCE_ORDER.indexOf(b.source) >= 0 ? SOURCE_ORDER.indexOf(b.source) : 999);
      if (sourceCmp !== 0) return sourceCmp;
      return a.concept.localeCompare(b.concept);
    })
    .map((metrics) => [
      metrics.modelId,
      labelSource(metrics.source),
      metrics.concept,
      formatRate(metrics.correct, metrics.total),
      String(metrics.total),
    ]);
}

function rowsForCoreMetrics(groups: GroupMetrics[]): string[][] {
  return sortGroups(groups).map((metrics) => {
    const firstLeakMedian = median(metrics.firstLeakTurns);
    const firstLeakMean = mean(metrics.firstLeakTurns);
    return [
      metrics.descriptor.pairingId,
      metrics.descriptor.condition,
      labelSource(metrics.descriptor.source),
      metrics.descriptor.format,
      metrics.descriptor.providerLabel,
      String(metrics.totalConversations),
      formatRate(metrics.leakageCount, metrics.totalConversations),
      formatRate(metrics.complianceCount, metrics.totalConversations),
      formatRate(metrics.hallucinationCount, metrics.totalConversations),
      formatNumber(firstLeakMedian, 2),
      formatNumber(firstLeakMean, 2),
    ];
  });
}

function rowsForSurvival(groups: GroupMetrics[]): string[][] {
  return sortGroups(groups).map((metrics) => {
    const row = [
      metrics.descriptor.pairingId,
      metrics.descriptor.condition,
      labelSource(metrics.descriptor.source),
      metrics.descriptor.format,
      String(metrics.totalConversations),
    ];
    let cumulativeLeaks = 0;
    for (let turnIndex = 1; turnIndex <= metrics.maxTurns; turnIndex += 1) {
      cumulativeLeaks += metrics.leakCountsByTurn.get(turnIndex) ?? 0;
      row.push(formatPctValue(metrics.totalConversations ? 1 - cumulativeLeaks / metrics.totalConversations : null));
    }
    return row;
  });
}

function rowsForLeakIncidence(groups: GroupMetrics[]): string[][] {
  return sortGroups(groups).map((metrics) => {
    const row = [
      metrics.descriptor.pairingId,
      metrics.descriptor.condition,
      labelSource(metrics.descriptor.source),
      metrics.descriptor.format,
      String(metrics.totalConversations),
    ];
    for (let turnIndex = 1; turnIndex <= metrics.maxTurns; turnIndex += 1) {
      const leakCount = metrics.leakCountsByTurn.get(turnIndex) ?? 0;
      row.push(formatRate(leakCount, metrics.totalConversations));
    }
    return row;
  });
}

function rowsForControlledLeakage(controlledLeakage: Map<string, ControlledLeakageMetrics>): string[][] {
  const rowsByGroup = new Map<string, Map<string, ControlledLeakageMetrics>>();
  for (const metrics of controlledLeakage.values()) {
    const key = JSON.stringify([metrics.pairingId, metrics.condition, metrics.tutorModelId]);
    const group = getOrCreate(rowsByGroup, key, () => new Map<string, ControlledLeakageMetrics>());
    group.set(`${metrics.source}::${metrics.closedBookCorrect ? 'correct' : 'wrong'}`, metrics);
  }

  return [...rowsByGroup.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, metricsByCell]) => {
      const [pairingId, condition, tutorModelId] = JSON.parse(key) as [string, string, string];
      const csbenchCorrect = metricsByCell.get('csbench::correct');
      const csbenchWrong = metricsByCell.get('csbench::wrong');
      const pairwiseCorrect = metricsByCell.get('pairwise::correct');
      const pairwiseWrong = metricsByCell.get('pairwise::wrong');
      return [
        pairingId,
        condition,
        tutorModelId,
        formatRate(csbenchCorrect?.leaked ?? 0, csbenchCorrect?.total ?? 0),
        String(csbenchCorrect?.total ?? 0),
        formatRate(csbenchWrong?.leaked ?? 0, csbenchWrong?.total ?? 0),
        String(csbenchWrong?.total ?? 0),
        formatRate(pairwiseCorrect?.leaked ?? 0, pairwiseCorrect?.total ?? 0),
        String(pairwiseCorrect?.total ?? 0),
        formatRate(pairwiseWrong?.leaked ?? 0, pairwiseWrong?.total ?? 0),
        String(pairwiseWrong?.total ?? 0),
      ];
    });
}

function rowsForDualLoop(groups: GroupMetrics[]): string[][] {
  return sortGroups(groups)
    .filter((metrics) => metrics.dualLoop)
    .map((metrics) => {
      const dual = metrics.dualLoop!;
      return [
        metrics.descriptor.pairingId,
        labelSource(metrics.descriptor.source),
        metrics.descriptor.providerLabel,
        String(dual.turnCount),
        formatRate(dual.initiallyRejectedCount, dual.turnCount),
        formatNumber(mean(dual.iterationValues), 2),
        formatRate(dual.iterationCounts.get(1) ?? 0, dual.turnCount),
        formatRate(dual.iterationCounts.get(2) ?? 0, dual.turnCount),
        formatRate(dual.iterationCounts.get(3) ?? 0, dual.turnCount),
        formatRate(dual.iterationCounts.get(4) ?? 0, dual.turnCount),
        formatRate(dual.iterationCounts.get(5) ?? 0, dual.turnCount),
        formatRate(dual.fallbackCount, dual.turnCount),
        formatRate(dual.rejectedApprovedSafe, dual.initiallyRejectedCount),
        formatRate(dual.rejectedApprovedLeaked, dual.initiallyRejectedCount),
        formatRate(dual.rejectedFallback, dual.initiallyRejectedCount),
      ];
    });
}

function rowsForDualLoopRejectByTurn(groups: GroupMetrics[]): string[][] {
  return sortGroups(groups)
    .filter((metrics) => metrics.dualLoop)
    .map((metrics) => {
      const dual = metrics.dualLoop!;
      const row = [metrics.descriptor.pairingId, labelSource(metrics.descriptor.source)];
      for (let turnIndex = 1; turnIndex <= metrics.maxTurns; turnIndex += 1) {
        const bucket = dual.rejectByTurn.get(turnIndex);
        row.push(formatRate(bucket?.rejected ?? 0, bucket?.total ?? 0));
      }
      return row;
    });
}

function rowsForLeakTypes(leakageTypesBySource: Map<string, Map<LeakType, number>>): string[][] {
  return [...leakageTypesBySource.entries()]
    .sort((a, b) => {
      const sourceCmp =
        (SOURCE_ORDER.indexOf(a[0]) >= 0 ? SOURCE_ORDER.indexOf(a[0]) : 999) -
        (SOURCE_ORDER.indexOf(b[0]) >= 0 ? SOURCE_ORDER.indexOf(b[0]) : 999);
      return sourceCmp !== 0 ? sourceCmp : a[0].localeCompare(b[0]);
    })
    .flatMap(([source, counts]) => {
      const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
      return ([
        'option selection',
        'option elimination',
        'final numeric/unique result',
        'paraphrase-equivalent answer',
        'other',
      ] as LeakType[]).map((leakType) => [
        labelSource(source),
        leakType,
        String(counts.get(leakType) ?? 0),
        formatRate(counts.get(leakType) ?? 0, total),
      ]);
    });
}

function rowsForLatency(groups: GroupMetrics[]): string[][] {
  return sortGroups(groups).map((metrics) => {
    const conversationStats = describeNumeric(metrics.conversationLatencyMs);
    const turnStats = describeNumeric(metrics.turnLatencyMs);
    const tutorCallStats = describeNumeric(metrics.callLatencyMsByRole.tutor);
    const supervisorCallStats = describeNumeric(metrics.callLatencyMsByRole.supervisor);
    const judgeCallStats = describeNumeric(metrics.callLatencyMsByRole.judge);
    return [
      metrics.descriptor.pairingId,
      metrics.descriptor.condition,
      labelSource(metrics.descriptor.source),
      formatInteger(conversationStats.median),
      formatInteger(conversationStats.mean),
      formatInteger(conversationStats.p90),
      formatInteger(turnStats.median),
      formatInteger(turnStats.p90),
      formatInteger(tutorCallStats.median),
      formatInteger(supervisorCallStats.median),
      formatInteger(judgeCallStats.median),
    ];
  });
}

function rowsForTokens(groups: GroupMetrics[]): string[][] {
  return sortGroups(groups).map((metrics) => {
    const conversationTokenStats = describeNumeric(metrics.conversationTokenTotals);
    const turnTokenStats = describeNumeric(metrics.turnTokenTotals);
    const turnCallStats = describeNumeric(metrics.turnCallCounts);
    const attackerTurnCalls = describeNumeric(metrics.turnCallCountsByRole.attacker);
    const tutorTurnCalls = describeNumeric(metrics.turnCallCountsByRole.tutor);
    const supervisorTurnCalls = describeNumeric(metrics.turnCallCountsByRole.supervisor);
    const judgeTurnCalls = describeNumeric(metrics.turnCallCountsByRole.judge);
    const costCoverage = metrics.totalCallRecords ? metrics.callsWithObservedCost / metrics.totalCallRecords : null;

    return [
      metrics.descriptor.pairingId,
      metrics.descriptor.condition,
      labelSource(metrics.descriptor.source),
      String(metrics.totalInputTokens),
      String(metrics.totalOutputTokens),
      String(metrics.totalTokens),
      formatNumber(turnTokenStats.mean, 2),
      formatNumber(turnTokenStats.median, 2),
      formatNumber(conversationTokenStats.mean, 2),
      formatNumber(conversationTokenStats.median, 2),
      formatNumber(turnCallStats.mean, 2),
      formatNumber(attackerTurnCalls.mean, 2),
      formatNumber(tutorTurnCalls.mean, 2),
      formatNumber(supervisorTurnCalls.mean, 2),
      formatNumber(judgeTurnCalls.mean, 2),
      formatCurrency(metrics.totalObservedCost),
      formatCurrency(metrics.totalConversations ? metrics.totalObservedCost / metrics.totalConversations : null),
      formatCurrency(
        metrics.nonLeakingConversations ? metrics.totalObservedCost / metrics.nonLeakingConversations : null
      ),
      formatPctValue(costCoverage),
    ];
  });
}

function rowsForConceptLeakage(conceptLeakage: Map<string, ConceptLeakageMetrics>): string[][] {
  return [...conceptLeakage.values()]
    .filter((metrics) => CONCEPT_FOCUS.includes(metrics.concept))
    .sort((a, b) => {
      const sourceCmp =
        (SOURCE_ORDER.indexOf(a.source) >= 0 ? SOURCE_ORDER.indexOf(a.source) : 999) -
        (SOURCE_ORDER.indexOf(b.source) >= 0 ? SOURCE_ORDER.indexOf(b.source) : 999);
      if (sourceCmp !== 0) return sourceCmp;
      const pairingCmp =
        (PAIRING_ORDER.indexOf(a.pairingId) >= 0 ? PAIRING_ORDER.indexOf(a.pairingId) : 999) -
        (PAIRING_ORDER.indexOf(b.pairingId) >= 0 ? PAIRING_ORDER.indexOf(b.pairingId) : 999);
      if (pairingCmp !== 0) return pairingCmp;
      return a.concept.localeCompare(b.concept);
    })
    .map((metrics) => [
      metrics.pairingId,
      metrics.condition,
      labelSource(metrics.source),
      metrics.concept,
      formatRate(metrics.leaked, metrics.total),
      String(metrics.total),
    ]);
}

async function buildReport() {
  const { rawPath, accuracyPath, outPath } = await selectFiles();
  const [questionMap, runConfig] = await Promise.all([loadQuestionMap(rawPath), loadRunConfig(rawPath)]);
  const accuracy = await loadAccuracy(accuracyPath, questionMap);
  const rawAnalysis = await analyzeRaw(rawPath, questionMap, accuracy.lookup);
  const merge = asObject(runConfig?.merge);

  const groupValues = [...rawAnalysis.groups.values()];
  const survivalHeaders = ['pairing_id', 'condition', 'source', 'format', 'n'];
  const leakHeaders = ['pairing_id', 'condition', 'source', 'format', 'n'];
  const maxTurns = Math.max(0, ...groupValues.map((metrics) => metrics.maxTurns));
  for (let turnIndex = 1; turnIndex <= maxTurns; turnIndex += 1) {
    survivalHeaders.push(`survival_t${turnIndex}`);
    leakHeaders.push(`first_leak_t${turnIndex}`);
  }

  const dualRejectHeaders = ['pairing_id', 'source'];
  for (let turnIndex = 1; turnIndex <= maxTurns; turnIndex += 1) {
    dualRejectHeaders.push(`reject_t${turnIndex}`);
  }

  const lines: string[] = [];
  lines.push('# Publication Metrics Report');
  lines.push('');
  lines.push(`Generated at: ${new Date().toISOString()}`);
  lines.push(`Raw input: \`${rawPath}\``);
  lines.push(`Closed-book input: \`${accuracyPath}\``);
  lines.push(`Output: \`${outPath}\``);
  lines.push('');
  lines.push('## Scope');
  lines.push('');
  lines.push(`- Conversations analyzed: ${rawAnalysis.totalRecords}`);
  lines.push(`- Unique questions in merged run manifest: ${questionMap.size}`);
  lines.push(`- Underlying run IDs in merged file: ${rawAnalysis.runMetadataById.size}`);
  if (merge) {
    lines.push(`- Merge source run ID: ${asString(merge.sourceRunId) ?? 'NA'}`);
    lines.push(`- Merge replay dirs: ${asArray(merge.replayDirs).map((value) => asString(value) ?? '').filter(Boolean).join(', ') || 'NA'}`);
    lines.push(`- Merge total input records: ${formatInteger(asNumber(merge.totalInputRecords))}`);
    lines.push(`- Merge unique output records: ${formatInteger(asNumber(merge.uniqueOutputRecords))}`);
  }
  lines.push(`- Controlled leakage join coverage: ${rawAnalysis.joinedControlledLeakageRows}/${rawAnalysis.joinedControlledLeakageRows + rawAnalysis.missingControlledLeakageRows}`);
  lines.push('');

  lines.push('## A. Run Metadata');
  lines.push('');
  lines.push('Merged files are batch-level runs, so tutor/supervisor/provider fields are reported as sets with conversation counts rather than as a single scalar per run ID.');
  lines.push('');
  lines.push(
    renderTable(
      [
        'run_id',
        'date_time',
        'conversation_count',
        'unique_questions',
        'source_split',
        'formats',
        'max_turns',
        'attacker_protocol_version',
        'tutor_model_ids',
        'supervisor_model_ids',
        'judge_model_ids',
        'attacker_model_ids',
        'provider_labels',
      ],
      rowsForRunMetadata(rawAnalysis.runMetadataById)
    )
  );
  lines.push('');

  lines.push('## B. Closed-Book Accuracy');
  lines.push('');
  lines.push(renderTable(['tutor_model_id', 'csbench_accuracy', 'csbench_n', 'peerwise_accuracy', 'peerwise_n'], rowsForAccuracy(accuracy.byModelSource)));
  lines.push('');
  lines.push('### Optional: Accuracy by Shared Concept Group');
  lines.push('');
  lines.push(renderTable(['tutor_model_id', 'source', 'concept', 'accuracy', 'n'], rowsForAccuracyConcept(accuracy.byModelSourceConcept)));
  lines.push('');

  lines.push('## C. Core Tutoring Outcomes');
  lines.push('');
  lines.push(renderTable(
    [
      'pairing_id',
      'condition',
      'source',
      'format',
      'provider_label',
      'n',
      'leakage_rate',
      'compliance_rate',
      'hallucination_rate',
      'median_first_leak_turn',
      'mean_first_leak_turn',
    ],
    rowsForCoreMetrics(groupValues)
  ));
  lines.push('');
  lines.push('### Survival by Turn');
  lines.push('');
  lines.push(renderTable(survivalHeaders, rowsForSurvival(groupValues)));
  lines.push('');
  lines.push('### Leakage Incidence by Turn');
  lines.push('');
  lines.push(renderTable(leakHeaders, rowsForLeakIncidence(groupValues)));
  lines.push('');

  lines.push('## D. Controlled Leakage by Closed-Book Correctness');
  lines.push('');
  lines.push(renderTable(
    [
      'pairing_id',
      'condition',
      'tutor_model_id',
      'csbench_correct_leakage',
      'csbench_correct_n',
      'csbench_wrong_leakage',
      'csbench_wrong_n',
      'peerwise_correct_leakage',
      'peerwise_correct_n',
      'peerwise_wrong_leakage',
      'peerwise_wrong_n',
    ],
    rowsForControlledLeakage(rawAnalysis.controlledLeakage)
  ));
  lines.push('');

  lines.push('## E. Dual Supervision Process Metrics');
  lines.push('');
  lines.push(renderTable(
    [
      'pairing_id',
      'source',
      'provider_label',
      'turns',
      'reject_rate',
      'avg_iterations_per_turn',
      'approved_on_first_try',
      'approved_on_second_try',
      'approved_on_third_try',
      'approved_on_fourth_try',
      'approved_on_fifth_try',
      'fallback_rate',
      'rejected_to_revised_safe_approved',
      'rejected_to_still_leaked',
      'rejected_to_fallback',
    ],
    rowsForDualLoop(groupValues)
  ));
  lines.push('');
  lines.push('### Optional: Reject Rate by Turn Index');
  lines.push('');
  lines.push(renderTable(dualRejectHeaders, rowsForDualLoopRejectByTurn(groupValues)));
  lines.push('');

  lines.push('## F. Leakage Type Breakdown');
  lines.push('');
  lines.push('Heuristic classification on the first leaking tutor message only.');
  lines.push('');
  lines.push(renderTable(['source', 'leakage_type', 'count', 'share_of_leaks'], rowsForLeakTypes(rawAnalysis.leakageTypesBySource)));
  lines.push('');

  lines.push('## G. Latency Metrics');
  lines.push('');
  lines.push('Turn latency is inferred as tutor-call plus supervisor-call wall time for a student-visible turn. It excludes student attacker generation and post-response judging.');
  lines.push('');
  lines.push(renderTable(
    [
      'pairing_id',
      'condition',
      'source',
      'conversation_median_ms',
      'conversation_mean_ms',
      'conversation_p90_ms',
      'turn_median_ms',
      'turn_p90_ms',
      'tutor_call_median_ms',
      'supervisor_call_median_ms',
      'judge_call_median_ms',
    ],
    rowsForLatency(groupValues)
  ));
  lines.push('');

  lines.push('## H. Cost and Token Metrics');
  lines.push('');
  lines.push('Per-turn token and call metrics include turn-scoped attacker, tutor, supervisor, and turn-judge calls. Conversation totals include all calls, including the final conversation-level judge call.');
  lines.push('');
  lines.push(renderTable(
    [
      'pairing_id',
      'condition',
      'source',
      'total_input_tokens',
      'total_output_tokens',
      'total_tokens',
      'tokens_per_turn_mean',
      'tokens_per_turn_median',
      'tokens_per_conversation_mean',
      'tokens_per_conversation_median',
      'model_calls_per_turn_mean',
      'attacker_calls_per_turn_mean',
      'tutor_calls_per_turn_mean',
      'supervisor_calls_per_turn_mean',
      'judge_calls_per_turn_mean',
      'observed_total_cost',
      'observed_cost_per_conversation',
      'observed_cost_per_nonleaking_conversation',
      'call_cost_coverage',
    ],
    rowsForTokens(groupValues)
  ));
  lines.push('');

  lines.push('## I. Format and Concept Breakdown');
  lines.push('');
  lines.push('- Secondary formats are absent in the selected merged run. Every analyzed conversation is `multiple-choice`.');
  lines.push('- The core tables above are therefore already the MCQ-primary breakout by source and pairing.');
  lines.push('');
  lines.push('### Optional: Leakage by Shared Concept Group');
  lines.push('');
  lines.push(renderTable(['pairing_id', 'condition', 'source', 'concept', 'leakage_rate', 'n'], rowsForConceptLeakage(rawAnalysis.conceptLeakage)));
  lines.push('');

  lines.push('## Notes');
  lines.push('');
  lines.push('- The repository does not expose an explicit attacker protocol version string. The report labels it as unversioned and notes the observed 6-level escalation pattern.');
  lines.push('- `PeerWise` is represented as `pairwise` in the raw artifacts and is normalized to `PeerWise` in this report.');
  lines.push('- Controlled leakage uses the requested join key `(question_id, tutor_model_id)` from the merged conversation records and the closed-book MCQ accuracy file.');
  lines.push('- Cost metrics are labeled `observed` because they depend on `calls[].usage.cost`; any missing per-call cost fields lower the observed total.');

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${lines.join('\n')}\n`);
  console.log(`Wrote ${outPath}`);
}

buildReport().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
