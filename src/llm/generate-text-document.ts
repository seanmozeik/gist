import { createUnsupportedFunctionalityError } from './errors';
import type { LlmProvider } from './model-id';
import type { ModelRequestOptions } from './model-options';
import type { Prompt } from './prompt';
import { resolveOpenAiCompatibleClientConfigForProvider } from './provider-capabilities';
import { completeOpenAiDocument } from './providers/openai';
import type { LlmTokenUsage } from './types';

interface ParsedModel {
  provider: LlmProvider;
  model: string;
  canonical: string;
}

interface DocumentResult {
  text: string;
  canonicalModelId: string;
  provider: ParsedModel['provider'];
  usage: LlmTokenUsage | null;
}

export async function maybeGenerateDocumentText(options: {
  parsed: ParsedModel;
  apiKeys: { openrouterApiKey: string | null };
  prompt: Prompt;
  maxOutputTokens?: number;
  temperature?: number;
  timeoutMs: number;
  fetchImpl: typeof fetch;
  forceOpenRouter?: boolean;
  openaiBaseUrlOverride?: string | null;
  forceChatCompletions?: boolean;
  requestOptions?: ModelRequestOptions;
  retryWithModelId: (modelId: string) => Promise<DocumentResult>;
}): Promise<DocumentResult | null> {
  const {
    parsed,
    apiKeys,
    prompt,
    maxOutputTokens,
    temperature,
    timeoutMs,
    fetchImpl,
    forceOpenRouter,
    forceChatCompletions,
    requestOptions,
  } = options;
  const attachments = prompt.attachments ?? [];
  const documentAttachment =
    attachments.find((attachment) => attachment.kind === 'document') ?? null;
  if (!documentAttachment) {
    return null;
  }
  if (attachments.length !== 1) {
    throw new Error('Internal error: document attachments cannot be combined with other inputs.');
  }

  // Only OpenRouter supports document attachments via OpenAI-compatible API
  if (parsed.provider !== 'openrouter') {
    throw createUnsupportedFunctionalityError(
      `document attachments are only supported for openrouter/... models`,
    );
  }

  const openaiConfig = resolveOpenAiCompatibleClientConfigForProvider({
    forceChatCompletions,
    forceOpenRouter,
    openaiApiKey: null,
    openrouterApiKey: apiKeys.openrouterApiKey,
    requestOptions,
  });

  const result = await completeOpenAiDocument({
    document: documentAttachment,
    fetchImpl,
    maxOutputTokens,
    modelId: parsed.model,
    openaiConfig,
    promptText: prompt.userText,
    temperature,
    timeoutMs,
  });
  return {
    canonicalModelId: parsed.canonical,
    provider: parsed.provider,
    text: result.text,
    usage: result.usage,
  };
}
