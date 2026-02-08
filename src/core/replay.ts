import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

type ReplayTurnInput = {
  message: string;
  attackLevel?: number;
  tactic?: string;
};

export type ReplayTurn = {
  message: string;
  attackLevel: number;
  attackFamily?: string;
  tactic: string;
};

export type ReplayScript = {
  sourcePath: string;
  byQuestionId: Map<string, ReplayTurnInput[]>;
  defaultTurns: ReplayTurnInput[] | null;
};

export async function loadReplayScript(path: string): Promise<ReplayScript> {
  const sourcePath = resolve(path);
  const raw = await readFile(sourcePath, 'utf-8');
  const parsed = parseReplayPayload(raw, sourcePath);

  if (parsed.byQuestionId.size === 0 && (!parsed.defaultTurns || parsed.defaultTurns.length === 0)) {
    throw new Error(`Replay script at "${sourcePath}" has no usable turns.`);
  }

  return parsed;
}

export function resolveReplayTurns({
  script,
  questionId,
  turns,
}: {
  script: ReplayScript;
  questionId: string;
  turns: number;
}): ReplayTurn[] {
  const selected = script.byQuestionId.get(questionId) ?? script.defaultTurns;
  if (!selected || selected.length === 0) {
    throw new Error(
      `Replay script "${script.sourcePath}" has no turns for question "${questionId}" and no default turns.`
    );
  }

  if (selected.length < turns) {
    throw new Error(
      `Replay script "${script.sourcePath}" has ${selected.length} turns for question "${questionId}", but ${turns} are required.`
    );
  }

  return selected.slice(0, turns).map((turn, idx) => ({
    message: turn.message,
    attackLevel: turn.attackLevel ?? idx + 1,
    tactic: turn.tactic?.trim() || 'replay',
  }));
}

function parseReplayPayload(raw: string, sourcePath: string): ReplayScript {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error(`Replay script "${sourcePath}" is empty.`);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(trimmed);
  } catch {
    payload = parseJsonl(trimmed, sourcePath);
  }

  return normalizeReplayPayload(payload, sourcePath);
}

function parseJsonl(raw: string, sourcePath: string): unknown {
  const entries = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch {
        throw new Error(`Invalid JSONL line ${index + 1} in replay script "${sourcePath}".`);
      }
    });
  return entries;
}

function normalizeReplayPayload(payload: unknown, sourcePath: string): ReplayScript {
  if (Array.isArray(payload)) {
    return {
      sourcePath,
      byQuestionId: new Map<string, ReplayTurnInput[]>(),
      defaultTurns: normalizeTurns(payload, `${sourcePath} default turns`),
    };
  }

  if (!isRecord(payload)) {
    throw new Error(`Unsupported replay payload in "${sourcePath}".`);
  }

  const byQuestionId = new Map<string, ReplayTurnInput[]>();
  let defaultTurns: ReplayTurnInput[] | null = null;

  if (payload['turns'] != null) {
    defaultTurns = normalizeTurns(payload['turns'], `${sourcePath} turns`);
  }
  if (payload['default'] != null) {
    defaultTurns = normalizeTurns(payload['default'], `${sourcePath} default`);
  }

  if (isRecord(payload['questions'])) {
    for (const [questionId, turnsRaw] of Object.entries(payload['questions'])) {
      byQuestionId.set(questionId, normalizeTurns(turnsRaw, `${sourcePath} questions.${questionId}`));
    }
  }

  for (const [key, value] of Object.entries(payload)) {
    if (key === 'turns' || key === 'default' || key === 'questions') continue;
    if (!Array.isArray(value)) continue;
    byQuestionId.set(key, normalizeTurns(value, `${sourcePath} ${key}`));
  }

  return { sourcePath, byQuestionId, defaultTurns };
}

function normalizeTurns(value: unknown, label: string): ReplayTurnInput[] {
  if (!Array.isArray(value)) {
    throw new Error(`Replay turns for ${label} must be an array.`);
  }

  return value.map((entry, idx) => {
    if (typeof entry === 'string') {
      const message = entry.trim();
      if (!message) throw new Error(`Replay turn ${idx + 1} in ${label} is empty.`);
      return { message };
    }
    if (!isRecord(entry)) {
      throw new Error(`Replay turn ${idx + 1} in ${label} must be a string or object.`);
    }

    const messageValue = entry['message'];
    if (typeof messageValue !== 'string' || !messageValue.trim()) {
      throw new Error(`Replay turn ${idx + 1} in ${label} is missing a valid "message".`);
    }
    const attackLevelValue = entry['attackLevel'];
    const tacticValue = entry['tactic'];
    const hasAttackLevel = attackLevelValue != null;
    if (hasAttackLevel && (typeof attackLevelValue !== 'number' || !Number.isInteger(attackLevelValue) || attackLevelValue < 1)) {
      throw new Error(`Replay turn ${idx + 1} in ${label} has invalid attackLevel.`);
    }
    if (tacticValue != null && typeof tacticValue !== 'string') {
      throw new Error(`Replay turn ${idx + 1} in ${label} has invalid tactic.`);
    }
    return {
      message: messageValue.trim(),
      attackLevel: attackLevelValue as number | undefined,
      tactic: tacticValue as string | undefined,
    };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
