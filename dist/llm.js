"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.timedGenerateText = timedGenerateText;
exports.timedGenerateObject = timedGenerateObject;
const ai_1 = require("ai");
const ai_sdk_provider_1 = require("@openrouter/ai-sdk-provider");
const util_1 = require("./util");
// Create OpenRouter provider instance
const openrouter = process.env.OPENROUTER_API_KEY
    ? (0, ai_sdk_provider_1.createOpenRouter)({ apiKey: process.env.OPENROUTER_API_KEY })
    : null;
async function resolveModelForSdk(modelId) {
    // Primary: Use OpenRouter if API key is available
    if (openrouter) {
        return openrouter.chat(modelId);
    }
    // Fallback: Try provider-specific SDKs
    const [provider, ...rest] = modelId.split('/');
    const name = rest.join('/');
    if (!provider || !name) {
        throw new Error(`OPENROUTER_API_KEY is not set and model "${modelId}" has no recognized provider prefix.`);
    }
    if (provider === 'openai') {
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const mod = require('@ai-sdk/openai');
            return mod.openai(name);
        }
        catch {
            throw new Error(`OPENROUTER_API_KEY is not set and @ai-sdk/openai is not installed, so model "${modelId}" cannot be used.`);
        }
    }
    if (provider === 'google') {
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const mod = require('@ai-sdk/google');
            return mod.google(name);
        }
        catch {
            throw new Error(`OPENROUTER_API_KEY is not set and @ai-sdk/google is not installed, so model "${modelId}" cannot be used.`);
        }
    }
    throw new Error(`OPENROUTER_API_KEY is not set and provider "${provider}" is not supported for model "${modelId}".`);
}
async function timedGenerateText({ calls, name, model, system, prompt, temperature, maxOutputTokens, }) {
    const startedAtIso = (0, util_1.nowIso)();
    const t0 = (0, util_1.hrNowMs)();
    const input = { model, system, prompt, temperature, maxOutputTokens };
    const resolvedModel = await resolveModelForSdk(model);
    try {
        const result = await (0, ai_1.generateText)({
            model: resolvedModel,
            system,
            prompt,
            temperature,
            maxOutputTokens,
        });
        const durationMs = (0, util_1.hrNowMs)() - t0;
        calls.push({
            kind: 'generateText',
            model,
            name,
            startedAtIso,
            durationMs,
            input,
            output: { text: result.text, finishReason: result.finishReason },
            usage: result.usage,
        });
        return { text: result.text };
    }
    catch (err) {
        const durationMs = (0, util_1.hrNowMs)() - t0;
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
async function timedGenerateObject({ calls, name, model, system, prompt, schema, schemaName, temperature, maxOutputTokens, }) {
    const startedAtIso = (0, util_1.nowIso)();
    const t0 = (0, util_1.hrNowMs)();
    const input = { model, system, prompt, schemaName, temperature, maxOutputTokens };
    const resolvedModel = await resolveModelForSdk(model);
    try {
        const result = await (0, ai_1.generateObject)({
            model: resolvedModel,
            system,
            prompt,
            schema,
            temperature,
            maxOutputTokens,
        });
        const durationMs = (0, util_1.hrNowMs)() - t0;
        calls.push({
            kind: 'generateObject',
            model,
            name,
            startedAtIso,
            durationMs,
            input,
            output: result.object,
            usage: result.usage,
        });
        return { object: result.object };
    }
    catch (err) {
        const durationMs = (0, util_1.hrNowMs)() - t0;
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
function pickErrorDetails(err) {
    const out = {};
    if (!err || typeof err !== 'object')
        return out;
    // AI SDK errors often include helpful fields:
    for (const k of ['cause', 'text', 'response', 'finishReason', 'usage']) {
        if (k in err)
            out[k] = err[k];
    }
    return out;
}
