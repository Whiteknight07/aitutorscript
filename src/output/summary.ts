import type { Condition, RunRecord } from '../types';
import { extractRiskGateRunSummary } from './analysis/normalize';

type GroupKey = string;

type LoopAgg = {
  initiallyRejectedTurns: number;
  fixedTurns: number;
  iterationCounts: Record<string, number>;
  totalIterations: number;
  totalTurns: number;
  interventionCount: number;
  turnsWithIntervention: number;
};

type GateAgg = {
  runsWithGate: number;
  turnsEvaluated: number;
  superviseDecisions: number;
  skipDecisions: number;
  shadowDecisions: number;
  fallbackOpenAICalls: number;
  failures: number;
  labeledDecisions: number;
  truePositive: number;
  falsePositive: number;
  trueNegative: number;
  falseNegative: number;
};

type MetricsAgg = {
  nRuns: number;
  nJudged: number;
  leakageCount: number;
  hallucinationCount: number;
  complianceCount: number;
  totalLatencyMs: number;
  loop?: LoopAgg;
  gate?: GateAgg;
};

type SummaryDimensions = {
  pairingId: string;
  condition: Condition;
  dataset: string | null;
  questionFormat: string | null;
  domain: string | null;
  subDomain: string | null;
  tag: string | null;
  bloomLevel: number | null;
  difficulty: string | null;
};

type GroupState = {
  pairingId: string;
  condition: Condition;
  cellKey: string;
  metrics: MetricsAgg;
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeDifficulty(value: unknown): string | null {
  const normalized = toNonEmptyString(value);
  if (!normalized) return null;
  const lower = normalized.toLowerCase();
  if (
    lower === 'unknown' ||
    lower === 'n/a' ||
    lower === 'na' ||
    lower === 'none' ||
    lower === 'null' ||
    lower === '?'
  ) {
    return null;
  }
  return normalized;
}

function readQuestionString(question: Record<string, unknown> | null, ...keys: string[]): string | null {
  if (!question) return null;
  for (const key of keys) {
    const value = toNonEmptyString(question[key]);
    if (value) return value;
  }
  return null;
}

function readQuestionTag(question: Record<string, unknown> | null): string | null {
  if (!question) return null;
  const direct = readQuestionString(question, 'tag');
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

function readDataset(record: RunRecord, question: Record<string, unknown> | null): string | null {
  const questionDataset = readQuestionString(question, 'dataset');
  if (questionDataset) return questionDataset;
  const cfg = asObject(record.config);
  const cfgDataset = readQuestionString(cfg, 'dataset');
  if (cfgDataset) return cfgDataset;
  const args = asObject(cfg?.args);
  return readQuestionString(args, 'dataset');
}

function normalizeKeyPart(value: string | number | null): string {
  if (value == null) return 'unknown';
  const trimmed = String(value).trim();
  if (!trimmed) return 'unknown';
  return encodeURIComponent(trimmed);
}

function buildDimensions(record: RunRecord): SummaryDimensions {
  const question = asObject(record.question);
  const csbench = asObject(question?.csbench);
  return {
    pairingId: String(record.pairingId ?? ''),
    condition: record.condition,
    dataset: readDataset(record, question),
    questionFormat: readQuestionString(question, 'questionFormat', 'format', 'csbenchFormat'),
    domain: readQuestionString(question, 'domain') ?? readQuestionString(csbench, 'domain'),
    subDomain:
      readQuestionString(question, 'subDomain', 'subdomain') ??
      readQuestionString(csbench, 'subDomain', 'subdomain'),
    tag: readQuestionTag(question) ?? readQuestionTag(csbench),
    bloomLevel: typeof record.question?.bloomLevel === 'number' ? record.question.bloomLevel : null,
    difficulty: normalizeDifficulty(record.question?.difficulty),
  };
}

function hasDatasetAwareDimensions(dim: SummaryDimensions): boolean {
  if (dim.questionFormat || dim.domain || dim.subDomain || dim.tag) return true;
  if (dim.dataset && dim.dataset.toLowerCase() === 'csbench') return true;
  return dim.bloomLevel == null && !dim.difficulty;
}

function buildCellKey(dim: SummaryDimensions): string {
  if (!hasDatasetAwareDimensions(dim) && dim.bloomLevel != null) {
    const bloomLabel = dim.bloomLevel != null ? String(dim.bloomLevel) : 'null';
    const difficultyLabel = dim.difficulty ?? 'unknown';
    return `b${bloomLabel}-${difficultyLabel}`;
  }

  const parts = [
    `dataset-${normalizeKeyPart(dim.dataset)}`,
    `format-${normalizeKeyPart(dim.questionFormat)}`,
    `domain-${normalizeKeyPart(dim.domain)}`,
  ];

  if (dim.subDomain) parts.push(`subdomain-${normalizeKeyPart(dim.subDomain)}`);
  if (dim.tag) parts.push(`tag-${normalizeKeyPart(dim.tag)}`);
  if (dim.bloomLevel != null) parts.push(`bloom-${dim.bloomLevel}`);
  if (dim.difficulty) parts.push(`difficulty-${normalizeKeyPart(dim.difficulty)}`);

  return parts.join('__');
}

function buildGroupKey(pairingId: string, condition: Condition, cellKey: string): GroupKey {
  return JSON.stringify([pairingId, condition, cellKey]);
}

export class SummaryAggregator {
  private groups = new Map<GroupKey, GroupState>();

  add(record: RunRecord) {
    const dimensions = buildDimensions(record);
    const cellKey = buildCellKey(dimensions);
    const key = buildGroupKey(dimensions.pairingId, dimensions.condition, cellKey);
    const state =
      this.groups.get(key) ?? {
        pairingId: dimensions.pairingId,
        condition: dimensions.condition,
        cellKey,
        metrics: this.initAgg(record.condition),
      };
    const agg = state.metrics;

    agg.nRuns += 1;
    agg.totalLatencyMs += record.totalLatencyMs;

    const turnSummary = summarizeTurnJudgments(record);
    if (turnSummary) {
      agg.nJudged += 1;
      if (turnSummary.leakage) agg.leakageCount += 1;
      if (turnSummary.hallucination) agg.hallucinationCount += 1;
      if (turnSummary.compliance) agg.complianceCount += 1;
    }

    if (record.condition === 'dual-loop' && record.loopTurnIterations && agg.loop) {
      for (const t of record.loopTurnIterations) {
        agg.loop.totalTurns += 1;
        agg.loop.totalIterations += t.iterationsUsed;
        agg.loop.iterationCounts[String(t.iterationsUsed)] =
          (agg.loop.iterationCounts[String(t.iterationsUsed)] ?? 0) + 1;
        if (t.initiallyRejected) {
          agg.loop.initiallyRejectedTurns += 1;
          agg.loop.turnsWithIntervention += 1;
          agg.loop.interventionCount += t.iterationsUsed - 1;
          if (t.endedApproved) agg.loop.fixedTurns += 1;
        }
      }
    }

    const riskGate = extractRiskGateRunSummary(record);
    if (riskGate) {
      agg.gate ??= {
        runsWithGate: 0,
        turnsEvaluated: 0,
        superviseDecisions: 0,
        skipDecisions: 0,
        shadowDecisions: 0,
        fallbackOpenAICalls: 0,
        failures: 0,
        labeledDecisions: 0,
        truePositive: 0,
        falsePositive: 0,
        trueNegative: 0,
        falseNegative: 0,
      };
      agg.gate.runsWithGate += 1;
      agg.gate.turnsEvaluated += riskGate.turnsEvaluated;
      agg.gate.superviseDecisions += riskGate.superviseDecisions;
      agg.gate.skipDecisions += riskGate.skipDecisions;
      agg.gate.shadowDecisions += riskGate.shadowDecisions;
      agg.gate.fallbackOpenAICalls += riskGate.fallbackOpenAICalls;
      agg.gate.failures += riskGate.failures;
      agg.gate.labeledDecisions += riskGate.labeledDecisions;
      agg.gate.truePositive += riskGate.truePositive;
      agg.gate.falsePositive += riskGate.falsePositive;
      agg.gate.trueNegative += riskGate.trueNegative;
      agg.gate.falseNegative += riskGate.falseNegative;
    }

    this.groups.set(key, state);
  }

  toSummaryObject() {
    const breakdown: Record<string, any> = {};

    for (const state of this.groups.values()) {
      const { pairingId, condition, cellKey, metrics } = state;
      breakdown[pairingId] ??= {};
      breakdown[pairingId][condition] ??= {};

      breakdown[pairingId][condition][cellKey] = finalizeAgg(metrics);
    }

    return { breakdown };
  }

  private initAgg(condition: Condition): MetricsAgg {
    return {
      nRuns: 0,
      nJudged: 0,
      leakageCount: 0,
      hallucinationCount: 0,
      complianceCount: 0,
      totalLatencyMs: 0,
      loop:
        condition === 'dual-loop'
          ? {
              initiallyRejectedTurns: 0,
              fixedTurns: 0,
              iterationCounts: {},
              totalIterations: 0,
              totalTurns: 0,
              interventionCount: 0,
              turnsWithIntervention: 0,
            }
          : undefined,
    };
  }
}

function summarizeTurnJudgments(
  record: RunRecord
): { leakage: boolean; hallucination: boolean; compliance: boolean } | null {
  const turnJudgments = Array.isArray(record.hiddenTrace?.turnJudgments) ? record.hiddenTrace.turnJudgments : [];
  if (!turnJudgments.length) return null;
  const leakage = turnJudgments.some((t) => t?.judge?.leakage === true);
  const hallucination = turnJudgments.some((t) => t?.judge?.hallucination === true);
  const nonCompliance = turnJudgments.some((t) => t?.judge?.compliance === false);
  return { leakage, hallucination, compliance: !nonCompliance };
}

function finalizeAgg(agg: MetricsAgg) {
  const avgLatencyMs = agg.nRuns ? agg.totalLatencyMs / agg.nRuns : null;
  const leakageRate = agg.nJudged ? agg.leakageCount / agg.nJudged : null;
  const hallucinationRate = agg.nJudged ? agg.hallucinationCount / agg.nJudged : null;
  const complianceRate = agg.nJudged ? agg.complianceCount / agg.nJudged : null;

  const loop = agg.loop
    ? {
        loopFixRate: agg.loop.initiallyRejectedTurns
          ? agg.loop.fixedTurns / agg.loop.initiallyRejectedTurns
          : null,
        avgIterationsPerTurn: agg.loop.totalTurns ? agg.loop.totalIterations / agg.loop.totalTurns : null,
        iterationDistribution: agg.loop.iterationCounts,
        initiallyRejectedTurns: agg.loop.initiallyRejectedTurns,
        fixedTurns: agg.loop.fixedTurns,
        totalTurns: agg.loop.totalTurns,
        interventionCount: agg.loop.interventionCount,
        turnsWithIntervention: agg.loop.turnsWithIntervention,
        interventionRate: agg.loop.totalTurns ? agg.loop.turnsWithIntervention / agg.loop.totalTurns : null,
        avgInterventionsPerTurn: agg.loop.totalTurns ? agg.loop.interventionCount / agg.loop.totalTurns : null,
      }
    : null;

  const gate = agg.gate
    ? {
        runsWithGate: agg.gate.runsWithGate,
        turnsEvaluated: agg.gate.turnsEvaluated,
        superviseDecisions: agg.gate.superviseDecisions,
        superviseRate: agg.gate.turnsEvaluated ? agg.gate.superviseDecisions / agg.gate.turnsEvaluated : null,
        skipDecisions: agg.gate.skipDecisions,
        skipRate: agg.gate.turnsEvaluated ? agg.gate.skipDecisions / agg.gate.turnsEvaluated : null,
        shadowDecisions: agg.gate.shadowDecisions,
        shadowRate: agg.gate.turnsEvaluated ? agg.gate.shadowDecisions / agg.gate.turnsEvaluated : null,
        fallbackOpenAICalls: agg.gate.fallbackOpenAICalls,
        fallbackRate: agg.gate.turnsEvaluated ? agg.gate.fallbackOpenAICalls / agg.gate.turnsEvaluated : null,
        failures: agg.gate.failures,
        failureRate: agg.gate.turnsEvaluated ? agg.gate.failures / agg.gate.turnsEvaluated : null,
        supervisorCallReductionPct: agg.gate.turnsEvaluated
          ? 1 - agg.gate.superviseDecisions / agg.gate.turnsEvaluated
          : null,
        labeledDecisions: agg.gate.labeledDecisions,
        truePositive: agg.gate.truePositive,
        falsePositive: agg.gate.falsePositive,
        trueNegative: agg.gate.trueNegative,
        falseNegative: agg.gate.falseNegative,
        recall:
          agg.gate.truePositive + agg.gate.falseNegative
            ? agg.gate.truePositive / (agg.gate.truePositive + agg.gate.falseNegative)
            : null,
        precision:
          agg.gate.truePositive + agg.gate.falsePositive
            ? agg.gate.truePositive / (agg.gate.truePositive + agg.gate.falsePositive)
            : null,
        fnr:
          agg.gate.truePositive + agg.gate.falseNegative
            ? agg.gate.falseNegative / (agg.gate.truePositive + agg.gate.falseNegative)
            : null,
      }
    : null;

  return {
    nRuns: agg.nRuns,
    nJudged: agg.nJudged,
    leakageRate,
    hallucinationRate,
    complianceRate,
    avgLatencyMs,
    loop,
    gate,
  };
}
