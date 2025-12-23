import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { renderReportHtml } from '../output/report';

type RunConfig = {
  runId?: string;
  createdAtIso?: string;
  args?: unknown;
};

function parseJsonOrThrow(text: string, label: string): any {
  try {
    return JSON.parse(text);
  } catch (err: any) {
    throw new Error(`${label} is not valid JSON: ${String(err?.message ?? err)}`);
  }
}

function usage(): never {
  // eslint-disable-next-line no-console
  console.error('Usage: bun run src/scripts/regenerate-report.ts <results/run_xxx>');
  process.exit(2);
}

async function main() {
  const runDirArg = process.argv[2];
  if (!runDirArg) usage();

  const runDir = resolve(runDirArg);

  const runConfig: RunConfig = parseJsonOrThrow(
    await readFile(join(runDir, 'run-config.json'), 'utf8'),
    'run-config.json'
  );

  const questionsJson = parseJsonOrThrow(
    await readFile(join(runDir, 'questions.json'), 'utf8'),
    'questions.json'
  );

  const summaryJson = parseJsonOrThrow(
    await readFile(join(runDir, 'summary.json'), 'utf8'),
    'summary.json'
  );

  const raw = await readFile(join(runDir, 'raw.jsonl'), 'utf8');
  const records = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, idx) => {
      try {
        return JSON.parse(line);
      } catch (err: any) {
        throw new Error(`raw.jsonl line ${idx + 1} is not valid JSON: ${String(err?.message ?? err)}`);
      }
    });

  const plannedRuns =
    typeof summaryJson?.totals?.plannedRuns === 'number' ? summaryJson.totals.plannedRuns : records.length;
  const completedRuns =
    typeof summaryJson?.totals?.completedRuns === 'number' ? summaryJson.totals.completedRuns : records.length;

  const runId = String(runConfig.runId ?? summaryJson.runId ?? 'run');
  const createdAtIso = String(runConfig.createdAtIso ?? summaryJson.createdAtIso ?? new Date().toISOString());
  const args = runConfig.args ?? summaryJson.args ?? {};
  const questions = questionsJson.questions ?? [];

  const html = renderReportHtml({
    runId,
    createdAtIso,
    args,
    questions,
    summary: summaryJson,
    records,
    status: {
      state: completedRuns >= plannedRuns ? 'complete' : 'running',
      plannedRuns,
      completedRuns,
      lastUpdatedAtIso: new Date().toISOString(),
      current: null,
      error: null,
    },
  });

  const outPath = join(runDir, 'report.html');
  await writeFile(outPath, html);
  // eslint-disable-next-line no-console
  console.log(`Wrote ${outPath}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

