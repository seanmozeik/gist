import { describe, expect, it } from 'vitest';

import type { GistConfig } from '../src/config';
import { resolveEnvState } from '../src/run/run-env';

describe('resolveEnvState', () => {
  it('resolves various API keys and configurations from env and config', () => {
    const envForRun = {
      ANTHROPIC_API_KEY: 'sk-anthropic',
      APIFY_API_TOKEN: 'sk-apify',
      ASSEMBLYAI_API_KEY: 'sk-assemblyai',
      FAL_KEY: 'sk-fal',
      FIRECRAWL_API_KEY: 'sk-firecrawl',
      GEMINI_API_KEY: 'sk-gemini',
      GIST_YT_DLP_COOKIES_FROM_BROWSER: 'chrome',
      GROQ_API_KEY: 'sk-groq',
      NVIDIA_API_KEY: 'sk-nvidia',
      OPENAI_API_KEY: 'sk-openai',
      XAI_API_KEY: 'sk-xai',
      YT_DLP_PATH: '/custom/yt-dlp',
      ZAI_API_KEY: 'sk-zai',
    };

    const state = resolveEnvState({ configForCli: null, env: {}, envForRun });

    expect(state.openaiApiKey).toBe('sk-openai');
    expect(state.anthropicApiKey).toBe('sk-anthropic');
    expect(state.googleApiKey).toBe('sk-gemini');
    expect(state.groqApiKey).toBe('sk-groq');
    expect(state.assemblyaiApiKey).toBe('sk-assemblyai');
    expect(state.xaiApiKey).toBe('sk-xai');
    expect(state.zaiApiKey).toBe('sk-zai');
    expect(state.nvidiaApiKey).toBe('sk-nvidia');
    expect(state.falApiKey).toBe('sk-fal');
    expect(state.firecrawlApiKey).toBe('sk-firecrawl');
    expect(state.apifyToken).toBe('sk-apify');
    expect(state.ytDlpPath).toBe('/custom/yt-dlp');
    expect(state.ytDlpCookiesFromBrowser).toBe('chrome');
    expect(state.googleConfigured).toBe(true);
    expect(state.anthropicConfigured).toBe(true);
    expect(state.firecrawlConfigured).toBe(true);
  });

  it('handles alternative env var names (GEMINI/GOOGLE, Z_AI/ZAI, NGC/NVIDIA)', () => {
    const state = resolveEnvState({
      configForCli: null,
      env: {},
      envForRun: {
        GOOGLE_API_KEY: 'sk-google',
        NGC_API_KEY: 'sk-nvidia-alt',
        YT_DLP_COOKIES_FROM_BROWSER: 'firefox',
        Z_AI_API_KEY: 'sk-zai-alt',
      },
    });

    expect(state.googleApiKey).toBe('sk-google');
    expect(state.zaiApiKey).toBe('sk-zai-alt');
    expect(state.nvidiaApiKey).toBe('sk-nvidia-alt');
    expect(state.ytDlpCookiesFromBrowser).toBe('firefox');
  });

  it('handles OpenRouter specific logic', () => {
    // Case 1: OpenRouter via base URL
    const state1 = resolveEnvState({
      configForCli: null,
      env: {},
      envForRun: { OPENAI_BASE_URL: 'https://openrouter.ai/api/v1', OPENROUTER_API_KEY: 'sk-or' },
    });
    expect(state1.openrouterApiKey).toBe('sk-or');
    expect(state1.apiKey).toBe('sk-or');

    // Case 2: OpenRouter via base URL but using OPENAI_API_KEY
    const state2 = resolveEnvState({
      configForCli: null,
      env: {},
      envForRun: {
        OPENAI_API_KEY: 'sk-openai-as-or',
        OPENAI_BASE_URL: 'https://openrouter.ai/api/v1',
      },
    });
    expect(state2.openrouterApiKey).toBe('sk-openai-as-or');
    expect(state2.apiKey).toBe('sk-openai-as-or');

    // Case 3: Explicit OPENROUTER_API_KEY without base URL override
    const state3 = resolveEnvState({
      configForCli: null,
      env: {},
      envForRun: { OPENROUTER_API_KEY: 'sk-or-explicit' },
    });
    expect(state3.openrouterApiKey).toBe('sk-or-explicit');
    expect(state3.apiKey).toBeNull(); // ApiKey follows OpenAI logic
  });

  it('resolves base URLs from env and config', () => {
    const state = resolveEnvState({
      configForCli: { nvidia: { baseUrl: 'https://custom-nvidia.com' } } satisfies GistConfig,
      env: {},
      envForRun: {
        GOOGLE_BASE_URL: 'https://custom-google.com',
        OPENAI_BASE_URL: 'https://custom-openai.com',
      },
    });

    expect(state.providerBaseUrls.openai).toBe('https://custom-openai.com');
    expect(state.providerBaseUrls.google).toBe('https://custom-google.com');
    expect(state.nvidiaBaseUrl).toBe('https://custom-nvidia.com');
  });

  it('trims whitespace from keys', () => {
    const state = resolveEnvState({
      configForCli: null,
      env: {},
      envForRun: { GROQ_API_KEY: '  ', OPENAI_API_KEY: '  sk-trim  ' },
    });

    expect(state.openaiApiKey).toBe('sk-trim');
    expect(state.groqApiKey).toBeNull();
  });
});
