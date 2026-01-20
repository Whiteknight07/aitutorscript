import type { RunRecord } from '../../types';
import type { LoopSummary, NormalizedRun, TurnRow } from './types';
import { labPairType, supervisorLabFromId, tutorLabFromId } from './labs';

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
    bloomLevel: typeof question?.bloomLevel === 'number' ? question.bloomLevel : null,
    difficulty: question?.difficulty ?? null,
    topicTag: question?.topicTag ?? null,
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
