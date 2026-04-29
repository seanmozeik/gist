import { generateTextWithModelId } from '../llm/generate-text.js';
import type { LlmProvider } from '../llm/model-id.js';
import type { ModelRequestOptions } from '../llm/model-options.js';
import type { Prompt } from '../llm/prompt.js';

export async function resolveModelIdForLlmCall({
  parsedModel,
}: {
  parsedModel: { provider: LlmProvider; model: string; canonical: string };
}): Promise<{ modelId: string; note: string | null; forceStreamOff: boolean }> {
  return { forceStreamOff: false, modelId: parsedModel.canonical, note: null };
}

export async function summarizeWithModelId({
  modelId,
  apiKeys,
  prompt,
  temperature,
  maxOutputTokens,
  timeoutMs,
  fetchImpl,
  forceOpenRouter,
  openaiBaseUrlOverride,
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
  forceChatCompletions?: boolean;
  requestOptions?: ModelRequestOptions;
}) {
  return generateTextWithModelId({
    apiKeys,
    fetchImpl,
    forceChatCompletions,
    forceOpenRouter,
    maxOutputTokens,
    modelId,
    openaiBaseUrlOverride,
    prompt,
    requestOptions,
    temperature,
    timeoutMs,
  });
}
