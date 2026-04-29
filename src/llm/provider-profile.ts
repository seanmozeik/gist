import type { CliProvider } from '../config.js';

export type RequiredModelEnv =
  | 'OPENROUTER_API_KEY'
  | 'CLI_CLAUDE'
  | 'CLI_CODEX'
  | 'CLI_GEMINI'
  | 'CLI_AGENT';

export const DEFAULT_CLI_MODELS: Record<CliProvider, string> = {
  agent: 'claude-sonnet-4-20250514',
  claude: 'claude-sonnet-4-20250514',
  codex: 'gpt-5.5',
  gemini: 'gemini-2.5-pro',
};

export function requiredEnvForCliProvider(provider: CliProvider): RequiredModelEnv {
  return `CLI_${provider.toUpperCase()}` as RequiredModelEnv;
}

export function resolveRequiredEnvForModelId(modelId: string): RequiredModelEnv | null {
  if (!modelId.startsWith('cli/')) {
    return null;
  }
  const parts = modelId.split('/');
  const provider = parts[1]?.toLowerCase();
  if (provider && DEFAULT_CLI_MODELS[provider as CliProvider]) {
    return `CLI_${provider.toUpperCase()}` as RequiredModelEnv;
  }
  return null;
}
