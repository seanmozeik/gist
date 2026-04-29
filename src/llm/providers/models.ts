import type { Api, Context, Model } from '@mariozechner/pi-ai';

import { createSyntheticModel, tryGetModel, wantsImages } from './shared.js';
import type { OpenAiClientConfig } from './types.js';

export function resolveOpenAiModel({
  modelId,
  context,
  openaiConfig,
}: {
  modelId: string;
  context: Context;
  openaiConfig: OpenAiClientConfig;
}): Model<Api> {
  const allowImages = wantsImages(context);
  const base = tryGetModel('openai', modelId);
  const api = openaiConfig.useChatCompletions ? 'openai-completions' : 'openai-responses';
  const baseUrl = openaiConfig.baseURL ?? base?.baseUrl ?? 'https://api.openai.com/v1';
  const headers = openaiConfig.isOpenRouter
    ? {
        ...base?.headers,
        'HTTP-Referer': 'https://github.com/steipete/summarize',
        'X-Title': 'summarize',
      }
    : (openaiConfig.extraHeaders
      ? { ...(base?.headers ?? {}), ...openaiConfig.extraHeaders }
      : base?.headers);
  return {
    ...(base ?? createSyntheticModel({ allowImages, api, baseUrl, modelId, provider: 'openai' })),
    api,
    baseUrl,
    ...(headers ? { headers } : {}),
  };
}
