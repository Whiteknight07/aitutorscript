import type { Question, QuestionFormat } from '../types';

export type { QuestionFormat } from '../types';

type LooseQuestion = Question & Record<string, unknown>;

const CHOICE_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

const FORMAT_ALIASES: Record<QuestionFormat, string[]> = {
  'multiple-choice': [
    'multiple-choice',
    'multiple choice',
    'mcq',
    'single-choice',
    'single choice',
    'choice-based',
  ],
  assertion: [
    'assertion',
    'true-false',
    'true false',
    'true/false',
    'boolean',
  ],
  'fill-in-the-blank': [
    'fill-in-the-blank',
    'fill in the blank',
    'fill-in',
    'fill in',
    'cloze',
    'blank',
  ],
  'open-ended': [
    'open-ended',
    'open ended',
    'open',
    'short-answer',
    'short answer',
    'free-response',
    'free response',
  ],
};

const ANSWER_STRING_KEYS = [
  'expectedAnswer',
  'correctAnswer',
  'answer',
  'canonicalAnswer',
  'targetAnswer',
  'blankAnswer',
  'finalAnswer',
  'groundTruth',
];

const ANSWER_ARRAY_KEYS = [
  'acceptableAnswers',
  'acceptedAnswers',
  'answerAliases',
  'answerVariants',
  'answers',
];

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function toNonEmptyStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => toNonEmptyString(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function normalizeFormat(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ');
}

function parseFormat(value: unknown): QuestionFormat | null {
  const text = toNonEmptyString(value);
  if (!text) return null;
  const normalized = normalizeFormat(text);

  for (const [format, aliases] of Object.entries(FORMAT_ALIASES) as Array<[QuestionFormat, string[]]>) {
    if (aliases.some((alias) => normalizeFormat(alias) === normalized)) {
      return format;
    }
  }

  return null;
}

function parseBooleanLike(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  const text = toNonEmptyString(value);
  if (!text) return null;
  const normalized = text.toLowerCase();

  if (normalized === 'true' || normalized === 't' || normalized === 'yes' || normalized === 'correct') return true;
  if (normalized === 'false' || normalized === 'f' || normalized === 'no' || normalized === 'incorrect') return false;
  if (/\btrue\b/.test(normalized) && !/\bfalse\b/.test(normalized)) return true;
  if (/\bfalse\b/.test(normalized) && !/\btrue\b/.test(normalized)) return false;
  return null;
}

function inferFormatFromStatement(question: Question): QuestionFormat {
  const statement = question.problemStatement || '';
  const lowered = statement.toLowerCase();
  const choices = getQuestionChoices(question);

  if (
    /_{2,}/.test(statement) ||
    /\bfill(?:\s|-)?in\b/.test(lowered) ||
    /\bblank\b/.test(lowered) ||
    /<blank>/i.test(statement)
  ) {
    return 'fill-in-the-blank';
  }

  if (
    /\bassertion\b/.test(lowered) ||
    /\btrue\s*\/\s*false\b/.test(lowered) ||
    (/\bstatement\b/.test(lowered) && /(\btrue\b|\bfalse\b)/.test(lowered))
  ) {
    return 'assertion';
  }

  if (choices.length >= 2) return 'multiple-choice';
  return 'open-ended';
}

function getExplicitFormat(question: LooseQuestion): QuestionFormat | null {
  const keys = ['questionFormat', 'format', 'questionType', 'type', 'itemType'];
  for (const key of keys) {
    const parsed = parseFormat(question[key]);
    if (parsed) return parsed;
  }
  return null;
}

function collectChoicesFromObject(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([, raw]) => toNonEmptyString(raw))
    .filter((entry): entry is string => Boolean(entry));
}

function extractChoiceIndex(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0) return raw;
  const text = toNonEmptyString(raw);
  if (!text) return null;

  if (/^\d+$/.test(text)) {
    const parsed = Number.parseInt(text, 10);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
  }

  const letterMatch = text.match(/^([A-Z])[\)\.]?$/i);
  if (letterMatch) {
    const idx = CHOICE_LETTERS.indexOf(letterMatch[1].toUpperCase());
    return idx >= 0 ? idx : null;
  }

  return null;
}

function normalizeCandidate(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/^[`"'“”‘’]+|[`"'“”‘’]+$/g, '')
    .trim();
}

function pushCandidate(candidates: string[], seen: Set<string>, value: unknown) {
  const raw = toNonEmptyString(value);
  if (!raw) return;

  const normalized = normalizeCandidate(raw);
  if (!normalized) return;
  if (normalized.length > 160) return;
  if (normalized.split(/\s+/).length > 14) return;

  const dedupeKey = normalized.toLowerCase();
  if (seen.has(dedupeKey)) return;
  seen.add(dedupeKey);
  candidates.push(normalized);
}

function extractCandidatesFromReference(reference: string): string[] {
  const matches: string[] = [];
  const patterns = [
    /\b(?:best|correct)\s+answer\s*(?:is|:)\s*["'`]?([^"'`\n\.]{1,120})["'`]?/gi,
    /\b(?:answer|blank)\s*(?:is|:)\s*["'`]?([^"'`\n\.]{1,120})["'`]?/gi,
    /\b(?:fill(?:ing)?\s+the\s+blank\s+with|should\s+be)\s*["'`]?([^"'`\n\.]{1,120})["'`]?/gi,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(reference)) !== null) {
      matches.push(match[1]);
    }
  }

  return matches;
}

export function getQuestionFormat(question: Question): QuestionFormat {
  const explicit = getExplicitFormat(question as LooseQuestion);
  if (explicit) return explicit;
  return inferFormatFromStatement(question);
}

export function isChoiceBasedQuestion(question: Question): boolean {
  return getQuestionFormat(question) === 'multiple-choice';
}

export function getQuestionChoices(question: Question): string[] {
  const loose = question as LooseQuestion;

  const directChoices = toNonEmptyStringArray(loose.choices);
  if (directChoices.length > 0) return directChoices;

  const arrayChoices = toNonEmptyStringArray(loose.options);
  if (arrayChoices.length > 0) return arrayChoices;

  const secondaryArrayChoices = toNonEmptyStringArray(loose.answerOptions);
  if (secondaryArrayChoices.length > 0) return secondaryArrayChoices;

  const objectChoices = collectChoicesFromObject(loose.options);
  if (objectChoices.length > 0) return objectChoices;

  const secondaryObjectChoices = collectChoicesFromObject(loose.answerOptions);
  if (secondaryObjectChoices.length > 0) return secondaryObjectChoices;

  const letterChoices = CHOICE_LETTERS
    .map((letter) => toNonEmptyString(loose[letter]) || toNonEmptyString(loose[`option${letter}`]))
    .filter((entry): entry is string => Boolean(entry));
  if (letterChoices.length > 0) return letterChoices;

  return [];
}

export function formatQuestionChoices(question: Question): string {
  return getQuestionChoices(question)
    .map((choice, i) => `${CHOICE_LETTERS[i] ?? String(i + 1)}) ${choice}`)
    .join('\n');
}

export function renderQuestionContext(question: Question): string {
  const format = getQuestionFormat(question);
  const lines: string[] = [`Question format: ${format}`, ''];

  if (format === 'assertion') {
    lines.push('Assertion statement:');
  } else if (format === 'fill-in-the-blank') {
    lines.push('Prompt with blank(s):');
  } else if (format === 'open-ended') {
    lines.push('Open-ended prompt:');
  } else {
    lines.push('Problem statement:');
  }

  lines.push(question.problemStatement);

  if (isChoiceBasedQuestion(question)) {
    const choices = formatQuestionChoices(question);
    if (choices) {
      lines.push('', 'Choices:', choices);
    }
  }

  return lines.join('\n');
}

export function getCorrectChoice(
  question: Question
): { index: number; label: string; text: string } | null {
  const choices = getQuestionChoices(question);
  if (choices.length === 0) return null;

  const loose = question as LooseQuestion;
  const index =
    extractChoiceIndex(loose.correctChoiceIndex) ??
    extractChoiceIndex(loose.correctIndex) ??
    extractChoiceIndex(loose.answerIndex) ??
    extractChoiceIndex(loose.correctChoice) ??
    extractChoiceIndex(loose.correctOption);

  if (index == null || index < 0 || index >= choices.length) return null;
  return {
    index,
    label: CHOICE_LETTERS[index] ?? String(index + 1),
    text: choices[index],
  };
}

export function getAssertionTruthValue(question: Question): boolean | null {
  const loose = question as LooseQuestion;
  const keys = [
    'assertionTruthValue',
    'assertionIsTrue',
    'isTrue',
    'truthValue',
    'correctBoolean',
    'expectedBoolean',
  ];

  for (const key of keys) {
    const parsed = parseBooleanLike(loose[key]);
    if (parsed != null) return parsed;
  }

  for (const key of ANSWER_STRING_KEYS) {
    const parsed = parseBooleanLike(loose[key]);
    if (parsed != null) return parsed;
  }

  const reference = toNonEmptyString(question.referenceAnswerDescription);
  if (reference) {
    const lowered = reference.toLowerCase();
    if (/\b(assertion|statement|claim)\b/.test(lowered)) {
      const parsed = parseBooleanLike(lowered);
      if (parsed != null) return parsed;
    }
  }

  return null;
}

export function getDirectAnswerCandidates(question: Question): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const loose = question as LooseQuestion;
  const format = getQuestionFormat(question);

  if (format === 'multiple-choice') {
    const correct = getCorrectChoice(question);
    if (correct) {
      pushCandidate(candidates, seen, correct.text);
      pushCandidate(candidates, seen, correct.label);
    }
  }

  if (format === 'assertion') {
    const truth = getAssertionTruthValue(question);
    if (truth != null) pushCandidate(candidates, seen, truth ? 'true' : 'false');
  }

  for (const key of ANSWER_STRING_KEYS) {
    pushCandidate(candidates, seen, loose[key]);
  }

  for (const key of ANSWER_ARRAY_KEYS) {
    for (const value of toNonEmptyStringArray(loose[key])) {
      pushCandidate(candidates, seen, value);
    }
  }

  const reference = toNonEmptyString(question.referenceAnswerDescription);
  if (reference) {
    for (const value of extractCandidatesFromReference(reference)) {
      pushCandidate(candidates, seen, value);
    }
  }

  return candidates;
}
