import OpenAI from 'openai';
import { ZodTypeAny, toJSONSchema } from 'zod';
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
    requireParameters?: boolean;
  };
};

type OpenRouterCtor = new (options: { apiKey: string }) => {
  callModel: (request: unknown) => {
    getText: () => Promise<string>;
    getResponse: () => Promise<unknown>;
  };
};
type OpenRouterClient = InstanceType<OpenRouterCtor>;

type SupportedProvider = 'openai' | 'google';

type StructuredOutputConfig = {
  schemaName: string;
  jsonSchema: Record<string, unknown>;
};

type ProviderCallResult = {
  text: string;
  finishReason?: string;
  usage?: unknown;
  response?: unknown;
};

const importOpenRouterSdk = new Function('specifier', 'return import(specifier);') as (
  specifier: string
) => Promise<{ OpenRouter?: OpenRouterCtor; default?: OpenRouterCtor }>;

const OPENAI_MAX_RETRY_ATTEMPTS = 6;
const OPENAI_RETRY_BASE_DELAY_MS = 250;
const OPENAI_RETRY_MAX_DELAY_MS = 8_000;
const OPENAI_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes for flex tier
let openAiClient: OpenAI | null = null;
let openRouterClientPromise: Promise<OpenRouterClient> | null = null;

/**
 * Compatibility export retained for callers that still import this symbol.
 * Routing is now handled directly by provider-prefixed model IDs.
 */
function getProviderOptions(_modelId: string): ProviderOptions {
  return {};
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseProviderModel(modelId: string): { provider: SupportedProvider; modelName: string } {
  const [providerRaw, ...rest] = String(modelId ?? '').split('/');
  const provider = providerRaw.toLowerCase();
  const modelName = rest.join('/').trim();

  if (!provider || !modelName) {
    throw new Error(
      `Invalid model ID "${modelId}". Expected provider-prefixed form like "openai/gpt-5.1" or "google/gemini-3-flash-preview".`
    );
  }

  if (provider !== 'openai' && provider !== 'google') {
    throw new Error(
      `Unsupported model provider "${providerRaw}" in "${modelId}". Supported providers: openai/*, google/*.`
    );
  }

  return {
    provider,
    modelName: modelName.startsWith('models/') ? modelName.slice('models/'.length) : modelName,
  };
}

function requireEnvVar(name: string, modelId: string): string {
  const value = String(process.env[name] ?? '').trim();
  if (!value) {
    throw new Error(`${name} is not set; model "${modelId}" cannot be called directly.`);
  }
  return value;
}

function ensureOpenAiClient(modelId: string): OpenAI {
  if (!openAiClient) {
    const apiKey = requireEnvVar('OPENAI_API_KEY', modelId);
    openAiClient = new OpenAI({
      apiKey,
      timeout: OPENAI_TIMEOUT_MS,
    });
  }
  return openAiClient;
}

async function ensureOpenRouterClient(modelId: string): Promise<OpenRouterClient> {
  const apiKey = String(process.env.OPENROUTER_API_KEY ?? '').trim();
  if (!apiKey) {
    throw new Error(
      `OPENROUTER_API_KEY is not set; model "${modelId}" cannot be called with @openrouter/sdk.`
    );
  }

  if (!openRouterClientPromise) {
    openRouterClientPromise = importOpenRouterSdk('@openrouter/sdk').then((sdkModule) => {
      const OpenRouter = sdkModule.OpenRouter ?? sdkModule.default;
      if (!OpenRouter) {
        throw new Error('Failed to load OpenRouter SDK constructor from @openrouter/sdk.');
      }
      return new OpenRouter({ apiKey });
    });
  }

  return openRouterClientPromise;
}

function numberOrZero(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeUsage(usage: any): Record<string, unknown> | undefined {
  if (!usage || typeof usage !== 'object') return undefined;

  const inputTokens = numberOrZero(
    usage.inputTokens ?? usage.promptTokens ?? usage.input_tokens ?? usage.promptTokenCount
  );
  const outputTokens = numberOrZero(
    usage.outputTokens ??
      usage.completionTokens ??
      usage.output_tokens ??
      usage.candidatesTokenCount
  );
  const cachedInputTokens = numberOrZero(
    usage.inputTokensDetails?.cachedTokens ??
      usage.cachedInputTokens ??
      usage.cachedTokens ??
      usage.input_tokens_details?.cached_tokens ??
      usage.cachedContentTokenCount ??
      usage.cached_content_token_count
  );
  const reasoningTokens = numberOrZero(
    usage.outputTokensDetails?.reasoningTokens ??
      usage.reasoningTokens ??
      usage.output_tokens_details?.reasoning_tokens ??
      usage.thoughtsTokenCount
  );
  const totalTokens = numberOrZero(
    usage.totalTokens ?? usage.total_tokens ?? usage.totalTokenCount ?? inputTokens + outputTokens
  );

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

function zodSchemaToJsonSchema(schema: ZodTypeAny): Record<string, unknown> {
  const jsonSchema = toJSONSchema(schema);
  if (!jsonSchema || typeof jsonSchema !== 'object') {
    throw new Error('Failed to convert Zod schema to JSON Schema for structured output.');
  }
  return jsonSchema as Record<string, unknown>;
}

function jsonParse(text: string): unknown {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function buildApiError(message: string, details: Record<string, unknown>): Error {
  const err = new Error(message) as Error & Record<string, unknown>;
  Object.assign(err, details);
  return err;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function readStatusCode(value: unknown): number | undefined {
  const status = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(status)) return undefined;
  return status >= 100 && status <= 599 ? status : undefined;
}

function getErrorStatusCode(err: unknown): number | undefined {
  if (!isRecord(err)) return undefined;

  const directStatus = readStatusCode(err.status);
  if (directStatus !== undefined) return directStatus;

  const statusCode = readStatusCode(err.statusCode);
  if (statusCode !== undefined) return statusCode;

  return undefined;
}

function extractOpenAiErrorCode(err: unknown): string | undefined {
  if (!isRecord(err) || !isRecord(err.response)) return undefined;
  const response = err.response as Record<string, unknown>;
  if (!isRecord(response.error)) return undefined;

  const code = response.error.code;
  if (typeof code === 'string' && code.trim().length > 0) {
    return code.trim().toLowerCase();
  }

  return undefined;
}

function extractOpenAiErrorType(err: unknown): string | undefined {
  if (!isRecord(err) || !isRecord(err.response)) return undefined;
  const response = err.response as Record<string, unknown>;
  if (!isRecord(response.error)) return undefined;

  const type = response.error.type;
  if (typeof type === 'string' && type.trim().length > 0) {
    return type.trim().toLowerCase();
  }

  return undefined;
}

function getRetryErrorText(err: unknown): string {
  if (!isRecord(err)) return '';

  const parts: string[] = [];
  if (typeof err.message === 'string') {
    parts.push(err.message);
  }
  if (typeof err.text === 'string') {
    parts.push(err.text);
  }

  if (isRecord(err.response) && isRecord(err.response.error) && typeof err.response.error.message === 'string') {
    parts.push(err.response.error.message);
  }

  return parts.join(' ').toLowerCase();
}

function isLikelyNetworkError(err: unknown): boolean {
  if (!isRecord(err)) return false;
  if (getErrorStatusCode(err) !== undefined) return false;

  if ('cause' in err && err.cause !== undefined) {
    return true;
  }

  const retryText = getRetryErrorText(err);
  return [
    'network',
    'fetch failed',
    'econnreset',
    'econnaborted',
    'etimedout',
    'timed out',
    'enotfound',
    'eai_again',
    'ehostunreach',
    'socket hang up',
    'connection reset',
  ].some((needle) => retryText.includes(needle));
}

function isRetryableOpenAiError(err: unknown): boolean {
  const status = getErrorStatusCode(err);

  if (status === 408) {
    return true;
  }

  if (status === 429) {
    const errorCode = extractOpenAiErrorCode(err);
    if (errorCode === 'insufficient_quota') {
      return false;
    }

    if (errorCode?.includes('rate') || errorCode?.includes('resource_unavailable')) {
      return true;
    }

    const errorType = extractOpenAiErrorType(err);
    if (errorType?.includes('rate') || errorType?.includes('resource_unavailable')) {
      return true;
    }

    const retryText = getRetryErrorText(err);
    if (
      retryText.includes('rate limit') ||
      retryText.includes('too many requests') ||
      retryText.includes('resource unavailable')
    ) {
      return true;
    }

    return true;
  }

  if (status !== undefined && status >= 500 && status <= 599) {
    return true;
  }

  return isLikelyNetworkError(err);
}

function calculateOpenAiRetryDelayMs(failureAttempt: number): number {
  const exponent = Math.max(0, failureAttempt - 1);
  const cappedExponential = Math.min(
    OPENAI_RETRY_MAX_DELAY_MS,
    OPENAI_RETRY_BASE_DELAY_MS * (2 ** exponent)
  );
  const jitterMultiplier = 0.5 + Math.random();

  return Math.max(
    1,
    Math.min(OPENAI_RETRY_MAX_DELAY_MS, Math.round(cappedExponential * jitterMultiplier))
  );
}

function shouldUseOpenAiFlexTier(modelName: string): boolean {
  return modelName === 'gpt-5.1';
}

async function postJson({
  url,
  headers,
  body,
}: {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}): Promise<{ status: number; data: unknown; text: string }> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
    });
  } catch (err: any) {
    throw buildApiError('Network request failed.', {
      cause: err,
      message: String(err?.message ?? err),
    });
  }

  const text = await response.text();
  const data = jsonParse(text);

  if (!response.ok) {
    throw buildApiError(`Provider request failed with status ${response.status}.`, {
      status: response.status,
      response: data,
      text,
      url,
    });
  }

  return {
    status: response.status,
    data,
    text,
  };
}

function extractOpenAiText(response: unknown): string {
  if (!isRecord(response)) return '';
  if (typeof response.output_text === 'string') {
    return response.output_text;
  }

  const output = Array.isArray(response.output) ? response.output : [];
  const chunks: string[] = [];

  for (const item of output) {
    if (!isRecord(item)) continue;
    const content = Array.isArray(item.content) ? item.content : [];
    for (const part of content) {
      if (!isRecord(part)) continue;
      if (typeof part.text === 'string' && part.text.trim().length > 0) {
        chunks.push(part.text);
      }
    }
  }

  return chunks.join('\n').trim();
}

function extractOpenAiFinishReason(response: unknown): string | undefined {
  if (!isRecord(response)) return undefined;

  if (isRecord(response.incompleteDetails) && typeof response.incompleteDetails.reason === 'string') {
    return response.incompleteDetails.reason;
  }

  if (isRecord(response.incomplete_details) && typeof response.incomplete_details.reason === 'string') {
    return response.incomplete_details.reason;
  }

  const output = Array.isArray(response.output) ? response.output : [];
  for (const item of output) {
    if (!isRecord(item)) continue;
    if (typeof item.status === 'string' && item.status.length > 0) {
      return item.status;
    }
  }

  if (typeof response.status === 'string' && response.status.length > 0) {
    return response.status;
  }

  return undefined;
}

async function callOpenAi({
  modelName,
  modelId,
  chatInput,
  maxOutputTokens,
  structuredOutput,
}: {
  modelName: string;
  modelId: string;
  chatInput: ChatInputMessage[];
  maxOutputTokens?: number;
  structuredOutput?: StructuredOutputConfig;
}): Promise<ProviderCallResult> {
  const client = ensureOpenAiClient(modelId);

  const params: Record<string, unknown> = {
    model: modelName,
    input: chatInput,
  };
  if (shouldUseOpenAiFlexTier(modelName)) {
    params.service_tier = 'flex';
  }
  if (maxOutputTokens !== undefined) {
    params.max_output_tokens = maxOutputTokens;
  }

  if (structuredOutput) {
    params.text = {
      format: {
        type: 'json_schema',
        name: structuredOutput.schemaName,
        strict: true,
        schema: structuredOutput.jsonSchema,
      },
    };
  }

  for (let attempt = 1; attempt <= OPENAI_MAX_RETRY_ATTEMPTS; attempt += 1) {
    try {
      const response = await client.responses.create(
        params as any,
        { timeout: OPENAI_TIMEOUT_MS },
      );

      return {
        text: response.output_text,
        finishReason: extractOpenAiFinishReason(response),
        usage: (response as any).usage,
        response,
      };
    } catch (err: any) {
      const canRetry =
        attempt < OPENAI_MAX_RETRY_ATTEMPTS &&
        isRetryableOpenAiError(err);

      if (!canRetry) {
        throw err;
      }

      const delayMs = calculateOpenAiRetryDelayMs(attempt);
      await sleep(delayMs);
    }
  }

  throw new Error('OpenAI request failed after retry budget was exhausted.');
}

async function callGoogle({
  modelName,
  modelId,
  chatInput,
  maxOutputTokens,
  structuredOutput,
}: {
  modelName: string;
  modelId: string;
  chatInput: ChatInputMessage[];
  maxOutputTokens?: number;
  structuredOutput?: StructuredOutputConfig;
}): Promise<ProviderCallResult> {
  const client = await ensureOpenRouterClient(modelId);
  const providerOptions = getProviderOptions(modelId);
  const request: {
    model: string;
    input: ChatInputMessage[];
    provider?: ProviderOptions['provider'];
    maxOutputTokens?: number;
    text?: {
      format: {
        type: 'json_schema';
        name: string;
        strict: boolean;
        schema: Record<string, unknown>;
      };
    };
  } = {
    model: `google/${modelName}`,
    input: chatInput,
    ...providerOptions,
  };

  if (maxOutputTokens !== undefined) {
    request.maxOutputTokens = maxOutputTokens;
  }

  if (structuredOutput) {
    request.text = {
      format: {
        type: 'json_schema',
        name: structuredOutput.schemaName,
        strict: true,
        schema: structuredOutput.jsonSchema,
      },
    };
  }

  const result = client.callModel(request);
  const [text, response] = await Promise.all([
    result.getText(),
    result.getResponse().catch(() => null),
  ]);

  return {
    text: String(text ?? ''),
    finishReason: extractOpenAiFinishReason(response),
    usage: isRecord(response) ? response.usage : undefined,
    response,
  };
}

async function callProvider({
  modelId,
  system,
  inputMessages,
  maxOutputTokens,
  structuredOutput,
}: {
  modelId: string;
  system: string;
  inputMessages: ChatMessage[];
  maxOutputTokens?: number;
  structuredOutput?: StructuredOutputConfig;
}): Promise<ProviderCallResult> {
  const { provider, modelName } = parseProviderModel(modelId);
  const chatInput = buildChatInput(system, inputMessages);

  if (provider === 'openai') {
    return callOpenAi({
      modelName,
      modelId,
      chatInput,
      maxOutputTokens,
      structuredOutput,
    });
  }

  return callGoogle({
    modelName,
    modelId,
    chatInput,
    maxOutputTokens,
    structuredOutput,
  });
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
  const input: Record<string, unknown> = { model, system, inputMessages };
  if (maxOutputTokens !== undefined) input.maxOutputTokens = maxOutputTokens;

  try {
    const result = await callProvider({
      modelId: model,
      system,
      inputMessages,
      maxOutputTokens,
    });
    const durationMs = hrNowMs() - t0;

    calls.push({
      kind: 'generateText',
      model,
      name,
      startedAtIso,
      durationMs,
      input,
      output: {
        text: result.text,
        finishReason: result.finishReason,
      },
      usage: normalizeUsage(result.usage),
    });

    return { text: String(result.text ?? '') };
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
  const input: Record<string, unknown> = { model, system, inputMessages, schemaName };
  if (maxOutputTokens !== undefined) input.maxOutputTokens = maxOutputTokens;

  const jsonSchema = zodSchemaToJsonSchema(schema);

  try {
    const result = await callProvider({
      modelId: model,
      system,
      inputMessages,
      maxOutputTokens,
      structuredOutput: {
        schemaName,
        jsonSchema,
      },
    });
    let parsed: unknown;
    try {
      parsed = schema.parse(normalizeParsedObjectCandidate(parseJsonObject(String(result.text ?? ''))));
    } catch (parseErr: any) {
      if (parseErr && typeof parseErr === 'object') {
        parseErr.text = result.text;
        parseErr.response = result.response;
      }
      throw parseErr;
    }
    const durationMs = hrNowMs() - t0;

    calls.push({
      kind: 'generateObject',
      model,
      name,
      startedAtIso,
      durationMs,
      input,
      output: parsed,
      usage: normalizeUsage(result.usage),
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

  for (const k of ['cause', 'text', 'response', 'status', 'statusCode', 'usage', 'url']) {
    if (k in err) out[k] = err[k];
  }
  return out;
}
