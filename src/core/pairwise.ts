import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

import { parse } from 'csv-parse/sync';

import { PairwiseQuestionSchema, type Question } from '../types';

type CsvRow = Record<string, unknown>;

type LoadPairwiseQuestionsInput = {
  dirPath: string;
  limit: number | null;
  warn?: (message: string) => void;
};

type AnswersTelemetry = {
  rowCount: number;
  rows: Array<Record<string, unknown>>;
};

type AnswersTelemetryIndex = {
  byQuestionId: Map<string, AnswersTelemetry>;
  byQuestionText: Map<string, AnswersTelemetry>;
};

const QUESTION_FILE_RE = /^Questions_(.+)\.csv$/i;
const ANSWER_FILE_RE = /^Answers_(.+)\.csv$/i;
const CHOICE_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'] as const;

const QUESTION_FIELD_ALIASES = ['question', 'questiontext', 'prompt', 'stem', 'problem'];
const ANSWER_FIELD_ALIASES = ['answer', 'correctanswer', 'correctchoice', 'correctoption', 'label'];
const EXPLANATION_FIELD_ALIASES = ['explanation', 'rationale', 'reason', 'solution', 'referenceanswerdescription'];
const QUESTION_ID_FIELD_ALIASES = ['id', 'questionid', 'question_id', 'qid', 'itemid', 'item_id'];
const TAG_FIELD_ALIASES = [
  'tags',
  'tag',
  'topictag',
  'topic',
  'topics',
  'category',
  'categories',
  'skill',
  'skills',
  'skilltag',
  'domain',
  'subdomain',
];

const HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '-',
  mdash: '-',
  rsquo: "'",
  lsquo: "'",
  ldquo: '"',
  rdquo: '"',
  hellip: '...',
};

export async function loadPairwiseQuestions({
  dirPath,
  limit,
  warn,
}: LoadPairwiseQuestionsInput): Promise<Question[]> {
  const resolvedDir = isAbsolute(dirPath) ? dirPath : join(process.cwd(), dirPath);
  const onWarn = warn ?? ((message: string) => console.warn(message));

  const directoryEntries = await readdir(resolvedDir, { withFileTypes: true });
  const files = directoryEntries.filter((entry) => entry.isFile()).map((entry) => entry.name);

  const questionFiles = files.filter((name) => QUESTION_FILE_RE.test(name)).sort((a, b) => a.localeCompare(b));
  if (questionFiles.length === 0) {
    throw new Error(`No Questions_*.csv files found in "${resolvedDir}".`);
  }

  const answersBySuffix = new Map<string, string>();
  for (const fileName of files) {
    const suffix = extractFileSuffix(fileName, ANSWER_FILE_RE);
    if (suffix == null) continue;
    const key = suffix.toLowerCase();
    if (!answersBySuffix.has(key)) {
      answersBySuffix.set(key, fileName);
    }
  }

  const telemetryCache = new Map<string, Promise<AnswersTelemetryIndex | null>>();
  const questions: Question[] = [];
  const seenIds = new Set<string>();

  for (const questionFile of questionFiles) {
    const suffix = extractFileSuffix(questionFile, QUESTION_FILE_RE);
    if (suffix == null) continue;

    const answersFile = answersBySuffix.get(suffix.toLowerCase()) ?? null;
    const telemetryIndex = await loadTelemetryIndex({
      telemetryCache,
      directory: resolvedDir,
      answersFile,
      warn: onWarn,
    });

    const questionPath = join(resolvedDir, questionFile);
    const rows = await parseCsvFile(questionPath);

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex];
      const csvRowNumber = rowIndex + 2;
      const built = buildPairwiseQuestion({
        row,
        csvRowNumber,
        questionFile,
        answersFile,
        telemetryIndex,
        warn: onWarn,
      });
      if (!built) continue;

      const parsed = PairwiseQuestionSchema.safeParse(built);
      if (!parsed.success) {
        const issues = parsed.error.issues.map((issue) => issue.message).join('; ');
        onWarn(
          `Skipping malformed row ${csvRowNumber} in ${questionFile}: schema validation failed (${issues || 'unknown error'}).`
        );
        continue;
      }

      if (seenIds.has(parsed.data.id)) {
        onWarn(
          `Skipping duplicate generated id "${parsed.data.id}" from ${questionFile} row ${csvRowNumber}.`
        );
        continue;
      }

      seenIds.add(parsed.data.id);
      questions.push(parsed.data);
    }
  }

  if (questions.length === 0) {
    throw new Error(`No valid pairwise questions were parsed from "${resolvedDir}".`);
  }

  if (limit == null) return questions;
  return questions.slice(0, Math.max(0, limit));
}

async function loadTelemetryIndex({
  telemetryCache,
  directory,
  answersFile,
  warn,
}: {
  telemetryCache: Map<string, Promise<AnswersTelemetryIndex | null>>;
  directory: string;
  answersFile: string | null;
  warn: (message: string) => void;
}): Promise<AnswersTelemetryIndex | null> {
  if (!answersFile) return null;
  if (!telemetryCache.has(answersFile)) {
    telemetryCache.set(
      answersFile,
      loadTelemetryIndexFromFile({
        answersPath: join(directory, answersFile),
        answersFile,
        warn,
      })
    );
  }
  return telemetryCache.get(answersFile) ?? null;
}

async function loadTelemetryIndexFromFile({
  answersPath,
  answersFile,
  warn,
}: {
  answersPath: string;
  answersFile: string;
  warn: (message: string) => void;
}): Promise<AnswersTelemetryIndex | null> {
  let rows: CsvRow[];
  try {
    rows = await parseCsvFile(answersPath);
  } catch (err: any) {
    warn(`Unable to parse telemetry file ${answersFile}: ${String(err?.message ?? err)}`);
    return null;
  }

  const byQuestionId = new Map<string, AnswersTelemetry>();
  const byQuestionText = new Map<string, AnswersTelemetry>();

  for (const row of rows) {
    const lookup = buildLookup(row);
    const questionId = getNormalizedField(lookup, QUESTION_ID_FIELD_ALIASES);
    const questionText = getNormalizedField(lookup, QUESTION_FIELD_ALIASES);
    const payload = normalizeTelemetryPayload(row);

    if (Object.keys(payload).length === 0) continue;
    if (questionId) pushTelemetry(byQuestionId, normalizeIdentifier(questionId), payload);
    if (questionText) pushTelemetry(byQuestionText, normalizeTextKey(questionText), payload);
  }

  return {
    byQuestionId,
    byQuestionText,
  };
}

function pushTelemetry(
  target: Map<string, AnswersTelemetry>,
  key: string,
  payload: Record<string, unknown>
) {
  const existing = target.get(key);
  if (!existing) {
    target.set(key, {
      rowCount: 1,
      rows: [payload],
    });
    return;
  }
  existing.rows.push(payload);
  existing.rowCount = existing.rows.length;
}

function normalizeTelemetryPayload(row: CsvRow): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const cleanKey = key.trim();
    if (!cleanKey) continue;
    const parsedValue = normalizeTelemetryValue(value);
    if (parsedValue == null) continue;
    out[cleanKey] = parsedValue;
  }
  return out;
}

function normalizeTelemetryValue(value: unknown): unknown {
  const raw = normalizePlainText(value);
  if (!raw) return null;
  const maybeNumber = Number(raw);
  if (!Number.isNaN(maybeNumber) && String(maybeNumber) === raw) return maybeNumber;
  return raw;
}

function buildPairwiseQuestion({
  row,
  csvRowNumber,
  questionFile,
  answersFile,
  telemetryIndex,
  warn,
}: {
  row: CsvRow;
  csvRowNumber: number;
  questionFile: string;
  answersFile: string | null;
  telemetryIndex: AnswersTelemetryIndex | null;
  warn: (message: string) => void;
}): Question | null {
  const lookup = buildLookup(row);

  const problemStatement = getNormalizedField(lookup, QUESTION_FIELD_ALIASES);
  if (!problemStatement) {
    warn(`Skipping malformed row ${csvRowNumber} in ${questionFile}: missing question text.`);
    return null;
  }

  const extractedChoices = extractChoices(lookup);
  if (extractedChoices.choices.length < 2) {
    warn(`Skipping malformed row ${csvRowNumber} in ${questionFile}: fewer than 2 answer choices.`);
    return null;
  }

  const answerRaw = getNormalizedField(lookup, ANSWER_FIELD_ALIASES);
  if (!answerRaw) {
    warn(`Skipping malformed row ${csvRowNumber} in ${questionFile}: missing Answer column value.`);
    return null;
  }

  const correctChoiceIndex = resolveCorrectChoiceIndex(answerRaw, extractedChoices);
  if (correctChoiceIndex == null || correctChoiceIndex < 0 || correctChoiceIndex >= extractedChoices.choices.length) {
    warn(`Skipping malformed row ${csvRowNumber} in ${questionFile}: invalid Answer value "${answerRaw}".`);
    return null;
  }

  const explanation = getNormalizedField(lookup, EXPLANATION_FIELD_ALIASES);
  const referenceAnswerDescription = buildReferenceAnswerDescription({
    explanation,
    choices: extractedChoices.choices,
    correctChoiceIndex,
  });

  const tags = extractTags(lookup);
  const topicTag = tags.join(' | ');
  const questionId = getNormalizedField(lookup, QUESTION_ID_FIELD_ALIASES);
  const generatedId = buildGeneratedId(problemStatement, extractedChoices.choices, correctChoiceIndex);
  const telemetry = findTelemetry({
    telemetryIndex,
    questionId,
    questionText: problemStatement,
  });

  const candidate: Question = {
    dataset: 'pairwise',
    id: generatedId,
    questionFormat: 'multiple-choice',
    topicTag: topicTag || 'pairwise',
    tag: tags[0],
    problemStatement,
    choices: extractedChoices.choices,
    correctChoiceIndex,
    referenceAnswerDescription,
    metadata: {
      tags,
      source: {
        questionsFile: questionFile,
        answersFile,
        questionsRow: csvRowNumber,
        questionId: questionId ?? undefined,
      },
      answersTelemetry: telemetry ?? undefined,
    },
  };

  return candidate;
}

function findTelemetry({
  telemetryIndex,
  questionId,
  questionText,
}: {
  telemetryIndex: AnswersTelemetryIndex | null;
  questionId: string | null;
  questionText: string;
}): Record<string, unknown> | null {
  if (!telemetryIndex) return null;

  if (questionId) {
    const byId = telemetryIndex.byQuestionId.get(normalizeIdentifier(questionId));
    if (byId) return { rowCount: byId.rowCount, rows: byId.rows };
  }

  const byText = telemetryIndex.byQuestionText.get(normalizeTextKey(questionText));
  if (byText) return { rowCount: byText.rowCount, rows: byText.rows };
  return null;
}

function buildReferenceAnswerDescription({
  explanation,
  choices,
  correctChoiceIndex,
}: {
  explanation: string | null;
  choices: string[];
  correctChoiceIndex: number;
}): string {
  if (explanation && explanation.length >= 10) return explanation;
  const correctChoice = choices[correctChoiceIndex] ?? 'unknown';
  return `Correct option text: ${correctChoice}.`;
}

function buildGeneratedId(problemStatement: string, choices: string[], correctChoiceIndex: number): string {
  const digest = createHash('sha1')
    .update(problemStatement)
    .update('\n')
    .update(choices.join('\n'))
    .update('\n')
    .update(String(correctChoiceIndex))
    .digest('hex')
    .slice(0, 16);
  return `pairwise-${digest}`;
}

function extractChoices(lookup: Map<string, string>): {
  choices: string[];
  labelToIndex: Map<string, number>;
} {
  const labelToIndex = new Map<string, number>();

  const letterChoices: string[] = [];
  for (let i = 0; i < CHOICE_LETTERS.length; i++) {
    const letter = CHOICE_LETTERS[i];
    const value = getNormalizedField(lookup, [
      letter,
      `option${letter}`,
      `choice${letter}`,
      `option_${letter}`,
      `choice_${letter}`,
      `${letter}option`,
      `${letter}choice`,
    ]);
    if (!value) continue;
    labelToIndex.set(letter.toLowerCase(), letterChoices.length);
    labelToIndex.set(String(letterChoices.length + 1), letterChoices.length);
    letterChoices.push(value);
  }

  if (letterChoices.length >= 2) {
    return {
      choices: letterChoices,
      labelToIndex,
    };
  }

  const numberedChoices = extractNumberedChoices(lookup);
  if (numberedChoices.length >= 2) {
    const out: string[] = [];
    for (const [ordinal, text] of numberedChoices) {
      labelToIndex.set(String(ordinal), out.length);
      const letter = CHOICE_LETTERS[ordinal - 1];
      if (letter) labelToIndex.set(letter.toLowerCase(), out.length);
      out.push(text);
    }
    return {
      choices: out,
      labelToIndex,
    };
  }

  const combined = getNormalizedField(lookup, ['options', 'choices', 'answeroptions', 'answerchoices']);
  if (combined) {
    const split = splitCombinedOptions(combined);
    for (let i = 0; i < split.length; i++) {
      labelToIndex.set(String(i + 1), i);
      const letter = CHOICE_LETTERS[i];
      if (letter) labelToIndex.set(letter.toLowerCase(), i);
    }
    return {
      choices: split,
      labelToIndex,
    };
  }

  return {
    choices: [],
    labelToIndex,
  };
}

function extractNumberedChoices(lookup: Map<string, string>): Array<[number, string]> {
  const found: Array<[number, string]> = [];
  for (const [key, value] of lookup.entries()) {
    const match = /^(?:option|choice)(\d{1,2})$/.exec(key);
    if (!match) continue;
    const ordinal = Number.parseInt(match[1], 10);
    if (!Number.isFinite(ordinal) || ordinal <= 0) continue;
    const normalized = normalizePlainText(value);
    if (!normalized) continue;
    found.push([ordinal, normalized]);
  }
  found.sort((a, b) => a[0] - b[0]);
  return found;
}

function splitCombinedOptions(value: string): string[] {
  const splitters = [/\r?\n+/, /\s*\|\s*/, /\s*;\s*/, /\s*,\s*/];
  for (const splitter of splitters) {
    const parts = value
      .split(splitter)
      .map((part) => normalizePlainText(part))
      .filter((part) => part.length > 0);
    if (parts.length >= 2) return parts;
  }
  return [];
}

function resolveCorrectChoiceIndex(
  answerRaw: string,
  extractedChoices: { choices: string[]; labelToIndex: Map<string, number> }
): number | null {
  const answer = normalizePlainText(answerRaw);
  if (!answer) return null;

  const lower = answer.toLowerCase();
  const direct = extractedChoices.labelToIndex.get(lower);
  if (direct != null) return direct;

  const letterMatch = /^(?:option|choice)?\s*([a-j])(?:[\).:\-]\s*.*)?$/i.exec(answer);
  if (letterMatch) {
    const byLetter = extractedChoices.labelToIndex.get(letterMatch[1].toLowerCase());
    if (byLetter != null) return byLetter;

    const fallback = CHOICE_LETTERS.indexOf(letterMatch[1].toUpperCase() as (typeof CHOICE_LETTERS)[number]);
    if (fallback >= 0 && fallback < extractedChoices.choices.length) return fallback;
  }

  const numberMatch = /^(?:option|choice)?\s*(\d{1,2})(?:[\).:\-]\s*.*)?$/i.exec(answer);
  if (numberMatch) {
    const byOrdinal = extractedChoices.labelToIndex.get(numberMatch[1]);
    if (byOrdinal != null) return byOrdinal;

    const fallback = Number.parseInt(numberMatch[1], 10) - 1;
    if (fallback >= 0 && fallback < extractedChoices.choices.length) return fallback;
  }

  const answerWithoutPrefix = answer.replace(/^(?:option|choice)?\s*[a-j0-9]+[\).:\-]\s*/i, '').trim();
  for (let i = 0; i < extractedChoices.choices.length; i++) {
    const choice = extractedChoices.choices[i];
    if (choice.toLowerCase() === lower) return i;
    if (answerWithoutPrefix && choice.toLowerCase() === answerWithoutPrefix.toLowerCase()) return i;
  }

  return null;
}

function extractTags(lookup: Map<string, string>): string[] {
  const tags: string[] = [];
  const seen = new Set<string>();

  const add = (value: string) => {
    for (const chunk of splitTagField(value)) {
      const normalized = normalizePlainText(chunk);
      if (!normalized) continue;
      const dedupeKey = normalized.toLowerCase();
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      tags.push(normalized);
    }
  };

  for (const alias of TAG_FIELD_ALIASES) {
    const value = getRawField(lookup, [alias]);
    if (!value) continue;
    add(value);
  }

  for (const [key, value] of lookup.entries()) {
    if (/^(?:tag|topic|skill)\d+$/.test(key)) add(value);
  }

  if (tags.length === 0) {
    tags.push('pairwise');
  }

  return tags;
}

function splitTagField(raw: string): string[] {
  const primary = raw.split(/\r?\n|\||;/g);
  if (primary.length > 1) return primary;
  const commaSplit = raw.split(',');
  if (commaSplit.length > 1) return commaSplit;
  return [raw];
}

async function parseCsvFile(filePath: string): Promise<CsvRow[]> {
  const raw = await readFile(filePath, 'utf8');
  try {
    const records = parse(raw, {
      bom: true,
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: false,
    }) as Array<Record<string, unknown>>;

    return records.map((record) => ({ ...record }));
  } catch (err: any) {
    throw new Error(`Failed to parse CSV "${filePath}": ${String(err?.message ?? err)}`);
  }
}

function buildLookup(row: CsvRow): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const [rawKey, rawValue] of Object.entries(row)) {
    const key = normalizeHeader(rawKey);
    if (!key || lookup.has(key)) continue;
    lookup.set(key, String(rawValue ?? ''));
  }
  return lookup;
}

function getNormalizedField(lookup: Map<string, string>, aliases: string[]): string | null {
  const raw = getRawField(lookup, aliases);
  if (!raw) return null;
  const normalized = normalizePlainText(raw);
  return normalized || null;
}

function getRawField(lookup: Map<string, string>, aliases: string[]): string | null {
  for (const alias of aliases) {
    const key = normalizeHeader(alias);
    if (!key) continue;
    if (!lookup.has(key)) continue;
    return lookup.get(key) ?? null;
  }
  return null;
}

function extractFileSuffix(fileName: string, pattern: RegExp): string | null {
  const match = pattern.exec(fileName);
  if (!match || !match[1]) return null;
  return match[1];
}

function normalizeHeader(value: string): string {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function normalizeIdentifier(value: string): string {
  const normalized = normalizePlainText(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || 'unknown';
}

function normalizeTextKey(value: string): string {
  return normalizePlainText(value).toLowerCase();
}

function normalizePlainText(value: unknown): string {
  const raw = String(value ?? '');
  if (!raw) return '';

  const noScript = raw
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const decoded = decodeHtmlEntities(noScript);
  const stripped = decoded.replace(/<[^>]+>/g, ' ');
  const decodedAgain = decodeHtmlEntities(stripped);

  return decodedAgain.replace(/\s+/g, ' ').trim();
}

function decodeHtmlEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_full, body: string) => {
    const token = String(body).toLowerCase();
    if (token.startsWith('#x')) {
      const codePoint = Number.parseInt(token.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : ' ';
    }
    if (token.startsWith('#')) {
      const codePoint = Number.parseInt(token.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : ' ';
    }
    return HTML_ENTITIES[token] ?? ' ';
  });
}
