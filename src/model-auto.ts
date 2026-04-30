import type { CliProvider, GistConfig } from './config.js';
import type { ModelAttempt } from './run/types.js';

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

  // Build model list based on kind and requirements
  const models = options.requiresVideoUnderstanding
    ? VIDEO_UNDERSTANDING_MODELS
    : DEFAULT_OPENROUTER_MODELS;

  // Add openrouter attempts for each model
  for (const model of models) {
    attempts.push({
      forceOpenRouter: true,
      llmModelId: null,
      openrouterProviders: options.openrouterProvidersFromEnv,
      requestOptions: undefined,
      requiredEnv: 'OPENROUTER_API_KEY',
      transport: 'openrouter',
      userModelId: model,
    });
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
