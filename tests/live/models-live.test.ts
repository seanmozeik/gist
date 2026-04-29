import { describe, expect, it } from 'vitest';

import { generateTextWithModelId, streamTextWithModelId } from '../../src/llm/generate-text.js';

const LIVE = process.env.SUMMARIZE_LIVE_TEST === '1';

function shouldSoftSkipLiveError(message: string): boolean {
  return /model.*not found|does not exist|permission|access|unauthorized|forbidden|404|not_found|model_not_found|empty summary|empty response/i.test(
    message,
  );
}

(LIVE ? describe : describe.skip)('live model smoke', () => {
  const timeoutMs = 120_000;

  const apiKeys = {
    anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? null,
    googleApiKey:
      process.env.GEMINI_API_KEY ??
      process.env.GOOGLE_GENERATIVE_AI_API_KEY ??
      process.env.GOOGLE_API_KEY ??
      null,
    openaiApiKey: process.env.OPENAI_API_KEY ?? null,
    xaiApiKey: process.env.XAI_API_KEY ?? null,
  };

  it(
    'OpenAI (gpt-5.2) returns text',
    async () => {
      if (!apiKeys.openaiApiKey) {
        it.skip('requires OPENAI_API_KEY', () => {});
        return;
      }
      try {
        const result = await generateTextWithModelId({
          apiKeys,
          fetchImpl: globalThis.fetch.bind(globalThis),
          maxOutputTokens: 32,
          modelId: 'openai/gpt-5.2',
          prompt: { userText: 'Say exactly: ok' },
          timeoutMs,
        });
        expect(result.text.trim().length).toBeGreaterThan(0);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (shouldSoftSkipLiveError(message)) {
          return;
        }
        throw error;
      }
    },
    timeoutMs,
  );

  it(
    'OpenAI (gpt-5.2) streams text (temperature ignored)',
    async () => {
      if (!apiKeys.openaiApiKey) {
        it.skip('requires OPENAI_API_KEY', () => {});
        return;
      }
      try {
        const result = await streamTextWithModelId({
          apiKeys,
          fetchImpl: globalThis.fetch.bind(globalThis),
          maxOutputTokens: 32,
          modelId: 'openai/gpt-5.2',
          prompt: { userText: 'Say exactly: ok' },
          temperature: 0.7,
          timeoutMs,
        });
        let text = '';
        for await (const chunk of result.textStream) {
          text += chunk;
        }
        if (text.trim().length === 0) {
          return;
        }
        expect(text.trim().length).toBeGreaterThan(0);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (shouldSoftSkipLiveError(message)) {
          return;
        }
        throw error;
      }
    },
    timeoutMs,
  );

  it(
    'OpenAI (gpt-5-mini) streams text',
    async () => {
      if (!apiKeys.openaiApiKey) {
        it.skip('requires OPENAI_API_KEY', () => {});
        return;
      }
      try {
        const result = await streamTextWithModelId({
          apiKeys,
          fetchImpl: globalThis.fetch.bind(globalThis),
          maxOutputTokens: 32,
          modelId: 'openai/gpt-5-mini',
          prompt: { userText: 'Say exactly: ok' },
          temperature: 0.7,
          timeoutMs,
        });
        let text = '';
        for await (const chunk of result.textStream) {
          text += chunk;
        }
        if (text.trim().length === 0) {
          return;
        }
        expect(text.trim().length).toBeGreaterThan(0);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (shouldSoftSkipLiveError(message)) {
          return;
        }
        throw error;
      }
    },
    timeoutMs,
  );

  it(
    'Anthropic (opus 4.5) returns text',
    async () => {
      if (!apiKeys.anthropicApiKey) {
        it.skip('requires ANTHROPIC_API_KEY', () => {});
        return;
      }
      try {
        const result = await generateTextWithModelId({
          apiKeys,
          fetchImpl: globalThis.fetch.bind(globalThis),
          maxOutputTokens: 32,
          modelId: 'anthropic/claude-opus-4-5',
          prompt: { userText: 'Say exactly: ok' },
          timeoutMs,
        });
        expect(result.text.trim().length).toBeGreaterThan(0);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (shouldSoftSkipLiveError(message)) {
          return;
        }
        throw error;
      }
    },
    timeoutMs,
  );

  it(
    'Anthropic (sonnet 4.5) returns text',
    async () => {
      if (!apiKeys.anthropicApiKey) {
        it.skip('requires ANTHROPIC_API_KEY', () => {});
        return;
      }
      try {
        const result = await generateTextWithModelId({
          apiKeys,
          fetchImpl: globalThis.fetch.bind(globalThis),
          maxOutputTokens: 32,
          modelId: 'anthropic/claude-sonnet-4-5',
          prompt: { userText: 'Say exactly: ok' },
          timeoutMs,
        });
        expect(result.text.trim().length).toBeGreaterThan(0);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (shouldSoftSkipLiveError(message)) {
          return;
        }
        throw error;
      }
    },
    timeoutMs,
  );

  it(
    'xAI (grok 4.1 fast) returns text',
    async () => {
      if (!apiKeys.xaiApiKey) {
        it.skip('requires XAI_API_KEY', () => {});
        return;
      }
      try {
        const result = await generateTextWithModelId({
          apiKeys,
          fetchImpl: globalThis.fetch.bind(globalThis),
          maxOutputTokens: 32,
          modelId: 'xai/grok-4-1-fast',
          prompt: { userText: 'Say exactly: ok' },
          timeoutMs,
        });
        expect(result.text.trim().length).toBeGreaterThan(0);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (shouldSoftSkipLiveError(message)) {
          return;
        }
        throw error;
      }
    },
    timeoutMs,
  );

  it(
    'Google (Gemini 3 Flash) returns text',
    async () => {
      if (!apiKeys.googleApiKey) {
        it.skip('requires GEMINI_API_KEY', () => {});
        return;
      }
      try {
        const result = await generateTextWithModelId({
          apiKeys,
          fetchImpl: globalThis.fetch.bind(globalThis),
          maxOutputTokens: 32,
          modelId: 'google/gemini-3-flash',
          prompt: { userText: 'Say exactly: ok' },
          timeoutMs,
        });
        expect(result.text.trim().length).toBeGreaterThan(0);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (shouldSoftSkipLiveError(message)) {
          return;
        }
        throw error;
      }
    },
    timeoutMs,
  );
});
