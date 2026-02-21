import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

import type { CsbenchFormat, Question } from '../types';

type RawCsbenchRow = {
  ID?: number | string;
  Split?: string;
  Domain?: string;
  SubDomain?: string;
  Format?: string;
  Tag?: string;
  Language?: string;
  Question?: string;
  Answer?: unknown;
  Explanation?: string;
  A?: string;
  B?: string;
  C?: string;
  D?: string;
  E?: string;
  F?: string;
  G?: string;
  H?: string;
  I?: string;
  J?: string;
};

const CHOICE_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'] as const;

export async function loadCsbenchQuestions({
  jsonlPath,
  limit,
  formats,
}: {
  jsonlPath: string;
  limit: number | null;
  formats: CsbenchFormat[];
}): Promise<Question[]> {
  const path = isAbsolute(jsonlPath) ? jsonlPath : join(process.cwd(), jsonlPath);
  const raw = await readFile(path, 'utf-8');
  const lines = raw.split('\n');

  const allowedFormats = new Set<CsbenchFormat>(formats);
  const questions: Question[] = [];
  const seenIds = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    if (limit != null && questions.length >= limit) return questions;
    const line = lines[i].trim();
    if (!line) continue;

    let row: RawCsbenchRow;
    try {
      row = JSON.parse(line) as RawCsbenchRow;
    } catch (err: any) {
      throw new Error(`Failed to parse CS Bench JSONL at line ${i + 1}: ${String(err?.message ?? err)}`);
    }

    const format = normalizeFormat(row.Format);
    if (!format || !allowedFormats.has(format)) continue;

    const question = buildQuestion(row, format);
    if (!question) continue;
    if (seenIds.has(question.id)) continue;

    seenIds.add(question.id);
    questions.push(question);
  }

  return questions;
}

function buildQuestion(row: RawCsbenchRow, csbenchFormat: CsbenchFormat): Question | null {
  const idRaw = toNonEmptyString(row.ID);
  const prompt = toNonEmptyString(row.Question);
  if (!idRaw || !prompt) return null;

  const split = toNonEmptyString(row.Split) ?? 'unknown';
  const domain = toNonEmptyString(row.Domain) ?? 'unknown';
  const subDomain = toNonEmptyString(row.SubDomain) ?? 'unknown';
  const tag = toNonEmptyString(row.Tag) ?? 'unknown';
  const language = toNonEmptyString(row.Language) ?? 'unknown';
  const answer = normalizeAnswer(row.Answer);
  const explanation = toNonEmptyString(row.Explanation);
  const referenceAnswerDescription = buildReferenceAnswerDescription(answer, explanation);
  const topicTag = [domain, subDomain].filter(Boolean).join(' / ') || 'csbench';

  const csbenchBase = {
    dataset: 'csbench' as const,
    source: 'csbench' as const,
    id: `csbench-${split.toLowerCase()}-${idRaw}`,
    csbenchFormat,
    questionFormat: csbenchFormat,
    domain,
    subDomain,
    tag,
    topicTag,
    problemStatement: prompt,
    referenceAnswerDescription,
    csbench: {
      id: idRaw,
      split,
      domain,
      subDomain,
      tag,
      language,
      answer,
      explanation: explanation ?? undefined,
    },
  };

  if (csbenchFormat === 'multiple-choice') {
    const choices = extractChoices(row);
    const correctChoiceIndex = inferChoiceIndex(row.Answer, choices.length);
    if (choices.length < 2 || correctChoiceIndex == null) return null;
    return {
      ...csbenchBase,
      csbenchFormat,
      choices,
      correctChoiceIndex,
    };
  }

  if (csbenchFormat === 'assertion') {
    const booleanAnswer = inferBooleanAnswer(row.Answer);
    if (booleanAnswer == null) return null;
    return {
      ...csbenchBase,
      csbenchFormat,
      choices: ['True', 'False'],
      correctChoiceIndex: booleanAnswer ? 0 : 1,
    };
  }

  if (csbenchFormat === 'fill-in-the-blank') {
    return {
      ...csbenchBase,
      csbenchFormat,
    };
  }

  return {
    ...csbenchBase,
    csbenchFormat: 'open-ended',
  };
}

function normalizeFormat(value: unknown): CsbenchFormat | null {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  if (normalized === 'multiple-choice' || normalized === 'multiple choice' || normalized === 'mcq') {
    return 'multiple-choice';
  }
  if (normalized === 'assertion' || normalized === 'true-false' || normalized === 'true/false') {
    return 'assertion';
  }
  if (normalized === 'fill-in-the-blank' || normalized === 'fill in the blank') {
    return 'fill-in-the-blank';
  }
  if (normalized === 'open-ended' || normalized === 'open ended') {
    return 'open-ended';
  }
  return null;
}

function toNonEmptyString(value: unknown): string | null {
  const str = String(value ?? '').trim();
  return str ? str : null;
}

function normalizeAnswer(value: unknown): string | boolean {
  if (typeof value === 'boolean') return value;
  const str = String(value ?? '').trim();
  if (!str) return '';
  if (str.toLowerCase() === 'true') return true;
  if (str.toLowerCase() === 'false') return false;
  return str;
}

function buildReferenceAnswerDescription(answer: string | boolean, explanation: string | null): string {
  if (explanation) return explanation;
  if (typeof answer === 'boolean') {
    return `Expected answer: ${answer ? 'True' : 'False'}.`;
  }
  if (answer) {
    return `Expected answer: ${answer}.`;
  }
  return 'Expected answer provided by CS Bench.';
}

function extractChoices(row: RawCsbenchRow): string[] {
  const out: string[] = [];
  for (const letter of CHOICE_LETTERS) {
    const value = row[letter];
    const text = toNonEmptyString(value);
    if (text) out.push(text);
  }
  return out;
}

function inferChoiceIndex(answer: unknown, choicesLength: number): number | null {
  const raw = String(answer ?? '').trim().toUpperCase();
  if (!raw) return null;
  const letterIndex = CHOICE_LETTERS.indexOf(raw as (typeof CHOICE_LETTERS)[number]);
  if (letterIndex >= 0) return letterIndex < choicesLength ? letterIndex : null;

  const asNumber = Number.parseInt(raw, 10);
  if (!Number.isFinite(asNumber)) return null;
  const idx = asNumber - 1;
  if (idx < 0 || idx >= choicesLength) return null;
  return idx;
}

function inferBooleanAnswer(answer: unknown): boolean | null {
  if (typeof answer === 'boolean') return answer;
  const raw = String(answer ?? '').trim().toLowerCase();
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return null;
}
