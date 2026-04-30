import { describe, expect, it } from 'vitest';

import type { GistConfig } from '../src/config';
import { buildAutoModelAttempts } from '../src/model-auto';

describe('auto model selection for current gateway providers', () => {
  it('uses configured free OpenRouter candidates with executable llm ids', () => {
    const config: GistConfig = {
      model: { mode: 'auto', rules: [{ candidates: ['openrouter/google/gemma-4-31b-it:free'] }] },
    };

    const attempts = buildAutoModelAttempts({
      allowAutoCliFallback: false,
      cliAvailability: {},
      config,
      desiredOutputTokens: 500,
      env: { OPENROUTER_API_KEY: 'sk-or-test' },
      isImplicitAutoSelection: false,
      kind: 'text',
      lastSuccessfulCliProvider: null,
      openrouterProvidersFromEnv: null,
      promptTokens: 100,
      requiresVideoUnderstanding: false,
    });

    expect(attempts[0]).toMatchObject({
      forceOpenRouter: true,
      llmModelId: 'openrouter/google/gemma-4-31b-it:free',
      requiredEnv: 'OPENROUTER_API_KEY',
      transport: 'openrouter',
      userModelId: 'openrouter/google/gemma-4-31b-it:free',
    });
  });
});
