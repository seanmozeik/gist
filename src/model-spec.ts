import type { CliProvider } from './config.js';
import { normalizeGatewayStyleModelId, parseGatewayStyleModelId } from './llm/model-id.js';
import type { LlmProvider } from './llm/model-id.js';
import type { ModelRequestOptions } from './llm/model-options.js';
import {
  DEFAULT_CLI_MODELS,
  type RequiredModelEnv,
  requiredEnvForCliProvider,
} from './llm/provider-capabilities.js';

export type FixedModelSpec =
  | {
      transport: 'native';
      userModelId: string;
      llmModelId: string;
      provider: LlmProvider;
      openrouterProviders: string[] | null;
      forceOpenRouter: false;
      requiredEnv: 'OPENROUTER_API_KEY' | null;
      openaiBaseUrlOverride?: string | null;
      forceChatCompletions?: boolean;
      requestOptions?: ModelRequestOptions;
    }
  | {
      transport: 'openrouter';
      userModelId: string;
      openrouterModelId: string;
      llmModelId: string;
      openrouterProviders: string[] | null;
      forceOpenRouter: true;
      requiredEnv: 'OPENROUTER_API_KEY';
      requestOptions?: ModelRequestOptions;
    }
  | {
      transport: 'cli';
      userModelId: string;
      llmModelId: null;
      openrouterProviders: null;
      forceOpenRouter: false;
      requiredEnv: 'CLI_CLAUDE' | 'CLI_CODEX' | 'CLI_GEMINI' | 'CLI_AGENT';
      cliProvider: CliProvider;
      cliModel: string | null;
    };

export type RequestedModel = { kind: 'auto' } | ({ kind: 'fixed' } & FixedModelSpec);

export function resolveOpenAiFastModelId(
  modelId: string,
): { modelId: string; options: ModelRequestOptions } | null {
  const normalized = modelId.trim();
  const match = /^(gpt-5\.[45](?:[-.][a-z0-9]+)*)-fast$/i.exec(normalized);
  if (!match) {
    return null;
  }
  return { modelId: match[1] ?? normalized, options: { serviceTier: 'fast' } };
}

export function parseRequestedModelId(raw: string): RequestedModel {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error('Missing model id');
  }

  const lower = trimmed.toLowerCase();
  if (lower === 'auto') {
    return { kind: 'auto' };
  }

  if (lower.startsWith('openrouter/')) {
    const openrouterModelId = trimmed.slice('openrouter/'.length).trim();
    if (openrouterModelId.length === 0) {
      throw new Error('Invalid model id: openrouter/… is missing the OpenRouter model id');
    }
    if (!openrouterModelId.includes('/')) {
      throw new Error(
        `Invalid OpenRouter model id "${openrouterModelId}". Expected "author/slug" (e.g. "openai/gpt-5-mini").`,
      );
    }
    return {
      forceOpenRouter: true,
      kind: 'fixed',
      llmModelId: `openai/${openrouterModelId}`,
      openrouterModelId,
      openrouterProviders: null,
      requiredEnv: 'OPENROUTER_API_KEY',
      transport: 'openrouter',
      userModelId: `openrouter/${openrouterModelId}`,
    };
  }

  if (lower.startsWith('nvidia/')) {
    const model = trimmed.slice('nvidia/'.length).trim();
    if (model.length === 0) {
      throw new Error('Invalid model id: nvidia/… is missing the model id');
    }
    return {
      kind: 'fixed',
      transport: 'native',
      userModelId: `nvidia/${model}`,
      llmModelId: `nvidia/${model}`,
      provider: 'local',
      openrouterProviders: null,
      forceOpenRouter: false,
      requiredEnv: 'OPENROUTER_API_KEY',
      openaiBaseUrlOverride: null,
      forceChatCompletions: true,
    };
  }

  if (lower.startsWith('cli/')) {
    const parts = trimmed
      .split('/')
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    const providerRaw = parts[1]?.toLowerCase() ?? '';
    if (
      providerRaw !== 'claude' &&
      providerRaw !== 'codex' &&
      providerRaw !== 'gemini' &&
      providerRaw !== 'agent'
    ) {
      throw new Error(`Invalid CLI model id "${trimmed}". Expected cli/<provider>/<model>.`);
    }
    const cliProvider = providerRaw as CliProvider;
    const requestedModel = parts.slice(2).join('/').trim();
    const cliModel = requestedModel.length > 0 ? requestedModel : DEFAULT_CLI_MODELS[cliProvider];
    const requiredEnv = requiredEnvForCliProvider(cliProvider) as Extract<
      RequiredModelEnv,
      'CLI_CLAUDE' | 'CLI_CODEX' | 'CLI_GEMINI' | 'CLI_AGENT'
    >;
    const userModelId = cliModel ? `cli/${cliProvider}/${cliModel}` : `cli/${cliProvider}`;
    return {
      cliModel,
      cliProvider,
      forceOpenRouter: false,
      kind: 'fixed',
      llmModelId: null,
      openrouterProviders: null,
      requiredEnv,
      transport: 'cli',
      userModelId,
    };
  }

  if (!trimmed.includes('/')) {
    const fastOpenAi = resolveOpenAiFastModelId(trimmed);
    if (fastOpenAi) {
      return {
        forceOpenRouter: false,
        kind: 'fixed',
        llmModelId: `openai/${fastOpenAi.modelId}`,
        openrouterProviders: null,
        provider: 'local',
        requestOptions: fastOpenAi.options,
        requiredEnv: 'OPENROUTER_API_KEY',
        transport: 'native',
        userModelId: trimmed,
      };
    }
    throw new Error(
      `Unknown model "${trimmed}". Expected "auto" or a provider-prefixed id like openrouter/... or cli/....`,
    );
  }

  const userModelId = normalizeGatewayStyleModelId(trimmed);
  const parsed = parseGatewayStyleModelId(userModelId);
  const llmModelId = userModelId;
  const requiredEnv = parsed.provider === 'local' ? null : ('OPENROUTER_API_KEY' as const);
  return {
    forceOpenRouter: false,
    kind: 'fixed',
    llmModelId,
    openrouterProviders: null,
    provider: parsed.provider,
    requiredEnv,
    transport: 'native',
    userModelId,
  };
}
