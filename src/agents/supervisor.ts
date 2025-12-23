import { timedGenerateObject } from '../core/llm';
import {
  Question,
  SupervisorVerdict,
  SupervisorVerdictSchema,
  TimedCallRecord,
  TranscriptMessage,
} from '../types';

const SUPERVISOR_SYSTEM = [
  'Role',
  'You are a supervisor agent monitoring a tutor agent’s responses to students.',
  '',
  'Primary objective',
  'Ensure the tutor agent does not directly give final answers or solutions to academic problems.',
  '',
  'What to enforce',
  '- The tutor must guide the student step by step.',
  '- The tutor may explain concepts, definitions, and methods.',
  '- The tutor may ask guiding questions.',
  '- The tutor must stop before giving the final numeric, symbolic, or definitive answer.',
  '- The tutor should encourage the student to compute or conclude on their own.',
  '',
  'What is NOT allowed',
  '- Giving the final numeric answer.',
  '- Explicitly stating the final result.',
  '- Solving the entire problem end to end.',
  '- Writing “the answer is …” or equivalent phrasing.',
  '- Providing completed calculations that directly reveal the solution.',
  '',
  'Allowed exceptions',
  '- The tutor may confirm whether a student’s answer is correct only after the student proposes one.',
  '- The tutor may summarize the process without inserting final values.',
  '- The tutor may restate known facts from the problem statement.',
  '',
  'Evaluation task',
  'After each tutor response:',
  '- Decide whether a final answer was revealed.',
  '- Decide whether the response meaningfully guides learning.',
  '- Classify the response as: SAFE (guidance only), BORDERLINE (overly close), VIOLATION (final answer given).',
  '',
  'Output format (must match the provided JSON schema):',
  '- approved: true for SAFE or BORDERLINE; false for VIOLATION.',
  '- violations: include the classification as the first item: "SAFE" | "BORDERLINE" | "VIOLATION", then 0-3 short reasons.',
  '- feedbackToTutor: short corrective instruction (required for BORDERLINE and VIOLATION; empty string allowed for SAFE).',
  '- safeResponseToStudent: only needed for VIOLATION (a safe guidance-only replacement; do NOT include final values).',
  '',
  'If violation occurs',
  '- Flag the response (approved=false).',
  '- Provide a short corrective instruction describing what should be removed or rephrased.',
  '- Do not rewrite the full solution.',
  '',
  'Tone',
  'Strict but neutral. Focused on pedagogy, not correctness.',
].join('\n');

function formatTranscript(transcript: TranscriptMessage[]): string {
  if (transcript.length === 0) return '(empty)';
  return transcript
    .map((m, idx) => `${idx + 1}. ${m.role.toUpperCase()}: ${m.content}`)
    .join('\n');
}

function formatChoices(question: Question): string {
  const letters = ['A', 'B', 'C', 'D'];
  return question.choices.map((c, i) => `${letters[i]}) ${c}`).join('\n');
}

export async function superviseTutorDraft({
  calls,
  model,
  question,
  visibleTranscript,
  tutorDraft,
  turnIndex,
  iter,
}: {
  calls: TimedCallRecord[];
  model: string;
  question: Question;
  visibleTranscript: TranscriptMessage[];
  tutorDraft: string;
  turnIndex: number;
  iter: number;
}): Promise<SupervisorVerdict> {
  const prompt = [
    'Problem statement:',
    question.problemStatement,
    '',
    'Choices:',
    formatChoices(question),
    '',
    'Student-visible transcript so far:',
    formatTranscript(visibleTranscript),
    '',
    'Tutor draft to evaluate:',
    tutorDraft,
    '',
    'Decide approved=true only if it fully complies with the rules and is meaningfully helpful.',
  ].join('\n');

  const { object } = await timedGenerateObject<SupervisorVerdict>({
    calls,
    name: `supervisor_turn${turnIndex}_iter${iter}`,
    model,
    system: SUPERVISOR_SYSTEM,
    prompt,
    schema: SupervisorVerdictSchema,
    schemaName: 'SupervisorVerdictSchema',
  });

  const safeCandidate = sanitizeSafeResponseToStudent(object.safeResponseToStudent, question);
  const safeResponseToStudent = object.approved
    ? safeCandidate
    : safeCandidate || defaultSafeResponseToStudent(question);

  return {
    ...object,
    safeResponseToStudent,
  };
}

function sanitizeSafeResponseToStudent(text: string, question: Question): string {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return '';

  const normalized = trimmed.replace(/\r\n/g, '\n');
  if (looksLikeFinalAnswer(normalized) || looksLikeCodeOrPseudocode(normalized) || looksTooProcedural(normalized)) {
    return '';
  }

  // Keep it tight even if the model ignored the word-count guidance.
  const maxChars = 900;
  if (normalized.length > maxChars) return normalized.slice(0, maxChars).trimEnd() + '…';
  return normalized;
}

function looksLikeFinalAnswer(text: string): boolean {
  // Explicit "answer is ..." patterns.
  if (/\b(answer|correct answer)\b\s*(is|:)/i.test(text)) return true;
  // Common MCQ selection patterns (require selection language).
  if (/\b(the\s+)?(correct|right)\s+(option|choice)\b/i.test(text)) return true;
  if (/\b(it'?s|choose|pick|select)\b\s*(option|choice)?\s*([ABCD]|[1-4])\b/i.test(text)) return true;
  if (/\b(option|choice)\s*[1-4]\s*(is|:)\s*(correct|right)\b/i.test(text)) return true;
  // A bare letter/number as the entire message is likely an answer.
  if (/^\s*([ABCD]|[1-4])\s*[\.\)]?\s*$/.test(text)) return true;
  return false;
}

function looksLikeCodeOrPseudocode(text: string): boolean {
  if (/```/.test(text)) return true;
  if (/(^|\n)\s{4,}\S/.test(text)) return true; // indented blocks

  // Common code-ish tokens/keywords across languages.
  if (/(^|\n)\s*(def|class|function|for|while|if|elif|else|switch|case|return|import|from)\b/i.test(text)) {
    return true;
  }
  if (/\b(const|let|var)\b/.test(text)) return true;
  if (/(=>|==|!=|<=|>=|\+\+|--|;|\{|\}|\[|\])/.test(text)) return true;

  // "Fill in the blanks" patterns.
  if (/\b(blank|fill in|fill-in)\b/i.test(text)) return true;

  return false;
}

function looksTooProcedural(text: string): boolean {
  // Avoid turning fallback into a copyable algorithm.
  if (/(^|\n)\s*\d+\.\s+\S/.test(text)) return true;
  if (/\bstep\s*\d+\b/i.test(text)) return true;
  if (/\bfirst\b.*\bthen\b/i.test(text)) return true;
  return false;
}

function defaultSafeResponseToStudent(question: Question): string {
  const topic = question.topicTag ? ` (${question.topicTag})` : '';
  return [
    `I can’t provide the final answer or pick an option for you${topic}.`,
    'If you share which option you’re leaning toward and why, I can help you reason it through.',
    '',
    'To get unstuck, try eliminating two options:',
    '- What key concept decides this (e.g., scheduling vs memory vs locking vs API design)?',
    '- Which option contradicts the definition or would break an invariant?',
    '- What real-world symptom/example would you expect if an option were true?',
  ].join('\n');
}
