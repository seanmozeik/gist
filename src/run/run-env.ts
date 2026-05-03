import type { CliProvider, GistConfig } from '../config';
import { isOpenRouterBaseUrl, resolveConfiguredBaseUrl } from '../openai/base-url';
import { resolveCliAvailability, resolveExecutableInPath } from './env';

export interface EnvState {
  apiKey: string | null;
  openrouterApiKey: string | null;
  openrouterConfigured: boolean;
  openaiApiKey: string | null;
  xaiApiKey: string | null;
  googleApiKey: string | null;
  anthropicApiKey: string | null;
  zaiApiKey: string | null;
  zaiBaseUrl: string;
  nvidiaApiKey: string | null;
  nvidiaBaseUrl: string;
  googleConfigured: boolean;
  anthropicConfigured: boolean;
  ytDlpPath: string | null;
  ytDlpCookiesFromBrowser: string | null;
  cliAvailability: Partial<Record<CliProvider, boolean>>;
  envForAuto: Record<string, string | undefined>;
  providerBaseUrls: {
    openai: string | null;
    nvidia: string | null;
    anthropic: string | null;
    google: string | null;
    xai: string | null;
  };
}

export function resolveEnvState({
  env,
  envForRun,
  configForCli,
}: {
  env: Record<string, string | undefined>;
  envForRun: Record<string, string | undefined>;
  configForCli: GistConfig | null;
}): EnvState {
  const xaiKeyRaw = typeof envForRun.XAI_API_KEY === 'string' ? envForRun.XAI_API_KEY : null;
  const openaiBaseUrl = resolveConfiguredBaseUrl({
    configValue: configForCli?.openai?.baseUrl,
    envValue: envForRun.OPENAI_BASE_URL,
  });
  const nvidiaBaseUrl = resolveConfiguredBaseUrl({
    configValue: null,
    envValue: envForRun.NVIDIA_BASE_URL,
  });
  const anthropicBaseUrl = resolveConfiguredBaseUrl({
    configValue: null,
    envValue: envForRun.ANTHROPIC_BASE_URL,
  });
  const googleBaseUrl = resolveConfiguredBaseUrl({
    configValue: null,
    envValue: envForRun.GOOGLE_BASE_URL ?? envForRun.GEMINI_BASE_URL,
  });
  const xaiBaseUrl = resolveConfiguredBaseUrl({
    configValue: null,
    envValue: envForRun.XAI_BASE_URL,
  });
  const zaiBaseUrl = resolveConfiguredBaseUrl({
    configValue: null,
    envValue:
      typeof envForRun.Z_AI_BASE_URL === 'string'
        ? envForRun.Z_AI_BASE_URL
        : (typeof envForRun.ZAI_BASE_URL === 'string'
          ? envForRun.ZAI_BASE_URL
          : null),
  });
  const zaiKeyRaw =
    typeof envForRun.Z_AI_API_KEY === 'string'
      ? envForRun.Z_AI_API_KEY
      : (typeof envForRun.ZAI_API_KEY === 'string'
        ? envForRun.ZAI_API_KEY
        : null);
  const openRouterKeyRaw =
    typeof envForRun.OPENROUTER_API_KEY === 'string' ? envForRun.OPENROUTER_API_KEY : null;
  const openaiKeyRaw =
    typeof envForRun.OPENAI_API_KEY === 'string' ? envForRun.OPENAI_API_KEY : null;
  const nvidiaKeyRaw =
    typeof envForRun.NVIDIA_API_KEY === 'string'
      ? envForRun.NVIDIA_API_KEY
      : (typeof envForRun.NGC_API_KEY === 'string'
        ? envForRun.NGC_API_KEY
        : null);
  const apiKey =
    typeof openaiBaseUrl === 'string' && isOpenRouterBaseUrl(openaiBaseUrl)
      ? (openRouterKeyRaw ?? openaiKeyRaw)
      : openaiKeyRaw;
  const ytDlpPath = (() => {
    const explicit = typeof envForRun.YT_DLP_PATH === 'string' ? envForRun.YT_DLP_PATH.trim() : '';
    if (explicit.length > 0) {
      return explicit;
    }
    return resolveExecutableInPath('yt-dlp', envForRun);
  })();
  const ytDlpCookiesFromBrowser = (() => {
    const raw =
      typeof envForRun.GIST_YT_DLP_COOKIES_FROM_BROWSER === 'string'
        ? envForRun.GIST_YT_DLP_COOKIES_FROM_BROWSER
        : (typeof envForRun.YT_DLP_COOKIES_FROM_BROWSER === 'string'
          ? envForRun.YT_DLP_COOKIES_FROM_BROWSER
          : '');
    const value = raw.trim();
    return value.length > 0 ? value : null;
  })();
  const anthropicKeyRaw =
    typeof envForRun.ANTHROPIC_API_KEY === 'string' ? envForRun.ANTHROPIC_API_KEY : null;
  const googleKeyRaw =
    typeof envForRun.GEMINI_API_KEY === 'string'
      ? envForRun.GEMINI_API_KEY
      : typeof envForRun.GOOGLE_GENERATIVE_AI_API_KEY === 'string'
        ? envForRun.GOOGLE_GENERATIVE_AI_API_KEY
        : typeof envForRun.GOOGLE_API_KEY === 'string'
          ? envForRun.GOOGLE_API_KEY
          : null;

  const xaiApiKey = xaiKeyRaw?.trim() ?? null;
  const zaiApiKey = zaiKeyRaw?.trim() ?? null;
  const zaiBaseUrlEffective = zaiBaseUrl?.trim() ?? 'https://api.z.ai/api/paas/v4';
  const nvidiaApiKey = nvidiaKeyRaw?.trim() ?? null;
  const nvidiaBaseUrlEffective = nvidiaBaseUrl?.trim() ?? 'https://integrate.api.nvidia.com/v1';
  const googleApiKey = googleKeyRaw?.trim() ?? null;
  const anthropicApiKey = anthropicKeyRaw?.trim() ?? null;
  const openrouterApiKey = (() => {
    const explicit = openRouterKeyRaw?.trim() ?? '';
    if (explicit.length > 0) {
      return explicit;
    }
    const baseUrl = openaiBaseUrl ?? '';
    const openaiKey = openaiKeyRaw?.trim() ?? '';
    if (baseUrl.length > 0 && isOpenRouterBaseUrl(baseUrl) && openaiKey.length > 0) {
      return openaiKey;
    }
    return null;
  })();
  const openaiApiKey = openaiKeyRaw?.trim() ?? null;
  const googleConfigured = typeof googleApiKey === 'string' && googleApiKey.length > 0;
  const anthropicConfigured = typeof anthropicApiKey === 'string' && anthropicApiKey.length > 0;
  const openrouterConfigured = typeof openrouterApiKey === 'string' && openrouterApiKey.length > 0;
  const cliAvailability = resolveCliAvailability({ config: configForCli, env });
  const envForAuto = openrouterApiKey
    ? { ...envForRun, OPENROUTER_API_KEY: openrouterApiKey }
    : envForRun;
  const providerBaseUrls = {
    anthropic: anthropicBaseUrl,
    google: googleBaseUrl,
    nvidia: nvidiaBaseUrl,
    openai: openaiBaseUrl,
    xai: xaiBaseUrl,
  };

  return {
    anthropicApiKey,
    anthropicConfigured,
    apiKey: apiKey?.trim() ?? null,
    cliAvailability,
    envForAuto,
    googleApiKey,
    googleConfigured,
    nvidiaApiKey,
    nvidiaBaseUrl: nvidiaBaseUrlEffective,
    openaiApiKey,
    openrouterApiKey,
    openrouterConfigured,
    providerBaseUrls,
    xaiApiKey,
    ytDlpCookiesFromBrowser,
    ytDlpPath,
    zaiApiKey,
    zaiBaseUrl: zaiBaseUrlEffective,
  };
}
