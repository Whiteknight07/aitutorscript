import type { RunRecord } from '../../types';
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
import type { AnalysisOutput, NormalizedRun, TurnRow } from './types';

export type { AnalysisOutput, ConditionEffectRow, RunGroupRow, TurnGroupRow } from './types';

type AnalysisOptions = {
  runId: string;
  createdAtIso: string;
  records: RunRecord[];
};

function tupleKey(parts: Array<string | number | null>): string {
  return JSON.stringify(parts);
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
    attackLevels: uniqueSortedNumbers(turnRows.map((r) => r.attackLevel)),
  };
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

  const runsWithBloomDifficulty = runs.filter((r) => r.bloomLevel != null || r.difficulty != null);
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

  const bloomDifficultyEffects = buildBloomDifficultyEffects(runs);

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
    },
  };
}
