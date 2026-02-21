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
  answerCounts: Record<string, number>;
};

type AnswersTelemetryIndex = {
  byQuestionId: Map<string, AnswersTelemetry>;
};

const QUESTION_FILE_RE = /^Questions_(.+)\.csv$/i;
const ANSWER_FILE_RE = /^Answers_(.+)\.csv$/i;
const CHOICE_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'] as const;

const QUESTION_FIELD_ALIASES = ['question', 'questiontext', 'prompt', 'stem', 'problem'];
const ANSWER_FIELD_ALIASES = ['answer', 'correctanswer', 'correctchoice', 'correctoption', 'label'];
const EXPLANATION_FIELD_ALIASES = ['explanation', 'rationale', 'reason', 'solution', 'referenceanswerdescription'];
const QUESTION_ID_FIELD_ALIASES = ['id', 'questionid', 'question_id', 'qid', 'itemid', 'item_id'];
const NUM_OPTIONS_FIELD_ALIASES = ['numoptions', 'num_options', 'optioncount', 'choicecount'];
const AVG_RATING_FIELD_ALIASES = ['avgrating', 'avg_rating', 'ratingavg', 'ratingaverage'];
const TOTAL_ANSWERS_FIELD_ALIASES = ['totalanswers', 'total_answers', 'answercount', 'answers'];
const TOTAL_RATINGS_FIELD_ALIASES = ['totalratings', 'total_ratings', 'ratingcount'];
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
        splitId: suffix,
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

  for (const row of rows) {
    const lookup = buildLookup(row);
    const questionId = getNormalizedField(lookup, QUESTION_ID_FIELD_ALIASES);
    const answerValue = getNormalizedField(lookup, ANSWER_FIELD_ALIASES);
    if (!questionId) continue;
    pushTelemetry(byQuestionId, normalizeIdentifier(questionId), answerValue);
  }

  return {
    byQuestionId,
  };
}

function pushTelemetry(
  target: Map<string, AnswersTelemetry>,
  key: string,
  answerValue: string | null
) {
  const normalizedAnswer = normalizeAnswerLabel(answerValue);
  const existing = target.get(key);
  if (!existing) {
    const answerCounts: Record<string, number> = {};
    if (normalizedAnswer) answerCounts[normalizedAnswer] = 1;
    target.set(key, {
      rowCount: 1,
      answerCounts,
    });
    return;
  }
  existing.rowCount += 1;
  if (normalizedAnswer) {
    existing.answerCounts[normalizedAnswer] = (existing.answerCounts[normalizedAnswer] ?? 0) + 1;
  }
}

function buildPairwiseQuestion({
  row,
  csvRowNumber,
  splitId,
  questionFile,
  answersFile,
  telemetryIndex,
  warn,
}: {
  row: CsvRow;
  csvRowNumber: number;
  splitId: string;
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

  const declaredNumOptions = getIntegerField(lookup, NUM_OPTIONS_FIELD_ALIASES);
  const extractedChoices = extractChoices(lookup, declaredNumOptions);
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
  const generatedId = buildGeneratedId({
    splitId,
    questionId,
    problemStatement,
    choices: extractedChoices.choices,
    correctChoiceIndex,
  });
  const avgRating = getFloatField(lookup, AVG_RATING_FIELD_ALIASES);
  const totalAnswers = getIntegerField(lookup, TOTAL_ANSWERS_FIELD_ALIASES);
  const totalRatings = getIntegerField(lookup, TOTAL_RATINGS_FIELD_ALIASES);
  const stats = {
    avgRating: avgRating ?? undefined,
    totalAnswers: totalAnswers ?? undefined,
    totalRatings: totalRatings ?? undefined,
    numOptions: declaredNumOptions ?? undefined,
  };
  const hasStats = Object.values(stats).some((value) => value != null);
  const telemetry = findTelemetry({
    telemetryIndex,
    questionId,
    authoredAnswer: answerRaw,
  });

  const candidate: Question = {
    dataset: 'pairwise',
    source: 'pairwise',
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
        splitId,
        questionsFile: questionFile,
        answersFile,
        questionsRow: csvRowNumber,
        questionId: questionId ?? undefined,
      },
      stats: hasStats ? stats : undefined,
      answersTelemetry: telemetry ?? undefined,
    },
  };

  return candidate;
}

function findTelemetry({
  telemetryIndex,
  questionId,
  authoredAnswer,
}: {
  telemetryIndex: AnswersTelemetryIndex | null;
  questionId: string | null;
  authoredAnswer: string;
}):
  | {
      rowCount: number;
      answerCounts: Record<string, number>;
      authoredAnswer?: string;
      authoredAnswerShare?: number;
    }
  | null {
  if (!telemetryIndex) return null;
  if (!questionId) return null;

  const byId = telemetryIndex.byQuestionId.get(normalizeIdentifier(questionId));
  if (!byId) return null;

  const normalizedAuthored = normalizeAnswerLabel(authoredAnswer);
  const answerCounts = { ...byId.answerCounts };
  const telemetry: {
    rowCount: number;
    answerCounts: Record<string, number>;
    authoredAnswer?: string;
    authoredAnswerShare?: number;
  } = {
    rowCount: byId.rowCount,
    answerCounts,
  };

  if (normalizedAuthored) {
    telemetry.authoredAnswer = normalizedAuthored;
    const authoredVotes = answerCounts[normalizedAuthored] ?? 0;
    telemetry.authoredAnswerShare = byId.rowCount > 0 ? authoredVotes / byId.rowCount : 0;
  }

  return telemetry;
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

function buildGeneratedId({
  splitId,
  questionId,
  problemStatement,
  choices,
  correctChoiceIndex,
}: {
  splitId: string;
  questionId: string | null;
  problemStatement: string;
  choices: string[];
  correctChoiceIndex: number;
}): string {
  const splitPart = toIdPart(splitId, 'unknown');
  if (questionId) {
    return `pairwise-${splitPart}-${toIdPart(questionId, 'unknown')}`;
  }
  const digest = createHash('sha1')
    .update(problemStatement)
    .update('\n')
    .update(choices.join('\n'))
    .update('\n')
    .update(String(correctChoiceIndex))
    .digest('hex')
    .slice(0, 16);
  return `pairwise-${splitPart}-${digest}`;
}

function extractChoices(lookup: Map<string, string>, declaredNumOptions: number | null): {
  choices: string[];
  labelToIndex: Map<string, number>;
} {
  const labelToIndex = new Map<string, number>();
  const choiceLimit =
    declaredNumOptions != null && declaredNumOptions > 0
      ? Math.min(declaredNumOptions, CHOICE_LETTERS.length)
      : CHOICE_LETTERS.length;

  const letterChoices: string[] = [];
  for (let i = 0; i < choiceLimit; i++) {
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

  const numberedChoices = extractNumberedChoices(lookup, choiceLimit);
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
    const split = splitCombinedOptions(combined, choiceLimit);
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

function extractNumberedChoices(
  lookup: Map<string, string>,
  choiceLimit: number
): Array<[number, string]> {
  const found: Array<[number, string]> = [];
  for (const [key, value] of lookup.entries()) {
    const match = /^(?:option|choice)(\d{1,2})$/.exec(key);
    if (!match) continue;
    const ordinal = Number.parseInt(match[1], 10);
    if (!Number.isFinite(ordinal) || ordinal <= 0 || ordinal > choiceLimit) continue;
    const normalized = normalizePlainText(value);
    if (!normalized) continue;
    found.push([ordinal, normalized]);
  }
  found.sort((a, b) => a[0] - b[0]);
  return found;
}

function splitCombinedOptions(value: string, choiceLimit: number): string[] {
  const splitters = [/\r?\n+/, /\s*\|\s*/, /\s*;\s*/, /\s*,\s*/];
  for (const splitter of splitters) {
    const parts = value
      .split(splitter)
      .map((part) => normalizePlainText(part))
      .filter((part) => part.length > 0);
    if (parts.length >= 2) return parts.slice(0, choiceLimit);
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

function toIdPart(value: string, fallback: string): string {
  const normalized = normalizeIdentifier(value);
  return normalized || fallback;
}

function getIntegerField(lookup: Map<string, string>, aliases: string[]): number | null {
  const raw = getNormalizedField(lookup, aliases);
  if (!raw) return null;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) return null;
  return value;
}

function getFloatField(lookup: Map<string, string>, aliases: string[]): number | null {
  const raw = getNormalizedField(lookup, aliases);
  if (!raw) return null;
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) return null;
  return value;
}

function normalizeAnswerLabel(value: string | null): string | null {
  if (!value) return null;
  const text = normalizePlainText(value);
  if (!text) return null;

  const letterMatch = /(?:^|\b)([a-j])(?:\b|[\).:\-])/i.exec(text);
  if (letterMatch) return letterMatch[1].toUpperCase();

  const asNumber = Number.parseInt(text, 10);
  if (Number.isFinite(asNumber) && asNumber >= 1 && asNumber <= CHOICE_LETTERS.length) {
    return CHOICE_LETTERS[asNumber - 1];
  }

  return text.toUpperCase();
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
