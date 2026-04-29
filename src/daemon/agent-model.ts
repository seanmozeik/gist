import type { Api, Model } from '@mariozechner/pi-ai';
import { getModel } from '@mariozechner/pi-ai';
import { isOpenRouterBaseUrl } from '@steipete/summarize-core';

import { createSyntheticModel } from '../llm/providers/shared.js';
import { buildAutoModelAttempts, envHasKey } from '../model-auto.js';
import { parseCliUserModelId } from '../run/env.js';
import { resolveRunContextState } from '../run/run-context.js';
import { resolveModelSelection } from '../run/run-models.js';
import { resolveRunOverrides } from '../run/run-settings.js';

interface AgentApiKeys {
  openaiApiKey: string | null;
  openrouterApiKey: string | null;
  anthropicApiKey: string | null;
  googleApiKey: string | null;
  xaiApiKey: string | null;
  zaiApiKey: string | null;
  nvidiaApiKey: string | null;
}

const REQUIRED_ENV_BY_PROVIDER: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  google: 'GEMINI_API_KEY',
  nvidia: 'NVIDIA_API_KEY',
  openai: 'OPENAI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  xai: 'XAI_API_KEY',
  zai: 'Z_AI_API_KEY',
};

function parseProviderModelId(modelId: string): { provider: string; model: string } {
  const trimmed = modelId.trim();
  const slash = trimmed.indexOf('/');
  if (slash === -1) {
    return { model: trimmed, provider: 'openai' };
  }
  return { model: trimmed.slice(slash + 1), provider: trimmed.slice(0, slash) };
}

function isCustomOpenAiBaseUrl(baseUrl: string | null): boolean {
  if (!baseUrl) {return false;}
  try {
    return new URL(baseUrl).host !== 'api.openai.com';
  } catch {
    return false;
  }
}

function overrideModelGatewaySettings({
  provider,
  model,
  baseUrl,
  forceOpenAiChatCompletions,
}: {
  provider: string;
  model: Model<Api>;
  baseUrl: string | null;
  forceOpenAiChatCompletions: boolean;
}) {
  const nextModel = baseUrl ? ({ ...model, baseUrl } as Model<Api>) : model;
  if (provider !== 'openai') {return nextModel;}
  const effectiveBaseUrl =
    typeof nextModel.baseUrl === 'string' && nextModel.baseUrl.trim().length > 0
      ? nextModel.baseUrl.trim()
      : null;
  const shouldUseChatCompletions =
    forceOpenAiChatCompletions ||
    isCustomOpenAiBaseUrl(effectiveBaseUrl) ||
    (effectiveBaseUrl !== null && isOpenRouterBaseUrl(effectiveBaseUrl));
  if (!shouldUseChatCompletions) {return nextModel;}
  const headers =
    effectiveBaseUrl !== null && isOpenRouterBaseUrl(effectiveBaseUrl)
      ? {
          ...(nextModel).headers,
          'HTTP-Referer': 'https://github.com/steipete/summarize',
          'X-Title': 'summarize',
        }
      : (nextModel).headers;
  return { ...nextModel, api: 'openai-completions', ...(headers ? { headers } : {}) } as Model<Api>;
}

function resolveModelWithFallback({
  provider,
  modelId,
  baseUrl,
  forceOpenAiChatCompletions,
}: {
  provider: string;
  modelId: string;
  baseUrl: string | null;
  forceOpenAiChatCompletions: boolean;
}): Model<Api> {
  try {
    const model = getModel(provider as never, modelId as never);
    if (!model) {throw new Error(`Model not found: ${provider}/${modelId}`);}
    return overrideModelGatewaySettings({
      baseUrl,
      forceOpenAiChatCompletions,
      model: model as Model<Api>,
      provider,
    });
  } catch (error) {
    if (baseUrl) {
      return createSyntheticModel({
        allowImages: false,
        api: 'openai-completions',
        baseUrl,
        modelId,
        provider: provider as never,
      });
    }
    if (provider === 'openrouter') {
      return createSyntheticModel({
        allowImages: false,
        api: 'openai-completions',
        baseUrl: 'https://openrouter.ai/api/v1',
        modelId,
        provider: 'openrouter',
      });
    }
    throw error;
  }
}

export function resolveApiKeyForModel({
  provider,
  apiKeys,
}: {
  provider: string;
  apiKeys: AgentApiKeys;
}): string {
  const resolved = (() => {
    switch (provider) {
      case 'openrouter': {
        return apiKeys.openrouterApiKey;
      }
      case 'openai': {
        return apiKeys.openaiApiKey;
      }
      case 'nvidia': {
        return apiKeys.nvidiaApiKey;
      }
      case 'anthropic': {
        return apiKeys.anthropicApiKey;
      }
      case 'google': {
        return apiKeys.googleApiKey;
      }
      case 'xai': {
        return apiKeys.xaiApiKey;
      }
      case 'zai': {
        return apiKeys.zaiApiKey;
      }
      default: {
        return null;
      }
    }
  })();

  if (resolved) {return resolved;}
  const requiredEnv = REQUIRED_ENV_BY_PROVIDER[provider];
  if (requiredEnv) {
    throw new Error(`Missing ${requiredEnv} for ${provider} model`);
  }
  throw new Error(`Missing API key for provider: ${provider}`);
}

function buildNoAgentModelAvailableError({
  attempts,
  envForAuto,
  cliAvailability,
}: {
  attempts: {
    transport: 'native' | 'openrouter' | 'cli';
    userModelId: string;
    requiredEnv: string;
  }[];
  envForAuto: Record<string, string | undefined>;
  cliAvailability: {
    claude?: boolean;
    codex?: boolean;
    gemini?: boolean;
    agent?: boolean;
    openclaw?: boolean;
    opencode?: boolean;
  };
}): Error {
  const checked = attempts.map((attempt) => attempt.userModelId);
  const missingEnv = [...new Set(attempts.filter((attempt) => attempt.transport !== 'cli').map((attempt) => attempt.requiredEnv).filter((requiredEnv) => !envHasKey(envForAuto, requiredEnv as never)))];
  const unavailableCli = [...new Set(attempts.filter((attempt) => attempt.transport === 'cli').map((attempt) => {
	if (attempt.requiredEnv === 'CLI_CLAUDE') return 'claude';
	if (attempt.requiredEnv === 'CLI_CODEX') return 'codex';
	if (attempt.requiredEnv === 'CLI_GEMINI') return 'gemini';
	if (attempt.requiredEnv === 'CLI_AGENT') return 'agent';
	if (attempt.requiredEnv === 'CLI_OPENCLAW') return 'openclaw';
	return 'opencode';
}).filter((provider) => !cliAvailability[provider]))];

  const details = [
    'No model available for agent.',
    checked.length > 0 ? `Checked: ${checked.join(', ')}.` : null,
    missingEnv.length > 0 ? `Missing env: ${missingEnv.join(', ')}.` : null,
    unavailableCli.length > 0 ? `CLI unavailable: ${unavailableCli.join(', ')}.` : null,
    'Restart or reinstall the daemon after changing API keys or CLI installs so its saved environment updates.',
  ]
    .filter((part): part is string => Boolean(part))
    .join(' ');

  return new Error(details);
}

export async function resolveAgentModel({
  env,
  pageContent,
  modelOverride,
}: {
  env: Record<string, string | undefined>;
  pageContent: string;
  modelOverride: string | null;
}) {
  const {
    config,
    configPath,
    configForCli,
    apiKey,
    openrouterApiKey,
    anthropicApiKey,
    googleApiKey,
    xaiApiKey,
    zaiApiKey,
    providerBaseUrls,
    zaiBaseUrl,
    nvidiaApiKey,
    nvidiaBaseUrl,
    envForAuto,
    cliAvailability,
    openaiUseChatCompletions,
  } = resolveRunContextState({
    cliFlagPresent: false,
    cliProviderArg: null,
    env,
    envForRun: env,
    languageExplicitlySet: false,
    programOpts: { videoMode: 'auto' },
    videoModeExplicitlySet: false,
  });

  const apiKeys: AgentApiKeys = {
    anthropicApiKey,
    googleApiKey,
    nvidiaApiKey,
    openaiApiKey: apiKey,
    openrouterApiKey,
    xaiApiKey,
    zaiApiKey,
  };

  const overrides = resolveRunOverrides({});
  const maxOutputTokens = overrides.maxOutputTokensArg ?? 2048;

  const { requestedModel, configForModelSelection, isFallbackModel } = resolveModelSelection({
    config,
    configForCli,
    configPath,
    envForRun: env,
    explicitModelArg: modelOverride,
  });

  const providerBaseUrlMap: Record<string, string | null> = {
    anthropic: providerBaseUrls.anthropic,
    google: providerBaseUrls.google,
    nvidia: nvidiaBaseUrl,
    openai: providerBaseUrls.openai,
    xai: providerBaseUrls.xai,
    zai: zaiBaseUrl,
  };

  const applyBaseUrlOverride = (provider: string, modelId: string) => {
    const baseUrl = providerBaseUrlMap[provider] ?? null;
    const providerForPiAi = provider === 'nvidia' ? 'openai' : provider;
    return {
      model: resolveModelWithFallback({
        provider: providerForPiAi,
        modelId,
        baseUrl,
        forceOpenAiChatCompletions: provider === 'openai' && openaiUseChatCompletions,
      }),
      provider,
    };
  };

  if (requestedModel.kind === 'fixed') {
    if (requestedModel.transport === 'cli') {
      return {
        apiKeys,
        cliConfig: configForCli?.cli ?? null,
        cliModel: requestedModel.cliModel,
        cliProvider: requestedModel.cliProvider,
        maxOutputTokens,
        model: null,
        provider: 'cli',
        transport: 'cli' as const,
        userModelId: requestedModel.userModelId,
      };
    }
    if (requestedModel.transport === 'openrouter') {
      const resolved = applyBaseUrlOverride('openrouter', requestedModel.openrouterModelId);
      return { ...resolved, apiKeys, maxOutputTokens };
    }

    const { provider, model } = parseProviderModelId(requestedModel.llmModelId);
    const resolved = applyBaseUrlOverride(provider, model);
    return { ...resolved, apiKeys, maxOutputTokens };
  }

  if (!isFallbackModel) {
    throw buildNoAgentModelAvailableError({ attempts: [], cliAvailability, envForAuto });
  }

  const estimatedPromptTokens = Math.ceil(pageContent.length / 4);
  const attempts = buildAutoModelAttempts({
    catalog: null,
    cliAvailability,
    config: configForModelSelection,
    desiredOutputTokens: maxOutputTokens,
    env: envForAuto,
    kind: 'website',
    openrouterProvidersFromEnv: null,
    promptTokens: estimatedPromptTokens,
    requiresVideoUnderstanding: false,
  });

  let cliAttempt: (typeof attempts)[number] | null = null;
  for (const attempt of attempts) {
    if (attempt.transport === 'cli') {
      cliAttempt ??= attempt;
      continue;
    }
    if (!envHasKey(envForAuto, attempt.requiredEnv)) {continue;}
    if (attempt.transport === 'openrouter') {
      const modelId = attempt.userModelId.replace(/^openrouter\//i, '');
      const resolved = applyBaseUrlOverride('openrouter', modelId);
      return { ...resolved, apiKeys, maxOutputTokens };
    }
    if (!attempt.llmModelId) {continue;}
    const { provider, model } = parseProviderModelId(attempt.llmModelId);
    const resolved = applyBaseUrlOverride(provider, model);
    return { ...resolved, apiKeys, maxOutputTokens };
  }

  if (cliAttempt) {
    const parsed = parseCliUserModelId(cliAttempt.userModelId);
    if (!cliAvailability[parsed.provider]) {
      throw buildNoAgentModelAvailableError({ attempts, cliAvailability, envForAuto });
    }
    return {
      apiKeys,
      cliConfig: configForCli?.cli ?? null,
      cliModel: parsed.model,
      cliProvider: parsed.provider,
      maxOutputTokens,
      model: null,
      provider: 'cli',
      transport: 'cli' as const,
      userModelId: cliAttempt.userModelId,
    };
  }

  throw buildNoAgentModelAvailableError({ attempts, cliAvailability, envForAuto });
}
