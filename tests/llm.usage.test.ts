import { describe, expect, it } from 'vitest';

import {
  normalizeAnthropicUsage,
  normalizeGoogleUsage,
  normalizeOpenAiUsage,
  normalizeTokenUsage,
} from '../src/llm/usage.js';

describe('llm usage normalization', () => {
  it('normalizes generic usage payloads', () => {
    expect(normalizeTokenUsage(null)).toBeNull();
    expect(normalizeTokenUsage({})).toBeNull();
    expect(normalizeTokenUsage({ input: 5 })).toMatchObject({ promptTokens: 5 });
    expect(normalizeTokenUsage({ output: 7, totalTokens: 10 })).toMatchObject({
      completionTokens: 7,
      totalTokens: 10,
    });
  });

  it('normalizes Anthropic usage payloads', () => {
    expect(normalizeAnthropicUsage(null)).toBeNull();
    expect(normalizeAnthropicUsage({})).toBeNull();
    expect(normalizeAnthropicUsage({ input_tokens: 12, output_tokens: 4 })).toEqual({
      completionTokens: 4,
      promptTokens: 12,
      totalTokens: 16,
    });
  });

  it('normalizes OpenAI usage payloads', () => {
    expect(normalizeOpenAiUsage(null)).toBeNull();
    expect(normalizeOpenAiUsage({})).toBeNull();
    expect(normalizeOpenAiUsage({ input_tokens: 2, output_tokens: 3 })).toEqual({
      completionTokens: 3,
      promptTokens: 2,
      totalTokens: 5,
    });
    expect(normalizeOpenAiUsage({ input_tokens: 2, output_tokens: 3, total_tokens: 9 })).toEqual({
      completionTokens: 3,
      promptTokens: 2,
      totalTokens: 9,
    });
  });

  it('normalizes Google usage payloads', () => {
    expect(normalizeGoogleUsage(null)).toBeNull();
    expect(normalizeGoogleUsage({})).toBeNull();
    expect(normalizeGoogleUsage({ candidatesTokenCount: 5, promptTokenCount: 10 })).toMatchObject({
      completionTokens: 5,
      promptTokens: 10,
      totalTokens: 15,
    });
    expect(
      normalizeGoogleUsage({ candidatesTokenCount: 5, promptTokenCount: 10, totalTokenCount: 40 }),
    ).toMatchObject({ completionTokens: 5, promptTokens: 10, totalTokens: 40 });
  });
});
