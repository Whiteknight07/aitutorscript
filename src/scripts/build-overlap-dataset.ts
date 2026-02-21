import { writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

import { ensureDir } from '../utils/util';
import { buildCsbenchPairwiseOverlapDataset } from '../core/overlap';

type ScriptArgs = {
  csbenchPath: string;
  pairwiseDir: string;
  outDir: string;
  outFile: string;
  limit: number | null;
};

function parseIntArg(value: string | undefined, flag: string): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid value for ${flag}: "${value}"`);
  }
  return parsed;
}

function parseArgs(argv: string[]): ScriptArgs {
  const outDir = argv.includes('--outDir')
    ? String(argv[argv.indexOf('--outDir') + 1] ?? 'overlap-csbench-pairwise')
    : 'overlap-csbench-pairwise';
  const outFile = argv.includes('--outFile')
    ? String(argv[argv.indexOf('--outFile') + 1] ?? 'questions.json')
    : 'questions.json';
  const csbenchPath = argv.includes('--csbenchPath')
    ? String(argv[argv.indexOf('--csbenchPath') + 1] ?? 'test.jsonl')
    : 'test.jsonl';
  const pairwiseDir = argv.includes('--pairwiseDir')
    ? String(argv[argv.indexOf('--pairwiseDir') + 1] ?? join('data', 'pairwise'))
    : join('data', 'pairwise');
  const limit = argv.includes('--limit')
    ? parseIntArg(argv[argv.indexOf('--limit') + 1], '--limit')
    : null;

  return {
    csbenchPath,
    pairwiseDir,
    outDir,
    outFile,
    limit,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = isAbsolute(args.outDir) ? args.outDir : join(process.cwd(), args.outDir);
  const outPath = join(outDir, args.outFile);

  const warnings: string[] = [];
  const dataset = await buildCsbenchPairwiseOverlapDataset({
    csbenchPath: args.csbenchPath,
    pairwiseDir: args.pairwiseDir,
    limit: args.limit,
    warn: (message) => warnings.push(message),
  });

  await ensureDir(outDir);
  await writeFile(outPath, JSON.stringify(dataset, null, 2));

  // eslint-disable-next-line no-console
  console.log(`Wrote overlap dataset: ${outPath}`);
  // eslint-disable-next-line no-console
  console.log(
    `Shared concepts: ${dataset.sharedBroadConcepts.join(', ') || '(none)'} | questions: ${dataset.totals.combinedOverlap}`
  );
  // eslint-disable-next-line no-console
  console.log(
    `Breakdown: csbench ${dataset.totals.csbenchOverlap}/${dataset.totals.csbenchInput}, pairwise ${dataset.totals.pairwiseOverlap}/${dataset.totals.pairwiseInput}`
  );
  if (warnings.length > 0) {
    // eslint-disable-next-line no-console
    console.log(`Pairwise loader warnings surfaced while building overlap dataset: ${warnings.length}`);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exitCode = 1;
});
