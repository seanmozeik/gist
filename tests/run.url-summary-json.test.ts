import { describe, expect, it } from 'vitest';

import { buildUrlJsonEnv, buildUrlJsonInput } from '../src/run/flows/url/summary-json.js';

describe('run url summary json', () => {
  it('builds preset-length input payloads', () => {
    const input = buildUrlJsonInput({
      effectiveMarkdownMode: 'readability',
      flags: {
        firecrawlMode: 'auto',
        format: 'markdown',
        lengthArg: { kind: 'preset', preset: 'medium' },
        maxOutputTokensArg: 512,
        outputLanguage: { kind: 'code', value: 'de' },
        timeoutMs: 42_000,
        transcriptTimestamps: true,
        youtubeMode: 'captions',
      },
      modelLabel: 'openai/gpt-5.4',
      url: 'https://example.com',
    } as never);

    expect(input).toEqual({
      firecrawl: 'auto',
      format: 'markdown',
      kind: 'url',
      language: { label: undefined, mode: 'fixed', tag: undefined },
      length: { kind: 'preset', preset: 'medium' },
      markdown: 'readability',
      maxOutputTokens: 512,
      model: 'openai/gpt-5.4',
      timeoutMs: 42_000,
      timestamps: true,
      url: 'https://example.com',
      youtube: 'captions',
    });
  });

  it('builds char-length input payloads and env booleans', () => {
    const input = buildUrlJsonInput({
      effectiveMarkdownMode: 'off',
      flags: {
        firecrawlMode: 'off',
        format: 'text',
        lengthArg: { kind: 'chars', maxCharacters: 9000 },
        maxOutputTokensArg: null,
        outputLanguage: { kind: 'auto' },
        timeoutMs: 1_000,
        transcriptTimestamps: false,
        youtubeMode: 'auto',
      },
      modelLabel: null,
      url: 'https://example.com/page',
    } as never);
    expect(input.length).toEqual({ kind: 'chars', maxCharacters: 9000 });
    expect(input.language).toEqual({ mode: 'auto' });

    expect(
      buildUrlJsonEnv({
        anthropicConfigured: true,
        apiKey: null,
        apifyToken: null,
        firecrawlConfigured: true,
        googleConfigured: false,
        openrouterApiKey: 'or',
        xaiApiKey: 'x',
      }),
    ).toEqual({
      hasAnthropicKey: true,
      hasApifyToken: false,
      hasFirecrawlKey: true,
      hasGoogleKey: false,
      hasOpenAIKey: false,
      hasOpenRouterKey: true,
      hasXaiKey: true,
    });
  });
});
