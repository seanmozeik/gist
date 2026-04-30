import { streamSimple } from '@mariozechner/pi-ai';
import type { Context } from '@mariozechner/pi-ai';

import { createUnsupportedFunctionalityError } from './errors';
import type { LlmApiKeys } from './generate-text';
import { resolveEffectiveTemperature, streamUsageWithTimeout } from './generate-text-shared';
import { parseGatewayStyleModelId } from './model-id';
import type { LlmProvider } from './model-id';
import type { ModelRequestOptions } from './model-options';
import { resolveOpenAiCompatibleClientConfigForProvider } from './provider-capabilities';
import { completeOpenAiText } from './providers/openai';
import type { OpenAiClientConfig } from './providers/types';
import type { LlmTokenUsage } from './types';

export interface StreamTextWithContextArgs {
  modelId: string;
  apiKeys: LlmApiKeys;
  context: Context;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  forceOpenRouter?: boolean;
  forceChatCompletions?: boolean;
  requestOptions?: ModelRequestOptions;
}

export interface StreamTextResult {
  textStream: AsyncIterable<string>;
  canonicalModelId: string;
  provider: LlmProvider;
  usage: Promise<LlmTokenUsage | null>;
  lastError: () => unknown;
}

function createTimedTextStream({
  textStream,
  timeoutMs,
  controller,
  setLastError,
}: {
  textStream: AsyncIterable<string>;
  timeoutMs: number;
  controller: AbortController;
  setLastError: (error: unknown) => void;
}): AsyncIterable<string> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const startedAtMs = Date.now();
  const timeoutError = new Error('LLM request timed out');
  const markTimedOut = () => {
    setLastError(timeoutError);
    controller.abort();
  };
  const startTimeout = () => {
    if (timeoutId) {
      return;
    }
    timeoutId = setTimeout(markTimedOut, timeoutMs);
  };
  const stopTimeout = () => {
    if (!timeoutId) {
      return;
    }
    clearTimeout(timeoutId);
    timeoutId = null;
  };
  const nextWithDeadline = async <T>(promise: Promise<T>): Promise<T> => {
    const elapsed = Date.now() - startedAtMs;
    const remaining = timeoutMs - elapsed;
    if (remaining <= 0) {
      markTimedOut();
      throw timeoutError;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            markTimedOut();
            reject(timeoutError);
          }, remaining);
        }),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  };

  return {
    async *[Symbol.asyncIterator]() {
      startTimeout();
      const iterator = textStream[Symbol.asyncIterator]();
      try {
        while (true) {
          const result = await nextWithDeadline(iterator.next());
          if (result.done) {
            break;
          }
          yield result.value;
        }
      } finally {
        stopTimeout();
        if (typeof iterator.return === 'function') {
          const cleanup = iterator.return();
          const cleanupPromise = cleanup === undefined ? undefined : (cleanup as Promise<unknown>);
          if (typeof cleanupPromise?.catch === 'function') {
            undefined;
          }
        }
      }
    },
  };
}

function collectTextDeltas({
  stream,
  onError,
}: {
  stream: AsyncIterable<{ type: string; delta?: string; error?: unknown }>;
  onError: (error: unknown) => void;
}): AsyncIterable<string> {
  return {
    async *[Symbol.asyncIterator]() {
      for await (const event of stream) {
        if (event.type === 'text_delta' && typeof event.delta === 'string') {
          yield event.delta;
        }
        if (event.type === 'error') {
          onError(event.error);
          break;
        }
      }
    },
  };
}

export async function streamTextWithContext({
  modelId,
  apiKeys,
  context,
  temperature,
  maxOutputTokens,
  timeoutMs,
  fetchImpl,
  forceOpenRouter,
  forceChatCompletions,
  requestOptions,
}: StreamTextWithContextArgs): Promise<StreamTextResult> {
  const parsed = parseGatewayStyleModelId(modelId);
  if (parsed.provider === 'local') {
    throw createUnsupportedFunctionalityError('streaming is not supported for local/... models');
  }

  const effectiveTemperature = resolveEffectiveTemperature({
    model: parsed.model,
    provider: parsed.provider,
    temperature,
  });

  const controller = new AbortController();
  let lastError: unknown = null;
  const setLastError = (error: unknown) => {
    if ((lastError as Error | null)?.message === 'LLM request timed out') {
      return;
    }
    lastError = error;
  };

  try {
    const openaiConfig: OpenAiClientConfig = resolveOpenAiCompatibleClientConfigForProvider({
      forceChatCompletions,
      forceOpenRouter,
      openaiApiKey: apiKeys.openrouterApiKey ? null : null,
      openrouterApiKey: apiKeys.openrouterApiKey,
      requestOptions,
    });

    if (fetchImpl) {
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
        lastError: () => lastError,
        provider: parsed.provider as LlmProvider,
        textStream: createTimedTextStream({
          controller,
          setLastError,
          textStream: {
            async *[Symbol.asyncIterator]() {
              yield result.text;
            },
          },
          timeoutMs,
        }),
        usage: Promise.resolve(result.usage),
      };
    }

    const openAiModel = await import('./providers/models.js').then((m) =>
      m.resolveOpenAiModel({ context, modelId: parsed.model, openaiConfig }),
    );
    const model = streamSimple(openAiModel, context, {
      ...(typeof effectiveTemperature === 'number' ? { temperature: effectiveTemperature } : {}),
      ...(typeof maxOutputTokens === 'number' ? { maxTokens: maxOutputTokens } : {}),
      apiKey: openaiConfig.apiKey,
      signal: controller.signal,
    });
    return {
      canonicalModelId: parsed.canonical,
      lastError: () => lastError,
      provider: parsed.provider as LlmProvider,
      textStream: createTimedTextStream({
        controller,
        setLastError,
        textStream: collectTextDeltas({
          onError: (error) => {
            lastError = error;
          },
          stream: model,
        }),
        timeoutMs,
      }),
      usage: streamUsageWithTimeout({ result: model.result(), timeoutMs }),
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('LLM request timed out', { cause: error });
    }
    throw error;
  }
}
