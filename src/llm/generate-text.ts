import type { Context } from '@mariozechner/pi-ai';
import { completeSimple } from '@mariozechner/pi-ai';

import { maybeGenerateDocumentText } from './generate-text-document.js';
import {
  computeRetryDelayMs,
  isGoogleEmptySummaryError,
  isRetryableTimeoutError,
  promptToContext,
  resolveEffectiveTemperature,
  resolveGoogleEmptyResponseFallbackModelId,
  shouldRetryGpt5WithoutTokenCap,
  sleep,
} from './generate-text-shared.js';
import { streamTextWithContext } from './generate-text-stream.js';
import { parseGatewayStyleModelId } from './model-id.js';
import type { LlmProvider } from './model-id.js';
import type { ModelRequestOptions } from './model-options.js';
import type { Prompt } from './prompt.js';
import { resolveOpenAiCompatibleClientConfigForProvider } from './provider-capabilities.js';
import {
  completeAnthropicText,
  normalizeAnthropicModelAccessError,
} from './providers/anthropic.js';
import { completeGoogleText } from './providers/google.js';
import {
  resolveAnthropicModel,
  resolveGoogleModel,
  resolveOpenAiModel,
  resolveNvidiaModel,
  resolveXaiModel,
  resolveZaiModel,
} from './providers/models.js';
import { completeOpenAiText, resolveOpenAiClientConfig } from './providers/openai.js';
import { extractText } from './providers/shared.js';
import type { OpenAiClientConfig } from './providers/types.js';
import type { LlmTokenUsage } from './types.js';
import { normalizeTokenUsage } from './usage.js';
export { streamTextWithContext } from './generate-text-stream.js';

export interface LlmApiKeys {
  xaiApiKey: string | null;
  openaiApiKey: string | null;
  googleApiKey: string | null;
  anthropicApiKey: string | null;
  openrouterApiKey: string | null;
}

export interface OpenRouterOptions { providers: string[] | null }

export type { LlmTokenUsage } from './types.js';

interface RetryNotice { attempt: number; maxRetries: number; delayMs: number; error: unknown }

export async function generateTextWithModelId({
  modelId,
  apiKeys,
  prompt,
  temperature,
  maxOutputTokens,
  timeoutMs,
  fetchImpl,
  forceOpenRouter,
  openaiBaseUrlOverride,
  anthropicBaseUrlOverride,
  googleBaseUrlOverride,
  xaiBaseUrlOverride,
  zaiBaseUrlOverride,
  forceChatCompletions,
  requestOptions,
  retries = 0,
  onRetry,
}: {
  modelId: string;
  apiKeys: LlmApiKeys;
  prompt: Prompt;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs: number;
  fetchImpl: typeof fetch;
  forceOpenRouter?: boolean;
  openaiBaseUrlOverride?: string | null;
  anthropicBaseUrlOverride?: string | null;
  googleBaseUrlOverride?: string | null;
  xaiBaseUrlOverride?: string | null;
  zaiBaseUrlOverride?: string | null;
  forceChatCompletions?: boolean;
  requestOptions?: ModelRequestOptions;
  retries?: number;
  onRetry?: (notice: RetryNotice) => void;
}): Promise<{
  text: string;
  canonicalModelId: string;
  provider: LlmProvider;
  usage: LlmTokenUsage | null;
}> {
  const parsed = parseGatewayStyleModelId(modelId);
  const effectiveTemperature = resolveEffectiveTemperature({
    model: parsed.model,
    provider: parsed.provider,
    temperature,
  });

  const documentResult = await maybeGenerateDocumentText({
    anthropicBaseUrlOverride,
    apiKeys,
    fetchImpl,
    forceChatCompletions,
    forceOpenRouter,
    googleBaseUrlOverride,
    maxOutputTokens,
    openaiBaseUrlOverride,
    parsed,
    prompt,
    requestOptions,
    retryWithModelId: (fallbackModelId) =>
      generateTextWithModelId({
        modelId: fallbackModelId,
        apiKeys,
        prompt,
        temperature,
        maxOutputTokens,
        timeoutMs,
        fetchImpl,
        forceOpenRouter,
        openaiBaseUrlOverride,
        anthropicBaseUrlOverride,
        googleBaseUrlOverride,
        xaiBaseUrlOverride,
        zaiBaseUrlOverride,
        forceChatCompletions,
        requestOptions,
        retries,
        onRetry,
      }),
    temperature: effectiveTemperature,
    timeoutMs,
  });
  if (documentResult) {
    return documentResult;
  }

  const context = promptToContext(prompt);

  const resolveOpenAiConfig = (
    provider: 'openai' | 'github-copilot' = 'openai',
  ): OpenAiClientConfig =>
    resolveOpenAiCompatibleClientConfigForProvider({
      forceChatCompletions,
      forceOpenRouter,
      openaiApiKey: apiKeys.openaiApiKey,
      openaiBaseUrlOverride,
      openrouterApiKey: apiKeys.openrouterApiKey,
      provider,
      requestOptions,
    });

  const completeSimpleText = async ({
    model,
    apiKey,
    signal,
  }: {
    model: Parameters<typeof completeSimple>[0];
    apiKey: string;
    signal: AbortSignal;
  }): Promise<{ text: string; usage: LlmTokenUsage | null }> => {
    const result = await completeSimple(model, context, {
      ...(typeof effectiveTemperature === 'number' ? { temperature: effectiveTemperature } : {}),
      ...(typeof maxOutputTokens === 'number' ? { maxTokens: maxOutputTokens } : {}),
      apiKey,
      signal,
    });
    const text = extractText(result);
    if (!text) {throw new Error(`LLM returned an empty summary (model ${parsed.canonical}).`);}
    return { text, usage: normalizeTokenUsage(result.usage) };
  };

  const maxRetries = Math.max(0, retries);
  let attempt = 0;

  while (attempt <= maxRetries) {
    const controller = new AbortController();
    const timeout = setTimeout(() =>{  controller.abort(); }, timeoutMs);
    try {
      if (parsed.provider === 'xai') {
        const apiKey = apiKeys.xaiApiKey;
        if (!apiKey) {throw new Error('Missing XAI_API_KEY for xai/... model');}
        const model = resolveXaiModel({ context, modelId: parsed.model, xaiBaseUrlOverride });
        const result = await completeSimple(model, context, {
          ...(typeof effectiveTemperature === 'number'
            ? { temperature: effectiveTemperature }
            : {}),
          ...(typeof maxOutputTokens === 'number' ? { maxTokens: maxOutputTokens } : {}),
          apiKey,
          signal: controller.signal,
        });
        const text = extractText(result);
        if (!text) {throw new Error(`LLM returned an empty summary (model ${parsed.canonical}).`);}
        return {
          canonicalModelId: parsed.canonical,
          provider: parsed.provider,
          text,
          usage: normalizeTokenUsage(result.usage),
        };
      }

      if (parsed.provider === 'google') {
        const apiKey = apiKeys.googleApiKey;
        if (!apiKey)
          {throw new Error(
            'Missing GEMINI_API_KEY (or GOOGLE_GENERATIVE_AI_API_KEY / GOOGLE_API_KEY) for google/... model',
          );}
        const result = await completeGoogleText({
          apiKey,
          context,
          googleBaseUrlOverride,
          maxOutputTokens,
          modelId: parsed.model,
          signal: controller.signal,
          temperature: effectiveTemperature,
        });
        return {
          canonicalModelId: parsed.canonical,
          provider: parsed.provider,
          text: result.text,
          usage: result.usage,
        };
      }

      if (parsed.provider === 'anthropic') {
        const apiKey = apiKeys.anthropicApiKey;
        if (!apiKey) {throw new Error('Missing ANTHROPIC_API_KEY for anthropic/... model');}
        const result = await completeAnthropicText({
          anthropicBaseUrlOverride,
          apiKey,
          context,
          maxOutputTokens,
          modelId: parsed.model,
          signal: controller.signal,
          temperature: effectiveTemperature,
        });
        return {
          canonicalModelId: parsed.canonical,
          provider: parsed.provider,
          text: result.text,
          usage: result.usage,
        };
      }

      if (parsed.provider === 'zai') {
        const openaiConfig = resolveOpenAiCompatibleClientConfigForProvider({
          openaiApiKey: apiKeys.openaiApiKey,
          openaiBaseUrlOverride: zaiBaseUrlOverride ?? openaiBaseUrlOverride,
          openrouterApiKey: apiKeys.openrouterApiKey,
          provider: 'zai',
          requestOptions,
        });
        const model = resolveZaiModel({
          context,
          modelId: parsed.model,
          openaiBaseUrlOverride: openaiConfig.baseURL,
        });
        const result = await completeSimpleText({
          apiKey: openaiConfig.apiKey,
          model,
          signal: controller.signal,
        });
        return {
          canonicalModelId: parsed.canonical,
          provider: parsed.provider,
          text: result.text,
          usage: result.usage,
        };
      }

      if (parsed.provider === 'nvidia') {
        const openaiConfig = resolveOpenAiCompatibleClientConfigForProvider({
          openaiApiKey: apiKeys.openaiApiKey,
          openaiBaseUrlOverride,
          openrouterApiKey: apiKeys.openrouterApiKey,
          provider: 'nvidia',
          requestOptions,
        });
        const model = resolveNvidiaModel({
          context,
          modelId: parsed.model,
          openaiBaseUrlOverride: openaiConfig.baseURL,
        });
        const result = await completeSimpleText({
          apiKey: openaiConfig.apiKey,
          model,
          signal: controller.signal,
        });
        return {
          canonicalModelId: parsed.canonical,
          provider: parsed.provider,
          text: result.text,
          usage: result.usage,
        };
      }

      if (parsed.provider === 'openai' || parsed.provider === 'github-copilot') {
        const openaiConfig = resolveOpenAiConfig(parsed.provider);
        const result = await completeOpenAiText({
          context,
          fetchImpl,
          maxOutputTokens,
          modelId: parsed.model,
          openaiConfig,
          signal: controller.signal,
          temperature: effectiveTemperature,
        });
        return {
          canonicalModelId: result.resolvedModelId
            ? `${parsed.provider}/${result.resolvedModelId}`
            : parsed.canonical,
          provider: parsed.provider,
          text: result.text,
          usage: result.usage,
        };
      }

      /* V8 ignore next */
      throw new Error(`Unknown provider ${parsed.provider}`);
    } catch (error) {
      const normalizedError =
        error instanceof DOMException && error.name === 'AbortError'
          ? new Error(`LLM request timed out after ${timeoutMs}ms (model ${parsed.canonical}).`)
          : error;
      const googleFallbackModelId =
        parsed.provider === 'google' &&
        isGoogleEmptySummaryError(normalizedError) &&
        resolveGoogleEmptyResponseFallbackModelId(parsed.canonical);
      if (
        shouldRetryGpt5WithoutTokenCap({
          error: normalizedError,
          maxOutputTokens,
          model: parsed.model,
          provider: parsed.provider,
        })
      ) {
        return generateTextWithModelId({
          anthropicBaseUrlOverride,
          apiKeys,
          fetchImpl,
          forceChatCompletions,
          forceOpenRouter,
          googleBaseUrlOverride,
          modelId: parsed.canonical,
          onRetry,
          openaiBaseUrlOverride,
          prompt,
          requestOptions,
          retries: Math.max(0, maxRetries - attempt),
          temperature,
          timeoutMs,
          xaiBaseUrlOverride,
          zaiBaseUrlOverride,
        });
      }
      if (googleFallbackModelId) {
        return generateTextWithModelId({
          anthropicBaseUrlOverride,
          apiKeys,
          fetchImpl,
          forceChatCompletions,
          forceOpenRouter,
          googleBaseUrlOverride,
          maxOutputTokens,
          modelId: googleFallbackModelId,
          onRetry,
          openaiBaseUrlOverride,
          prompt,
          requestOptions,
          retries: Math.max(0, maxRetries - attempt),
          temperature,
          timeoutMs,
          xaiBaseUrlOverride,
          zaiBaseUrlOverride,
        });
      }
      if (parsed.provider === 'anthropic') {
        const normalized = normalizeAnthropicModelAccessError(normalizedError, parsed.model);
        if (normalized) {throw normalized;}
      }
      if (isRetryableTimeoutError(normalizedError) && attempt < maxRetries) {
        const delayMs = computeRetryDelayMs(attempt);
        onRetry?.({ attempt: attempt + 1, delayMs, error: normalizedError, maxRetries });
        await sleep(delayMs);
        attempt += 1;
        continue;
      }
      throw normalizedError;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(`LLM request failed after ${maxRetries + 1} attempts.`);
}

export async function streamTextWithModelId({
  modelId,
  apiKeys,
  prompt,
  temperature,
  maxOutputTokens,
  timeoutMs,
  fetchImpl,
  forceOpenRouter,
  openaiBaseUrlOverride,
  anthropicBaseUrlOverride,
  googleBaseUrlOverride,
  xaiBaseUrlOverride,
  forceChatCompletions,
  requestOptions,
}: {
  modelId: string;
  apiKeys: LlmApiKeys;
  prompt: Prompt;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs: number;
  fetchImpl: typeof fetch;
  forceOpenRouter?: boolean;
  openaiBaseUrlOverride?: string | null;
  anthropicBaseUrlOverride?: string | null;
  googleBaseUrlOverride?: string | null;
  xaiBaseUrlOverride?: string | null;
  forceChatCompletions?: boolean;
  requestOptions?: ModelRequestOptions;
}): Promise<{
  textStream: AsyncIterable<string>;
  canonicalModelId: string;
  provider: LlmProvider;
  usage: Promise<LlmTokenUsage | null>;
  lastError: () => unknown;
}> {
  const context = promptToContext(prompt);
  return streamTextWithContext({
    anthropicBaseUrlOverride,
    apiKeys,
    context,
    fetchImpl,
    forceChatCompletions,
    forceOpenRouter,
    googleBaseUrlOverride,
    maxOutputTokens,
    modelId,
    openaiBaseUrlOverride,
    requestOptions,
    temperature,
    timeoutMs,
    xaiBaseUrlOverride,
  });
}
