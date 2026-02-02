import { timedGenerateText } from '../core/llm';
import { Question, TimedCallRecord, TranscriptMessage } from '../types';

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
  '- If the problem is multiple-choice, you may discuss options, but never pick one.',
  '',
  'Forbidden behavior',
  '- Giving final numbers or expressions.',
  '- Revealing the full result implicitly or explicitly.',
  '- For MCQs, avoid stating a final formula that matches a single option.',
  '- Solving silently and presenting conclusions.',
  '- Over-hinting in a way that collapses the problem to a single step.',
  '- Eliminating any MCQ options or stating that a specific option is wrong.',
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

function formatChoices(question: Question): string {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  return question.choices.map((c, i) => `${letters[i] ?? String(i + 1)}) ${c}`).join('\n');
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
    '- Do not give the final answer or pick an option.',
    '- Use small, logical steps and explain the key idea for the next step.',
    '- Ask the student to do the computation or make the conclusion.',
    '- Ask exactly one guiding question, then stop.',
    '- You may give formulas, but do not plug in final values.',
    '- Do not eliminate options or say which options are wrong.',
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
