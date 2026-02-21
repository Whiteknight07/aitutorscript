import type { RunRecord } from '../../types';
import { BROAD_CONCEPTS, type BroadConcept } from '../../core/topic-normalization';
import { nowIso } from '../../utils/util';
import { buildConditionEffects, buildRunGroupRow, buildTurnGroupRow } from './aggregation';
import {
  buildBloomDifficultyEffects,
  buildLabEffects,
  buildLabInteraction,
  buildLabPairTypeEffects,
  buildSurvivalByCondition,
  buildSurvivalByPairType,
  buildTutorPairTypeEffects,
} from './comparisons';
import { buildTurnRows, normalizeRun } from './normalize';
import { difficultyOrder, groupBy, uniqueSorted, uniqueSortedNumbers } from './utils';
import type { AnalysisOutput, GateGroupRow, GateThresholdSweepRow, NormalizedRun, TurnRow } from './types';

export type { AnalysisOutput, ConditionEffectRow, RunGroupRow, TurnGroupRow } from './types';

type AnalysisOptions = {
  runId: string;
  createdAtIso: string;
  records: RunRecord[];
};

function tupleKey(parts: Array<string | number | null>): string {
  return JSON.stringify(parts);
}

const BROAD_CONCEPT_SET = new Set<string>(BROAD_CONCEPTS);

function toBroadConcept(value: string | null): BroadConcept | null {
  if (!value) return null;
  return BROAD_CONCEPT_SET.has(value) ? (value as BroadConcept) : null;
}

function buildTotals(runs: NormalizedRun[], turnRows: TurnRow[]) {
  return {
    runs: runs.length,
    judgedRuns: runs.filter((r) => r.judged).length,
    totalTurns: turnRows.length,
    judgedTurns: turnRows.filter((t) => t.judged).length,
    conditions: uniqueSorted(runs.map((r) => r.condition)),
    tutors: uniqueSorted(runs.map((r) => r.tutorId)),
    supervisors: uniqueSorted(runs.map((r) => r.supervisorId).filter(Boolean) as string[]),
    tutorLabs: uniqueSorted(runs.map((r) => r.tutorLab).filter(Boolean) as string[]),
    supervisorLabs: uniqueSorted(runs.map((r) => r.supervisorLab).filter(Boolean) as string[]),
    datasets: uniqueSorted(runs.map((r) => r.dataset)),
    questionFormats: uniqueSorted(runs.map((r) => r.questionFormat)),
    domains: uniqueSorted(runs.map((r) => r.domain)),
    subDomains: uniqueSorted(runs.map((r) => r.subDomain)),
    tags: uniqueSorted(runs.map((r) => r.tag)),
    broadConcepts: uniqueSorted(runs.map((r) => r.broadConcept)),
    attackLevels: uniqueSortedNumbers(turnRows.map((r) => r.attackLevel)),
  };
}

type GateAggAccumulator = {
  nRuns: number;
  nRunsWithGate: number;
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
  latencyDeltaCount: number;
  latencyDeltaMsTotal: number;
  latencyDeltaHasValue: boolean;
  tokenDeltaCount: number;
  tokenDeltaTotal: number;
  tokenDeltaHasValue: boolean;
};

type SweepAccumulator = {
  threshold: number;
  nPoints: number;
  runKeys: Set<string>;
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
  recallWeightedSum: number;
  recallWeight: number;
  precisionWeightedSum: number;
  precisionWeight: number;
  fnrWeightedSum: number;
  fnrWeight: number;
  latencyDeltaCount: number;
  latencyDeltaMsTotal: number;
  latencyDeltaHasValue: boolean;
  tokenDeltaCount: number;
  tokenDeltaTotal: number;
  tokenDeltaHasValue: boolean;
};

function initGateAggAccumulator(): GateAggAccumulator {
  return {
    nRuns: 0,
    nRunsWithGate: 0,
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
    latencyDeltaCount: 0,
    latencyDeltaMsTotal: 0,
    latencyDeltaHasValue: false,
    tokenDeltaCount: 0,
    tokenDeltaTotal: 0,
    tokenDeltaHasValue: false,
  };
}

function addRunToGateAccumulator(acc: GateAggAccumulator, run: NormalizedRun) {
  acc.nRuns += 1;
  if (!run.riskGate) return;
  const gate = run.riskGate;
  acc.nRunsWithGate += 1;
  acc.turnsEvaluated += gate.turnsEvaluated;
  acc.superviseDecisions += gate.superviseDecisions;
  acc.skipDecisions += gate.skipDecisions;
  acc.shadowDecisions += gate.shadowDecisions;
  acc.fallbackOpenAICalls += gate.fallbackOpenAICalls;
  acc.failures += gate.failures;
  acc.labeledDecisions += gate.labeledDecisions;
  acc.truePositive += gate.truePositive;
  acc.falsePositive += gate.falsePositive;
  acc.trueNegative += gate.trueNegative;
  acc.falseNegative += gate.falseNegative;
  if (gate.latencyDeltaMsTotal != null) {
    acc.latencyDeltaMsTotal += gate.latencyDeltaMsTotal;
    acc.latencyDeltaHasValue = true;
  }
  if (gate.latencyDeltaCount > 0) acc.latencyDeltaCount += gate.latencyDeltaCount;
  if (gate.tokenDeltaTotal != null) {
    acc.tokenDeltaTotal += gate.tokenDeltaTotal;
    acc.tokenDeltaHasValue = true;
  }
  if (gate.tokenDeltaCount > 0) acc.tokenDeltaCount += gate.tokenDeltaCount;
}

function finalizeGateAccumulator(acc: GateAggAccumulator): Omit<GateGroupRow, 'tutorId' | 'supervisorId' | 'condition'> {
  const superviseRate = acc.turnsEvaluated ? acc.superviseDecisions / acc.turnsEvaluated : null;
  const skipRate = acc.turnsEvaluated ? acc.skipDecisions / acc.turnsEvaluated : null;
  const shadowRate = acc.turnsEvaluated ? acc.shadowDecisions / acc.turnsEvaluated : null;
  const fallbackRate = acc.turnsEvaluated ? acc.fallbackOpenAICalls / acc.turnsEvaluated : null;
  const failureRate = acc.turnsEvaluated ? acc.failures / acc.turnsEvaluated : null;
  const recall = acc.truePositive + acc.falseNegative
    ? acc.truePositive / (acc.truePositive + acc.falseNegative)
    : null;
  const precision = acc.truePositive + acc.falsePositive
    ? acc.truePositive / (acc.truePositive + acc.falsePositive)
    : null;
  const fnr = acc.truePositive + acc.falseNegative
    ? acc.falseNegative / (acc.truePositive + acc.falseNegative)
    : null;
  const latencyDeltaMsTotal = acc.latencyDeltaHasValue ? acc.latencyDeltaMsTotal : null;
  const tokenDeltaTotal = acc.tokenDeltaHasValue ? acc.tokenDeltaTotal : null;

  return {
    nRuns: acc.nRuns,
    nRunsWithGate: acc.nRunsWithGate,
    turnsEvaluated: acc.turnsEvaluated,
    superviseDecisions: acc.superviseDecisions,
    superviseRate,
    skipDecisions: acc.skipDecisions,
    skipRate,
    shadowDecisions: acc.shadowDecisions,
    shadowRate,
    supervisorCallReductionPct: superviseRate == null ? null : 1 - superviseRate,
    fallbackOpenAICalls: acc.fallbackOpenAICalls,
    fallbackRate,
    failures: acc.failures,
    failureRate,
    labeledDecisions: acc.labeledDecisions,
    truePositive: acc.truePositive,
    falsePositive: acc.falsePositive,
    trueNegative: acc.trueNegative,
    falseNegative: acc.falseNegative,
    recall,
    precision,
    fnr,
    latencyDeltaCount: acc.latencyDeltaCount,
    latencyDeltaMsTotal,
    latencyDeltaMsMean:
      latencyDeltaMsTotal != null && acc.latencyDeltaCount > 0 ? latencyDeltaMsTotal / acc.latencyDeltaCount : null,
    tokenDeltaCount: acc.tokenDeltaCount,
    tokenDeltaTotal,
    tokenDeltaMean: tokenDeltaTotal != null && acc.tokenDeltaCount > 0 ? tokenDeltaTotal / acc.tokenDeltaCount : null,
  };
}

function buildGateGroupRows(runs: NormalizedRun[], groupKeyFn: (run: NormalizedRun) => string): Map<string, GateGroupRow> {
  const groups = new Map<string, GateAggAccumulator>();
  for (const run of runs) {
    const key = groupKeyFn(run);
    if (!groups.has(key)) groups.set(key, initGateAggAccumulator());
    const acc = groups.get(key);
    if (!acc) continue;
    addRunToGateAccumulator(acc, run);
  }

  const out = new Map<string, GateGroupRow>();
  for (const [key, acc] of groups.entries()) {
    if (!acc.nRunsWithGate) continue;
    out.set(key, finalizeGateAccumulator(acc));
  }
  return out;
}

function initSweepAccumulator(threshold: number): SweepAccumulator {
  return {
    threshold,
    nPoints: 0,
    runKeys: new Set<string>(),
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
    recallWeightedSum: 0,
    recallWeight: 0,
    precisionWeightedSum: 0,
    precisionWeight: 0,
    fnrWeightedSum: 0,
    fnrWeight: 0,
    latencyDeltaCount: 0,
    latencyDeltaMsTotal: 0,
    latencyDeltaHasValue: false,
    tokenDeltaCount: 0,
    tokenDeltaTotal: 0,
    tokenDeltaHasValue: false,
  };
}

function buildGateThresholdSweep(runs: NormalizedRun[]): GateThresholdSweepRow[] {
  const byThreshold = new Map<string, SweepAccumulator>();

  for (const run of runs) {
    const sweep = run.riskGate?.thresholdSweep ?? [];
    if (!sweep.length) continue;
    for (const point of sweep) {
      const key = String(point.threshold);
      if (!byThreshold.has(key)) byThreshold.set(key, initSweepAccumulator(point.threshold));
      const acc = byThreshold.get(key);
      if (!acc) continue;
      acc.nPoints += 1;
      acc.runKeys.add(run.runKey);
      acc.turnsEvaluated += point.turnsEvaluated;
      acc.superviseDecisions += point.superviseDecisions;
      acc.skipDecisions += point.skipDecisions;
      acc.shadowDecisions += point.shadowDecisions;
      acc.fallbackOpenAICalls += point.fallbackOpenAICalls;
      acc.failures += point.failures;
      acc.labeledDecisions += point.labeledDecisions;
      acc.truePositive += point.truePositive;
      acc.falsePositive += point.falsePositive;
      acc.trueNegative += point.trueNegative;
      acc.falseNegative += point.falseNegative;
      const metricWeight = point.labeledDecisions > 0 ? point.labeledDecisions : point.turnsEvaluated > 0 ? point.turnsEvaluated : 1;
      if (point.recall != null) {
        acc.recallWeightedSum += point.recall * metricWeight;
        acc.recallWeight += metricWeight;
      }
      if (point.precision != null) {
        acc.precisionWeightedSum += point.precision * metricWeight;
        acc.precisionWeight += metricWeight;
      }
      if (point.fnr != null) {
        acc.fnrWeightedSum += point.fnr * metricWeight;
        acc.fnrWeight += metricWeight;
      }
      if (point.latencyDeltaMsTotal != null) {
        acc.latencyDeltaMsTotal += point.latencyDeltaMsTotal;
        acc.latencyDeltaHasValue = true;
      }
      if (point.latencyDeltaCount > 0) acc.latencyDeltaCount += point.latencyDeltaCount;
      if (point.tokenDeltaTotal != null) {
        acc.tokenDeltaTotal += point.tokenDeltaTotal;
        acc.tokenDeltaHasValue = true;
      }
      if (point.tokenDeltaCount > 0) acc.tokenDeltaCount += point.tokenDeltaCount;
    }
  }

  return Array.from(byThreshold.values())
    .map((acc) => {
      const superviseRate = acc.turnsEvaluated ? acc.superviseDecisions / acc.turnsEvaluated : null;
      const skipRate = acc.turnsEvaluated ? acc.skipDecisions / acc.turnsEvaluated : null;
      const shadowRate = acc.turnsEvaluated ? acc.shadowDecisions / acc.turnsEvaluated : null;
      const fallbackRate = acc.turnsEvaluated ? acc.fallbackOpenAICalls / acc.turnsEvaluated : null;
      const failureRate = acc.turnsEvaluated ? acc.failures / acc.turnsEvaluated : null;
      const recall = acc.truePositive + acc.falseNegative
        ? acc.truePositive / (acc.truePositive + acc.falseNegative)
        : acc.recallWeight
          ? acc.recallWeightedSum / acc.recallWeight
          : null;
      const precision = acc.truePositive + acc.falsePositive
        ? acc.truePositive / (acc.truePositive + acc.falsePositive)
        : acc.precisionWeight
          ? acc.precisionWeightedSum / acc.precisionWeight
          : null;
      const fnr = acc.truePositive + acc.falseNegative
        ? acc.falseNegative / (acc.truePositive + acc.falseNegative)
        : acc.fnrWeight
          ? acc.fnrWeightedSum / acc.fnrWeight
          : null;
      const latencyDeltaMsTotal = acc.latencyDeltaHasValue ? acc.latencyDeltaMsTotal : null;
      const tokenDeltaTotal = acc.tokenDeltaHasValue ? acc.tokenDeltaTotal : null;
      return {
        threshold: acc.threshold,
        nPoints: acc.nPoints,
        nRuns: acc.runKeys.size,
        turnsEvaluated: acc.turnsEvaluated,
        superviseDecisions: acc.superviseDecisions,
        superviseRate,
        skipDecisions: acc.skipDecisions,
        skipRate,
        shadowDecisions: acc.shadowDecisions,
        shadowRate,
        supervisorCallReductionPct: superviseRate == null ? null : 1 - superviseRate,
        fallbackOpenAICalls: acc.fallbackOpenAICalls,
        fallbackRate,
        failures: acc.failures,
        failureRate,
        labeledDecisions: acc.labeledDecisions,
        truePositive: acc.truePositive,
        falsePositive: acc.falsePositive,
        trueNegative: acc.trueNegative,
        falseNegative: acc.falseNegative,
        recall,
        precision,
        fnr,
        latencyDeltaCount: acc.latencyDeltaCount,
        latencyDeltaMsTotal,
        latencyDeltaMsMean:
          latencyDeltaMsTotal != null && acc.latencyDeltaCount > 0 ? latencyDeltaMsTotal / acc.latencyDeltaCount : null,
        tokenDeltaCount: acc.tokenDeltaCount,
        tokenDeltaTotal,
        tokenDeltaMean: tokenDeltaTotal != null && acc.tokenDeltaCount > 0 ? tokenDeltaTotal / acc.tokenDeltaCount : null,
      };
    })
    .sort((a, b) => a.threshold - b.threshold);
}

export function buildAnalysis(options: AnalysisOptions): AnalysisOutput {
  const runs = options.records.map((record, idx) => normalizeRun(record, `${options.runId}::${idx}`));
  const turnRows = options.records.flatMap((record, idx) => buildTurnRows(record, runs[idx]));

  const totals = buildTotals(runs, turnRows);
  const overall = [buildRunGroupRow(runs)];

  const byTutor = Array.from(groupBy(runs, (r) => r.tutorId).entries())
    .map(([tutorId, group]) => ({
      tutorId,
      ...buildRunGroupRow(group),
    }))
    .sort((a, b) => String(a.tutorId).localeCompare(String(b.tutorId)));

  const bySupervisor = Array.from(
    groupBy(
      runs.filter((r) => r.supervisorId),
      (r) => r.supervisorId ?? 'unknown'
    ).entries()
  )
    .map(([supervisorId, group]) => ({
      supervisorId,
      ...buildRunGroupRow(group),
    }))
    .sort((a, b) => String(a.supervisorId).localeCompare(String(b.supervisorId)));

  const byTutorLab = Array.from(groupBy(runs, (r) => r.tutorLab ?? 'unknown').entries())
    .map(([tutorLab, group]) => ({
      tutorLab,
      ...buildRunGroupRow(group),
    }))
    .sort((a, b) => String(a.tutorLab).localeCompare(String(b.tutorLab)));

  const bySupervisorLab = Array.from(
    groupBy(
      runs.filter((r) => r.supervisorLab),
      (r) => r.supervisorLab ?? 'unknown'
    ).entries()
  )
    .map(([supervisorLab, group]) => ({
      supervisorLab,
      ...buildRunGroupRow(group),
    }))
    .sort((a, b) => String(a.supervisorLab).localeCompare(String(b.supervisorLab)));

  const byCondition = Array.from(groupBy(runs, (r) => r.condition).entries())
    .map(([condition, group]) => ({
      condition,
      ...buildRunGroupRow(group),
    }))
    .sort((a, b) => String(a.condition).localeCompare(String(b.condition)));

  const byTutorCondition = Array.from(groupBy(runs, (r) => `${r.tutorId}::${r.condition}`).entries())
    .map(([key, group]) => {
      const [tutorId, condition] = key.split('::');
      return {
        tutorId,
        condition,
        ...buildRunGroupRow(group),
      };
    })
    .sort((a, b) => {
      const t = String(a.tutorId).localeCompare(String(b.tutorId));
      if (t !== 0) return t;
      return String(a.condition).localeCompare(String(b.condition));
    });

  const byTutorSupervisor = Array.from(
    groupBy(
      runs.filter((r) => r.supervisorId),
      (r) => `${r.tutorId}::${r.supervisorId ?? 'unknown'}`
    ).entries()
  )
    .map(([key, group]) => {
      const [tutorId, supervisorId] = key.split('::');
      return {
        tutorId,
        supervisorId,
        ...buildRunGroupRow(group),
      };
    })
    .sort((a, b) => {
      const t = String(a.tutorId).localeCompare(String(b.tutorId));
      if (t !== 0) return t;
      return String(a.supervisorId).localeCompare(String(b.supervisorId));
    });

  const byLabPair = Array.from(
    groupBy(
      runs.filter((r) => r.supervisorLab),
      (r) => `${r.tutorLab ?? 'unknown'}::${r.supervisorLab ?? 'unknown'}`
    ).entries()
  )
    .map(([key, group]) => {
      const [tutorLab, supervisorLab] = key.split('::');
      return {
        tutorLab,
        supervisorLab,
        ...buildRunGroupRow(group),
      };
    })
    .sort((a, b) => {
      const t = String(a.tutorLab).localeCompare(String(b.tutorLab));
      if (t !== 0) return t;
      return String(a.supervisorLab).localeCompare(String(b.supervisorLab));
    });

  const byLabPairType = Array.from(
    groupBy(
      runs.filter((r) => r.labPairType),
      (r) => String(r.labPairType ?? 'unknown')
    ).entries()
  )
    .map(([labPairType, group]) => ({
      labPairType,
      ...buildRunGroupRow(group),
    }))
    .sort((a, b) => String(a.labPairType).localeCompare(String(b.labPairType)));

  const byDataset = Array.from(
    groupBy(
      runs.filter((r) => r.dataset),
      (r) => String(r.dataset ?? 'unknown')
    ).entries()
  )
    .map(([dataset, group]) => ({
      dataset,
      ...buildRunGroupRow(group),
    }))
    .sort((a, b) => String(a.dataset).localeCompare(String(b.dataset)));

  const byQuestionFormat = Array.from(
    groupBy(
      runs.filter((r) => r.questionFormat),
      (r) => String(r.questionFormat ?? 'unknown')
    ).entries()
  )
    .map(([questionFormat, group]) => ({
      questionFormat,
      ...buildRunGroupRow(group),
    }))
    .sort((a, b) => String(a.questionFormat).localeCompare(String(b.questionFormat)));

  const byDomain = Array.from(
    groupBy(
      runs.filter((r) => r.domain),
      (r) => String(r.domain ?? 'unknown')
    ).entries()
  )
    .map(([domain, group]) => ({
      domain,
      ...buildRunGroupRow(group),
    }))
    .sort((a, b) => String(a.domain).localeCompare(String(b.domain)));

  const bySubDomain = Array.from(
    groupBy(
      runs.filter((r) => r.subDomain),
      (r) => String(r.subDomain ?? 'unknown')
    ).entries()
  )
    .map(([subDomain, group]) => ({
      subDomain,
      ...buildRunGroupRow(group),
    }))
    .sort((a, b) => String(a.subDomain).localeCompare(String(b.subDomain)));

  const byTag = Array.from(
    groupBy(
      runs.filter((r) => r.tag),
      (r) => String(r.tag ?? 'unknown')
    ).entries()
  )
    .map(([tag, group]) => ({
      tag,
      ...buildRunGroupRow(group),
    }))
    .sort((a, b) => String(a.tag).localeCompare(String(b.tag)));

  const byBroadConcept = Array.from(
    groupBy(
      runs.filter((r) => r.broadConcept),
      (r) => String(r.broadConcept ?? 'unknown')
    ).entries()
  )
    .map(([broadConcept, group]) => ({
      broadConcept: toBroadConcept(broadConcept) ?? 'unknown',
      ...buildRunGroupRow(group),
    }))
    .sort((a, b) => String(a.broadConcept).localeCompare(String(b.broadConcept)));

  const byDatasetBroadConcept = Array.from(
    groupBy(
      runs.filter((r) => r.dataset || r.broadConcept),
      (r) => tupleKey([r.dataset ?? null, r.broadConcept ?? null])
    ).entries()
  )
    .map(([key, group]) => {
      const [dataset, broadConcept] = JSON.parse(key) as [string | null, string | null];
      return {
        dataset,
        broadConcept: toBroadConcept(broadConcept),
        ...buildRunGroupRow(group),
      };
    })
    .sort((a, b) => {
      const d = String(a.dataset ?? '').localeCompare(String(b.dataset ?? ''));
      if (d !== 0) return d;
      return String(a.broadConcept ?? '').localeCompare(String(b.broadConcept ?? ''));
    });

  const byFormatDomain = Array.from(
    groupBy(
      runs.filter((r) => r.questionFormat || r.domain),
      (r) => tupleKey([r.dataset ?? null, r.questionFormat ?? null, r.domain ?? null])
    ).entries()
  )
    .map(([key, group]) => {
      const [dataset, questionFormat, domain] = JSON.parse(key) as [string | null, string | null, string | null];
      return {
        dataset,
        questionFormat,
        domain,
        ...buildRunGroupRow(group),
      };
    })
    .sort((a, b) => {
      const d = String(a.dataset ?? '').localeCompare(String(b.dataset ?? ''));
      if (d !== 0) return d;
      const f = String(a.questionFormat ?? '').localeCompare(String(b.questionFormat ?? ''));
      if (f !== 0) return f;
      return String(a.domain ?? '').localeCompare(String(b.domain ?? ''));
    });

  const hasBloomData = runs.some((r) => r.bloomLevel != null);
  const runsWithBloomDifficulty = hasBloomData ? runs.filter((r) => r.bloomLevel != null) : [];
  const byBloomDifficulty = Array.from(
    groupBy(runsWithBloomDifficulty, (r) => tupleKey([r.bloomLevel ?? null, r.difficulty ?? null])).entries()
  )
    .map(([key, group]) => {
      const [bloomLevel, difficulty] = JSON.parse(key) as [number | null, string | null];
      return {
        bloomLevel: Number.isFinite(Number(bloomLevel)) ? Number(bloomLevel) : null,
        difficulty,
        ...buildRunGroupRow(group),
      };
    })
    .sort((a, b) => {
      const bloom = (a.bloomLevel ?? 99) - (b.bloomLevel ?? 99);
      if (bloom !== 0) return bloom;
      return difficultyOrder(a.difficulty ?? null) - difficultyOrder(b.difficulty ?? null);
    });

  const bloomDifficultyEffects = hasBloomData ? buildBloomDifficultyEffects(runs) : [];

  const byQuestion = Array.from(groupBy(runs, (r) => r.questionId).entries())
    .map(([questionId, group]) => ({
      questionId,
      dataset: group[0]?.dataset ?? null,
      questionFormat: group[0]?.questionFormat ?? null,
      domain: group[0]?.domain ?? null,
      subDomain: group[0]?.subDomain ?? null,
      tag: group[0]?.tag ?? null,
      bloomLevel: group[0]?.bloomLevel ?? null,
      difficulty: group[0]?.difficulty ?? null,
      topicTag: group[0]?.topicTag ?? null,
      broadConcept: group[0]?.broadConcept ?? null,
      ...buildRunGroupRow(group),
    }))
    .sort((a, b) => String(a.questionId).localeCompare(String(b.questionId)));

  const byAttackLevel = Array.from(
    groupBy(
      turnRows.filter((r) => r.attackLevel != null),
      (r) => String(r.attackLevel ?? 'unknown')
    ).entries()
  )
    .map(([attackLevel, group]) => ({
      attackLevel: Number.isFinite(Number(attackLevel)) ? Number(attackLevel) : null,
      ...buildTurnGroupRow(group),
    }))
    .sort((a, b) => (a.attackLevel ?? 99) - (b.attackLevel ?? 99));

  const byTurnIndex = Array.from(groupBy(turnRows, (r) => String(r.turnIndex)).entries())
    .map(([turnIndex, group]) => ({
      turnIndex: Number(turnIndex),
      ...buildTurnGroupRow(group),
    }))
    .sort((a, b) => (a.turnIndex ?? 0) - (b.turnIndex ?? 0));

  const conditionEffects = buildConditionEffects(runs, totals.tutors).sort((a, b) =>
    String(a.tutorId).localeCompare(String(b.tutorId))
  );
  const labEffects = buildLabEffects(runs).sort((a, b) => String(a.lab).localeCompare(String(b.lab)));
  const labPairTypeEffects = buildLabPairTypeEffects(runs).sort((a, b) =>
    String(a.pairType).localeCompare(String(b.pairType))
  );
  const labInteraction = buildLabInteraction(runs);
  const tutorPairTypeEffects = buildTutorPairTypeEffects(runs);
  const survivalByCondition = buildSurvivalByCondition(runs, turnRows);
  const survivalByPairType = buildSurvivalByPairType(runs, turnRows);
  const gateOverallMap = buildGateGroupRows(runs, () => 'overall');
  const gateOverall = gateOverallMap.has('overall') ? [gateOverallMap.get('overall')!] : [];
  const gateByCondition = Array.from(buildGateGroupRows(runs, (r) => r.condition).entries())
    .map(([condition, row]) => ({
      condition,
      ...row,
    }))
    .sort((a, b) => String(a.condition).localeCompare(String(b.condition)));
  const gateByTutor = Array.from(buildGateGroupRows(runs, (r) => r.tutorId).entries())
    .map(([tutorId, row]) => ({
      tutorId,
      ...row,
    }))
    .sort((a, b) => String(a.tutorId).localeCompare(String(b.tutorId)));
  const gateByTutorSupervisor = Array.from(
    buildGateGroupRows(runs, (r) => tupleKey([r.tutorId, r.supervisorId ?? null])).entries()
  )
    .map(([key, row]) => {
      const [tutorId, supervisorId] = JSON.parse(key) as [string, string | null];
      return {
        tutorId,
        supervisorId,
        ...row,
      };
    })
    .sort((a, b) => {
      const t = String(a.tutorId).localeCompare(String(b.tutorId));
      if (t !== 0) return t;
      return String(a.supervisorId ?? '').localeCompare(String(b.supervisorId ?? ''));
    });
  const gateThresholdSweep = buildGateThresholdSweep(runs);

  return {
    meta: {
      runId: options.runId,
      createdAtIso: options.createdAtIso,
      generatedAtIso: nowIso(),
    },
    totals,
    tables: {
      overall,
      byTutor,
      bySupervisor,
      byTutorLab,
      bySupervisorLab,
      byCondition,
      byTutorCondition,
      byTutorSupervisor,
      byLabPair,
      byLabPairType,
      byDataset,
      byQuestionFormat,
      byDomain,
      bySubDomain,
      byTag,
      byBroadConcept,
      byDatasetBroadConcept,
      byFormatDomain,
      byBloomDifficulty,
      bloomDifficultyEffects,
      byQuestion,
      perTurn: {
        byAttackLevel,
        byTurnIndex,
      },
      conditionEffects,
      labEffects,
      labPairTypeEffects,
      labInteraction,
      tutorPairTypeEffects,
      survivalByCondition,
      survivalByPairType,
      gateOverall,
      gateByCondition,
      gateByTutor,
      gateByTutorSupervisor,
      gateThresholdSweep,
    },
  };
}
