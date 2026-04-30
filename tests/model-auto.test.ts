import { describe, expect, it } from 'vitest';

import type { GistConfig } from '../src/config.js';
import { prependCliCandidates, resolveCliAutoFallbackConfig } from '../src/model-auto-cli.js';
import { buildAutoModelAttempts } from '../src/model-auto.js';

describe('auto model selection', () => {
  it('preserves candidate order (native then OpenRouter fallback)', () => {
    const config: GistConfig = {
      model: { mode: 'auto', rules: [{ candidates: ['openai/gpt-5-mini', 'xai/grok-4-fast'] }] },
    };
    const attempts = buildAutoModelAttempts({
      catalog: null,
      config,
      desiredOutputTokens: 50,
      env: { OPENROUTER_API_KEY: 'sk-or-test' },
      kind: 'text',
      openrouterModelIds: ['openai/gpt-5-mini', 'x-ai/grok-4-fast'],
      openrouterProvidersFromEnv: null,
      promptTokens: 100,
      requiresVideoUnderstanding: false,
    });

    expect(attempts[0]?.userModelId).toBe('openai/gpt-5-mini');
    expect(attempts[1]?.userModelId).toBe('openrouter/openai/gpt-5-mini');
    expect(attempts[2]?.userModelId).toBe('xai/grok-4-fast');
    expect(attempts[3]?.userModelId).toBe('openrouter/x-ai/grok-4-fast');
  });

  it('skips OpenRouter fallback when no mapping is found', () => {
    const config: GistConfig = {
      model: { mode: 'auto', rules: [{ candidates: ['xai/grok-4-fast-non-reasoning'] }] },
    };
    const attempts = buildAutoModelAttempts({
      catalog: null,
      config,
      desiredOutputTokens: 50,
      env: { OPENROUTER_API_KEY: 'sk-or-test' },
      kind: 'text',
      openrouterModelIds: ['openai/gpt-5-mini', 'x-ai/grok-4-fast'],
      openrouterProvidersFromEnv: null,
      promptTokens: 100,
      requiresVideoUnderstanding: false,
    });

    expect(attempts.map((a) => a.userModelId)).toEqual(['xai/grok-4-fast-non-reasoning']);
  });

  it('skips OpenRouter fallback when multiple OpenRouter ids match the same slug', () => {
    const config: GistConfig = {
      model: { mode: 'auto', rules: [{ candidates: ['xai/grok-4-fast'] }] },
    };
    const attempts = buildAutoModelAttempts({
      catalog: null,
      config,
      desiredOutputTokens: 50,
      env: { OPENROUTER_API_KEY: 'sk-or-test' },
      kind: 'text',
      openrouterModelIds: ['x-ai/grok-4-fast', 'other/grok-4-fast'],
      openrouterProvidersFromEnv: null,
      promptTokens: 100,
      requiresVideoUnderstanding: false,
    });

    expect(attempts.map((a) => a.userModelId)).toEqual(['xai/grok-4-fast']);
  });

  it('matches OpenRouter ids when punctuation differs in slug', () => {
    const config: GistConfig = {
      model: { mode: 'auto', rules: [{ candidates: ['xai/grok-4-1-fast'] }] },
    };
    const attempts = buildAutoModelAttempts({
      catalog: null,
      config,
      desiredOutputTokens: 50,
      env: { OPENROUTER_API_KEY: 'sk-or-test' },
      kind: 'text',
      openrouterModelIds: ['x-ai/grok-4.1-fast'],
      openrouterProvidersFromEnv: null,
      promptTokens: 100,
      requiresVideoUnderstanding: false,
    });

    expect(attempts.map((a) => a.userModelId)).toEqual([
      'xai/grok-4-1-fast',
      'openrouter/x-ai/grok-4.1-fast',
    ]);
  });

  it('skips OpenRouter fallback when normalized slug is ambiguous', () => {
    const config: GistConfig = {
      model: { mode: 'auto', rules: [{ candidates: ['xai/grok-4-1-fast'] }] },
    };
    const attempts = buildAutoModelAttempts({
      catalog: null,
      config,
      desiredOutputTokens: 50,
      env: { OPENROUTER_API_KEY: 'sk-or-test' },
      kind: 'text',
      openrouterModelIds: ['x-ai/grok-4.1-fast', 'other/grok-4.1-fast'],
      openrouterProvidersFromEnv: null,
      promptTokens: 100,
      requiresVideoUnderstanding: false,
    });

    expect(attempts.map((a) => a.userModelId)).toEqual(['xai/grok-4-1-fast']);
  });

  it('prefers exact OpenRouter id even if slug is ambiguous', () => {
    const config: GistConfig = {
      model: { mode: 'auto', rules: [{ candidates: ['xai/grok-4-fast'] }] },
    };
    const attempts = buildAutoModelAttempts({
      catalog: null,
      config,
      desiredOutputTokens: 50,
      env: { OPENROUTER_API_KEY: 'sk-or-test' },
      kind: 'text',
      openrouterModelIds: ['xai/grok-4-fast', 'other/grok-4-fast'],
      openrouterProvidersFromEnv: null,
      promptTokens: 100,
      requiresVideoUnderstanding: false,
    });

    expect(attempts.map((a) => a.userModelId)).toEqual([
      'xai/grok-4-fast',
      'openrouter/xai/grok-4-fast',
    ]);
  });

  it('matches OpenRouter ids case-insensitively', () => {
    const config: GistConfig = {
      model: { mode: 'auto', rules: [{ candidates: ['openai/gpt-5-mini'] }] },
    };
    const attempts = buildAutoModelAttempts({
      catalog: null,
      config,
      desiredOutputTokens: 50,
      env: { OPENROUTER_API_KEY: 'sk-or-test' },
      kind: 'text',
      openrouterModelIds: ['OpenAI/GPT-5-Mini'],
      openrouterProvidersFromEnv: null,
      promptTokens: 100,
      requiresVideoUnderstanding: false,
    });

    expect(attempts.map((a) => a.userModelId)).toEqual([
      'openai/gpt-5-mini',
      'openrouter/openai/gpt-5-mini',
    ]);
  });

  it('does not add OpenRouter fallback without OPENROUTER_API_KEY', () => {
    const config: GistConfig = {
      model: { mode: 'auto', rules: [{ candidates: ['openai/gpt-5-mini'] }] },
    };
    const attempts = buildAutoModelAttempts({
      catalog: null,
      config,
      desiredOutputTokens: 50,
      env: {},
      kind: 'text',
      openrouterModelIds: ['openai/gpt-5-mini'],
      openrouterProvidersFromEnv: null,
      promptTokens: 100,
      requiresVideoUnderstanding: false,
    });

    expect(attempts.map((a) => a.userModelId)).toEqual(['openai/gpt-5-mini']);
  });

  it('skips OpenRouter fallback when OpenRouter catalog is empty', () => {
    const config: GistConfig = {
      model: { mode: 'auto', rules: [{ candidates: ['openai/gpt-5-mini'] }] },
    };
    const attempts = buildAutoModelAttempts({
      catalog: null,
      config,
      desiredOutputTokens: 50,
      env: { OPENROUTER_API_KEY: 'sk-or-test' },
      kind: 'text',
      openrouterModelIds: [],
      openrouterProvidersFromEnv: null,
      promptTokens: 100,
      requiresVideoUnderstanding: false,
    });

    expect(attempts.map((a) => a.userModelId)).toEqual(['openai/gpt-5-mini']);
  });

  it('adds an OpenRouter fallback attempt when OPENROUTER_API_KEY is set', () => {
    const config: GistConfig = {
      model: { mode: 'auto', rules: [{ candidates: ['openai/gpt-5-mini'] }] },
    };
    const attempts = buildAutoModelAttempts({
      catalog: null,
      config,
      desiredOutputTokens: 50,
      env: { OPENROUTER_API_KEY: 'sk-or-test' },
      kind: 'text',
      openrouterProvidersFromEnv: ['groq'],
      promptTokens: 100,
      requiresVideoUnderstanding: false,
    });

    expect(attempts.some((a) => a.forceOpenRouter)).toBe(true);
    expect(attempts.some((a) => a.userModelId === 'openai/gpt-5-mini')).toBe(true);
    expect(attempts.some((a) => a.userModelId === 'openrouter/openai/gpt-5-mini')).toBe(true);
  });

  it('does not add an OpenRouter fallback when video understanding is required', () => {
    const config: GistConfig = {
      model: { mode: 'auto', rules: [{ candidates: ['google/gemini-3-flash'] }] },
    };
    const attempts = buildAutoModelAttempts({
      catalog: null,
      config,
      desiredOutputTokens: 50,
      env: { OPENROUTER_API_KEY: 'sk-or-test' },
      kind: 'video',
      openrouterProvidersFromEnv: ['groq'],
      promptTokens: 100,
      requiresVideoUnderstanding: true,
    });

    expect(attempts.every((a) => !a.forceOpenRouter)).toBe(true);
  });

  it('respects explicit openrouter/... candidates (no native attempt)', () => {
    const config: GistConfig = {
      model: { mode: 'auto', rules: [{ candidates: ['openrouter/openai/gpt-5-nano'] }] },
    };
    const attempts = buildAutoModelAttempts({
      catalog: null,
      config,
      desiredOutputTokens: 50,
      env: { OPENROUTER_API_KEY: 'sk-or-test' },
      kind: 'text',
      openrouterProvidersFromEnv: null,
      promptTokens: 100,
      requiresVideoUnderstanding: false,
    });

    expect(attempts.some((a) => a.userModelId === 'openrouter/openai/gpt-5-nano')).toBe(true);
    expect(attempts.some((a) => a.userModelId === 'openai/gpt-5-nano')).toBe(false);
  });

  it('treats OpenRouter model ids as opaque (meta-llama/... etc)', () => {
    const config: GistConfig = {
      model: {
        mode: 'auto',
        rules: [{ candidates: ['openrouter/meta-llama/llama-3.3-70b-instruct:free'] }],
      },
    };
    const attempts = buildAutoModelAttempts({
      catalog: null,
      config,
      desiredOutputTokens: 50,
      env: { OPENROUTER_API_KEY: 'sk-or-test' },
      kind: 'text',
      openrouterProvidersFromEnv: null,
      promptTokens: 100,
      requiresVideoUnderstanding: false,
    });

    expect(attempts[0]?.userModelId).toBe('openrouter/meta-llama/llama-3.3-70b-instruct:free');
    expect(attempts[0]?.llmModelId).toBe('openai/meta-llama/llama-3.3-70b-instruct:free');
  });

  it('selects candidates via token bands (first match wins)', () => {
    const config: GistConfig = {
      model: {
        mode: 'auto',
        rules: [
          {
            bands: [
              { candidates: ['openai/gpt-5-nano'], token: { max: 100 } },
              { candidates: ['openai/gpt-5-mini'], token: { max: 1000 } },
              { candidates: ['xai/grok-4-fast-non-reasoning'] },
            ],
            when: ['text'],
          },
        ],
      },
    };

    const attempts = buildAutoModelAttempts({
      catalog: null,
      config,
      desiredOutputTokens: 50,
      env: {},
      kind: 'text',
      openrouterProvidersFromEnv: null,
      promptTokens: 200,
      requiresVideoUnderstanding: false,
    });

    expect(attempts[0]?.userModelId).toBe('openai/gpt-5-mini');
  });

  it('filters candidates by LiteLLM max input tokens (skips too-small context)', () => {
    const config: GistConfig = {
      model: { mode: 'auto', rules: [{ candidates: ['openai/gpt-5-nano', 'openai/gpt-5-mini'] }] },
    };

    const catalog = {
      'gpt-5-mini': { max_input_tokens: 1000 },
      'gpt-5-nano': { max_input_tokens: 10 },
    };

    const attempts = buildAutoModelAttempts({
      catalog,
      config,
      desiredOutputTokens: 50,
      env: { OPENAI_API_KEY: 'test' },
      kind: 'text',
      openrouterProvidersFromEnv: null,
      promptTokens: 100,
      requiresVideoUnderstanding: false,
    });

    expect(attempts[0]?.userModelId).toBe('openai/gpt-5-mini');
  });

  it('supports multi-kind "when" arrays', () => {
    const config: GistConfig = {
      model: {
        mode: 'auto',
        rules: [
          { candidates: ['openai/gpt-5-nano'], when: ['youtube', 'website'] },
          { candidates: ['openai/gpt-5-mini'], when: ['text'] },
        ],
      },
    };

    const attemptsWebsite = buildAutoModelAttempts({
      catalog: null,
      config,
      desiredOutputTokens: 50,
      env: { OPENAI_API_KEY: 'test' },
      kind: 'website',
      openrouterProvidersFromEnv: null,
      promptTokens: 100,
      requiresVideoUnderstanding: false,
    });
    expect(attemptsWebsite[0]?.userModelId).toBe('openai/gpt-5-nano');

    const attemptsText = buildAutoModelAttempts({
      catalog: null,
      config,
      desiredOutputTokens: 50,
      env: { OPENAI_API_KEY: 'test' },
      kind: 'text',
      openrouterProvidersFromEnv: null,
      promptTokens: 100,
      requiresVideoUnderstanding: false,
    });
    expect(attemptsText[0]?.userModelId).toBe('openai/gpt-5-mini');
  });

  it('does not prepend CLI candidates unless enabled', () => {
    const attempts = buildAutoModelAttempts({
      catalog: null,
      cliAvailability: { claude: true, codex: true, gemini: true },
      config: null,
      desiredOutputTokens: 50,
      env: {},
      kind: 'text',
      openrouterProvidersFromEnv: null,
      promptTokens: 100,
      requiresVideoUnderstanding: false,
    });

    expect(attempts[0]?.userModelId).toBe('google/gemini-3-flash');
  });

  it('prepends CLI candidates when enabled', () => {
    const config: GistConfig = {
      cli: { enabled: ['claude', 'gemini', 'codex'] },
      model: { mode: 'auto', rules: [{ candidates: ['openai/gpt-5-mini'] }] },
    };
    const attempts = buildAutoModelAttempts({
      catalog: null,
      cliAvailability: { claude: true },
      config,
      desiredOutputTokens: 50,
      env: {},
      kind: 'text',
      openrouterProvidersFromEnv: null,
      promptTokens: 100,
      requiresVideoUnderstanding: false,
    });

    expect(attempts[0]?.userModelId).toBe('cli/claude/sonnet');
  });

  it('prepends auto CLI fallback candidates for implicit auto when no API keys are set', () => {
    const config: GistConfig = {
      model: { mode: 'auto', rules: [{ candidates: ['openai/gpt-5-mini'] }] },
    };
    const attempts = buildAutoModelAttempts({
      catalog: null,
      cliAvailability: { claude: true },
      config,
      desiredOutputTokens: 50,
      env: {},
      isImplicitAutoSelection: true,
      kind: 'text',
      openrouterProvidersFromEnv: null,
      promptTokens: 100,
      requiresVideoUnderstanding: false,
    });

    expect(attempts[0]?.userModelId).toBe('cli/claude/sonnet');
  });

  it('does not prepend auto CLI fallback candidates for explicit --model auto', () => {
    const config: GistConfig = {
      model: { mode: 'auto', rules: [{ candidates: ['openai/gpt-5-mini'] }] },
    };
    const attempts = buildAutoModelAttempts({
      catalog: null,
      cliAvailability: { claude: true },
      config,
      desiredOutputTokens: 50,
      env: {},
      isImplicitAutoSelection: false,
      kind: 'text',
      openrouterProvidersFromEnv: null,
      promptTokens: 100,
      requiresVideoUnderstanding: false,
    });

    expect(attempts[0]?.userModelId).toBe('openai/gpt-5-mini');
  });

  it('does not prepend auto CLI fallback candidates when API keys are present', () => {
    const config: GistConfig = {
      model: { mode: 'auto', rules: [{ candidates: ['openai/gpt-5-mini'] }] },
    };
    const attempts = buildAutoModelAttempts({
      catalog: null,
      cliAvailability: { claude: true },
      config,
      desiredOutputTokens: 50,
      env: { OPENAI_API_KEY: 'test' },
      isImplicitAutoSelection: true,
      kind: 'text',
      openrouterProvidersFromEnv: null,
      promptTokens: 100,
      requiresVideoUnderstanding: false,
    });

    expect(attempts[0]?.userModelId).toBe('openai/gpt-5-mini');
  });

  it('prioritizes last successful CLI provider in auto CLI fallback mode', () => {
    const config: GistConfig = {
      model: { mode: 'auto', rules: [{ candidates: ['openai/gpt-5-mini'] }] },
    };
    const attempts = buildAutoModelAttempts({
      catalog: null,
      cliAvailability: { claude: true, gemini: true },
      config,
      desiredOutputTokens: 50,
      env: {},
      isImplicitAutoSelection: true,
      kind: 'text',
      lastSuccessfulCliProvider: 'gemini',
      openrouterProvidersFromEnv: null,
      promptTokens: 100,
      requiresVideoUnderstanding: false,
    });

    expect(attempts[0]?.userModelId).toBe('cli/gemini/flash');
    expect(attempts[1]?.userModelId).toBe('cli/claude/sonnet');
  });

  it('prepends a bare OpenCode CLI fallback when no default model is configured', () => {
    const config: GistConfig = {
      model: { mode: 'auto', rules: [{ candidates: ['openai/gpt-5-mini'] }] },
    };
    const attempts = buildAutoModelAttempts({
      catalog: null,
      cliAvailability: { opencode: true },
      config,
      desiredOutputTokens: 50,
      env: {},
      isImplicitAutoSelection: true,
      kind: 'text',
      openrouterProvidersFromEnv: null,
      promptTokens: 100,
      requiresVideoUnderstanding: false,
    });

    expect(attempts[0]?.userModelId).toBe('cli/opencode');
  });

  it('uses the configured OpenCode model for CLI fallback candidates', () => {
    const config: GistConfig = {
      cli: { opencode: { model: 'openai/gpt-5.4' } },
      model: { mode: 'auto', rules: [{ candidates: ['openai/gpt-5-mini'] }] },
    };
    const attempts = buildAutoModelAttempts({
      catalog: null,
      cliAvailability: { opencode: true },
      config,
      desiredOutputTokens: 50,
      env: {},
      isImplicitAutoSelection: true,
      kind: 'text',
      openrouterProvidersFromEnv: null,
      promptTokens: 100,
      requiresVideoUnderstanding: false,
    });

    expect(attempts[0]?.userModelId).toBe('cli/opencode/openai/gpt-5.4');
  });

  it('dedupes configured CLI auto-fallback order', () => {
    const config: GistConfig = {
      cli: {
        autoFallback: {
          enabled: true,
          onlyWhenNoApiKeys: false,
          order: ['opencode', 'claude', 'opencode'],
        },
      },
    };

    expect(resolveCliAutoFallbackConfig(config)).toEqual({
      enabled: true,
      onlyWhenNoApiKeys: false,
      order: ['opencode', 'claude'],
    });
  });

  it('does not prepend CLI candidates when an explicit enabled list is empty', () => {
    expect(
      prependCliCandidates({
        allowAutoCliFallback: false,
        candidates: ['openai/gpt-5-mini'],
        config: { cli: { enabled: [] } },
        env: {},
        isImplicitAutoSelection: true,
        lastSuccessfulCliProvider: null,
      }),
    ).toEqual(['openai/gpt-5-mini']);
  });

  it('dedupes duplicate explicit OpenCode CLI entries', () => {
    expect(
      prependCliCandidates({
        allowAutoCliFallback: false,
        candidates: ['openai/gpt-5-mini'],
        config: { cli: { enabled: ['opencode', 'opencode'] } },
        env: {},
        isImplicitAutoSelection: true,
        lastSuccessfulCliProvider: null,
      }),
    ).toEqual(['cli/opencode', 'openai/gpt-5-mini']);
  });

  it('skips CLI candidates when video understanding is required', () => {
    const config: GistConfig = {
      cli: { enabled: ['claude'] },
      model: { mode: 'auto', rules: [{ candidates: ['google/gemini-3-flash'] }] },
    };
    const attempts = buildAutoModelAttempts({
      catalog: null,
      cliAvailability: { claude: true },
      config,
      desiredOutputTokens: 50,
      env: {},
      kind: 'video',
      openrouterProvidersFromEnv: null,
      promptTokens: 100,
      requiresVideoUnderstanding: true,
    });

    expect(attempts.every((a) => a.transport !== 'cli')).toBe(true);
    expect(attempts[0]?.userModelId).toBe('google/gemini-3-flash');
  });

  it('does not reorder CLI providers when preferred is already first', () => {
    const config: GistConfig = {
      model: { mode: 'auto', rules: [{ candidates: ['openai/gpt-5-mini'] }] },
    };
    const attempts = buildAutoModelAttempts({
      catalog: null,
      cliAvailability: { claude: true, gemini: true },
      config,
      desiredOutputTokens: 50,
      env: {},
      isImplicitAutoSelection: true,
      kind: 'text',
      lastSuccessfulCliProvider: 'claude',
      openrouterProvidersFromEnv: null,
      promptTokens: 100,
      requiresVideoUnderstanding: false, // Claude is already first in default order
    });

    expect(attempts[0]?.userModelId).toBe('cli/claude/sonnet');
    expect(attempts[1]?.userModelId).toBe('cli/gemini/flash');
  });
});
