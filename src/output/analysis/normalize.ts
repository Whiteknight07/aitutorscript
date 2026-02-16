import type { RunRecord } from '../../types';
import type { LoopSummary, NormalizedRun, TurnRow } from './types';
import { labPairType, supervisorLabFromId, tutorLabFromId } from './labs';

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function getQuestionStringField(question: Record<string, unknown> | null, ...keys: string[]): string | null {
  if (!question) return null;
  for (const key of keys) {
    const value = toNonEmptyString(question[key]);
    if (value) return value;
  }
  return null;
}

function getQuestionTag(question: Record<string, unknown> | null): string | null {
  if (!question) return null;
  const direct = getQuestionStringField(question, 'tag');
  if (direct) return direct;

  const tags = question.tags;
  if (Array.isArray(tags)) {
    for (const raw of tags) {
      const value = toNonEmptyString(raw);
      if (value) return value;
    }
  }
  return null;
}

function getRunDataset(record: RunRecord, question: Record<string, unknown> | null): string | null {
  const questionDataset = getQuestionStringField(question, 'dataset');
  if (questionDataset) return questionDataset;

  const cfg = asObject(record.config);
  const cfgDataset = getQuestionStringField(cfg, 'dataset');
  if (cfgDataset) return cfgDataset;

  const args = asObject(cfg?.args);
  return getQuestionStringField(args, 'dataset');
}

export function deriveTutorId(record: RunRecord): string {
  const cfg = record.config as { tutorId?: string } | null;
  if (cfg?.tutorId) return String(cfg.tutorId);
  const pid = record.pairingId ? String(record.pairingId) : 'unknown';
  const parts = pid.split('-');
  return parts[0] || 'unknown';
}

export function deriveSupervisorId(record: RunRecord): string | null {
  const cfg = record.config as { supervisorId?: string } | null;
  if (cfg?.supervisorId) return String(cfg.supervisorId);
  if (record.condition !== 'dual-loop') return null;
  const pid = record.pairingId ? String(record.pairingId) : '';
  const parts = pid.split('-');
  return parts.length >= 2 && parts[1] ? parts[1] : null;
}

export function computeLoopSummary(loop: RunRecord['loopTurnIterations']): LoopSummary | null {
  if (!Array.isArray(loop) || loop.length === 0) return null;
  let turns = 0;
  let initiallyRejectedTurns = 0;
  let fixedTurns = 0;
  let totalIterations = 0;
  let interventionCount = 0;

  for (const row of loop) {
    turns += 1;
    if (row?.initiallyRejected) initiallyRejectedTurns += 1;
    if (row?.initiallyRejected && row?.endedApproved) fixedTurns += 1;
    const iterations = Number(row?.iterationsUsed);
    if (Number.isFinite(iterations) && iterations > 0) {
      totalIterations += iterations;
      interventionCount += Math.max(0, iterations - 1);
    }
  }

  return { turns, initiallyRejectedTurns, fixedTurns, totalIterations, interventionCount };
}

export function normalizeRun(record: RunRecord, runKey: string): NormalizedRun {
  const question = record.question;
  const questionObj = asObject(question);
  const csbenchObj = asObject(questionObj?.csbench);
  const tutorId = deriveTutorId(record);
  const supervisorId = deriveSupervisorId(record);
  const turnJudgments = Array.isArray(record.hiddenTrace?.turnJudgments) ? record.hiddenTrace.turnJudgments : [];
  const hasTurnJudgments = turnJudgments.length > 0;
  const turnLeakage = hasTurnJudgments ? turnJudgments.some((t) => t?.judge?.leakage === true) : null;
  const turnHallucination = hasTurnJudgments
    ? turnJudgments.some((t) => t?.judge?.hallucination === true)
    : null;
  const turnNonCompliance = hasTurnJudgments
    ? turnJudgments.some((t) => t?.judge?.compliance === false)
    : null;
  const leakage = turnLeakage;
  const hallucination = turnHallucination;
  const compliance = hasTurnJudgments ? !turnNonCompliance : null;
  const judged = hasTurnJudgments;

  const endedEarly = record.turnsCompleted < record.turnsRequested;
  const lastTurnJudge = hasTurnJudgments ? turnJudgments[turnJudgments.length - 1]?.judge ?? null : null;
  const earlyReason =
    endedEarly && lastTurnJudge?.shouldTerminate ? String(lastTurnJudge.terminationReason) : null;
  const earlyStopLeakage = endedEarly && earlyReason === 'leakage';
  const tutorLab = tutorLabFromId(tutorId);
  const supervisorLab = supervisorLabFromId(supervisorId);
  const pairType = labPairType(tutorLab, supervisorLab);

  return {
    runId: record.runId,
    runKey,
    createdAtIso: record.createdAtIso,
    questionId: question?.id ?? 'unknown',
    dataset: getRunDataset(record, questionObj),
    questionFormat: getQuestionStringField(questionObj, 'questionFormat', 'format', 'csbenchFormat'),
    domain: getQuestionStringField(questionObj, 'domain') ?? getQuestionStringField(csbenchObj, 'domain'),
    subDomain:
      getQuestionStringField(questionObj, 'subDomain', 'subdomain') ??
      getQuestionStringField(csbenchObj, 'subDomain', 'subdomain'),
    tag: getQuestionTag(questionObj) ?? getQuestionTag(csbenchObj),
    bloomLevel: typeof question?.bloomLevel === 'number' ? question.bloomLevel : null,
    difficulty: typeof question?.difficulty === 'string' ? question.difficulty : null,
    topicTag: typeof question?.topicTag === 'string' ? question.topicTag : null,
    pairingId: String(record.pairingId ?? ''),
    condition: record.condition,
    tutorId,
    tutorLab,
    supervisorId,
    supervisorLab,
    labPairType: pairType,
    turnsRequested: record.turnsRequested,
    turnsCompleted: record.turnsCompleted,
    latencyMs: Number.isFinite(record.totalLatencyMs) ? record.totalLatencyMs : null,
    judged,
    leakage,
    hallucination,
    compliance,
    endedEarly,
    earlyReason,
    earlyStopLeakage,
    loop: computeLoopSummary(record.loopTurnIterations),
  };
}

export function buildTurnRows(record: RunRecord, run: NormalizedRun): TurnRow[] {
  const studentTurns = Array.isArray(record.hiddenTrace?.studentTurns) ? record.hiddenTrace.studentTurns : [];
  const turnJudgments = Array.isArray(record.hiddenTrace?.turnJudgments) ? record.hiddenTrace.turnJudgments : [];
  const judgeByIndex = new Map<number, (typeof turnJudgments)[number]['judge']>();
  let maxJudgeIndex = -1;
  let hasZeroIndex = false;
  for (const tj of turnJudgments) {
    const idx = Number(tj?.turnIndex);
    if (Number.isFinite(idx)) {
      if (idx === 0) hasZeroIndex = true;
    }
  }
  const judgeIndexOffset = hasZeroIndex ? 0 : 1;
  for (const tj of turnJudgments) {
    const idx = Number(tj?.turnIndex);
    if (!Number.isFinite(idx)) continue;
    const normalized = idx - judgeIndexOffset;
    if (!Number.isFinite(normalized) || normalized < 0) continue;
    judgeByIndex.set(normalized, tj.judge);
    if (normalized > maxJudgeIndex) maxJudgeIndex = normalized;
  }

  const maxIndex = Math.max(studentTurns.length - 1, maxJudgeIndex);
  const rows: TurnRow[] = [];
  const toBool = (value: unknown): boolean | null => {
    if (value === true) return true;
    if (value === false) return false;
    return null;
  };

  for (let i = 0; i <= maxIndex; i += 1) {
    const st = studentTurns[i];
    const judge = judgeByIndex.get(i) ?? null;
    if (!st && !judge) continue;
    const attackLevel = Number.isFinite(Number(st?.attackLevel)) ? Number(st?.attackLevel) : null;
    const judged = !!judge;
    rows.push({
      runKey: run.runKey,
      tutorId: run.tutorId,
      supervisorId: run.supervisorId,
      condition: run.condition,
      questionId: run.questionId,
      dataset: run.dataset,
      questionFormat: run.questionFormat,
      domain: run.domain,
      subDomain: run.subDomain,
      tag: run.tag,
      bloomLevel: run.bloomLevel,
      difficulty: run.difficulty,
      topicTag: run.topicTag,
      turnIndex: i,
      attackLevel,
      judged,
      leakage: judge ? toBool(judge.leakage) : null,
      hallucination: judge ? toBool(judge.hallucination) : null,
      compliance: judge ? toBool(judge.compliance) : null,
      shouldTerminate: judge ? toBool(judge.shouldTerminate) : null,
      terminationReason: judge ? String(judge.terminationReason) : null,
    });
  }
  return rows;
}
