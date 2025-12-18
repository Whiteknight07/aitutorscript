import { generateObject, generateText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { ZodTypeAny } from 'zod';
import type { TimedCallRecord } from '../types';
import { hrNowMs, nowIso } from '../utils/util';

// Create OpenRouter provider instance
const openrouter = process.env.OPENROUTER_API_KEY
  ? createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY })
  : null;

/**
 * Get provider-specific options for a model.
 * - Configures OpenRouter to prefer high-throughput, low-price providers
 * - Disables reasoning/thinking for OpenAI GPT-5.1 models
 */
function getProviderOptions(modelId: string): any {
  const options: any = {
    // OpenRouter provider routing: sort by throughput first, then price
    // See: https://openrouter.ai/docs/features/provider-routing
    openrouter: {
      provider: {
        // Order of preference for provider selection
        order: ['Throughput', 'Price'],
      },
    },
  };

  // Disable reasoning/thinking for OpenAI GPT-5.1 models
  if (modelId.includes('gpt-5')) {
    options.openai = {
      reasoning_effort: 'none',
    };
  }

  return options;
}

async function resolveModelForSdk(modelId: string): Promise<any> {
  // Primary: Use OpenRouter if API key is available
  if (openrouter) {
    return openrouter.chat(modelId);
  }

  // Fallback: Try provider-specific SDKs
  const [provider, ...rest] = modelId.split('/');
  const name = rest.join('/');
  if (!provider || !name) {
    throw new Error(
      `OPENROUTER_API_KEY is not set and model "${modelId}" has no recognized provider prefix.`
    );
  }

  if (provider === 'openai') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('@ai-sdk/openai') as any;
      return mod.openai(name);
    } catch {
      throw new Error(
        `OPENROUTER_API_KEY is not set and @ai-sdk/openai is not installed, so model "${modelId}" cannot be used.`
      );
    }
  }

  if (provider === 'google') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('@ai-sdk/google') as any;
      return mod.google(name);
    } catch {
      throw new Error(
        `OPENROUTER_API_KEY is not set and @ai-sdk/google is not installed, so model "${modelId}" cannot be used.`
      );
    }
  }

  throw new Error(
    `OPENROUTER_API_KEY is not set and provider "${provider}" is not supported for model "${modelId}".`
  );
}

export { getProviderOptions };

export async function timedGenerateText({
  calls,
  name,
  model,
  system,
  prompt,
  temperature,
  maxOutputTokens,
}: {
  calls: TimedCallRecord[];
  name: string;
  model: string;
  system: string;
  prompt: string;
  temperature?: number;
  maxOutputTokens?: number;
}): Promise<{ text: string }> {
  const startedAtIso = nowIso();
  const t0 = hrNowMs();
  const input = { model, system, prompt, temperature, maxOutputTokens };
  const resolvedModel = await resolveModelForSdk(model);
  const providerOptions = getProviderOptions(model);
  try {
    const result = await generateText({
      model: resolvedModel,
      system,
      prompt,
      temperature,
      maxOutputTokens,
      ...(providerOptions && { providerOptions }),
    });
    const durationMs = hrNowMs() - t0;

    calls.push({
      kind: 'generateText',
      model,
      name,
      startedAtIso,
      durationMs,
      input,
      output: { text: result.text, finishReason: (result as any).finishReason },
      usage: (result as any).usage,
    });

    return { text: result.text };
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
  temperature,
  maxOutputTokens,
}: {
  calls: TimedCallRecord[];
  name: string;
  model: string;
  system: string;
  prompt: string;
  schema: ZodTypeAny;
  schemaName: string;
  temperature?: number;
  maxOutputTokens?: number;
}): Promise<{ object: T }> {
  const startedAtIso = nowIso();
  const t0 = hrNowMs();
  const input = { model, system, prompt, schemaName, temperature, maxOutputTokens };
  const resolvedModel = await resolveModelForSdk(model);
  const providerOptions = getProviderOptions(model);
  try {
    const result = await generateObject({
      model: resolvedModel,
      system,
      prompt,
      schema,
      temperature,
      maxOutputTokens,
      ...(providerOptions && { providerOptions }),
    });
    const durationMs = hrNowMs() - t0;

    calls.push({
      kind: 'generateObject',
      model,
      name,
      startedAtIso,
      durationMs,
      input,
      output: result.object,
      usage: (result as any).usage,
    });

    return { object: result.object as T };
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

  // AI SDK errors often include helpful fields:
  for (const k of ['cause', 'text', 'response', 'finishReason', 'usage']) {
    if (k in err) out[k] = err[k];
  }
  return out;
}
