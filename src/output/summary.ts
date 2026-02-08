import type { Condition, Difficulty, RunRecord } from '../types';

// GroupKey now uses string for pairingId since it can be legacy or new format
type GroupKey = `${string}::${Condition}::${number}::${Difficulty}`;

type LoopAgg = {
  initiallyRejectedTurns: number;
  fixedTurns: number;
  iterationCounts: Record<string, number>;
  totalIterations: number;
  totalTurns: number;
  interventionCount: number;
  turnsWithIntervention: number;
};

type MetricsAgg = {
  nRuns: number;
  nJudged: number;
  leakageCount: number;
  hallucinationCount: number;
  complianceCount: number;
  totalLatencyMs: number;
  loop?: LoopAgg;
};

export class SummaryAggregator {
  private groups = new Map<GroupKey, MetricsAgg>();

  add(record: RunRecord) {
    const key: GroupKey = `${record.pairingId}::${record.condition}::${record.question.bloomLevel}::${record.question.difficulty}`;
    const agg = this.groups.get(key) ?? this.initAgg(record.condition);

    agg.nRuns += 1;
    agg.totalLatencyMs += record.totalLatencyMs;

    const runSummary = summarizeRunJudgment(record);
    if (runSummary) {
      agg.nJudged += 1;
      if (runSummary.leakage) agg.leakageCount += 1;
      if (runSummary.hallucination) agg.hallucinationCount += 1;
      if (runSummary.compliance) agg.complianceCount += 1;
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

    this.groups.set(key, agg);
  }

  toSummaryObject() {
    const breakdown: Record<string, any> = {};

    for (const [key, agg] of this.groups.entries()) {
      const [pairingId, condition, bloomStr, difficulty] = key.split('::');
      breakdown[pairingId] ??= {};
      breakdown[pairingId][condition] ??= {};
      const bloomLevel = Number(bloomStr);
      const cellKey = `b${bloomLevel}-${difficulty}`;

      breakdown[pairingId][condition][cellKey] = finalizeAgg(agg);
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

function summarizeRunJudgment(
  record: RunRecord
): { leakage: boolean; hallucination: boolean; compliance: boolean } | null {
  if (record.judge) {
    return {
      leakage: record.judge.leakage,
      hallucination: record.judge.hallucination,
      compliance: record.judge.compliance,
    };
  }

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

  return {
    nRuns: agg.nRuns,
    nJudged: agg.nJudged,
    leakageRate,
    hallucinationRate,
    complianceRate,
    avgLatencyMs,
    loop,
  };
}
