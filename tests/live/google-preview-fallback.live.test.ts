import { describe, expect, it } from 'vitest';

import { generateTextWithModelId } from '../../src/llm/generate-text.js';

const LIVE = process.env.SUMMARIZE_LIVE_TEST === '1';

(LIVE ? describe : describe.skip)('live Google preview compatibility', () => {
  const timeoutMs = 120_000;

  it(
    'returns non-empty text for google/gemini-3-flash-preview',
    async () => {
      const googleApiKey =
        process.env.GEMINI_API_KEY ??
        process.env.GOOGLE_GENERATIVE_AI_API_KEY ??
        process.env.GOOGLE_API_KEY ??
        null;
      if (!googleApiKey) {
        it.skip('requires GEMINI_API_KEY', () => {});
        return;
      }

      const result = await generateTextWithModelId({
        apiKeys: {
          anthropicApiKey: null,
          googleApiKey,
          openaiApiKey: null,
          openrouterApiKey: null,
          xaiApiKey: null,
        },
        fetchImpl: globalThis.fetch.bind(globalThis),
        maxOutputTokens: 32,
        modelId: 'google/gemini-3-flash-preview',
        prompt: { userText: 'Say exactly: ok' },
        timeoutMs,
      });

      expect(result.text.trim().length).toBeGreaterThan(0);
    },
    timeoutMs,
  );
});
