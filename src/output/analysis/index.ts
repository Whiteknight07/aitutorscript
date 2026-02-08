import type { RunRecord } from '../../types';
import { nowIso } from '../../utils/util';
import { OUTCOME_LABELS, type OutcomeLabel } from '../outcomes';
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

const PANEL_NESTED_KEYS = [
  'panel',
  'judgePanel',
  'panelVotes',
  'panelJudgments',
  'votes',
  'judges',
  'raters',
  'results',
  'judgments',
  'items',
] as const;

function collectBooleanVotes(value: unknown): boolean[] {
  if (value === true) return [true];
  if (value === false) return [false];
  if (Array.isArray(value)) return value.flatMap((item) => collectBooleanVotes(item));
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  const votes: boolean[] = [];
  for (const key of PANEL_NESTED_KEYS) {
    if (key in record) votes.push(...collectBooleanVotes(record[key]));
  }
  return votes;
}

function extractPanelVotes(record: RunRecord): Partial<Record<OutcomeLabel, boolean[]>> {
  const out: Partial<Record<OutcomeLabel, boolean[]>> = {};
  const candidates: unknown[] = [];
  const top = record as unknown as Record<string, unknown>;
  candidates.push(top.judgePanel, top.panel, top.panelVotes, top.panelJudgments);
  if (record.judge && typeof record.judge === 'object') {
    const judge = record.judge as unknown as Record<string, unknown>;
    candidates.push(judge.panel, judge.judgePanel, judge.panelVotes, judge.panelJudgments, judge.votes, judge.raters);
  }
  const turnJudgments = Array.isArray(record.hiddenTrace?.turnJudgments) ? record.hiddenTrace.turnJudgments : [];
  for (const tj of turnJudgments) {
    if (!tj?.judge || typeof tj.judge !== 'object') continue;
    const judge = tj.judge as unknown as Record<string, unknown>;
    candidates.push(judge.panel, judge.judgePanel, judge.panelVotes, judge.panelJudgments, judge.votes, judge.raters);
  }

  for (const label of OUTCOME_LABELS) {
    const votes: boolean[] = [];
    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== 'object') continue;
      const source = candidate as Record<string, unknown>;
      if (label in source) votes.push(...collectBooleanVotes(source[label]));
      for (const key of PANEL_NESTED_KEYS) {
        if (!(key in source)) continue;
        const nested = source[key];
        if (!nested || typeof nested !== 'object') continue;
        const nestedRecord = nested as Record<string, unknown>;
        if (label in nestedRecord) votes.push(...collectBooleanVotes(nestedRecord[label]));
      }
    }
    if (votes.length) out[label] = votes;
  }

  return out;
}

function buildJudgePanelTables(records: RunRecord[], runs: NormalizedRun[]) {
  const counters = new Map<
    OutcomeLabel,
    {
      compared: number;
      agreement: number;
      disputed: number;
    }
  >();
  const disputedRows: AnalysisOutput['tables']['judgePanelDisputed'] = [];
  for (const label of OUTCOME_LABELS) {
    counters.set(label, { compared: 0, agreement: 0, disputed: 0 });
  }

  for (let i = 0; i < records.length; i += 1) {
    const panelVotes = extractPanelVotes(records[i]);
    const run = runs[i];
    for (const label of OUTCOME_LABELS) {
      const votes = panelVotes[label];
      if (!votes?.length) continue;
      const finalLabel = run[label];
      if (typeof finalLabel !== 'boolean') continue;
      const trueVotes = votes.filter(Boolean).length;
      const falseVotes = votes.length - trueVotes;
      const hasDispute = trueVotes > 0 && falseVotes > 0;
      const majority = trueVotes === falseVotes ? null : trueVotes > falseVotes;
      const counter = counters.get(label);
      if (!counter) continue;
      counter.compared += 1;
      if (majority != null && majority === finalLabel) counter.agreement += 1;
      if (hasDispute) counter.disputed += 1;
      if (hasDispute || (majority != null && majority !== finalLabel)) {
        disputedRows.push({
          runKey: run.runKey,
          tutorId: run.tutorId,
          condition: run.condition,
          questionId: run.questionId,
          outcome: label,
          finalLabel,
          panelTrueVotes: trueVotes,
          panelFalseVotes: falseVotes,
        });
      }
    }
  }

  const agreementRows: AnalysisOutput['tables']['judgePanelAgreement'] = OUTCOME_LABELS.map((label) => {
    const counter = counters.get(label) ?? { compared: 0, agreement: 0, disputed: 0 };
    return {
      outcome: label,
      nComparedRuns: counter.compared,
      agreementCount: counter.agreement,
      agreementRate: counter.compared ? counter.agreement / counter.compared : null,
      disputedCount: counter.disputed,
      disputedRate: counter.compared ? counter.disputed / counter.compared : null,
    };
  }).filter((row) => row.nComparedRuns > 0);

  return {
    judgePanelAgreement: agreementRows,
    judgePanelDisputed: disputedRows.sort((a, b) => String(a.runKey).localeCompare(String(b.runKey))),
  };
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

  const byBloomDifficulty = Array.from(
    groupBy(runs, (r) => `${r.bloomLevel ?? 'unknown'}::${r.difficulty ?? 'unknown'}`).entries()
  )
    .map(([key, group]) => {
      const [bloomLevel, difficulty] = key.split('::');
      return {
        bloomLevel: Number.isFinite(Number(bloomLevel)) ? Number(bloomLevel) : null,
        difficulty: difficulty === 'unknown' ? null : difficulty,
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
  const judgePanelTables = buildJudgePanelTables(options.records, runs);

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
      judgePanelAgreement: judgePanelTables.judgePanelAgreement,
      judgePanelDisputed: judgePanelTables.judgePanelDisputed,
    },
  };
}
