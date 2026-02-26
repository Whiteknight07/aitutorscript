import { readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

import { buildAnalysis } from '../output/analysis/index';
import { renderReportHtml } from '../output/report';
import { SummaryAggregator } from '../output/summary';
import type { RunRecord } from '../types';
import { ensureDir, nowIso } from '../utils/util';

type RunConfig = {
  runId?: string;
  createdAtIso?: string;
  args?: unknown;
};

type SummaryJson = {
  runId?: string;
  createdAtIso?: string;
  args?: unknown;
  totals?: {
    plannedRuns?: number;
    completedRuns?: number;
  };
};

type MergeSource = {
  label: string;
  path: string;
};

function usage(): never {
  // eslint-disable-next-line no-console
  console.error(
    'Usage: node --import tsx src/scripts/merge-replays.ts <results/run_xxx> [--outDir <results/run_xxx_merged>]' 
  );
  process.exit(2);
}

function parseJsonOrThrow(text: string, label: string): any {
  try {
    return JSON.parse(text);
  } catch (err: any) {
    throw new Error(`${label} is not valid JSON: ${String(err?.message ?? err)}`);
  }
}

function parseArgs(argv: string[]): { baseRunDir: string; outDir: string | null } {
  if (argv.length < 3) usage();

  const baseRunDir = argv[2];
  if (!baseRunDir || baseRunDir.startsWith('--')) usage();

  let outDir: string | null = null;

  for (let i = 3; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--outDir') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('--outDir requires a value.');
      }
      outDir = value;
      i += 1;
      continue;
    }

    throw new Error(`Unknown arg: ${token}`);
  }

  return { baseRunDir, outDir };
}

function recordKey(record: RunRecord, fallback: string): string {
  const question = (record.question ?? null) as Record<string, unknown> | null;
  const questionId = typeof question?.id === 'string' ? question.id : null;
  const pairingId = typeof record.pairingId === 'string' ? record.pairingId : null;
  const condition = typeof record.condition === 'string' ? record.condition : null;

  if (questionId && pairingId && condition) {
    return `${questionId}|${pairingId}|${condition}`;
  }

  return fallback;
}

async function readJsonl(path: string, label: string): Promise<RunRecord[]> {
  const text = await readFile(path, 'utf8');
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const out: RunRecord[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    try {
      out.push(JSON.parse(line) as RunRecord);
    } catch (err: any) {
      throw new Error(`${label} line ${i + 1} is not valid JSON: ${String(err?.message ?? err)}`);
    }
  }

  return out;
}

function asIsoOrNow(value: unknown): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : nowIso();
}

async function main() {
  const { baseRunDir: baseRunDirArg, outDir: outDirArg } = parseArgs(process.argv);

  const baseRunDir = resolve(baseRunDirArg);
  const baseRunName = basename(baseRunDir);
  const parentDir = dirname(baseRunDir);

  const runConfig = parseJsonOrThrow(
    await readFile(join(baseRunDir, 'run-config.json'), 'utf8'),
    'run-config.json'
  ) as RunConfig;

  const questionsJson = parseJsonOrThrow(
    await readFile(join(baseRunDir, 'questions.json'), 'utf8'),
    'questions.json'
  );

  const sourceSummary = parseJsonOrThrow(
    await readFile(join(baseRunDir, 'summary.json'), 'utf8'),
    'summary.json'
  ) as SummaryJson;

  const dirents = await readdir(parentDir, { withFileTypes: true });
  const replayDirs = dirents
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name.startsWith(`${baseRunName}_replay_`))
    .sort();

  const sources: MergeSource[] = [
    { label: 'base', path: join(baseRunDir, 'raw.jsonl') },
    ...replayDirs.map((name) => ({ label: name, path: join(parentDir, name, 'raw.jsonl') })),
  ];

  const dedup = new Map<string, RunRecord>();
  let totalSeen = 0;

  for (const source of sources) {
    const records = await readJsonl(source.path, source.label);
    for (let idx = 0; idx < records.length; idx += 1) {
      const record = records[idx];
      totalSeen += 1;
      const key = recordKey(record, `${source.label}|${idx}`);
      dedup.set(key, record);
    }
  }

  const mergedRecords = Array.from(dedup.values());

  const mergedRunId = `${baseRunName}_merged_${nowIso().replace(/[:.]/g, '-')}`;
  const mergedCreatedAtIso = nowIso();
  const mergedOutDir = outDirArg
    ? resolve(outDirArg)
    : join(parentDir, mergedRunId);

  await ensureDir(mergedOutDir);

  const mergedRunConfig = {
    runId: mergedRunId,
    createdAtIso: mergedCreatedAtIso,
    args: runConfig.args ?? sourceSummary.args ?? {},
    merge: {
      sourceRunDir: baseRunDir,
      sourceRunId: String(runConfig.runId ?? sourceSummary.runId ?? baseRunName),
      replayDirs,
      totalInputRecords: totalSeen,
      uniqueOutputRecords: mergedRecords.length,
    },
  };

  await writeFile(join(mergedOutDir, 'run-config.json'), JSON.stringify(mergedRunConfig, null, 2));
  await writeFile(join(mergedOutDir, 'questions.json'), JSON.stringify(questionsJson, null, 2));
  await writeFile(
    join(mergedOutDir, 'raw.jsonl'),
    mergedRecords.map((record) => JSON.stringify(record)).join('\n') + (mergedRecords.length ? '\n' : '')
  );

  const aggregator = new SummaryAggregator();
  for (const record of mergedRecords) {
    aggregator.add(record);
  }

  const plannedRuns =
    typeof sourceSummary?.totals?.plannedRuns === 'number'
      ? sourceSummary.totals.plannedRuns
      : mergedRecords.length;
  const completedRuns = mergedRecords.length;
  const args = mergedRunConfig.args;
  const questions = Array.isArray(questionsJson?.questions) ? questionsJson.questions : [];

  const summary = {
    runId: mergedRunId,
    createdAtIso: mergedCreatedAtIso,
    args,
    totals: {
      questions: questions.length,
      plannedRuns,
      completedRuns,
    },
    ...aggregator.toSummaryObject(),
  };

  const analysis = buildAnalysis({
    runId: mergedRunId,
    createdAtIso: mergedCreatedAtIso,
    records: mergedRecords,
  });

  await writeFile(join(mergedOutDir, 'summary.json'), JSON.stringify(summary, null, 2));
  await writeFile(join(mergedOutDir, 'analysis.json'), JSON.stringify(analysis, null, 2));
  await ensureDir(join(mergedOutDir, 'analysis'));

  const html = renderReportHtml({
    runId: mergedRunId,
    createdAtIso: mergedCreatedAtIso,
    args,
    questions,
    summary,
    analysis,
    records: mergedRecords,
    status: {
      state: completedRuns >= plannedRuns ? 'complete' : 'running',
      plannedRuns,
      completedRuns,
      lastUpdatedAtIso: asIsoOrNow(mergedCreatedAtIso),
      current: null,
      error: null,
    },
  });

  await writeFile(join(mergedOutDir, 'report.html'), html);

  // eslint-disable-next-line no-console
  console.log(`Merged run: ${mergedOutDir}`);
  // eslint-disable-next-line no-console
  console.log(`Sources: base + ${replayDirs.length} replay dir(s)`);
  // eslint-disable-next-line no-console
  console.log(`Records: input=${totalSeen} unique=${mergedRecords.length}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
