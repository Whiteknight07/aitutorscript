import type { RunRecord } from '../../types';
import { labelQuestionBroadConcept } from '../../core/topic-normalization';
import type { LoopSummary, NormalizedRun, RiskGateDecision, RiskGateRunSummary, RiskGateSweepPoint, TurnRow } from './types';
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

function toBoolean(value: unknown): boolean | null {
  if (value === true) return true;
  if (value === false) return false;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === 'yes' || normalized === '1') return true;
    if (normalized === 'false' || normalized === 'no' || normalized === '0') return false;
  }
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  return null;
}

function toFiniteNumber(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}

function toNonNegativeInt(value: unknown): number | null {
  const n = toFiniteNumber(value);
  if (n == null) return null;
  return Math.max(0, Math.round(n));
}

function firstNonNull<T>(...values: Array<T | null | undefined>): T | null {
  for (const value of values) {
    if (value != null) return value;
  }
  return null;
}

function firstNonEmptyArray<T>(...arrays: Array<T[] | null | undefined>): T[] {
  for (const array of arrays) {
    if (Array.isArray(array) && array.length > 0) return array;
  }
  return [];
}

function numberField(obj: Record<string, unknown> | null, ...keys: string[]): number | null {
  if (!obj) return null;
  for (const key of keys) {
    const parsed = toFiniteNumber(obj[key]);
    if (parsed != null) return parsed;
  }
  return null;
}

function intField(obj: Record<string, unknown> | null, ...keys: string[]): number | null {
  if (!obj) return null;
  for (const key of keys) {
    const parsed = toNonNegativeInt(obj[key]);
    if (parsed != null) return parsed;
  }
  return null;
}

function boolField(obj: Record<string, unknown> | null, ...keys: string[]): boolean | null {
  if (!obj) return null;
  for (const key of keys) {
    const parsed = toBoolean(obj[key]);
    if (parsed != null) return parsed;
  }
  return null;
}

function sumNumbers(values: Array<number | null>): number | null {
  let total = 0;
  let count = 0;
  for (const value of values) {
    if (value == null) continue;
    total += value;
    count += 1;
  }
  return count ? total : null;
}

function normalizeRiskGateDecisionKind(value: unknown): RiskGateDecision['decision'] {
  const raw = toNonEmptyString(value);
  if (!raw) return 'unknown';
  const normalized = raw.toLowerCase();
  if (
    normalized === 'supervise' ||
    normalized === 'review' ||
    normalized === 'route' ||
    normalized === 'escalate' ||
    normalized === 'block'
  ) {
    return 'supervise';
  }
  if (normalized === 'skip' || normalized === 'allow' || normalized === 'pass' || normalized === 'approve') {
    return 'skip';
  }
  if (normalized === 'shadow' || normalized === 'observe') {
    return 'shadow';
  }
  return 'unknown';
}

function boolRate(numerator: number, denominator: number): number | null {
  if (!denominator) return null;
  return numerator / denominator;
}

function normalizeRiskGateDecision(value: unknown): RiskGateDecision | null {
  const obj = asObject(value);
  if (!obj) return null;

  const decision = normalizeRiskGateDecisionKind(
    firstNonNull(obj.decision, obj.action, obj.outcome, obj.route, obj.mode, obj.decisionType)
  );
  const predictedShouldSupervise =
    boolField(obj, 'predictedShouldSupervise', 'predictSupervise', 'gateTriggered', 'triggered') ??
    (decision === 'supervise' || decision === 'shadow'
      ? true
      : decision === 'skip'
        ? false
        : null);
  const labelShouldSupervise = boolField(
    obj,
    'labelShouldSupervise',
    'shouldSuperviseLabel',
    'groundTruthShouldSupervise',
    'expectedSupervise',
    'trueShouldSupervise',
    'isPositiveLabel'
  );
  const fallbackOpenAICall =
    boolField(
      obj,
      'fallbackOpenAICall',
      'fallbackOpenAiCall',
      'fallbackOpenAI',
      'usedOpenAIFallback',
      'didFallbackToOpenAI'
    ) ?? false;
  const failure =
    boolField(obj, 'failure', 'failed', 'isFailure', 'hadError', 'errorOccurred') ??
    !!(obj.error || obj.failureReason);
  const turnIndex = firstNonNull(
    intField(obj, 'turnIndex', 'turn', 'turnNumber', 'index'),
    numberField(obj, 'turnIndex', 'turn', 'turnNumber', 'index')
  );
  const latencyDeltaMs = numberField(
    obj,
    'latencyDeltaMs',
    'latencyDelta',
    'deltaLatencyMs',
    'latencySavedMs',
    'latencyOverheadMs'
  );
  const tokenDelta = numberField(obj, 'tokenDelta', 'deltaTokens', 'tokenSaved', 'tokensSaved', 'tokenDeltaTotal');

  const hasSignal =
    decision !== 'unknown' ||
    predictedShouldSupervise != null ||
    labelShouldSupervise != null ||
    fallbackOpenAICall ||
    failure ||
    latencyDeltaMs != null ||
    tokenDelta != null;
  if (!hasSignal) return null;

  return {
    turnIndex,
    decision,
    predictedShouldSupervise,
    labelShouldSupervise,
    fallbackOpenAICall,
    failure,
    latencyDeltaMs,
    tokenDelta,
  };
}

function normalizeRiskGateSweepPoint(value: unknown): RiskGateSweepPoint | null {
  const obj = asObject(value);
  if (!obj) return null;

  const threshold = numberField(obj, 'threshold', 'riskThreshold', 'gateThreshold', 'tau');
  if (threshold == null) return null;

  const turnsEvaluated = intField(obj, 'turnsEvaluated', 'evaluatedTurns', 'nTurnsEvaluated') ?? 0;
  const superviseDecisions = intField(obj, 'superviseDecisions', 'supervise', 'reviewDecisions', 'routeToSupervisor') ?? 0;
  const skipDecisions = intField(obj, 'skipDecisions', 'skip', 'allowDecisions') ?? 0;
  const shadowDecisions = intField(obj, 'shadowDecisions', 'shadow', 'shadowModeDecisions') ?? 0;
  const fallbackOpenAICalls =
    intField(obj, 'fallbackOpenAICalls', 'fallbackCalls', 'fallbackOpenAiCalls', 'openAIFallbackCalls') ?? 0;
  const failures = intField(obj, 'failures', 'failureCount', 'errors') ?? 0;

  const truePositive = intField(obj, 'truePositive', 'tp') ?? 0;
  const falsePositive = intField(obj, 'falsePositive', 'fp') ?? 0;
  const trueNegative = intField(obj, 'trueNegative', 'tn') ?? 0;
  const falseNegative = intField(obj, 'falseNegative', 'fn') ?? 0;

  const confusionDen = truePositive + falsePositive + trueNegative + falseNegative;
  const labeledDecisions = intField(obj, 'labeledDecisions', 'labelCount', 'nLabeled') ?? confusionDen;

  const recallFromCounts = boolRate(truePositive, truePositive + falseNegative);
  const precisionFromCounts = boolRate(truePositive, truePositive + falsePositive);
  const fnrFromCounts = boolRate(falseNegative, truePositive + falseNegative);

  const recall = firstNonNull(recallFromCounts, numberField(obj, 'recall'));
  const precision = firstNonNull(precisionFromCounts, numberField(obj, 'precision'));
  const fnr = firstNonNull(fnrFromCounts, numberField(obj, 'fnr', 'falseNegativeRate', 'missRate'));

  let latencyDeltaCount = intField(obj, 'latencyDeltaCount', 'latencyCount') ?? 0;
  let latencyDeltaMsTotal = numberField(obj, 'latencyDeltaMsTotal', 'latencyDeltaTotalMs', 'latencyDeltaMsTotalValue');
  let latencyDeltaMsMean = numberField(obj, 'latencyDeltaMsMean', 'latencyDeltaMeanMs', 'avgLatencyDeltaMs');
  if (latencyDeltaMsTotal == null) {
    const fallbackTotal = numberField(obj, 'latencyDeltaMs', 'latencyDelta');
    if (fallbackTotal != null) latencyDeltaMsTotal = fallbackTotal;
  }
  if (!latencyDeltaCount && latencyDeltaMsTotal != null && turnsEvaluated > 0) latencyDeltaCount = turnsEvaluated;
  if (latencyDeltaMsTotal == null && latencyDeltaMsMean != null && latencyDeltaCount > 0) {
    latencyDeltaMsTotal = latencyDeltaMsMean * latencyDeltaCount;
  }
  if (latencyDeltaMsMean == null && latencyDeltaMsTotal != null && latencyDeltaCount > 0) {
    latencyDeltaMsMean = latencyDeltaMsTotal / latencyDeltaCount;
  }

  let tokenDeltaCount = intField(obj, 'tokenDeltaCount', 'tokenCount') ?? 0;
  let tokenDeltaTotal = numberField(obj, 'tokenDeltaTotal', 'tokenDeltaTotalValue', 'tokensDeltaTotal');
  let tokenDeltaMean = numberField(obj, 'tokenDeltaMean', 'avgTokenDelta', 'tokenDeltaAvg');
  if (tokenDeltaTotal == null) {
    const fallbackTotal = numberField(obj, 'tokenDelta', 'tokensSaved', 'tokenSaved');
    if (fallbackTotal != null) tokenDeltaTotal = fallbackTotal;
  }
  if (!tokenDeltaCount && tokenDeltaTotal != null && turnsEvaluated > 0) tokenDeltaCount = turnsEvaluated;
  if (tokenDeltaTotal == null && tokenDeltaMean != null && tokenDeltaCount > 0) {
    tokenDeltaTotal = tokenDeltaMean * tokenDeltaCount;
  }
  if (tokenDeltaMean == null && tokenDeltaTotal != null && tokenDeltaCount > 0) {
    tokenDeltaMean = tokenDeltaTotal / tokenDeltaCount;
  }

  return {
    threshold,
    turnsEvaluated,
    superviseDecisions,
    skipDecisions,
    shadowDecisions,
    fallbackOpenAICalls,
    failures,
    labeledDecisions,
    truePositive,
    falsePositive,
    trueNegative,
    falseNegative,
    recall,
    precision,
    fnr,
    latencyDeltaCount,
    latencyDeltaMsTotal,
    latencyDeltaMsMean,
    tokenDeltaCount,
    tokenDeltaTotal,
    tokenDeltaMean,
  };
}

function toRiskGateDecisionArray(value: unknown): RiskGateDecision[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => normalizeRiskGateDecision(item)).filter((item): item is RiskGateDecision => item != null);
}

function toRiskGateSweepArray(value: unknown): RiskGateSweepPoint[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeRiskGateSweepPoint(item))
    .filter((item): item is RiskGateSweepPoint => item != null)
    .sort((a, b) => a.threshold - b.threshold);
}

export function extractRiskGateRunSummary(record: RunRecord): RiskGateRunSummary | null {
  const unsafeRecord = record as any;
  const runRiskGate = asObject(unsafeRecord?.riskGate);
  const hiddenTrace = asObject(unsafeRecord?.hiddenTrace);

  const decisions = firstNonEmptyArray(
    toRiskGateDecisionArray((hiddenTrace as any)?.riskGateDecisions),
    toRiskGateDecisionArray((runRiskGate as any)?.decisions),
    toRiskGateDecisionArray((runRiskGate as any)?.gateDecisions),
    toRiskGateDecisionArray((runRiskGate as any)?.decisionLog),
  );

  const thresholdSweep = firstNonEmptyArray(
    toRiskGateSweepArray((runRiskGate as any)?.thresholdSweep),
    toRiskGateSweepArray((runRiskGate as any)?.sweepPoints),
    toRiskGateSweepArray((runRiskGate as any)?.sweep),
  );

  const turnsEvaluatedDerived = decisions.length;
  const superviseDecisionsDerived = decisions.filter((d) => d.decision === 'supervise').length;
  const skipDecisionsDerived = decisions.filter((d) => d.decision === 'skip').length;
  const shadowDecisionsDerived = decisions.filter((d) => d.decision === 'shadow').length;
  const fallbackOpenAICallsDerived = decisions.filter((d) => d.fallbackOpenAICall).length;
  const failuresDerived = decisions.filter((d) => d.failure).length;

  let tpDerived = 0;
  let fpDerived = 0;
  let tnDerived = 0;
  let fnDerived = 0;
  for (const decision of decisions) {
    if (decision.labelShouldSupervise == null || decision.predictedShouldSupervise == null) continue;
    if (decision.predictedShouldSupervise && decision.labelShouldSupervise) tpDerived += 1;
    if (decision.predictedShouldSupervise && !decision.labelShouldSupervise) fpDerived += 1;
    if (!decision.predictedShouldSupervise && !decision.labelShouldSupervise) tnDerived += 1;
    if (!decision.predictedShouldSupervise && decision.labelShouldSupervise) fnDerived += 1;
  }

  const truePositive = intField(runRiskGate, 'truePositive', 'tp') ?? tpDerived;
  const falsePositive = intField(runRiskGate, 'falsePositive', 'fp') ?? fpDerived;
  const trueNegative = intField(runRiskGate, 'trueNegative', 'tn') ?? tnDerived;
  const falseNegative = intField(runRiskGate, 'falseNegative', 'fn') ?? fnDerived;
  const labeledDecisions =
    intField(runRiskGate, 'labeledDecisions', 'labelCount', 'nLabeled') ??
    truePositive + falsePositive + trueNegative + falseNegative;

  const turnsEvaluated =
    intField(runRiskGate, 'turnsEvaluated', 'evaluatedTurns', 'nTurnsEvaluated', 'decisionCount') ??
    turnsEvaluatedDerived;
  const superviseDecisions =
    intField(runRiskGate, 'superviseDecisions', 'supervise', 'reviewDecisions', 'routeToSupervisor') ??
    superviseDecisionsDerived;
  const skipDecisions = intField(runRiskGate, 'skipDecisions', 'skip', 'allowDecisions') ?? skipDecisionsDerived;
  const shadowDecisions = intField(runRiskGate, 'shadowDecisions', 'shadow', 'shadowModeDecisions') ?? shadowDecisionsDerived;
  const fallbackOpenAICalls =
    intField(runRiskGate, 'fallbackOpenAICalls', 'fallbackCalls', 'openAIFallbackCalls', 'fallbackOpenAiCalls') ??
    fallbackOpenAICallsDerived;
  const failures = intField(runRiskGate, 'failures', 'failureCount', 'errors') ?? failuresDerived;

  const recallFromCounts = boolRate(truePositive, truePositive + falseNegative);
  const precisionFromCounts = boolRate(truePositive, truePositive + falsePositive);
  const fnrFromCounts = boolRate(falseNegative, truePositive + falseNegative);

  const recall = firstNonNull(recallFromCounts, numberField(runRiskGate, 'recall'));
  const precision = firstNonNull(precisionFromCounts, numberField(runRiskGate, 'precision'));
  const fnr = firstNonNull(fnrFromCounts, numberField(runRiskGate, 'fnr', 'falseNegativeRate', 'missRate'));

  const latencyDeltas = decisions.map((d) => d.latencyDeltaMs);
  const tokenDeltas = decisions.map((d) => d.tokenDelta);

  let latencyDeltaCount = intField(runRiskGate, 'latencyDeltaCount', 'latencyCount') ?? 0;
  let latencyDeltaMsTotal = numberField(runRiskGate, 'latencyDeltaMsTotal', 'latencyDeltaTotalMs', 'latencyDeltaTotal');
  let latencyDeltaMsMean = numberField(runRiskGate, 'latencyDeltaMsMean', 'latencyDeltaMeanMs', 'avgLatencyDeltaMs');
  const latencySumDerived = sumNumbers(latencyDeltas);
  if (!latencyDeltaCount) latencyDeltaCount = latencyDeltas.filter((v) => v != null).length;
  if (latencyDeltaMsTotal == null) latencyDeltaMsTotal = latencySumDerived;
  if (latencyDeltaMsTotal == null) {
    const fallbackTotal = numberField(runRiskGate, 'latencyDeltaMs', 'latencyDelta');
    if (fallbackTotal != null) latencyDeltaMsTotal = fallbackTotal;
  }
  if (latencyDeltaMsTotal == null && latencyDeltaMsMean != null && latencyDeltaCount > 0) {
    latencyDeltaMsTotal = latencyDeltaMsMean * latencyDeltaCount;
  }
  if (latencyDeltaMsMean == null && latencyDeltaMsTotal != null && latencyDeltaCount > 0) {
    latencyDeltaMsMean = latencyDeltaMsTotal / latencyDeltaCount;
  }

  let tokenDeltaCount = intField(runRiskGate, 'tokenDeltaCount', 'tokenCount') ?? 0;
  let tokenDeltaTotal = numberField(runRiskGate, 'tokenDeltaTotal', 'tokenDeltaTotalValue', 'tokensDeltaTotal');
  let tokenDeltaMean = numberField(runRiskGate, 'tokenDeltaMean', 'avgTokenDelta', 'tokenDeltaAvg');
  const tokenSumDerived = sumNumbers(tokenDeltas);
  if (!tokenDeltaCount) tokenDeltaCount = tokenDeltas.filter((v) => v != null).length;
  if (tokenDeltaTotal == null) tokenDeltaTotal = tokenSumDerived;
  if (tokenDeltaTotal == null) {
    const fallbackTotal = numberField(runRiskGate, 'tokenDelta', 'tokensSaved', 'tokenSaved');
    if (fallbackTotal != null) tokenDeltaTotal = fallbackTotal;
  }
  if (tokenDeltaTotal == null && tokenDeltaMean != null && tokenDeltaCount > 0) {
    tokenDeltaTotal = tokenDeltaMean * tokenDeltaCount;
  }
  if (tokenDeltaMean == null && tokenDeltaTotal != null && tokenDeltaCount > 0) {
    tokenDeltaMean = tokenDeltaTotal / tokenDeltaCount;
  }

  const enabled = boolField(runRiskGate, 'enabled', 'isEnabled', 'active');
  const threshold = numberField(runRiskGate, 'threshold', 'riskThreshold', 'gateThreshold', 'tau');

  const hasAnySignal =
    runRiskGate != null ||
    decisions.length > 0 ||
    thresholdSweep.length > 0 ||
    turnsEvaluated > 0 ||
    superviseDecisions > 0 ||
    skipDecisions > 0 ||
    shadowDecisions > 0 ||
    fallbackOpenAICalls > 0 ||
    failures > 0 ||
    labeledDecisions > 0 ||
    recall != null ||
    precision != null ||
    fnr != null;
  if (!hasAnySignal) return null;

  return {
    enabled,
    threshold,
    turnsEvaluated,
    superviseDecisions,
    skipDecisions,
    shadowDecisions,
    fallbackOpenAICalls,
    failures,
    labeledDecisions,
    truePositive,
    falsePositive,
    trueNegative,
    falseNegative,
    recall,
    precision,
    fnr,
    supervisorCallReductionPct: turnsEvaluated ? 1 - superviseDecisions / turnsEvaluated : null,
    fallbackRate: turnsEvaluated ? fallbackOpenAICalls / turnsEvaluated : null,
    latencyDeltaCount,
    latencyDeltaMsTotal,
    latencyDeltaMsMean,
    tokenDeltaCount,
    tokenDeltaTotal,
    tokenDeltaMean,
    decisions,
    thresholdSweep,
  };
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
  const broadConcept = labelQuestionBroadConcept(question);
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
    broadConcept: broadConcept.concept,
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
    riskGate: extractRiskGateRunSummary(record),
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
      broadConcept: run.broadConcept,
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
