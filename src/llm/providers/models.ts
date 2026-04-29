import type { Api, Context, Model } from '@mariozechner/pi-ai';

import {
  createSyntheticModel,
  resolveBaseUrlOverride,
  tryGetModel,
  wantsImages,
} from './shared.js';
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

export function resolveZaiModel({
  modelId,
  context,
  openaiBaseUrlOverride,
}: {
  modelId: string;
  context: Context;
  openaiBaseUrlOverride?: string | null;
}): Model<Api> {
  const allowImages = wantsImages(context);
  const base = tryGetModel('zai', modelId);
  const api = 'openai-completions';
  const baseUrl = openaiBaseUrlOverride ?? base?.baseUrl ?? 'https://api.z.ai/api/paas/v4';
  return {
    ...(base ?? createSyntheticModel({ allowImages, api, baseUrl, modelId, provider: 'zai' })),
    api,
    baseUrl,
    input: allowImages ? ['text', 'image'] : ['text'],
  };
}

export function resolveNvidiaModel({
  modelId,
  context,
  openaiBaseUrlOverride,
}: {
  modelId: string;
  context: Context;
  openaiBaseUrlOverride?: string | null;
}): Model<Api> {
  const allowImages = wantsImages(context);
  // The NVIDIA Integrate API is OpenAI-compatible; treat it like an OpenAI gateway.
  const base = tryGetModel('openai', modelId);
  const api = 'openai-completions';
  const baseUrl = openaiBaseUrlOverride ?? base?.baseUrl ?? 'https://integrate.api.nvidia.com/v1';
  return {
    ...(base ?? createSyntheticModel({ allowImages, api, baseUrl, modelId, provider: 'openai' })),
    api,
    baseUrl,
    input: allowImages ? ['text', 'image'] : ['text'],
  };
}

export function resolveXaiModel({
  modelId,
  context,
  xaiBaseUrlOverride,
}: {
  modelId: string;
  context: Context;
  xaiBaseUrlOverride?: string | null;
}): Model<Api> {
  const allowImages = wantsImages(context);
  const base = tryGetModel('xai', modelId);
  const override = resolveBaseUrlOverride(xaiBaseUrlOverride);
  if (override) {
    return {
      ...(base ??
        createSyntheticModel({
          allowImages,
          api: 'openai-completions',
          baseUrl: override,
          modelId,
          provider: 'xai',
        })),
      baseUrl: override,
    };
  }
  return (
    base ??
    createSyntheticModel({
      allowImages,
      api: 'openai-completions',
      baseUrl: 'https://api.x.ai/v1',
      modelId,
      provider: 'xai',
    })
  );
}

export function resolveGoogleModel({
  modelId,
  context,
  googleBaseUrlOverride,
}: {
  modelId: string;
  context: Context;
  googleBaseUrlOverride?: string | null;
}): Model<Api> {
  const allowImages = wantsImages(context);
  const base = tryGetModel('google', modelId);
  const override = resolveBaseUrlOverride(googleBaseUrlOverride);
  if (override) {
    return {
      ...(base ??
        createSyntheticModel({
          allowImages,
          api: 'google-generative-ai',
          baseUrl: override,
          modelId,
          provider: 'google',
        })),
      baseUrl: override,
    };
  }
  return (
    base ??
    createSyntheticModel({
      allowImages,
      api: 'google-generative-ai',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      modelId,
      provider: 'google',
    })
  );
}

export function resolveAnthropicModel({
  modelId,
  context,
  anthropicBaseUrlOverride,
}: {
  modelId: string;
  context: Context;
  anthropicBaseUrlOverride?: string | null;
}): Model<Api> {
  const allowImages = wantsImages(context);
  const base = tryGetModel('anthropic', modelId);
  const override = resolveBaseUrlOverride(anthropicBaseUrlOverride);
  if (override) {
    return {
      ...(base ??
        createSyntheticModel({
          allowImages,
          api: 'anthropic-messages',
          baseUrl: override,
          modelId,
          provider: 'anthropic',
        })),
      baseUrl: override,
    };
  }
  return (
    base ??
    createSyntheticModel({
      allowImages,
      api: 'anthropic-messages',
      baseUrl: 'https://api.anthropic.com',
      modelId,
      provider: 'anthropic',
    })
  );
}
