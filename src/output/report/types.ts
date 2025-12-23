import type { RunRecord } from '../../types';

export type ReportInput = {
  runId: string;
  createdAtIso: string;
  args: unknown;
  questions: unknown;
  summary: unknown;
  records: RunRecord[];
  status: {
    state: 'running' | 'complete' | 'failed';
    plannedRuns: number;
    completedRuns: number;
    lastUpdatedAtIso: string;
    current?: {
      index: number;
      questionId: string;
      difficulty: number;
      pairingId: string;
      condition: string;
    } | null;
    error?: {
      message: string;
      stack?: string;
    } | null;
  };
};

