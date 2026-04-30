import { generateTextWithModelId } from '../llm/generate-text';
import type { LlmProvider } from '../llm/model-id';
import type { ModelRequestOptions } from '../llm/model-options';
import type { Prompt } from '../llm/prompt';

export async function resolveModelIdForLlmCall({
  parsedModel,
}: {
  parsedModel: { provider: LlmProvider; model: string; canonical: string };
}): Promise<{ modelId: string; note: string | null; forceStreamOff: boolean }> {
  return { forceStreamOff: false, modelId: parsedModel.canonical, note: null };
}

export async function gistWithModelId({
  modelId,
  apiKeys,
  prompt,
  temperature,
  maxOutputTokens,
  timeoutMs,
  fetchImpl,
  forceOpenRouter,
  openaiBaseUrlOverride,
  localBaseUrl,
  forceChatCompletions,
  requestOptions,
}: {
  modelId: string;
  apiKeys: { openrouterApiKey: string | null };
  prompt: Prompt;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs: number;
  fetchImpl: typeof fetch;
  forceOpenRouter?: boolean;
  openaiBaseUrlOverride?: string | null;
  localBaseUrl?: string | null;
  forceChatCompletions?: boolean;
  requestOptions?: ModelRequestOptions;
}) {
  return generateTextWithModelId({
    apiKeys,
    fetchImpl,
    forceChatCompletions,
    forceOpenRouter,
    localBaseUrl,
    maxOutputTokens,
    modelId,
    openaiBaseUrlOverride,
    prompt,
    requestOptions,
    temperature,
    timeoutMs,
  });
}
