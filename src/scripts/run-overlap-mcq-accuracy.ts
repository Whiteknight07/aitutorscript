import 'dotenv/config';

import {
  parseMcqAccuracyArgs,
  printMcqAccuracyHelp,
  runOverlapMcqAccuracy,
} from '../core/mcq-accuracy';

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help')) {
    printMcqAccuracyHelp();
    process.exit(0);
  }

  const options = parseMcqAccuracyArgs(argv);
  const summary = await runOverlapMcqAccuracy(options);

  // eslint-disable-next-line no-console
  console.log(`Run ID: ${summary.runId}`);
  // eslint-disable-next-line no-console
  console.log(`Output: ${summary.outputPath}`);
  // eslint-disable-next-line no-console
  console.log(`Questions loaded: ${summary.totalQuestionsLoaded}`);
  // eslint-disable-next-line no-console
  console.log(`MCQ questions evaluated: ${summary.totalQuestionsEvaluated}`);
  // eslint-disable-next-line no-console
  console.log(`Total records: ${summary.totalRecords}`);
  // eslint-disable-next-line no-console
  console.log(`Invalid records: ${summary.invalidRecords}`);

  for (const [modelId, row] of Object.entries(summary.accuracyByModel)) {
    // eslint-disable-next-line no-console
    console.log(
      `${modelId}: ${row.correct}/${row.total} (${(row.accuracy * 100).toFixed(2)}%)`
    );
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exitCode = 1;
});
