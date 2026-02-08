export type DescriptiveStats = {
  n: number;
  mean: number | null;
  median: number | null;
  min: number | null;
  max: number | null;
  std: number | null;
  p90: number | null;
  p95: number | null;
  p99: number | null;
};

export type RateStats = {
  count: number;
  total: number;
  rate: number | null;
  ciLow: number | null;
  ciHigh: number | null;
};

export type DeltaRateStats = {
  delta: number | null;
  ciLow: number | null;
  ciHigh: number | null;
};

export function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] == null) return sorted[base];
  return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
}

export function descriptiveStats(values: number[]): DescriptiveStats {
  if (!values.length) {
    return { n: 0, mean: null, median: null, min: null, max: null, std: null, p90: null, p95: null, p99: null };
  }
  const sorted = values.slice().sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const mean = sum / n;
  const variance = sorted.reduce((acc, v) => acc + (v - mean) ** 2, 0) / n;
  return {
    n,
    mean,
    median: quantile(sorted, 0.5),
    min: sorted[0],
    max: sorted[n - 1],
    std: Math.sqrt(variance),
    p90: quantile(sorted, 0.9),
    p95: quantile(sorted, 0.95),
    p99: quantile(sorted, 0.99),
  };
}

export function buildRateStats(count: number, total: number): RateStats {
  if (!total) {
    return { count, total, rate: null, ciLow: null, ciHigh: null };
  }
  const ci = wilsonInterval(count, total);
  return {
    count,
    total,
    rate: count / total,
    ciLow: ci?.low ?? null,
    ciHigh: ci?.high ?? null,
  };
}

export function wilsonInterval(
  count: number,
  total: number,
  z = 1.959963984540054
): { low: number; high: number } | null {
  if (!total) return null;
  const n = total;
  const p = count / n;
  const z2 = z ** 2;
  const denominator = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denominator;
  const margin = (z / denominator) * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return {
    low: Math.max(0, center - margin),
    high: Math.min(1, center + margin),
  };
}

export function buildRateDeltaStats(
  baselineCount: number,
  baselineTotal: number,
  compareCount: number,
  compareTotal: number
): DeltaRateStats {
  const baseline = buildRateStats(baselineCount, baselineTotal);
  const compare = buildRateStats(compareCount, compareTotal);
  if (baseline.rate == null || compare.rate == null) {
    return {
      delta: null,
      ciLow: null,
      ciHigh: null,
    };
  }
  return {
    delta: compare.rate - baseline.rate,
    ciLow:
      compare.ciLow != null && baseline.ciHigh != null ? compare.ciLow - baseline.ciHigh : null,
    ciHigh:
      compare.ciHigh != null && baseline.ciLow != null ? compare.ciHigh - baseline.ciLow : null,
  };
}
