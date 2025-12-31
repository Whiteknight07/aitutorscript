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
      bloomLevel: number;
      difficulty: string;
      tutorId: string;
      supervisorId: string | null;
      condition: string;
    } | null;
    error?: {
      message: string;
      stack?: string;
    } | null;
  };
};

