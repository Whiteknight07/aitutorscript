import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { parseArgs, printHelp } from './utils/args';
import { runExperiments } from './core/experiment';

async function main() {
  const argv = process.argv;
  if (argv.includes('--help')) {
    printHelp();
    process.exit(0);
  }

  const args = parseArgs(argv);
  const envSummary = await readEnvSummary();

  await runExperiments({ args, envSummary });
}

async function readEnvSummary(): Promise<Record<string, unknown>> {
  const keys = [
    'OPENAI_API_KEY',
    'GEMINI_API_KEY',
    'GOOGLE_GENERATIVE_AI_API_KEY',
    'NODE_ENV',
  ];

  const present: Record<string, boolean> = {};
  for (const key of keys) present[key] = Boolean(process.env[key]);

  const envFile = await safeReadFile('.env');
  return {
    present,
    hasDotEnvFile: envFile != null,
  };
}

async function safeReadFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
