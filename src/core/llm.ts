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

function getGoogleApiKey(modelId: string): string {
  const directKey = String(process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? '').trim();
  if (directKey) return directKey;

  const legacyKey = String(process.env.GOOGLE_API_KEY ?? '').trim();
  if (legacyKey) return legacyKey;

  throw new Error(
    `GOOGLE_GENERATIVE_AI_API_KEY is not set (and GOOGLE_API_KEY fallback is empty); model "${modelId}" cannot be called directly.`
  );
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

function resolveJsonPointer(root: Record<string, unknown>, ref: string): unknown {
  if (!ref.startsWith('#/')) {
    throw new Error(`Unsupported JSON schema reference "${ref}".`);
  }

  const pointer = ref.slice(2);
  const segments = pointer
    .split('/')
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'));

  let current: unknown = root;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        throw new Error(`Invalid array index "${segment}" in JSON schema reference "${ref}".`);
      }
      current = current[index];
      continue;
    }

    if (!isRecord(current) || !(segment in current)) {
      throw new Error(`Unresolved JSON schema reference "${ref}".`);
    }

    current = current[segment];
  }

  return current;
}

function dereferenceJsonSchemaNode(
  node: unknown,
  rootSchema: Record<string, unknown>,
  activeRefs: Set<string>
): unknown {
  if (!isRecord(node)) return node;

  const ref = typeof node.$ref === 'string' ? node.$ref : undefined;
  if (!ref) return node;

  if (activeRefs.has(ref)) {
    throw new Error(`Circular JSON schema reference "${ref}".`);
  }

  activeRefs.add(ref);
  try {
    const resolved = resolveJsonPointer(rootSchema, ref);
    return dereferenceJsonSchemaNode(resolved, rootSchema, activeRefs);
  } finally {
    activeRefs.delete(ref);
  }
}

function inferJsonSchemaTypeFromValue(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  if (typeof value === 'object') return 'object';
  return 'string';
}

function jsonSchemaTypeToGeminiType(type: string): string {
  switch (type) {
    case 'object':
      return 'OBJECT';
    case 'array':
      return 'ARRAY';
    case 'string':
      return 'STRING';
    case 'integer':
      return 'INTEGER';
    case 'number':
      return 'NUMBER';
    case 'boolean':
      return 'BOOLEAN';
    case 'null':
      return 'NULL';
    default:
      return 'STRING';
  }
}

function isNullSchemaNode(node: unknown, rootSchema: Record<string, unknown>): boolean {
  const resolved = dereferenceJsonSchemaNode(node, rootSchema, new Set<string>());
  if (!isRecord(resolved)) return false;

  if (resolved.type === 'null') return true;
  if (Array.isArray(resolved.type)) {
    return resolved.type.includes('null');
  }
  return false;
}

function convertJsonSchemaNodeToGeminiSchema(
  node: unknown,
  rootSchema: Record<string, unknown>,
  activeRefs: Set<string>
): Record<string, unknown> {
  const resolved = dereferenceJsonSchemaNode(node, rootSchema, activeRefs);
  if (!isRecord(resolved)) {
    return { type: 'STRING' };
  }

  if (Array.isArray(resolved.anyOf) && resolved.anyOf.length > 0) {
    const variants = resolved.anyOf;
    const nonNullVariants = variants.filter((variant) => !isNullSchemaNode(variant, rootSchema));
    const chosen = nonNullVariants[0] ?? variants[0];
    const converted = convertJsonSchemaNodeToGeminiSchema(chosen, rootSchema, activeRefs);
    if (nonNullVariants.length !== variants.length) {
      converted.nullable = true;
    }
    return converted;
  }

  if (Array.isArray(resolved.oneOf) && resolved.oneOf.length > 0) {
    const variants = resolved.oneOf;
    const nonNullVariants = variants.filter((variant) => !isNullSchemaNode(variant, rootSchema));
    const chosen = nonNullVariants[0] ?? variants[0];
    const converted = convertJsonSchemaNodeToGeminiSchema(chosen, rootSchema, activeRefs);
    if (nonNullVariants.length !== variants.length) {
      converted.nullable = true;
    }
    return converted;
  }

  let nullable = Boolean(resolved.nullable);
  let jsonType: string | undefined;

  if (typeof resolved.type === 'string') {
    jsonType = resolved.type;
  } else if (Array.isArray(resolved.type)) {
    for (const typeValue of resolved.type) {
      if (typeValue === 'null') {
        nullable = true;
        continue;
      }
      if (!jsonType && typeof typeValue === 'string') {
        jsonType = typeValue;
      }
    }
  }

  if (!jsonType && Array.isArray(resolved.enum) && resolved.enum.length > 0) {
    jsonType = inferJsonSchemaTypeFromValue(resolved.enum[0]);
  }

  if (!jsonType && resolved.const !== undefined) {
    jsonType = inferJsonSchemaTypeFromValue(resolved.const);
  }

  if (!jsonType) {
    if (isRecord(resolved.properties)) {
      jsonType = 'object';
    } else if (resolved.items !== undefined) {
      jsonType = 'array';
    } else {
      jsonType = 'string';
    }
  }

  if (jsonType === 'null') {
    jsonType = 'string';
    nullable = true;
  }

  const geminiSchema: Record<string, unknown> = {
    type: jsonSchemaTypeToGeminiType(jsonType),
  };

  if (nullable) {
    geminiSchema.nullable = true;
  }

  if (typeof resolved.description === 'string' && resolved.description.trim().length > 0) {
    geminiSchema.description = resolved.description;
  }

  if (Array.isArray(resolved.enum) && resolved.enum.length > 0) {
    geminiSchema.enum = resolved.enum;
  } else if (resolved.const !== undefined) {
    geminiSchema.enum = [resolved.const];
  }

  if (jsonType === 'object') {
    const properties = isRecord(resolved.properties)
      ? (resolved.properties as Record<string, unknown>)
      : {};
    const convertedProps: Record<string, unknown> = {};

    for (const [key, propSchema] of Object.entries(properties)) {
      convertedProps[key] = convertJsonSchemaNodeToGeminiSchema(propSchema, rootSchema, activeRefs);
    }

    geminiSchema.properties = convertedProps;

    if (Array.isArray(resolved.required) && resolved.required.length > 0) {
      const required = resolved.required.filter((value): value is string => typeof value === 'string');
      if (required.length > 0) {
        geminiSchema.required = required;
      }
    }

    if (isRecord(resolved.additionalProperties)) {
      geminiSchema.additionalProperties = convertJsonSchemaNodeToGeminiSchema(
        resolved.additionalProperties,
        rootSchema,
        activeRefs
      );
    }
  }

  if (jsonType === 'array' && resolved.items !== undefined) {
    geminiSchema.items = convertJsonSchemaNodeToGeminiSchema(resolved.items, rootSchema, activeRefs);
  }

  return geminiSchema;
}

function jsonSchemaToGeminiSchema(jsonSchema: Record<string, unknown>): Record<string, unknown> | undefined {
  try {
    return convertJsonSchemaNodeToGeminiSchema(jsonSchema, jsonSchema, new Set<string>());
  } catch {
    return undefined;
  }
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

function extractGeminiText(response: unknown): string {
  if (!isRecord(response)) return '';

  const candidates = Array.isArray(response.candidates) ? response.candidates : [];
  if (candidates.length === 0 || !isRecord(candidates[0])) return '';

  const candidate = candidates[0];
  const content = isRecord(candidate.content) ? candidate.content : null;
  if (!content) return '';

  const parts = Array.isArray(content.parts) ? content.parts : [];
  const chunks: string[] = [];

  for (const part of parts) {
    if (!isRecord(part)) continue;
    if (typeof part.text === 'string' && part.text.trim().length > 0) {
      chunks.push(part.text);
    }
  }

  return chunks.join('\n').trim();
}

function extractGeminiFinishReason(response: unknown): string | undefined {
  if (!isRecord(response)) return undefined;
  const candidates = Array.isArray(response.candidates) ? response.candidates : [];
  if (candidates.length === 0 || !isRecord(candidates[0])) return undefined;

  const finishReason = candidates[0].finishReason;
  if (typeof finishReason === 'string' && finishReason.length > 0) {
    return finishReason;
  }
  return undefined;
}

function buildGeminiContents(messages: ChatMessage[]): Array<{
  role: 'user' | 'model';
  parts: Array<{ text: string }>;
}> {
  return messages.map((message) => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: message.content }],
  }));
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
  const apiKey = requireEnvVar('OPENAI_API_KEY', modelId);

  const body: Record<string, unknown> = {
    model: modelName,
    input: chatInput,
  };
  if (maxOutputTokens !== undefined) {
    body.max_output_tokens = maxOutputTokens;
  }

  if (structuredOutput) {
    body.text = {
      format: {
        type: 'json_schema',
        name: structuredOutput.schemaName,
        strict: true,
        schema: structuredOutput.jsonSchema,
      },
    };
  }

  const response = await postJson({
    url: 'https://api.openai.com/v1/responses',
    headers: {
      authorization: `Bearer ${apiKey}`,
    },
    body,
  });

  return {
    text: extractOpenAiText(response.data),
    finishReason: extractOpenAiFinishReason(response.data),
    usage: isRecord(response.data) ? response.data.usage : undefined,
    response: response.data,
  };
}

async function callGoogle({
  modelName,
  modelId,
  system,
  inputMessages,
  maxOutputTokens,
  structuredOutput,
}: {
  modelName: string;
  modelId: string;
  system: string;
  inputMessages: ChatMessage[];
  maxOutputTokens?: number;
  structuredOutput?: StructuredOutputConfig;
}): Promise<ProviderCallResult> {
  const apiKey = getGoogleApiKey(modelId);
  const generationConfig: Record<string, unknown> = {};

  if (maxOutputTokens !== undefined) {
    generationConfig.maxOutputTokens = maxOutputTokens;
  }

  if (structuredOutput) {
    generationConfig.responseMimeType = 'application/json';
    const geminiSchema = jsonSchemaToGeminiSchema(structuredOutput.jsonSchema);
    if (geminiSchema) {
      generationConfig.responseSchema = geminiSchema;
    }
  }

  const body: Record<string, unknown> = {
    contents: buildGeminiContents(inputMessages),
  };
  if (system.trim().length > 0) {
    body.systemInstruction = {
      parts: [{ text: system }],
    };
  }
  if (Object.keys(generationConfig).length > 0) {
    body.generationConfig = generationConfig;
  }

  const encodedModelName = encodeURIComponent(modelName);
  const response = await postJson({
    url: `https://generativelanguage.googleapis.com/v1beta/models/${encodedModelName}:generateContent?key=${encodeURIComponent(apiKey)}`,
    headers: {},
    body,
  });

  return {
    text: extractGeminiText(response.data),
    finishReason: extractGeminiFinishReason(response.data),
    usage: isRecord(response.data) ? response.data.usageMetadata : undefined,
    response: response.data,
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
    system,
    inputMessages,
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
