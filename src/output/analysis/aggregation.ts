import type { ConditionEffectRow, NormalizedRun, RunGroupRow, TurnGroupRow, TurnRow } from './types';
import { buildRateDeltaStats, buildRateStats, descriptiveStats } from './stats';
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
    leakageCiLow: leakageStats.ciLow,
    leakageCiHigh: leakageStats.ciHigh,
    hallucinationCount,
    hallucinationRate: hallucinationStats.rate,
    hallucinationCiLow: hallucinationStats.ciLow,
    hallucinationCiHigh: hallucinationStats.ciHigh,
    complianceCount,
    complianceRate: complianceStats.rate,
    complianceCiLow: complianceStats.ciLow,
    complianceCiHigh: complianceStats.ciHigh,
    earlyStopCount,
    earlyStopRate: earlyStopStats.rate,
    earlyStopCiLow: earlyStopStats.ciLow,
    earlyStopCiHigh: earlyStopStats.ciHigh,
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
    leakageCiLow: leakageStats.ciLow,
    leakageCiHigh: leakageStats.ciHigh,
    hallucinationCount,
    hallucinationRate: hallucinationStats.rate,
    hallucinationCiLow: hallucinationStats.ciLow,
    hallucinationCiHigh: hallucinationStats.ciHigh,
    complianceCount,
    complianceRate: complianceStats.rate,
    complianceCiLow: complianceStats.ciLow,
    complianceCiHigh: complianceStats.ciHigh,
    terminationCount,
    terminationRate: terminationStats.rate,
    terminationCiLow: terminationStats.ciLow,
    terminationCiHigh: terminationStats.ciHigh,
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

    const singleLeakCount = singleLeak.filter(Boolean).length;
    const dualLeakCount = dualLeak.filter(Boolean).length;
    const singleHallucCount = singleHalluc.filter(Boolean).length;
    const dualHallucCount = dualHalluc.filter(Boolean).length;
    const singleCompCount = singleComp.filter(Boolean).length;
    const dualCompCount = dualComp.filter(Boolean).length;
    const singleEarlyCount = singleEarly.filter(Boolean).length;
    const dualEarlyCount = dualEarly.filter(Boolean).length;

    const leakSingleStats = buildRateStats(singleLeakCount, singleJudged.length);
    const leakDualStats = buildRateStats(dualLeakCount, dualJudged.length);
    const leakDeltaStats = buildRateDeltaStats(singleLeakCount, singleJudged.length, dualLeakCount, dualJudged.length);
    const hallucSingleStats = buildRateStats(singleHallucCount, singleJudged.length);
    const hallucDualStats = buildRateStats(dualHallucCount, dualJudged.length);
    const hallucDeltaStats = buildRateDeltaStats(
      singleHallucCount,
      singleJudged.length,
      dualHallucCount,
      dualJudged.length
    );
    const compSingleStats = buildRateStats(singleCompCount, singleJudged.length);
    const compDualStats = buildRateStats(dualCompCount, dualJudged.length);
    const compDeltaStats = buildRateDeltaStats(singleCompCount, singleJudged.length, dualCompCount, dualJudged.length);
    const earlySingleStats = buildRateStats(singleEarlyCount, single.length);
    const earlyDualStats = buildRateStats(dualEarlyCount, dual.length);
    const earlyDeltaStats = buildRateDeltaStats(singleEarlyCount, single.length, dualEarlyCount, dual.length);

    rows.push({
      tutorId,
      nSingleRuns: single.length,
      nDualRuns: dual.length,
      nSingleJudgedRuns: singleJudged.length,
      nDualJudgedRuns: dualJudged.length,
      leakageSingleRate: leakSingleStats.rate,
      leakageSingleCiLow: leakSingleStats.ciLow,
      leakageSingleCiHigh: leakSingleStats.ciHigh,
      leakageDualRate: leakDualStats.rate,
      leakageDualCiLow: leakDualStats.ciLow,
      leakageDualCiHigh: leakDualStats.ciHigh,
      leakageDelta: leakDeltaStats.delta,
      leakageDeltaCiLow: leakDeltaStats.ciLow,
      leakageDeltaCiHigh: leakDeltaStats.ciHigh,
      hallucinationSingleRate: hallucSingleStats.rate,
      hallucinationSingleCiLow: hallucSingleStats.ciLow,
      hallucinationSingleCiHigh: hallucSingleStats.ciHigh,
      hallucinationDualRate: hallucDualStats.rate,
      hallucinationDualCiLow: hallucDualStats.ciLow,
      hallucinationDualCiHigh: hallucDualStats.ciHigh,
      hallucinationDelta: hallucDeltaStats.delta,
      hallucinationDeltaCiLow: hallucDeltaStats.ciLow,
      hallucinationDeltaCiHigh: hallucDeltaStats.ciHigh,
      complianceSingleRate: compSingleStats.rate,
      complianceSingleCiLow: compSingleStats.ciLow,
      complianceSingleCiHigh: compSingleStats.ciHigh,
      complianceDualRate: compDualStats.rate,
      complianceDualCiLow: compDualStats.ciLow,
      complianceDualCiHigh: compDualStats.ciHigh,
      complianceDelta: compDeltaStats.delta,
      complianceDeltaCiLow: compDeltaStats.ciLow,
      complianceDeltaCiHigh: compDeltaStats.ciHigh,
      earlyStopSingleRate: earlySingleStats.rate,
      earlyStopSingleCiLow: earlySingleStats.ciLow,
      earlyStopSingleCiHigh: earlySingleStats.ciHigh,
      earlyStopDualRate: earlyDualStats.rate,
      earlyStopDualCiLow: earlyDualStats.ciLow,
      earlyStopDualCiHigh: earlyDualStats.ciHigh,
      earlyStopDelta: earlyDeltaStats.delta,
      earlyStopDeltaCiLow: earlyDeltaStats.ciLow,
      earlyStopDeltaCiHigh: earlyDeltaStats.ciHigh,
    });
  }

  return rows;
}
