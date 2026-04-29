import { maybeGenerateDocumentText } from './generate-text-document.js';
import {
  computeRetryDelayMs,
  isRetryableTimeoutError,
  promptToContext,
  resolveEffectiveTemperature,
  sleep,
} from './generate-text-shared.js';
import { streamTextWithContext } from './generate-text-stream.js';
import { parseGatewayStyleModelId } from './model-id.js';
import type { LlmProvider } from './model-id.js';
import type { ModelRequestOptions } from './model-options.js';
import type { Prompt } from './prompt.js';
import { resolveOpenAiCompatibleClientConfigForProvider } from './provider-capabilities.js';
import { completeOpenAiText } from './providers/openai.js';
import type { OpenAiClientConfig } from './providers/types.js';
import type { LlmTokenUsage } from './types.js';

export { streamTextWithContext } from './generate-text-stream.js';

export interface LlmApiKeys {
  openrouterApiKey: string | null;
}

export interface OpenRouterOptions {
  providers: string[] | null;
}

export type { LlmTokenUsage } from './types.js';

interface RetryNotice {
  attempt: number;
  maxRetries: number;
  delayMs: number;
  error: unknown;
}

export async function generateTextWithModelId({
  modelId,
  apiKeys,
  prompt,
  temperature,
  maxOutputTokens,
  timeoutMs,
  fetchImpl,
  forceOpenRouter,

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

  // Document handling (e.g. Anthropic document API) — only for openrouter
  if (parsed.provider === 'openrouter') {
    const documentResult = await maybeGenerateDocumentText({
      apiKeys,
      fetchImpl,
      forceChatCompletions,
      forceOpenRouter,
      maxOutputTokens,

      parsed,
      prompt,
      requestOptions,
      retryWithModelId: (fallbackModelId) =>
        generateTextWithModelId({
          apiKeys,
          fetchImpl,
          forceChatCompletions,
          forceOpenRouter,
          maxOutputTokens,
          modelId: fallbackModelId,
          onRetry,
          prompt,

          requestOptions,
          retries,
          temperature,
          timeoutMs,
        }),
      temperature: effectiveTemperature,
      timeoutMs,
    });
    if (documentResult) {
      return documentResult;
    }
  }

  const context = promptToContext(prompt);

  const resolveOpenAiConfig = (): OpenAiClientConfig =>
    resolveOpenAiCompatibleClientConfigForProvider({
      forceChatCompletions,
      forceOpenRouter,
      openaiApiKey: null,
      openrouterApiKey: apiKeys.openrouterApiKey,
      requestOptions,
    });

  const maxRetries = Math.max(0, retries);
  let attempt = 0;

  while (attempt <= maxRetries) {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    try {
      if (parsed.provider === 'openrouter') {
        const openaiConfig = resolveOpenAiConfig();
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
            ? `openrouter/${result.resolvedModelId}`
            : parsed.canonical,
          provider: parsed.provider,
          text: result.text,
          usage: result.usage,
        };
      }

      if (parsed.provider === 'local') {
        // Sidecar chat — POST to /v1/chat/completions
        const baseUrl = (globalThis as unknown as { __SIDECAR_BASE_URL?: string })
          .__SIDECAR_BASE_URL;
        if (!baseUrl) {
          throw new Error('Local sidecar not configured. Set SUMMARIZE_LOCAL_BASE_URL env var.');
        }
        const url = `${baseUrl}/v1/chat/completions`;
        const messages: { role: string; content: string }[] = [];
        if (prompt.system) {
          messages.push({ content: prompt.system, role: 'system' });
        }
        messages.push({ content: prompt.userText, role: 'user' });
        const body: Record<string, unknown> = { messages, model: parsed.model, stream: false };
        if (typeof effectiveTemperature === 'number') {
          body.temperature = effectiveTemperature;
        }
        if (typeof maxOutputTokens === 'number') {
          body.max_tokens = maxOutputTokens;
        }

        const response = await fetchImpl(url, {
          body: JSON.stringify(body),
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
          signal: controller.signal,
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Sidecar error (${response.status}): ${text.slice(0, 500)}`);
        }

        const json = (await response.json()) as {
          choices?: { message?: { content?: string } }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };

        const text = json.choices?.[0]?.message?.content;
        if (!text) {
          throw new Error(`Sidecar returned an empty summary (model ${parsed.canonical}).`);
        }

        const usage = json.usage
          ? {
              completionTokens: json.usage.completion_tokens ?? 0,
              promptTokens: json.usage.prompt_tokens ?? 0,
              totalTokens: (json.usage.prompt_tokens ?? 0) + (json.usage.completion_tokens ?? 0),
            }
          : null;

        return { canonicalModelId: parsed.canonical, provider: parsed.provider, text, usage };
      }

      /* V8 ignore next */
      throw new Error(`Unknown provider ${parsed.provider}`);
    } catch (error) {
      const normalizedError =
        error instanceof DOMException && error.name === 'AbortError'
          ? new Error(`LLM request timed out after ${timeoutMs}ms (model ${parsed.canonical}).`)
          : error;
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
    apiKeys,
    context,
    fetchImpl,
    forceChatCompletions,
    forceOpenRouter,
    maxOutputTokens,
    modelId,

    requestOptions,
    temperature,
    timeoutMs,
  });
}
