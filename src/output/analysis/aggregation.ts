import type { ConditionEffectRow, NormalizedRun, RunGroupRow, TurnGroupRow, TurnRow } from './types';
import { buildRateStats, descriptiveStats } from './stats';
import { uniqueSorted } from './utils';

export function buildRunGroupRow(rows: NormalizedRun[]): RunGroupRow {
  const nRuns = rows.length;
  const nJudgedRuns = rows.filter((r) => r.judged).length;
  const leakageCount = rows.filter((r) => r.leakage === true).length;
  const hallucinationCount = rows.filter((r) => r.hallucination === true).length;
  const complianceCount = rows.filter((r) => r.compliance === true).length;
  const earlyStopCount = rows.filter((r) => r.endedEarly).length;
  const earlyStopLeakageCount = rows.filter((r) => r.earlyStopLeakage).length;
  const earlyStopOtherCount = Math.max(0, earlyStopCount - earlyStopLeakageCount);

  const leakageStats = buildRateStats(leakageCount, nJudgedRuns);
  const hallucinationStats = buildRateStats(hallucinationCount, nJudgedRuns);
  const complianceStats = buildRateStats(complianceCount, nJudgedRuns);
  const earlyStopStats = buildRateStats(earlyStopCount, nRuns);

  const latencies = rows
    .map((r) => r.latencyMs)
    .filter((v): v is number => Number.isFinite(v));
  const latencyStats = descriptiveStats(latencies);
  let loopRuns = 0;
  let loopTurns = 0;
  let loopInitiallyRejectedTurns = 0;
  let loopFixedTurns = 0;
  let loopTotalIterations = 0;
  let loopInterventionCount = 0;
  for (const r of rows) {
    if (!r.loop) continue;
    loopRuns += 1;
    loopTurns += r.loop.turns;
    loopInitiallyRejectedTurns += r.loop.initiallyRejectedTurns;
    loopFixedTurns += r.loop.fixedTurns;
    loopTotalIterations += r.loop.totalIterations;
    loopInterventionCount += r.loop.interventionCount;
  }

  const loopInterventionRate = loopTurns ? loopInitiallyRejectedTurns / loopTurns : null;
  const loopFixRate = loopInitiallyRejectedTurns ? loopFixedTurns / loopInitiallyRejectedTurns : null;
  const loopAvgIterationsPerTurn = loopTurns ? loopTotalIterations / loopTurns : null;
  const loopAvgInterventionsPerTurn = loopTurns ? loopInterventionCount / loopTurns : null;

  return {
    nRuns,
    nJudgedRuns,
    leakageCount,
    leakageRate: leakageStats.rate,
    hallucinationCount,
    hallucinationRate: hallucinationStats.rate,
    complianceCount,
    complianceRate: complianceStats.rate,
    earlyStopCount,
    earlyStopRate: earlyStopStats.rate,
    earlyStopLeakageCount,
    earlyStopOtherCount,
    latencyCount: latencyStats.n,
    latencyMeanMs: latencyStats.mean,
    latencyMedianMs: latencyStats.median,
    latencyP90Ms: latencyStats.p90,
    latencyP95Ms: latencyStats.p95,
    latencyP99Ms: latencyStats.p99,
    latencyMinMs: latencyStats.min,
    latencyMaxMs: latencyStats.max,
    latencyStdMs: latencyStats.std,
    loopRuns,
    loopTurns,
    loopInitiallyRejectedTurns,
    loopFixedTurns,
    loopTotalIterations,
    loopInterventionCount,
    loopInterventionRate,
    loopFixRate,
    loopAvgIterationsPerTurn,
    loopAvgInterventionsPerTurn,
  };
}

export function buildTurnGroupRow(rows: TurnRow[]): TurnGroupRow {
  const nTurns = rows.length;
  const nJudgedTurns = rows.filter((r) => r.judged).length;
  const leakageCount = rows.filter((r) => r.leakage === true).length;
  const hallucinationCount = rows.filter((r) => r.hallucination === true).length;
  const complianceCount = rows.filter((r) => r.compliance === true).length;
  const terminationCount = rows.filter((r) => r.shouldTerminate === true).length;

  const leakageStats = buildRateStats(leakageCount, nJudgedTurns);
  const hallucinationStats = buildRateStats(hallucinationCount, nJudgedTurns);
  const complianceStats = buildRateStats(complianceCount, nJudgedTurns);
  const terminationStats = buildRateStats(terminationCount, nJudgedTurns);

  return {
    nTurns,
    nJudgedTurns,
    leakageCount,
    leakageRate: leakageStats.rate,
    hallucinationCount,
    hallucinationRate: hallucinationStats.rate,
    complianceCount,
    complianceRate: complianceStats.rate,
    terminationCount,
    terminationRate: terminationStats.rate,
  };
}

export function buildConditionEffects(
  runs: NormalizedRun[],
  tutors: string[]
): ConditionEffectRow[] {
  const rows: ConditionEffectRow[] = [];
  const tutorList = tutors.length ? tutors : uniqueSorted(runs.map((r) => r.tutorId));
  const tutorsWithAll = ['all', ...tutorList];

  for (const tutorId of tutorsWithAll) {
    const scoped = tutorId === 'all' ? runs : runs.filter((r) => r.tutorId === tutorId);
    const single = scoped.filter((r) => r.condition === 'single');
    const dual = scoped.filter((r) => r.condition === 'dual-loop');

    const singleJudged = single.filter((r) => r.judged);
    const dualJudged = dual.filter((r) => r.judged);

    const singleLeak = singleJudged.map((r) => r.leakage === true);
    const dualLeak = dualJudged.map((r) => r.leakage === true);
    const singleHalluc = singleJudged.map((r) => r.hallucination === true);
    const dualHalluc = dualJudged.map((r) => r.hallucination === true);
    const singleComp = singleJudged.map((r) => r.compliance === true);
    const dualComp = dualJudged.map((r) => r.compliance === true);
    const singleEarly = single.map((r) => r.endedEarly);
    const dualEarly = dual.map((r) => r.endedEarly);

    rows.push({
      tutorId,
      nSingleRuns: single.length,
      nDualRuns: dual.length,
      nSingleJudgedRuns: singleJudged.length,
      nDualJudgedRuns: dualJudged.length,
      leakageSingleRate: singleJudged.length ? singleLeak.filter(Boolean).length / singleJudged.length : null,
      leakageDualRate: dualJudged.length ? dualLeak.filter(Boolean).length / dualJudged.length : null,
      leakageDelta:
        singleJudged.length && dualJudged.length
          ? dualLeak.filter(Boolean).length / dualJudged.length - singleLeak.filter(Boolean).length / singleJudged.length
          : null,
      hallucinationSingleRate: singleJudged.length ? singleHalluc.filter(Boolean).length / singleJudged.length : null,
      hallucinationDualRate: dualJudged.length ? dualHalluc.filter(Boolean).length / dualJudged.length : null,
      hallucinationDelta:
        singleJudged.length && dualJudged.length
          ? dualHalluc.filter(Boolean).length / dualJudged.length -
            singleHalluc.filter(Boolean).length / singleJudged.length
          : null,
      complianceSingleRate: singleJudged.length ? singleComp.filter(Boolean).length / singleJudged.length : null,
      complianceDualRate: dualJudged.length ? dualComp.filter(Boolean).length / dualJudged.length : null,
      complianceDelta:
        singleJudged.length && dualJudged.length
          ? dualComp.filter(Boolean).length / dualJudged.length - singleComp.filter(Boolean).length / singleJudged.length
          : null,
      earlyStopSingleRate: single.length ? singleEarly.filter(Boolean).length / single.length : null,
      earlyStopDualRate: dual.length ? dualEarly.filter(Boolean).length / dual.length : null,
      earlyStopDelta:
        single.length && dual.length
          ? dualEarly.filter(Boolean).length / dual.length - singleEarly.filter(Boolean).length / single.length
          : null,
    });
  }

  return rows;
}
