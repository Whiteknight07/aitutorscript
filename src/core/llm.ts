import { ZodTypeAny } from 'zod';
import type { TimedCallRecord } from '../types';
import { hrNowMs, nowIso } from '../utils/util';

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type ChatInputMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

type ProviderOptions = {
  provider?: {
    sort?: 'throughput' | 'price' | 'latency';
    order?: string[];
  };
};

type OpenRouterClient = InstanceType<(typeof import('@openrouter/sdk'))['OpenRouter']>;

let openrouterPromise: Promise<OpenRouterClient> | null = null;
const importOpenRouterSdk = new Function('specifier', 'return import(specifier);') as (
  specifier: string
) => Promise<{ OpenRouter: (new (options: { apiKey: string }) => OpenRouterClient) }>;

/**
 * Get provider-specific options for a model.
 * - Applies explicit provider routing overrides for specific models.
 */
function getProviderOptions(modelId: string): ProviderOptions {
  const provider: NonNullable<ProviderOptions['provider']> = {};

  // Hardcode: route Kimi K2 judge via Google Vertex on OpenRouter.
  // (OpenRouter provider naming varies; include both common identifiers.)
  if (
    modelId === 'moonshotai/kimi-k2-thinking' ||
    modelId.endsWith('/kimi-k2-thinking') ||
    modelId === 'kimik2' ||
    modelId.endsWith('/kimik2')
  ) {
    provider.order = ['google-vertex', 'Google Vertex'];
  }

  // Optional: force OpenRouter to use Google Vertex for specific model IDs.
  // Example:
  //   OPENROUTER_GOOGLE_VERTEX_ONLY_MODELS="google/gemini-2.0-flash-001,google/gemini-2.0-pro"
  const vertexOnly = String(process.env.OPENROUTER_GOOGLE_VERTEX_ONLY_MODELS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (vertexOnly.includes(modelId)) {
    provider.order = ['google-vertex', 'Google Vertex'];
  }

  if (provider.order && provider.order.length > 0) {
    return { provider };
  }
  return {};
}

async function ensureOpenRouterClient(modelId: string): Promise<OpenRouterClient> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      `OPENROUTER_API_KEY is not set; model "${modelId}" cannot be called with @openrouter/sdk.`
    );
  }

  if (!openrouterPromise) {
    openrouterPromise = importOpenRouterSdk('@openrouter/sdk').then(
      ({ OpenRouter }) => new OpenRouter({ apiKey })
    );
  }

  return openrouterPromise;
}

function buildMessages(prompt: string, messages?: ChatMessage[]): ChatMessage[] {
  if (Array.isArray(messages) && messages.length > 0) {
    return messages
      .map((message) => ({
        role: message.role,
        content: String(message.content ?? ''),
      }))
      .filter((message) => message.content.trim().length > 0);
  }

  return [{ role: 'user', content: prompt }];
}

function buildChatInput(system: string, inputMessages: ChatMessage[]): ChatInputMessage[] {
  const chatInput: ChatInputMessage[] = [];

  if (system.trim().length > 0) {
    chatInput.push({ role: 'system', content: system });
  }

  return [
    ...chatInput,
    ...inputMessages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
  ];
}

function numberOrZero(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeUsage(usage: any): Record<string, unknown> | undefined {
  if (!usage || typeof usage !== 'object') return undefined;

  const inputTokens = numberOrZero(usage.inputTokens ?? usage.promptTokens);
  const outputTokens = numberOrZero(usage.outputTokens ?? usage.completionTokens);
  const cachedInputTokens = numberOrZero(
    usage.inputTokensDetails?.cachedTokens ?? usage.cachedInputTokens ?? usage.cachedTokens
  );
  const reasoningTokens = numberOrZero(
    usage.outputTokensDetails?.reasoningTokens ?? usage.reasoningTokens
  );
  const totalTokens = numberOrZero(usage.totalTokens ?? inputTokens + outputTokens);

  const normalized: Record<string, unknown> = {
    inputTokens,
    outputTokens,
    totalTokens,
    reasoningTokens,
    cachedInputTokens,
  };

  if (usage.cost !== undefined) normalized.cost = usage.cost;
  if (usage.costDetails !== undefined) normalized.costDetails = usage.costDetails;
  if (usage.isByok !== undefined) normalized.isByok = usage.isByok;

  return normalized;
}

function parseJsonObject(text: string): unknown {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) throw new Error('Model returned empty text; expected a JSON object.');

  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    const firstBrace = candidate.indexOf('{');
    const lastBrace = candidate.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      const sliced = candidate.slice(firstBrace, lastBrace + 1);
      return JSON.parse(sliced);
    }
    throw new Error('Failed to parse JSON object from model response text.');
  }
}

function normalizeParsedObjectCandidate(value: unknown): unknown {
  // Some models wrap a single JSON object in an array when asked for json_object.
  if (Array.isArray(value) && value.length === 1 && value[0] && typeof value[0] === 'object') {
    return value[0];
  }
  return value;
}

export { getProviderOptions };

export async function timedGenerateText({
  calls,
  name,
  model,
  system,
  prompt,
  maxOutputTokens,
  messages,
}: {
  calls: TimedCallRecord[];
  name: string;
  model: string;
  system: string;
  prompt: string;
  maxOutputTokens?: number;
  messages?: ChatMessage[];
}): Promise<{ text: string }> {
  const startedAtIso = nowIso();
  const t0 = hrNowMs();
  const inputMessages = buildMessages(prompt, messages);
  const chatInput = buildChatInput(system, inputMessages);
  const input: Record<string, unknown> = { model, system, inputMessages };
  if (maxOutputTokens !== undefined) input.maxOutputTokens = maxOutputTokens;

  const client = await ensureOpenRouterClient(model);
  const providerOptions = getProviderOptions(model);

  try {
    const request: {
      model: string;
      input: ChatInputMessage[];
      provider?: ProviderOptions['provider'];
      maxOutputTokens?: number;
    } = {
      model,
      input: chatInput,
      ...providerOptions,
    };
    if (maxOutputTokens !== undefined) request.maxOutputTokens = maxOutputTokens;

    const result = client.callModel(request);
    const [text, response] = await Promise.all([
      result.getText(),
      result.getResponse().catch(() => null),
    ]);
    const durationMs = hrNowMs() - t0;

    calls.push({
      kind: 'generateText',
      model,
      name,
      startedAtIso,
      durationMs,
      input,
      output: {
        text,
        finishReason: (response as any)?.finishReason ?? response?.status,
      },
      usage: normalizeUsage(response?.usage),
    });

    return { text: String(text ?? '') };
  } catch (err: any) {
    const durationMs = hrNowMs() - t0;
    const error = {
      name: err?.name,
      message: String(err?.message ?? err),
      stack: err?.stack,
      details: pickErrorDetails(err),
    };
    calls.push({
      kind: 'generateText',
      model,
      name,
      startedAtIso,
      durationMs,
      input,
      output: null,
      error,
    });
    throw err;
  }
}

export async function timedGenerateObject<T>({
  calls,
  name,
  model,
  system,
  prompt,
  schema,
  schemaName,
  maxOutputTokens,
  messages,
}: {
  calls: TimedCallRecord[];
  name: string;
  model: string;
  system: string;
  prompt: string;
  schema: ZodTypeAny;
  schemaName: string;
  maxOutputTokens?: number;
  messages?: ChatMessage[];
}): Promise<{ object: T }> {
  const startedAtIso = nowIso();
  const t0 = hrNowMs();
  const inputMessages = buildMessages(prompt, messages);
  const chatInput = buildChatInput(system, inputMessages);
  const input: Record<string, unknown> = { model, system, inputMessages, schemaName };
  if (maxOutputTokens !== undefined) input.maxOutputTokens = maxOutputTokens;

  const client = await ensureOpenRouterClient(model);
  const providerOptions = getProviderOptions(model);

  try {
    const request: {
      model: string;
      input: ChatInputMessage[];
      provider?: ProviderOptions['provider'];
      text: { format: { type: 'json_object' } };
      maxOutputTokens?: number;
    } = {
      model,
      input: chatInput,
      text: {
        format: {
          type: 'json_object',
        },
      },
      ...providerOptions,
    };
    if (maxOutputTokens !== undefined) request.maxOutputTokens = maxOutputTokens;

    const result = client.callModel(request);
    const [text, response] = await Promise.all([
      result.getText(),
      result.getResponse().catch(() => null),
    ]);
    const parsed = schema.parse(normalizeParsedObjectCandidate(parseJsonObject(String(text ?? ''))));
    const durationMs = hrNowMs() - t0;

    calls.push({
      kind: 'generateObject',
      model,
      name,
      startedAtIso,
      durationMs,
      input,
      output: parsed,
      usage: normalizeUsage(response?.usage),
    });

    return { object: parsed as T };
  } catch (err: any) {
    const durationMs = hrNowMs() - t0;
    const error = {
      name: err?.name,
      message: String(err?.message ?? err),
      stack: err?.stack,
      details: pickErrorDetails(err),
    };
    calls.push({
      kind: 'generateObject',
      model,
      name,
      startedAtIso,
      durationMs,
      input,
      output: null,
      error,
    });
    throw err;
  }
}

function pickErrorDetails(err: any): unknown {
  const out: Record<string, unknown> = {};
  if (!err || typeof err !== 'object') return out;

  for (const k of ['cause', 'text', 'response', 'status', 'statusCode', 'usage']) {
    if (k in err) out[k] = err[k];
  }
  return out;
}
