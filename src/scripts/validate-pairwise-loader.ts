import { join } from 'node:path';

import { loadPairwiseQuestions } from '../core/pairwise';

type ValidationIssue = {
  questionId: string;
  message: string;
};

async function main() {
  const dirArg = process.argv[2];
  const dirPath = dirArg ? String(dirArg) : join('data', 'pairwise');
  const warnings: string[] = [];

  const questions = await loadPairwiseQuestions({
    dirPath,
    limit: null,
    warn: (message) => warnings.push(message),
  });

  const issues: ValidationIssue[] = [];
  const ids = new Set<string>();

  for (const question of questions) {
    if (ids.has(question.id)) {
      issues.push({ questionId: question.id, message: 'duplicate id' });
    }
    ids.add(question.id);

    if (question.dataset !== 'pairwise') {
      issues.push({ questionId: question.id, message: `unexpected dataset "${question.dataset}"` });
    }

    const choices = Array.isArray((question as any).choices) ? ((question as any).choices as string[]) : [];
    const correctChoiceIndex =
      typeof (question as any).correctChoiceIndex === 'number' ? (question as any).correctChoiceIndex : -1;

    if (choices.length < 2) {
      issues.push({ questionId: question.id, message: 'fewer than 2 choices' });
    }

    if (correctChoiceIndex < 0 || correctChoiceIndex >= choices.length) {
      issues.push({
        questionId: question.id,
        message: `invalid correctChoiceIndex ${correctChoiceIndex} for ${choices.length} choices`,
      });
    }

    if (/<[^>]+>/.test(question.problemStatement)) {
      issues.push({ questionId: question.id, message: 'problemStatement still contains HTML tags' });
    }

    if (/<[^>]+>/.test(question.referenceAnswerDescription)) {
      issues.push({ questionId: question.id, message: 'referenceAnswerDescription still contains HTML tags' });
    }

    for (const choice of choices) {
      if (/<[^>]+>/.test(choice)) {
        issues.push({ questionId: question.id, message: 'choice text still contains HTML tags' });
        break;
      }
    }
  }

  // eslint-disable-next-line no-console
  console.log(`Loaded ${questions.length} pairwise questions from ${dirPath}.`);
  // eslint-disable-next-line no-console
  console.log(`Loader warnings: ${warnings.length}.`);

  if (issues.length > 0) {
    // eslint-disable-next-line no-console
    console.error(`Validation failed with ${issues.length} issue(s).`);
    for (const issue of issues.slice(0, 20)) {
      // eslint-disable-next-line no-console
      console.error(`- ${issue.questionId}: ${issue.message}`);
    }
    process.exitCode = 1;
    return;
  }

  // eslint-disable-next-line no-console
  console.log('Validation passed.');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exitCode = 1;
});
