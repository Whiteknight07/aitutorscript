import { writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

import {
  BROAD_CONCEPTS,
  labelQuestionBroadConcept,
  toBroadConceptLabel,
  type BroadConcept,
} from '../core/topic-normalization';
import { loadCsbenchQuestions } from '../core/csbench';
import { loadPairwiseQuestions } from '../core/pairwise';
import type { CsbenchFormat, Question } from '../types';

type ScriptOptions = {
  csbenchPath: string;
  pairwiseDir: string;
  limit: number | null;
  jsonOut: string | null;
};

type ConceptStats = {
  concept: BroadConcept;
  label: string;
  pairwiseCount: number;
  pairwiseShare: number;
  csbenchCount: number;
  csbenchShare: number;
  inBoth: boolean;
};

type DatasetSummary = {
  total: number;
  conceptCounts: Record<BroadConcept, number>;
  confidenceCounts: Record<'high' | 'medium' | 'low', number>;
};

const ALL_CSBENCH_FORMATS: CsbenchFormat[] = [
  'multiple-choice',
  'assertion',
  'fill-in-the-blank',
  'open-ended',
];

function parseArgs(argv: string[]): ScriptOptions {
  const opts: ScriptOptions = {
    csbenchPath: 'test.jsonl',
    pairwiseDir: join('data', 'pairwise'),
    limit: null,
    jsonOut: join('results', 'topic-overlap.json'),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--csbenchPath') {
      opts.csbenchPath = String(argv[i + 1] ?? opts.csbenchPath);
      i += 1;
      continue;
    }
    if (token === '--pairwiseDir') {
      opts.pairwiseDir = String(argv[i + 1] ?? opts.pairwiseDir);
      i += 1;
      continue;
    }
    if (token === '--limit') {
      const raw = Number.parseInt(String(argv[i + 1] ?? ''), 10);
      opts.limit = Number.isFinite(raw) && raw > 0 ? raw : null;
      i += 1;
      continue;
    }
    if (token === '--jsonOut') {
      const value = String(argv[i + 1] ?? '').trim();
      opts.jsonOut = value ? value : null;
      i += 1;
    }
  }

  return opts;
}

function createConceptCounts(): Record<BroadConcept, number> {
  return {
    'control-flow': 0,
    'data-representation': 0,
    'memory-state': 0,
    'data-structures': 0,
    'algorithms-complexity': 0,
    'systems-os': 0,
    networking: 0,
    'architecture-organization': 0,
    'io-formatting': 0,
    unknown: 0,
  };
}

function summarizeDataset(questions: Question[]): DatasetSummary {
  const conceptCounts = createConceptCounts();
  const confidenceCounts: Record<'high' | 'medium' | 'low', number> = {
    high: 0,
    medium: 0,
    low: 0,
  };

  for (const question of questions) {
    const label = labelQuestionBroadConcept(question);
    conceptCounts[label.concept] += 1;
    confidenceCounts[label.confidence] += 1;
  }

  return {
    total: questions.length,
    conceptCounts,
    confidenceCounts,
  };
}

function toShare(count: number, total: number): number {
  if (total <= 0) return 0;
  return (count / total) * 100;
}

function buildConceptStats(pairwise: DatasetSummary, csbench: DatasetSummary): ConceptStats[] {
  return BROAD_CONCEPTS.filter((concept) => concept !== 'unknown')
    .map((concept) => {
      const pairwiseCount = pairwise.conceptCounts[concept];
      const csbenchCount = csbench.conceptCounts[concept];
      return {
        concept,
        label: toBroadConceptLabel(concept),
        pairwiseCount,
        pairwiseShare: toShare(pairwiseCount, pairwise.total),
        csbenchCount,
        csbenchShare: toShare(csbenchCount, csbench.total),
        inBoth: pairwiseCount > 0 && csbenchCount > 0,
      };
    })
    .sort((a, b) => {
      if (a.inBoth !== b.inBoth) return a.inBoth ? -1 : 1;
      const combinedA = a.pairwiseCount + a.csbenchCount;
      const combinedB = b.pairwiseCount + b.csbenchCount;
      return combinedB - combinedA;
    });
}

function formatPct(value: number): string {
  return `${value.toFixed(1)}%`;
}

function summarizeOverlap(pairwise: DatasetSummary, csbench: DatasetSummary) {
  const conceptsPairwise = new Set<BroadConcept>();
  const conceptsCsbench = new Set<BroadConcept>();

  for (const concept of BROAD_CONCEPTS) {
    if (concept === 'unknown') continue;
    if (pairwise.conceptCounts[concept] > 0) conceptsPairwise.add(concept);
    if (csbench.conceptCounts[concept] > 0) conceptsCsbench.add(concept);
  }

  const sharedConcepts = Array.from(conceptsPairwise).filter((concept) => conceptsCsbench.has(concept));
  const unionConcepts = new Set<BroadConcept>([...conceptsPairwise, ...conceptsCsbench]);
  const jaccard = unionConcepts.size === 0 ? 0 : sharedConcepts.length / unionConcepts.size;

  const pairwiseSharedCoverage = sharedConcepts.reduce((sum, concept) => sum + pairwise.conceptCounts[concept], 0);
  const csbenchSharedCoverage = sharedConcepts.reduce((sum, concept) => sum + csbench.conceptCounts[concept], 0);

  return {
    sharedConcepts: sharedConcepts.sort((a, b) => a.localeCompare(b)),
    jaccard,
    pairwiseSharedCoverage,
    csbenchSharedCoverage,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const pairwiseWarnings: string[] = [];

  const pairwiseQuestions = await loadPairwiseQuestions({
    dirPath: options.pairwiseDir,
    limit: options.limit,
    warn: (message) => pairwiseWarnings.push(message),
  });

  const csbenchQuestions = await loadCsbenchQuestions({
    jsonlPath: options.csbenchPath,
    limit: options.limit,
    formats: ALL_CSBENCH_FORMATS,
  });

  const pairwiseSummary = summarizeDataset(pairwiseQuestions);
  const csbenchSummary = summarizeDataset(csbenchQuestions);
  const conceptStats = buildConceptStats(pairwiseSummary, csbenchSummary);
  const overlap = summarizeOverlap(pairwiseSummary, csbenchSummary);

  const sharedLabels = overlap.sharedConcepts.map((concept) => toBroadConceptLabel(concept));

  // eslint-disable-next-line no-console
  console.log(
    `Loaded ${pairwiseSummary.total} pairwise questions and ${csbenchSummary.total} csbench questions.` +
      (pairwiseWarnings.length ? ` (${pairwiseWarnings.length} pairwise loader warnings)` : '')
  );
  // eslint-disable-next-line no-console
  console.log(`Shared broad concepts (${overlap.sharedConcepts.length}): ${sharedLabels.join(', ') || 'none'}`);
  // eslint-disable-next-line no-console
  console.log(`Concept-set Jaccard overlap: ${formatPct(overlap.jaccard * 100)}`);
  // eslint-disable-next-line no-console
  console.log(
    `Coverage in shared concepts: pairwise ${formatPct(
      toShare(overlap.pairwiseSharedCoverage, pairwiseSummary.total)
    )}, csbench ${formatPct(toShare(overlap.csbenchSharedCoverage, csbenchSummary.total))}`
  );
  // eslint-disable-next-line no-console
  console.log('');
  // eslint-disable-next-line no-console
  console.log('Per-concept overlap:');
  for (const row of conceptStats) {
    // eslint-disable-next-line no-console
    console.log(
      `- ${row.label}: pairwise=${row.pairwiseCount} (${formatPct(row.pairwiseShare)}), csbench=${row.csbenchCount} (${formatPct(row.csbenchShare)})${row.inBoth ? ' [shared]' : ''}`
    );
  }

  if (options.jsonOut) {
    const outPath = isAbsolute(options.jsonOut) ? options.jsonOut : join(process.cwd(), options.jsonOut);
    const payload = {
      generatedAtIso: new Date().toISOString(),
      options,
      totals: {
        pairwise: pairwiseSummary.total,
        csbench: csbenchSummary.total,
      },
      confidence: {
        pairwise: pairwiseSummary.confidenceCounts,
        csbench: csbenchSummary.confidenceCounts,
      },
      overlap,
      conceptStats,
      pairwiseWarnings: pairwiseWarnings.slice(0, 100),
    };
    await writeFile(outPath, JSON.stringify(payload, null, 2));
    // eslint-disable-next-line no-console
    console.log('');
    // eslint-disable-next-line no-console
    console.log(`Wrote ${outPath}`);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exitCode = 1;
});
