import type { CliProvider, GistConfig } from './config';
import { normalizeGatewayStyleModelId, parseGatewayStyleModelId } from './llm/model-id';
import type { ModelAttempt } from './run/types';

const DEFAULT_OPENROUTER_MODELS = [
  'openrouter/meta/llama-3.3-70b-versatile',
  'openrouter/google/gemini-2.0-flash-lite',
  'openrouter/mistralai/mistral-large-instruct',
];

const VIDEO_UNDERSTANDING_MODELS = [
  'openrouter/openai/gpt-4o',
  'openrouter/google/gemini-2.0-flash-exp',
  ...DEFAULT_OPENROUTER_MODELS,
];

function selectConfiguredCandidates(options: {
  config: GistConfig | null;
  kind: 'video' | 'image' | 'text' | 'file';
  promptTokens: number | null;
}): string[] | null {
  const model = options.config?.model;
  if (!model || !('mode' in model) || model.mode !== 'auto' || !model.rules?.length) {
    return null;
  }

  for (const rule of model.rules) {
    if (rule.when?.length && !rule.when.includes(options.kind)) {
      continue;
    }

    if (rule.candidates?.length) {
      return rule.candidates;
    }

    if (rule.bands?.length) {
      for (const band of rule.bands) {
        const min = band.token?.min;
        const max = band.token?.max;
        const { promptTokens } = options;
        const matches =
          promptTokens === null
            ? min === undefined && max === undefined
            : (min === undefined || promptTokens >= min) &&
              (max === undefined || promptTokens <= max);
        if (matches) {
          return band.candidates;
        }
      }
    }
  }

  return null;
}

function buildGatewayModelAttempt(
  rawModelId: string,
  openrouterProviders: string[] | null,
): ModelAttempt {
  const userModelId = normalizeGatewayStyleModelId(rawModelId);
  const parsed = parseGatewayStyleModelId(userModelId);
  return {
    forceOpenRouter: parsed.provider === 'openrouter',
    llmModelId: parsed.canonical,
    openrouterProviders: parsed.provider === 'openrouter' ? openrouterProviders : null,
    requestOptions: undefined,
    requiredEnv: parsed.provider === 'openrouter' ? 'OPENROUTER_API_KEY' : null,
    transport: parsed.provider === 'openrouter' ? 'openrouter' : 'native',
    userModelId: parsed.canonical,
  };
}

export function buildAutoModelAttempts(options: {
  allowAutoCliFallback: boolean;
  cliAvailability: Partial<Record<CliProvider, boolean>>;
  config: GistConfig | null;
  desiredOutputTokens: number | null;
  env: Record<string, string | undefined>;
  isImplicitAutoSelection: boolean;
  kind: 'video' | 'image' | 'text' | 'file';
  lastSuccessfulCliProvider: CliProvider | null;
  openrouterProvidersFromEnv: string[] | null;
  promptTokens: number | null;
  requiresVideoUnderstanding: boolean;
}): ModelAttempt[] {
  const attempts: ModelAttempt[] = [];

  const models =
    selectConfiguredCandidates({
      config: options.config,
      kind: options.kind,
      promptTokens: options.promptTokens,
    }) ??
    (options.requiresVideoUnderstanding ? VIDEO_UNDERSTANDING_MODELS : DEFAULT_OPENROUTER_MODELS);

  for (const model of models) {
    attempts.push(buildGatewayModelAttempt(model, options.openrouterProvidersFromEnv));
  }

  // Add local sidecar attempt if configured
  const localBaseUrl =
    (globalThis as unknown as { __SIDECAR_BASE_URL?: string }).__SIDECAR_BASE_URL ??
    options.env?.GIST_LOCAL_BASE_URL ??
    options.config?.local?.baseUrl;
  if (localBaseUrl) {
    attempts.push({
      forceOpenRouter: false,
      llmModelId: null,
      openrouterProviders: null,
      requiredEnv: null,
      transport: 'native',
      userModelId: 'local/qwen2.5-7b', // Placeholder — local doesn't need API key
    });
  }

  // Add CLI fallback if enabled and available
  if (options.allowAutoCliFallback) {
    const availableCli = Object.entries(options.cliAvailability)
      .filter(([, available]) => available)
      .map(([provider]) => provider as CliProvider);

    for (const provider of availableCli) {
      attempts.push({
        cliProvider: provider,
        forceOpenRouter: false,
        llmModelId: null,
        openrouterProviders: null,
        requiredEnv: `CLI_${provider.toUpperCase()}` as ModelAttempt['requiredEnv'],
        transport: 'cli',
        userModelId: `cli/${provider}`,
      });
    }
  }

  return attempts;
}
