import { access, copyFile, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

function usage(): never {
  // eslint-disable-next-line no-console
  console.error('Usage: node --import tsx src/scripts/auto-replay-next.ts <results/run_xxx>');
  process.exit(2);
}

function runCommand(
  command: string,
  args: string[],
  options?: { inheritStdio?: boolean }
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      stdio: options?.inheritStdio ? 'inherit' : ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    let stdout = '';
    let stderr = '';

    if (!options?.inheritStdio) {
      child.stdout?.on('data', (chunk) => {
        stdout += String(chunk);
      });
      child.stderr?.on('data', (chunk) => {
        stderr += String(chunk);
      });
    }

    child.on('error', (err) => {
      rejectPromise(err);
    });

    child.on('close', (code) => {
      resolvePromise({
        code: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function listReplayDirs(baseRunDir: string): Promise<string[]> {
  const resolvedBaseRunDir = resolve(baseRunDir);
  const parentDir = dirname(resolvedBaseRunDir);
  const baseName = resolvedBaseRunDir.split('/').pop() ?? '';
  const prefix = `${baseName}_replay_`;

  const entries = await readdir(parentDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => join(parentDir, entry.name))
    .sort();
}

async function isReplayRunningFor(baseRunDir: string): Promise<boolean> {
  const resolved = resolve(baseRunDir);
  const runName = basename(resolved);

  const absolutePattern = `src/scripts/replay-failures.ts ${resolved}`;
  const relativePattern = `src/scripts/replay-failures.ts results/${runName}`;

  const absolute = await runCommand('pgrep', ['-f', absolutePattern]);
  if (absolute.code === 0) return true;

  const relative = await runCommand('pgrep', ['-f', relativePattern]);
  return relative.code === 0;
}

async function main() {
  const baseRunDirArg = process.argv[2];
  if (!baseRunDirArg) usage();

  const baseRunDir = resolve(baseRunDirArg);

  if (!(await exists(join(baseRunDir, 'run-config.json')))) {
    throw new Error(`Base run-config.json not found at: ${join(baseRunDir, 'run-config.json')}`);
  }

  // eslint-disable-next-line no-console
  console.log(`[auto-replay-next] Watching active replay for base: ${baseRunDir}`);

  while (await isReplayRunningFor(baseRunDir)) {
    // eslint-disable-next-line no-console
    console.log('[auto-replay-next] Current replay still running; rechecking in 30s...');
    await sleep(30_000);
  }

  const replayDirs = await listReplayDirs(baseRunDir);
  if (replayDirs.length === 0) {
    throw new Error(`No replay directories found for base run: ${baseRunDir}`);
  }
  const latestReplayDir = replayDirs[replayDirs.length - 1];

  const baseQuestionsPath = join(baseRunDir, 'questions.json');
  const replayQuestionsPath = join(latestReplayDir, 'questions.json');

  if (!(await exists(replayQuestionsPath))) {
    await copyFile(baseQuestionsPath, replayQuestionsPath);
    // eslint-disable-next-line no-console
    console.log(`[auto-replay-next] Copied questions.json into ${latestReplayDir}`);
  }

  // eslint-disable-next-line no-console
  console.log(`[auto-replay-next] Starting next replay from: ${latestReplayDir}`);
  const replayResult = await runCommand(
    'pnpm',
    ['replay-failures', latestReplayDir],
    { inheritStdio: true }
  );

  process.exit(replayResult.code);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
