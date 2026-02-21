import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

import {
  BROAD_CONCEPTS,
  labelQuestionBroadConcept,
  type BroadConcept,
  type BroadConceptLabel,
} from './topic-normalization';
import { loadCsbenchQuestions } from './csbench';
import { loadPairwiseQuestions } from './pairwise';
import { CsbenchFormatSchema, type CsbenchFormat, type Question } from '../types';

export type OverlapDatasetQuestion = Question & {
  source: 'csbench' | 'pairwise';
};

export type OverlapDatasetQuestionRecord = {
  question: OverlapDatasetQuestion;
  overlap: BroadConceptLabel;
};

export type OverlapDatasetFile = {
  generatedAtIso: string;
  csbenchPath: string;
  pairwiseDir: string;
  csbenchFormats: CsbenchFormat[];
  sharedBroadConcepts: BroadConcept[];
  totals: {
    csbenchInput: number;
    pairwiseInput: number;
    csbenchOverlap: number;
    pairwiseOverlap: number;
    combinedOverlap: number;
  };
  questions: OverlapDatasetQuestion[];
  overlapMetadata: Record<string, BroadConceptLabel>;
};

type BuildOverlapDatasetOptions = {
  csbenchPath: string;
  pairwiseDir: string;
  limit: number | null;
  csbenchFormats?: CsbenchFormat[];
  warn?: (message: string) => void;
};

function normalizeDatasetPath(path: string): string {
  return isAbsolute(path) ? path : join(process.cwd(), path);
}

function deriveSource(question: Question): 'csbench' | 'pairwise' | null {
  if (question.dataset === 'csbench') return 'csbench';
  if (question.dataset === 'pairwise') return 'pairwise';
  return null;
}

function withSource(question: Question, source: 'csbench' | 'pairwise'): OverlapDatasetQuestion {
  return {
    ...question,
    source,
  };
}

function computeConceptCounts(labels: BroadConceptLabel[]): Map<BroadConcept, number> {
  const counts = new Map<BroadConcept, number>();
  for (const label of labels) {
    counts.set(label.concept, (counts.get(label.concept) ?? 0) + 1);
  }
  return counts;
}

function getSharedBroadConcepts(
  csbenchLabels: BroadConceptLabel[],
  pairwiseLabels: BroadConceptLabel[]
): BroadConcept[] {
  const csbenchCounts = computeConceptCounts(csbenchLabels);
  const pairwiseCounts = computeConceptCounts(pairwiseLabels);

  return BROAD_CONCEPTS.filter((concept) => {
    if (concept === 'unknown') return false;
    return (csbenchCounts.get(concept) ?? 0) > 0 && (pairwiseCounts.get(concept) ?? 0) > 0;
  });
}

export async function buildCsbenchPairwiseOverlapDataset({
  csbenchPath,
  pairwiseDir,
  limit,
  csbenchFormats = ['multiple-choice', 'assertion', 'fill-in-the-blank', 'open-ended'],
  warn,
}: BuildOverlapDatasetOptions): Promise<OverlapDatasetFile> {
  const formatList = csbenchFormats.map((format) => CsbenchFormatSchema.parse(format));
  const warnings: string[] = [];

  const pairwiseQuestions = await loadPairwiseQuestions({
    dirPath: pairwiseDir,
    limit,
    warn: (message) => {
      warnings.push(message);
      warn?.(message);
    },
  });
  const csbenchQuestions = await loadCsbenchQuestions({
    jsonlPath: csbenchPath,
    limit,
    formats: formatList,
  });

  const labeledCsbench = csbenchQuestions.map((question) => ({
    question: withSource(question, 'csbench'),
    overlap: labelQuestionBroadConcept(question),
  }));
  const labeledPairwise = pairwiseQuestions.map((question) => ({
    question: withSource(question, 'pairwise'),
    overlap: labelQuestionBroadConcept(question),
  }));

  const sharedBroadConcepts = getSharedBroadConcepts(
    labeledCsbench.map((row) => row.overlap),
    labeledPairwise.map((row) => row.overlap)
  );
  const sharedSet = new Set<BroadConcept>(sharedBroadConcepts);

  const overlapCsbench = labeledCsbench.filter((row) => sharedSet.has(row.overlap.concept));
  const overlapPairwise = labeledPairwise.filter((row) => sharedSet.has(row.overlap.concept));

  const allOverlapRows = [...overlapCsbench, ...overlapPairwise];
  const overlapMetadata = allOverlapRows.reduce<Record<string, BroadConceptLabel>>((acc, row) => {
    acc[row.question.id] = row.overlap;
    return acc;
  }, {});

  if (warnings.length > 0) {
    warn?.(`Pairwise loader emitted ${warnings.length} warning(s) while building overlap dataset.`);
  }

  return {
    generatedAtIso: new Date().toISOString(),
    csbenchPath: normalizeDatasetPath(csbenchPath),
    pairwiseDir: normalizeDatasetPath(pairwiseDir),
    csbenchFormats: formatList,
    sharedBroadConcepts,
    totals: {
      csbenchInput: csbenchQuestions.length,
      pairwiseInput: pairwiseQuestions.length,
      csbenchOverlap: overlapCsbench.length,
      pairwiseOverlap: overlapPairwise.length,
      combinedOverlap: allOverlapRows.length,
    },
    questions: allOverlapRows.map((row) => row.question),
    overlapMetadata,
  };
}

export async function loadOverlapQuestions({
  jsonPath,
  limit,
}: {
  jsonPath: string;
  limit: number | null;
}): Promise<Question[]> {
  const path = normalizeDatasetPath(jsonPath);
  const raw = await readFile(path, 'utf8');
  const parsed = JSON.parse(raw) as { questions?: unknown[] } | unknown[];
  const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed.questions) ? parsed.questions : [];
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`No questions found in overlap dataset file: "${path}"`);
  }

  const questions: Question[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row || typeof row !== 'object') {
      throw new Error(`Invalid overlap question at index ${i}: row must be an object.`);
    }

    const question = row as Question;
    const dataset = (question as any).dataset;
    const id = (question as any).id;
    const topicTag = (question as any).topicTag;
    const problemStatement = (question as any).problemStatement;
    const referenceAnswerDescription = (question as any).referenceAnswerDescription;

    if (typeof dataset !== 'string' || !dataset) {
      throw new Error(`Invalid overlap question at index ${i}: missing dataset.`);
    }
    if (typeof id !== 'string' || !id.trim()) {
      throw new Error(`Invalid overlap question at index ${i}: missing id.`);
    }
    if (typeof topicTag !== 'string' || !topicTag.trim()) {
      throw new Error(`Invalid overlap question at index ${i}: missing topicTag.`);
    }
    if (typeof problemStatement !== 'string' || problemStatement.trim().length < 10) {
      throw new Error(`Invalid overlap question at index ${i}: invalid problemStatement.`);
    }
    if (
      typeof referenceAnswerDescription !== 'string' ||
      referenceAnswerDescription.trim().length < 10
    ) {
      throw new Error(
        `Invalid overlap question at index ${i}: invalid referenceAnswerDescription.`
      );
    }

    const source = deriveSource(question);
    const withDerivedSource = source
      ? {
          ...question,
          source,
        }
      : question;
    questions.push(withDerivedSource as Question);
  }

  if (limit == null) return questions;
  return questions.slice(0, Math.max(0, limit));
}
