import type {
  BloomDifficultyEffectRow,
  LabEffectRow,
  LabInteractionRow,
  LabPairTypeEffectRow,
  NormalizedRun,
  SurvivalRow,
  TutorPairTypeEffectRow,
  TurnRow,
} from './types';
import { difficultyOrder, uniqueSorted } from './utils';

function judgedRows(rows: NormalizedRun[]): NormalizedRun[] {
  return rows.filter((r) => r.judged);
}

function judgedCount(rows: NormalizedRun[]): number {
  return rows.filter((r) => r.judged).length;
}

function rateFromJudged(rows: NormalizedRun[], predicate: (row: NormalizedRun) => boolean): number | null {
  const judged = judgedRows(rows);
  if (!judged.length) return null;
  return judged.filter(predicate).length / judged.length;
}

function earlyRate(rows: NormalizedRun[]): number | null {
  if (!rows.length) return null;
  return rows.filter((r) => r.endedEarly).length / rows.length;
}

export function buildLabEffects(runs: NormalizedRun[]): LabEffectRow[] {
  const singleRuns = runs.filter((r) => r.condition === 'single');
  const dualRuns = runs.filter((r) => r.condition === 'dual-loop' && r.supervisorLab);

  const singleLeakageRate = rateFromJudged(singleRuns, (r) => r.leakage === true);
  const singleHallucRate = rateFromJudged(singleRuns, (r) => r.hallucination === true);
  const singleCompRate = rateFromJudged(singleRuns, (r) => r.compliance === true);
  const singleEarlyRate = earlyRate(singleRuns);

  const dualByLab = new Map<string, NormalizedRun[]>();
  const supervisorsByLab = new Map<string, Set<string>>();
  for (const r of dualRuns) {
    const lab = r.supervisorLab ?? 'unknown';
    if (!dualByLab.has(lab)) dualByLab.set(lab, []);
    dualByLab.get(lab)?.push(r);
    if (!supervisorsByLab.has(lab)) supervisorsByLab.set(lab, new Set());
    supervisorsByLab.get(lab)?.add(r.supervisorId ?? 'unknown');
  }

  const rows: LabEffectRow[] = [];
  for (const [lab, labDualRuns] of dualByLab.entries()) {
    const dualLeakageRate = rateFromJudged(labDualRuns, (r) => r.leakage === true);
    const dualHallucRate = rateFromJudged(labDualRuns, (r) => r.hallucination === true);
    const dualCompRate = rateFromJudged(labDualRuns, (r) => r.compliance === true);
    const dualEarlyRate = earlyRate(labDualRuns);

    rows.push({
      lab,
      supervisorCount: supervisorsByLab.get(lab)?.size ?? 0,
      nSingleRuns: singleRuns.length,
      nDualRuns: labDualRuns.length,
      nSingleJudgedRuns: judgedCount(singleRuns),
      nDualJudgedRuns: judgedCount(labDualRuns),
      leakageSingleRate: singleLeakageRate,
      leakageDualRate: dualLeakageRate,
      leakageDelta:
        singleLeakageRate != null && dualLeakageRate != null ? dualLeakageRate - singleLeakageRate : null,
      hallucinationSingleRate: singleHallucRate,
      hallucinationDualRate: dualHallucRate,
      hallucinationDelta:
        singleHallucRate != null && dualHallucRate != null ? dualHallucRate - singleHallucRate : null,
      complianceSingleRate: singleCompRate,
      complianceDualRate: dualCompRate,
      complianceDelta: singleCompRate != null && dualCompRate != null ? dualCompRate - singleCompRate : null,
      earlyStopSingleRate: singleEarlyRate,
      earlyStopDualRate: dualEarlyRate,
      earlyStopDelta: singleEarlyRate != null && dualEarlyRate != null ? dualEarlyRate - singleEarlyRate : null,
    });
  }

  return rows.sort((a, b) => String(a.lab).localeCompare(String(b.lab)));
}

export function buildLabPairTypeEffects(runs: NormalizedRun[]): LabPairTypeEffectRow[] {
  const singleRuns = runs.filter((r) => r.condition === 'single');
  const dualRuns = runs.filter((r) => r.condition === 'dual-loop' && r.labPairType);
  const singleLeakageRate = rateFromJudged(singleRuns, (r) => r.leakage === true);
  const singleHallucRate = rateFromJudged(singleRuns, (r) => r.hallucination === true);
  const singleCompRate = rateFromJudged(singleRuns, (r) => r.compliance === true);
  const singleEarlyRate = earlyRate(singleRuns);

  const pairTypes = uniqueSorted(
    dualRuns.map((r) => r.labPairType).filter(Boolean) as Array<'same-lab' | 'cross-lab'>
  );

  const rows: LabPairTypeEffectRow[] = [];
  for (const pairType of pairTypes) {
    const dualForType = dualRuns.filter((r) => r.labPairType === pairType);
    const dualLeakageRate = rateFromJudged(dualForType, (r) => r.leakage === true);
    const dualHallucRate = rateFromJudged(dualForType, (r) => r.hallucination === true);
    const dualCompRate = rateFromJudged(dualForType, (r) => r.compliance === true);
    const dualEarlyRate = earlyRate(dualForType);

    rows.push({
      pairType: pairType as 'same-lab' | 'cross-lab',
      nSingleRuns: singleRuns.length,
      nDualRuns: dualForType.length,
      nSingleJudgedRuns: judgedCount(singleRuns),
      nDualJudgedRuns: judgedCount(dualForType),
      leakageSingleRate: singleLeakageRate,
      leakageDualRate: dualLeakageRate,
      leakageDelta:
        singleLeakageRate != null && dualLeakageRate != null ? dualLeakageRate - singleLeakageRate : null,
      hallucinationSingleRate: singleHallucRate,
      hallucinationDualRate: dualHallucRate,
      hallucinationDelta:
        singleHallucRate != null && dualHallucRate != null ? dualHallucRate - singleHallucRate : null,
      complianceSingleRate: singleCompRate,
      complianceDualRate: dualCompRate,
      complianceDelta: singleCompRate != null && dualCompRate != null ? dualCompRate - singleCompRate : null,
      earlyStopSingleRate: singleEarlyRate,
      earlyStopDualRate: dualEarlyRate,
      earlyStopDelta: singleEarlyRate != null && dualEarlyRate != null ? dualEarlyRate - singleEarlyRate : null,
    });
  }

  return rows.sort((a, b) => String(a.pairType).localeCompare(String(b.pairType)));
}

export function buildLabInteraction(runs: NormalizedRun[]): LabInteractionRow[] {
  const singleRuns = runs.filter((r) => r.condition === 'single' && r.tutorLab);
  const dualRuns = runs.filter((r) => r.condition === 'dual-loop' && r.tutorLab && r.supervisorLab);

  const baselineByTutorLab = new Map<string, NormalizedRun[]>();
  for (const r of singleRuns) {
    const lab = r.tutorLab ?? 'unknown';
    if (!baselineByTutorLab.has(lab)) baselineByTutorLab.set(lab, []);
    baselineByTutorLab.get(lab)?.push(r);
  }

  const rows: LabInteractionRow[] = [];
  const pairMap = new Map<string, NormalizedRun[]>();
  for (const r of dualRuns) {
    const key = `${r.tutorLab}::${r.supervisorLab}`;
    if (!pairMap.has(key)) pairMap.set(key, []);
    pairMap.get(key)?.push(r);
  }

  for (const [key, dualGroup] of pairMap.entries()) {
    const [tutorLab, supervisorLab] = key.split('::');
    const baseline = baselineByTutorLab.get(tutorLab) ?? [];
    const singleLeakageRate = rateFromJudged(baseline, (r) => r.leakage === true);
    const singleCompRate = rateFromJudged(baseline, (r) => r.compliance === true);
    const dualLeakageRate = rateFromJudged(dualGroup, (r) => r.leakage === true);
    const dualCompRate = rateFromJudged(dualGroup, (r) => r.compliance === true);

    rows.push({
      tutorLab,
      supervisorLab,
      nSingleRuns: baseline.length,
      nDualRuns: dualGroup.length,
      nSingleJudgedRuns: judgedCount(baseline),
      nDualJudgedRuns: judgedCount(dualGroup),
      leakageSingleRate: singleLeakageRate,
      leakageDualRate: dualLeakageRate,
      leakageDelta:
        singleLeakageRate != null && dualLeakageRate != null ? dualLeakageRate - singleLeakageRate : null,
      complianceSingleRate: singleCompRate,
      complianceDualRate: dualCompRate,
      complianceDelta: singleCompRate != null && dualCompRate != null ? dualCompRate - singleCompRate : null,
    });
  }

  return rows.sort((a, b) => {
    const t = String(a.tutorLab).localeCompare(String(b.tutorLab));
    if (t !== 0) return t;
    return String(a.supervisorLab).localeCompare(String(b.supervisorLab));
  });
}

export function buildTutorPairTypeEffects(runs: NormalizedRun[]): TutorPairTypeEffectRow[] {
  const rows: TutorPairTypeEffectRow[] = [];
  const tutors = uniqueSorted(runs.map((r) => r.tutorId));
  for (const tutorId of tutors) {
    const tutorRuns = runs.filter((r) => r.tutorId === tutorId);
    const singleRuns = tutorRuns.filter((r) => r.condition === 'single');
    const dualRuns = tutorRuns.filter((r) => r.condition === 'dual-loop' && r.labPairType);

    const singleLeakageRate = rateFromJudged(singleRuns, (r) => r.leakage === true);
    const singleCompRate = rateFromJudged(singleRuns, (r) => r.compliance === true);

    const pairTypes = uniqueSorted(
      dualRuns.map((r) => r.labPairType).filter(Boolean) as Array<'same-lab' | 'cross-lab'>
    );
    for (const pairType of pairTypes) {
      const dualForType = dualRuns.filter((r) => r.labPairType === pairType);
      const dualLeakageRate = rateFromJudged(dualForType, (r) => r.leakage === true);
      const dualCompRate = rateFromJudged(dualForType, (r) => r.compliance === true);

      rows.push({
        tutorId,
        pairType: pairType as 'same-lab' | 'cross-lab',
        nSingleRuns: singleRuns.length,
        nDualRuns: dualForType.length,
        nSingleJudgedRuns: judgedCount(singleRuns),
        nDualJudgedRuns: judgedCount(dualForType),
        leakageSingleRate: singleLeakageRate,
        leakageDualRate: dualLeakageRate,
        leakageDelta:
          singleLeakageRate != null && dualLeakageRate != null ? dualLeakageRate - singleLeakageRate : null,
        complianceSingleRate: singleCompRate,
        complianceDualRate: dualCompRate,
        complianceDelta: singleCompRate != null && dualCompRate != null ? dualCompRate - singleCompRate : null,
      });
    }
  }

  return rows.sort((a, b) => {
    const t = String(a.tutorId).localeCompare(String(b.tutorId));
    if (t !== 0) return t;
    return String(a.pairType).localeCompare(String(b.pairType));
  });
}

export function buildBloomDifficultyEffects(runs: NormalizedRun[]): BloomDifficultyEffectRow[] {
  const singleRuns = runs.filter((r) => r.condition === 'single');
  const dualRuns = runs.filter((r) => r.condition === 'dual-loop');
  const keys = uniqueSorted(
    runs.map((r) => `${r.bloomLevel ?? 'unknown'}::${r.difficulty ?? 'unknown'}`)
  );

  const rows: BloomDifficultyEffectRow[] = [];
  for (const key of keys) {
    const [bloomRaw, difficultyRaw] = key.split('::');
    const bloomLevel = Number.isFinite(Number(bloomRaw)) ? Number(bloomRaw) : null;
    const difficulty = difficultyRaw === 'unknown' ? null : difficultyRaw;
    const singleGroup = singleRuns.filter((r) => r.bloomLevel === bloomLevel && r.difficulty === difficulty);
    const dualGroup = dualRuns.filter((r) => r.bloomLevel === bloomLevel && r.difficulty === difficulty);

    const singleLeakageRate = rateFromJudged(singleGroup, (r) => r.leakage === true);
    const dualLeakageRate = rateFromJudged(dualGroup, (r) => r.leakage === true);
    const singleCompRate = rateFromJudged(singleGroup, (r) => r.compliance === true);
    const dualCompRate = rateFromJudged(dualGroup, (r) => r.compliance === true);
    const singleHallucRate = rateFromJudged(singleGroup, (r) => r.hallucination === true);
    const dualHallucRate = rateFromJudged(dualGroup, (r) => r.hallucination === true);

    rows.push({
      bloomLevel,
      difficulty,
      nSingleRuns: singleGroup.length,
      nDualRuns: dualGroup.length,
      nSingleJudgedRuns: judgedCount(singleGroup),
      nDualJudgedRuns: judgedCount(dualGroup),
      leakageSingleRate: singleLeakageRate,
      leakageDualRate: dualLeakageRate,
      leakageDelta:
        singleLeakageRate != null && dualLeakageRate != null ? dualLeakageRate - singleLeakageRate : null,
      complianceSingleRate: singleCompRate,
      complianceDualRate: dualCompRate,
      complianceDelta: singleCompRate != null && dualCompRate != null ? dualCompRate - singleCompRate : null,
      hallucinationSingleRate: singleHallucRate,
      hallucinationDualRate: dualHallucRate,
      hallucinationDelta:
        singleHallucRate != null && dualHallucRate != null ? dualHallucRate - singleHallucRate : null,
    });
  }

  return rows.sort((a, b) => {
    const bloom = (a.bloomLevel ?? 99) - (b.bloomLevel ?? 99);
    if (bloom !== 0) return bloom;
    return difficultyOrder(a.difficulty ?? null) - difficultyOrder(b.difficulty ?? null);
  });
}

function buildFirstLeakByRun(turnRows: TurnRow[]): Map<string, { firstLeak: number | null; maxTurn: number }> {
  const map = new Map<string, { firstLeak: number | null; maxTurn: number }>();
  for (const row of turnRows) {
    if (!row.judged) continue;
    const current = map.get(row.runKey) ?? { firstLeak: null, maxTurn: -1 };
    if (row.turnIndex > current.maxTurn) current.maxTurn = row.turnIndex;
    if (row.leakage === true) {
      if (current.firstLeak == null || row.turnIndex < current.firstLeak) current.firstLeak = row.turnIndex;
    }
    map.set(row.runKey, current);
  }
  return map;
}

function buildSurvivalRows(
  runs: NormalizedRun[],
  turnRows: TurnRow[],
  groupLabel: (run: NormalizedRun) => string | null
): SurvivalRow[] {
  const leakByRun = buildFirstLeakByRun(turnRows);
  const grouped = new Map<string, string[]>();
  for (const run of runs) {
    const label = groupLabel(run);
    if (!label) continue;
    if (!leakByRun.has(run.runKey)) continue;
    if (!grouped.has(label)) grouped.set(label, []);
    grouped.get(label)?.push(run.runKey);
  }

  const rows: SurvivalRow[] = [];
  for (const [label, runIds] of grouped.entries()) {
    let maxTurn = -1;
    for (const runId of runIds) {
      const row = leakByRun.get(runId);
      if (!row) continue;
      if (row.maxTurn > maxTurn) maxTurn = row.maxTurn;
    }
    const totalRuns = runIds.length;
    for (let t = 0; t <= maxTurn; t += 1) {
      let survivors = 0;
      for (const runId of runIds) {
        const row = leakByRun.get(runId);
        if (!row) continue;
        if (row.firstLeak == null || row.firstLeak > t) survivors += 1;
      }
      rows.push({
        group: label,
        turnIndex: t,
        survivalRate: totalRuns ? survivors / totalRuns : null,
        nRuns: totalRuns,
      });
    }
  }

  return rows.sort((a, b) => {
    const g = String(a.group).localeCompare(String(b.group));
    if (g !== 0) return g;
    return (a.turnIndex ?? 0) - (b.turnIndex ?? 0);
  });
}

export function buildSurvivalByCondition(runs: NormalizedRun[], turnRows: TurnRow[]): SurvivalRow[] {
  return buildSurvivalRows(runs, turnRows, (run) => run.condition ?? null);
}

export function buildSurvivalByPairType(runs: NormalizedRun[], turnRows: TurnRow[]): SurvivalRow[] {
  return buildSurvivalRows(runs, turnRows, (run) => run.labPairType ?? null);
}
