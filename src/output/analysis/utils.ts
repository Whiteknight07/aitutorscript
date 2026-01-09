export function groupBy<T>(rows: T[], keyFn: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyFn(row);
    if (!map.has(key)) map.set(key, []);
    map.get(key)?.push(row);
  }
  return map;
}

export function uniqueSorted(values: Array<string | null | undefined>): string[] {
  const set = new Set<string>();
  for (const v of values) {
    if (!v) continue;
    set.add(String(v));
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

export function uniqueSortedNumbers(values: Array<number | null | undefined>): number[] {
  const set = new Set<number>();
  for (const v of values) {
    if (!Number.isFinite(v as number)) continue;
    set.add(Number(v));
  }
  return Array.from(set).sort((a, b) => a - b);
}

export function difficultyOrder(value: string | null): number {
  if (value === 'easy') return 0;
  if (value === 'medium') return 1;
  if (value === 'hard') return 2;
  return 99;
}
