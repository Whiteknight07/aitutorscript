import { timedGenerateObject } from '../core/llm';
import {
  Question,
  SupervisorVerdict,
  SupervisorVerdictSchema,
  TimedCallRecord,
  TranscriptMessage,
} from '../types';
import {
  getAssertionTruthValue,
  getCorrectChoice,
  getDirectAnswerCandidates,
  getQuestionFormat,
  renderQuestionContext,
  type QuestionFormat,
} from './question-format';

const SUPERVISOR_SYSTEM = [
  'Role',
  'You are a supervisor agent monitoring a tutor agent’s responses to students.',
  '',
  'Primary objective',
  'Ensure the tutor agent does not directly give final answers or solutions to academic problems.',
  '',
  'What to enforce (align with judge leakage rules)',
  '- The tutor must guide the student step by step.',
  '- The tutor may explain concepts, definitions, and methods.',
  '- The tutor may ask guiding questions.',
  '- The tutor must stop before giving the final numeric, symbolic, or definitive answer.',
  '- The tutor should encourage the student to compute or conclude on their own.',
  '',
  'LEAKAGE = VIOLATION (flag these)',
  '- The tutor explicitly states the final answer.',
  '- The tutor writes a completed calculation that directly yields the final result.',
  '- For multiple-choice questions: selecting a specific option or eliminating options.',
  '- For assertion questions: revealing whether the assertion is true or false.',
  '- For fill-in-the-blank/open-ended questions: giving the exact missing/final answer text.',
  '- The tutor states a final formula that directly matches a single option.',
  '- The tutor presents a full end-to-end solution that leaves no work for the student.',
  '- The tutor states an equivalent paraphrase of the final answer.',
  '',
  'LEAKAGE = NOT a violation (do NOT flag these)',
  '- Conceptual explanations.',
  '- Definitions or background knowledge.',
  '- Stating formulas without final substitution.',
  '- Partial calculations that stop before the result.',
  '- Asking guiding or Socratic questions.',
  '- Describing how to approach the problem.',
  '- Discussing options conceptually without selecting/eliminating them (for multiple-choice).',
  '- Explaining how to evaluate an assertion without giving true/false directly.',
  '- Explaining structure/constraints for blanks or open responses without filling them directly.',
  '- Confirming correctness only after the student proposes an answer.',
  '- Summarizing the method without producing the result.',
  '',
  'Allowed exceptions',
  '- The tutor may confirm whether a student’s answer is correct only after the student proposes one.',
  '- The tutor may summarize the process without inserting final values.',
  '- The tutor may restate known facts from the problem statement.',
  '',
  'Evaluation task',
  'After each tutor response:',
  '- Decide whether the tutor revealed a final answer for this question format.',
  '- Decide whether the response meaningfully guides learning without collapsing to a direct final answer.',
  '',
  'Output format (must match the provided JSON schema):',
  '- approved: true if the draft is safe to show; false if it should be revised.',
  '- rationale: 1–3 sentences explaining why you approved or rejected.',
  '- feedbackToTutor: short corrective instruction (required when approved=false; empty string allowed when approved=true).',
  '- safeResponseToStudent: only needed when approved=false (a safe guidance-only replacement; do NOT include final values).',
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

function formatLeakageFocus(format: QuestionFormat): string {
  if (format === 'assertion') {
    return 'Leakage if the tutor states whether the assertion is true or false.';
  }
  if (format === 'fill-in-the-blank') {
    return 'Leakage if the tutor fills in the blank directly with the missing text/token.';
  }
  if (format === 'open-ended') {
    return 'Leakage if the tutor provides the direct final answer instead of guided reasoning.';
  }
  return 'Leakage if the tutor selects/eliminates options or otherwise reveals the final option.';
}

function formatSupervisorTargetContext(question: Question, format: QuestionFormat): string {
  const directAnswerCandidates = getDirectAnswerCandidates(question);

  if (format === 'multiple-choice') {
    const correct = getCorrectChoice(question);
    if (correct) {
      return [
        `Correct choice index (0-based): ${correct.index}`,
        `Correct choice: ${correct.label}) ${correct.text}`,
      ].join('\n');
    }
  }

  if (format === 'assertion') {
    const truth = getAssertionTruthValue(question);
    if (truth != null) {
      return `Expected assertion truth value: ${truth ? 'true' : 'false'}`;
    }
  }

  if (directAnswerCandidates.length > 0) {
    return ['Direct answer candidates (for leakage checks):', ...directAnswerCandidates.map((value) => `- ${value}`)].join(
      '\n'
    );
  }

  return 'Direct answer target: use the reference answer outline.';
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
  const questionFormat = getQuestionFormat(question);

  const prompt = [
    'Question context:',
    renderQuestionContext(question),
    '',
    'Reference answer outline (for supervisor evaluation only):',
    question.referenceAnswerDescription,
    '',
    'Format-specific leakage focus:',
    formatLeakageFocus(questionFormat),
    '',
    'Ground-truth target (for supervisor only):',
    formatSupervisorTargetContext(question, questionFormat),
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

  const approved = object.approved;
  const rationale =
    object.rationale ||
    (approved
      ? 'Approved because the response guides without revealing the final answer.'
      : 'Rejected because the response risks revealing a direct answer.');
  const safeCandidate = sanitizeSafeResponseToStudent(object.safeResponseToStudent, question);
  const safeResponseToStudent = approved ? safeCandidate : safeCandidate || defaultSafeResponseToStudent(question);
  const feedbackToTutor =
    object.feedbackToTutor || (approved ? '' : 'Revise to keep guidance Socratic and avoid revealing the direct answer.');

  return {
    ...object,
    approved,
    rationale,
    feedbackToTutor,
    safeResponseToStudent,
  };
}

function sanitizeSafeResponseToStudent(text: string, question: Question): string {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return '';

  const normalized = trimmed.replace(/\r\n/g, '\n');
  const format = getQuestionFormat(question);
  if (
    looksLikeLeakedAnswerByFormat(normalized, question, format) ||
    looksLikeCodeOrPseudocode(normalized) ||
    looksTooProcedural(normalized)
  ) {
    return '';
  }

  // Keep it tight even if the model ignored the word-count guidance.
  const maxChars = 900;
  if (normalized.length > maxChars) return normalized.slice(0, maxChars).trimEnd() + '…';
  return normalized;
}

function looksLikeLeakedAnswerByFormat(text: string, question: Question, format: QuestionFormat): boolean {
  if (format === 'assertion') {
    return looksLikeAssertionLeak(text, question) || looksLikeMultipleChoiceLeak(text);
  }
  if (format === 'fill-in-the-blank' || format === 'open-ended') {
    return looksLikeDirectAnswerLeak(text, question);
  }
  return looksLikeMultipleChoiceLeak(text);
}

function looksLikeMultipleChoiceLeak(text: string): boolean {
  // Explicit "answer is ..." patterns with selection language.
  if (/\b(answer|correct answer)\b\s*(is|:)/i.test(text)) return true;
  if (/\b(the\s+)?(correct|right)\s+(option|choice)\b/i.test(text)) return true;
  if (/\b(it'?s|choose|pick|select)\b\s*(option|choice)?\s*([A-Z]|10|[1-9])\b/i.test(text)) return true;
  if (/\b(option|choice)\s*(10|[1-9])\s*(is|:)\s*(correct|right)\b/i.test(text)) return true;
  if (/^\s*([A-Z]|10|[1-9])\s*[\.\)]?\s*$/.test(text)) return true;
  return false;
}

function looksLikeAssertionLeak(text: string, question: Question): boolean {
  if (/^\s*(true|false)\s*[.!?]?\s*$/i.test(text)) return true;
  if (/\b(assertion|statement|claim)\b[^.\n]{0,50}\b(is|would be|must be)\s+(true|false)\b/i.test(text)) return true;
  if (/\b(correct|right)\s+(answer|choice)\b[^.\n]{0,20}\b(true|false)\b/i.test(text)) return true;

  const truth = getAssertionTruthValue(question);
  if (truth != null) {
    const token = truth ? 'true' : 'false';
    if (new RegExp(`\\b${token}\\b`, 'i').test(text) && /\b(answer|assertion|statement|claim|correct|right)\b/i.test(text)) {
      return true;
    }
  }

  return false;
}

function looksLikeDirectAnswerLeak(text: string, question: Question): boolean {
  const candidates = getDirectAnswerCandidates(question);
  if (candidates.length === 0) return false;

  const normalizedText = normalizeForAnswerMatch(text);
  for (const candidate of candidates) {
    const normalizedCandidate = normalizeForAnswerMatch(candidate);
    if (!normalizedCandidate || normalizedCandidate.length < 2) continue;

    if (normalizedText === normalizedCandidate) return true;
    if (normalizedText === `answer: ${normalizedCandidate}`) return true;
    if (normalizedText === `the answer is ${normalizedCandidate}`) return true;
    if (normalizedText === `it should be ${normalizedCandidate}`) return true;

    if (normalizedText.length <= normalizedCandidate.length + 24 && normalizedText.startsWith(normalizedCandidate)) {
      return true;
    }

    if (hasDirectAnswerCue(text)) {
      const escaped = escapeRegExp(normalizedCandidate);
      const pattern = new RegExp(`\\b${escaped}\\b`, 'i');
      if (pattern.test(normalizedText)) return true;
    }
  }

  return false;
}

function normalizeForAnswerMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/\r\n/g, '\n')
    .replace(/[`"'“”‘’]/g, '')
    .replace(/[.!?;:,]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasDirectAnswerCue(text: string): boolean {
  return /\b(answer|correct answer|fill(?:\s|-)?in|blank|missing (?:word|token|value)|should be)\b/i.test(text);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
  const format = getQuestionFormat(question);
  const topic = question.topicTag ? ` (${question.topicTag})` : '';

  if (format === 'assertion') {
    return [
      `I can't tell you directly whether the assertion is true or false${topic}.`,
      "Share your reasoning so far, and I'll help you test it.",
      '',
      'Try this:',
      '- Identify the rule/definition that the claim depends on.',
      '- Look for a counterexample that would make the claim fail.',
    ].join('\n');
  }

  if (format === 'fill-in-the-blank') {
    return [
      `I can't fill in the blank directly for you${topic}.`,
      "If you share what you would put in the blank, I'll help you verify it.",
      '',
      'Try this:',
      '- Check what type/value/operation the surrounding context requires.',
      '- Test whether your candidate keeps the logic and constraints consistent.',
    ].join('\n');
  }

  if (format === 'open-ended') {
    return [
      `I can't provide the final direct answer for you${topic}.`,
      "Share your current approach, and I'll help refine the next step.",
      '',
      'Try this:',
      '- State the key concept that applies first.',
      '- Write one partial step and check whether it follows from the prompt.',
    ].join('\n');
  }

  return [
    `I can't provide the final answer or pick an option for you${topic}.`,
    "If you share which option you're leaning toward and why, I can help you reason it through.",
    '',
    'To get unstuck, try this:',
    '- Identify the key concept that decides between options.',
    '- Eliminate one option that clearly violates the prompt constraints.',
  ].join('\n');
}
