import { describe, expect, it } from 'vitest';

import {
  isOpenAiGpt5Model,
  promptToContext,
  resolveEffectiveTemperature,
  resolveGoogleEmptyResponseFallbackModelId,
  shouldRetryGpt5WithoutTokenCap,
} from '../src/llm/generate-text-shared.js';

describe('generate-text shared helpers', () => {
  it('builds image prompt contexts and rejects unsupported attachments', () => {
    const imageContext = promptToContext({
      attachments: [{ kind: 'image', mediaType: 'image/png', bytes: new Uint8Array([1, 2, 3]) }],
      userText: 'look',
    });

    expect(imageContext.messages).toHaveLength(1);

    expect(() =>
      promptToContext({
        attachments: [
          { kind: 'image', mediaType: 'image/png', bytes: new Uint8Array([1]) },
          { kind: 'image', mediaType: 'image/png', bytes: new Uint8Array([2]) },
        ],
        userText: 'bad',
      }),
    ).toThrow(/only single image attachments/i);
  });

  it('omits temperature for OpenAI GPT-5 and GitHub Copilot OpenAI GPT-5 ids', () => {
    expect(
      resolveEffectiveTemperature({ model: 'gpt-5', provider: 'openai', temperature: 0.4 }),
    ).toBeUndefined();
    expect(
      resolveEffectiveTemperature({
        model: 'openai/gpt-5.4',
        provider: 'github-copilot',
        temperature: 0.4,
      }),
    ).toBeUndefined();
    expect(
      resolveEffectiveTemperature({
        model: 'anthropic/claude-opus-4.6',
        provider: 'github-copilot',
        temperature: 0.4,
      }),
    ).toBe(0.4);
  });

  it('detects GPT-5-family retries that should drop maxOutputTokens', () => {
    expect(isOpenAiGpt5Model('openai', 'gpt-5-mini')).toBe(true);
    expect(isOpenAiGpt5Model('openai', 'openai/gpt-5-mini')).toBe(true);
    expect(isOpenAiGpt5Model('github-copilot', 'openai/gpt-5.4')).toBe(true);
    expect(isOpenAiGpt5Model('openai', 'gpt-4.1')).toBe(false);

    expect(
      shouldRetryGpt5WithoutTokenCap({
        error: new Error('LLM returned an empty summary (model openai/gpt-5-mini).'),
        maxOutputTokens: 200,
        model: 'gpt-5-mini',
        provider: 'openai',
      }),
    ).toBe(true);
    expect(
      shouldRetryGpt5WithoutTokenCap({
        error: new Error('LLM returned an empty summary'),
        maxOutputTokens: undefined,
        model: 'gpt-5-mini',
        provider: 'openai',
      }),
    ).toBe(false);
    expect(
      shouldRetryGpt5WithoutTokenCap({
        error: new Error('LLM returned an empty summary'),
        maxOutputTokens: 200,
        model: 'gpt-4.1',
        provider: 'openai',
      }),
    ).toBe(false);
  });

  it('only falls back preview or exp Google ids', () => {
    expect(resolveGoogleEmptyResponseFallbackModelId('google/gemini-3-flash-preview')).toBe(
      'google/gemini-2.5-flash',
    );
    expect(resolveGoogleEmptyResponseFallbackModelId('google/gemini-2.5-flash')).toBeNull();
    expect(resolveGoogleEmptyResponseFallbackModelId('openai/gpt-5')).toBeNull();
  });
});
