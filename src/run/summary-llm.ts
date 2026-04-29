import { generateTextWithModelId } from '../llm/generate-text.js';
import { resolveGoogleModelForUsage } from '../llm/google-models.js';
import type { LlmProvider } from '../llm/model-id.js';
import type { parseGatewayStyleModelId } from '../llm/model-id.js';
import type { ModelRequestOptions } from '../llm/model-options.js';
import type { Prompt } from '../llm/prompt.js';

export async function resolveModelIdForLlmCall({
  parsedModel,
  apiKeys,
  fetchImpl,
  timeoutMs,
}: {
  parsedModel: ReturnType<typeof parseGatewayStyleModelId>;
  apiKeys: { googleApiKey: string | null };
  fetchImpl: typeof fetch;
  timeoutMs: number;
}): Promise<{ modelId: string; note: string | null; forceStreamOff: boolean }> {
  if (parsedModel.provider !== 'google') {
    return { forceStreamOff: false, modelId: parsedModel.canonical, note: null };
  }

  const key = apiKeys.googleApiKey;
  if (!key) {
    return { forceStreamOff: false, modelId: parsedModel.canonical, note: null };
  }

  const resolved = await resolveGoogleModelForUsage({
    apiKey: key,
    fetchImpl,
    requestedModelId: parsedModel.model,
    timeoutMs,
  });

  return {
    forceStreamOff: false,
    modelId: `google/${resolved.resolvedModelId}`,
    note: resolved.note,
  };
}

export async function summarizeWithModelId({
  modelId,
  prompt,
  maxOutputTokens,
  timeoutMs,
  fetchImpl,
  apiKeys,
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
}: {
  modelId: string;
  prompt: Prompt;
  maxOutputTokens?: number;
  timeoutMs: number;
  fetchImpl: typeof fetch;
  apiKeys: {
    xaiApiKey: string | null;
    openaiApiKey: string | null;
    googleApiKey: string | null;
    anthropicApiKey: string | null;
    openrouterApiKey: string | null;
  };
  forceOpenRouter?: boolean;
  openaiBaseUrlOverride?: string | null;
  anthropicBaseUrlOverride?: string | null;
  googleBaseUrlOverride?: string | null;
  xaiBaseUrlOverride?: string | null;
  zaiBaseUrlOverride?: string | null;
  forceChatCompletions?: boolean;
  requestOptions?: ModelRequestOptions;
  retries: number;
  onRetry?: (notice: {
    attempt: number;
    maxRetries: number;
    delayMs: number;
    error: unknown;
  }) => void;
}): Promise<{
  text: string;
  provider: LlmProvider;
  canonicalModelId: string;
  usage: Awaited<ReturnType<typeof generateTextWithModelId>>['usage'];
}> {
  const result = await generateTextWithModelId({
    anthropicBaseUrlOverride,
    apiKeys,
    fetchImpl,
    forceChatCompletions,
    forceOpenRouter,
    googleBaseUrlOverride,
    maxOutputTokens,
    modelId,
    onRetry,
    openaiBaseUrlOverride,
    prompt,
    requestOptions,
    retries,
    temperature: 0,
    timeoutMs,
    xaiBaseUrlOverride,
    zaiBaseUrlOverride,
  });
  return {
    canonicalModelId: result.canonicalModelId,
    provider: result.provider,
    text: result.text,
    usage: result.usage,
  };
}
