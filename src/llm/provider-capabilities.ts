import type { ModelRequestOptions } from './model-options.js';
import type { OpenAiClientConfig } from './providers/types.js';

// Re-export from provider-profile
export {
  DEFAULT_CLI_MODELS,
  requiredEnvForCliProvider,
  resolveRequiredEnvForModelId,
} from './provider-profile.js';

export type { RequiredModelEnv } from './provider-profile.js';

export function resolveOpenAiCompatibleClientConfigForProvider({
  forceChatCompletions,
  forceOpenRouter,
  openaiApiKey,
  openrouterApiKey,

  requestOptions,
}: {
  forceChatCompletions?: boolean;
  forceOpenRouter?: boolean;
  openaiApiKey: string | null;
  openrouterApiKey: string | null;

  requestOptions?: ModelRequestOptions;
}): OpenAiClientConfig {
  return resolveOpenAiClientConfig({
    apiKeys: { openaiApiKey, openrouterApiKey },
    forceChatCompletions,
    forceOpenRouter,
    openaiBaseUrlOverride: null,
    requestOptions,
  });
}

function resolveOpenAiClientConfig({
  apiKeys,
  forceChatCompletions,
  forceOpenRouter,
  openaiBaseUrlOverride,
  requestOptions,
}: {
  apiKeys: { openaiApiKey: string | null; openrouterApiKey: string | null };
  forceChatCompletions?: boolean;
  forceOpenRouter?: boolean;
  openaiBaseUrlOverride: string | null;
  requestOptions?: ModelRequestOptions;
}): OpenAiClientConfig {
  const useOpenRouter =
    forceOpenRouter ?? Boolean(apiKeys.openrouterApiKey && !apiKeys.openaiApiKey);

  if (useOpenRouter) {
    return {
      apiKey: apiKeys.openrouterApiKey ?? '',
      baseURL: 'https://openrouter.ai/api/v1',
      extraHeaders: {
        'HTTP-Referer': 'https://github.com/steipete/summarize',
        'X-Title': 'summarize',
      },
      isOpenRouter: true,
      useChatCompletions: forceChatCompletions ?? false,
      ...(requestOptions ? { requestOptions } : {}),
    };
  }

  const apiKey = apiKeys.openaiApiKey;
  if (!apiKey) {
    throw new Error('Missing OpenAI API key');
  }
  return {
    apiKey,
    baseURL: openaiBaseUrlOverride ?? 'https://api.openai.com/v1',
    isOpenRouter: false,
    useChatCompletions: forceChatCompletions ?? false,
    ...(requestOptions ? { requestOptions } : {}),
  };
}
