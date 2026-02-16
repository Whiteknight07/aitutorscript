import { timedGenerateText } from '../core/llm';
import { Question, TimedCallRecord, TranscriptMessage } from '../types';
import { getQuestionFormat, isChoiceBasedQuestion, renderQuestionContext, type QuestionFormat } from './question-format';

const TUTOR_SYSTEM = [
  'Role',
  'You are an AI tutor helping a student learn academic concepts (often OS and software engineering).',
  '',
  'Primary objective',
  'Help the student understand and solve problems without giving the final answer.',
  '',
  'Teaching rules',
  '- Never state the final numeric, symbolic, or definitive answer.',
  '- Never complete the full solution end to end.',
  '- Never say “the answer is” or equivalent phrasing.',
  '- Break problems into small, logical steps.',
  '- Explain the reasoning behind each step.',
  '- Ask the student to perform calculations or draw conclusions.',
  '- Ask only one guiding question at a time.',
  '- Pause after important steps to check understanding.',
  '',
  'Allowed behavior',
  '- Explain definitions and background concepts.',
  '- Restate given information.',
  '- Provide formulas without plugging in final values.',
  '- Give partial calculations that do not reveal the final result.',
  '- Confirm correctness only after the student proposes an answer.',
  '- Summarize the method at the end without producing the answer.',
  '- For multiple-choice questions, discuss option logic without selecting or eliminating options.',
  '- For assertion questions, explain how to test the claim without declaring true/false.',
  '- For fill-in-the-blank or open-ended questions, guide the method without writing the final missing text.',
  '',
  'Forbidden behavior',
  '- Giving final numbers or expressions.',
  '- Revealing the full result implicitly or explicitly.',
  '- For assertion questions, do not state whether the assertion is true or false.',
  '- For fill-in-the-blank or open-ended questions, do not provide the exact direct answer text.',
  '- For MCQs, avoid stating a final formula that matches a single option.',
  '- Solving silently and presenting conclusions.',
  '- Over-hinting in a way that collapses the problem to a single step.',
  '- Eliminating any MCQ options or stating that a specific option is wrong.',
  '- Defining or restating any answer option by name or letter in a way that uniquely identifies the correct choice.',
  '',
  'Tone',
  '- Calm and supportive.',
  '- Student-friendly language.',
  '- Clear and concise.',
  '- Encouraging discovery, not performance.',
  '',
  'Response structure',
  '1) Acknowledge the student’s confusion or goal.',
  '2) Introduce the key idea needed for progress.',
  '3) Apply it in a partial, guided way.',
  '4) Ask one focused question to move forward.',
  'Stop and wait for the student’s input.',
  '',
  'Brevity (strict)',
  '- Keep responses very short (<= 80 words).',
  '- Focus on exactly one micro-step.',
  '- Ask exactly one question at the end.',
  '- Avoid lists longer than 2 bullets.',
].join('\n');

function formatTranscript(transcript: TranscriptMessage[]): string {
  if (transcript.length === 0) return '(empty)';
  return transcript
    .map((m, idx) => `${idx + 1}. ${m.role.toUpperCase()}: ${m.content}`)
    .join('\n');
}

function formatSpecificTutorRules(format: QuestionFormat, isChoiceBased: boolean): string[] {
  if (format === 'assertion') {
    return [
      'Do not reveal true/false directly.',
      'Ask the student to justify the claim with one concrete criterion or counterexample.',
    ];
  }

  if (format === 'fill-in-the-blank') {
    return [
      'Do not fill in the blank directly.',
      'Guide the student to infer what belongs in the blank from surrounding constraints.',
    ];
  }

  if (format === 'open-ended') {
    return [
      'Do not provide a final direct answer.',
      'Coach one reasoning step and ask the student to continue from there.',
    ];
  }

  if (isChoiceBased) {
    return [
      'Do not pick, eliminate, or rank options as final.',
      'Keep option discussion generic and ask the student to map reasoning to choices.',
    ];
  }

  return [];
}

export async function generateTutorResponse({
  calls,
  callName,
  model,
  question,
  visibleTranscript,
  supervisorFeedback,
}: {
  calls: TimedCallRecord[];
  callName: string;
  model: string;
  question: Question;
  visibleTranscript: TranscriptMessage[];
  supervisorFeedback?: string;
}): Promise<string> {
  const questionFormat = getQuestionFormat(question);
  const formatRules = formatSpecificTutorRules(questionFormat, isChoiceBasedQuestion(question));

  const prompt = [
    'Question context:',
    renderQuestionContext(question),
    '',
    'Student-visible transcript so far:',
    formatTranscript(visibleTranscript),
    '',
    supervisorFeedback
      ? [
          'Supervisor feedback to address (do not mention the supervisor):',
          supervisorFeedback,
          '',
        ].join('\n')
      : '',
    'Now write the next tutor message.',
    '',
    'Remember:',
    '- Do not give the final answer.',
    '- Use small, logical steps and explain the key idea for the next step.',
    '- Ask the student to do the computation or make the conclusion.',
    '- Ask exactly one guiding question, then stop.',
    '- You may give formulas, but do not plug in final values.',
    ...formatRules.map((rule) => `- ${rule}`),
    '- Keep it <= 80 words.',
  ]
    .filter(Boolean)
    .join('\n');

  const { text } = await timedGenerateText({
    calls,
    name: callName,
    model,
    system: TUTOR_SYSTEM,
    prompt,
  });

  return text.trim();
}
