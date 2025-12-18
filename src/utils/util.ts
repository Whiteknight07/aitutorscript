import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export function nowIso(): string {
  return new Date().toISOString();
}

export function hrNowMs(): number {
  return Number(process.hrtime.bigint() / 1_000_000n);
}

export async function ensureDir(dir: string) {
  await mkdir(dir, { recursive: true });
}

export async function createJsonlWriter(outDir: string, filename: string) {
  await ensureDir(outDir);
  const path = join(outDir, filename);
  const stream = createWriteStream(path, { flags: 'a' });

  return {
    path,
    write: async (obj: unknown) => {
      const line = JSON.stringify(obj);
      if (!stream.write(line + '\n')) {
        await new Promise<void>((resolve) => stream.once('drain', resolve));
      }
    },
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        stream.end(() => resolve());
        stream.on('error', reject);
      });
    },
  };
}

export function stableStringify(obj: unknown): string {
  return JSON.stringify(obj, Object.keys(obj as any).sort(), 2);
}

