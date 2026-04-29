import { describe, expect, it } from 'vitest';

import type { ExtractedLinkContent } from '../src/content/index.js';
import {
  buildFinishExtras,
  buildModelMetaFromAttempt,
  pickModelForFinishLine,
} from '../src/run/flows/url/summary-finish.js';
import type { ModelAttempt } from '../src/run/types.js';

const baseExtracted: ExtractedLinkContent = {
  content: 'Hello world',
  description: null,
  diagnostics: {
    firecrawl: { attempted: false, cacheMode: 'bypass', cacheStatus: 'unknown', used: false },
    markdown: { provider: null, requested: false, used: false },
    strategy: 'html',
    transcript: {
      attemptedProviders: [],
      cacheMode: 'bypass',
      cacheStatus: 'unknown',
      provider: null,
      textProvided: false,
    },
  },
  isVideoOnly: false,
  mediaDurationSeconds: null,
  siteName: 'Example',
  title: 'Example',
  totalCharacters: 11,
  transcriptCharacters: null,
  transcriptLines: null,
  transcriptMetadata: null,
  transcriptSegments: null,
  transcriptSource: null,
  transcriptTimedText: null,
  transcriptWordCount: null,
  transcriptionProvider: null,
  truncated: false,
  url: 'https://example.com',
  video: null,
  wordCount: 2,
};

const baseAttempt: ModelAttempt = {
  forceOpenRouter: false,
  llmModelId: 'openai/gpt-5.2',
  openrouterProviders: null,
  requiredEnv: 'OPENAI_API_KEY',
  transport: 'native',
  userModelId: 'openai/gpt-5.2',
};

describe('summary finish helpers', () => {
  it('returns null extras when no transcript or transcription cost is present', () => {
    expect(
      buildFinishExtras({
        extracted: baseExtracted,
        metricsDetailed: false,
        transcriptionCostLabel: null,
      }),
    ).toBeNull();
  });

  it('includes transcript summary and transcription cost when present', () => {
    const extracted: ExtractedLinkContent = {
      ...baseExtracted,
      mediaDurationSeconds: 75,
      siteName: 'YouTube',
      transcriptCharacters: 1200,
      transcriptWordCount: 200,
      video: { kind: 'youtube', url: 'https://www.youtube.com/watch?v=abc123' },
    };

    expect(
      buildFinishExtras({ extracted, metricsDetailed: true, transcriptionCostLabel: '$0.02 tx' }),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining('txc='),
        expect.stringContaining('transcript='),
        '$0.02 tx',
      ]),
    );
  });

  it('prefers the latest summary model', () => {
    expect(
      pickModelForFinishLine(
        [
          { model: 'openai/gpt-4.1', purpose: 'summary' },
          { model: 'openai/gpt-4.1-mini', purpose: 'markdown' },
          { model: 'openai/gpt-5.2', purpose: 'summary' },
        ],
        'fallback/model',
      ),
    ).toBe('openai/gpt-5.2');
  });

  it('falls back to markdown, then last call, then explicit fallback', () => {
    expect(
      pickModelForFinishLine(
        [
          { model: 'openai/gpt-4.1-mini', purpose: 'extract' },
          { model: 'openai/gpt-5.2-mini', purpose: 'markdown' },
        ],
        'fallback/model',
      ),
    ).toBe('openai/gpt-5.2-mini');

    expect(
      pickModelForFinishLine(
        [{ model: 'openai/gpt-4.1-mini', purpose: 'extract' }],
        'fallback/model',
      ),
    ).toBe('openai/gpt-4.1-mini');

    expect(pickModelForFinishLine([], 'fallback/model')).toBe('fallback/model');
  });

  it('returns cli metadata for cli attempts', () => {
    expect(
      buildModelMetaFromAttempt({
        ...baseAttempt,
        llmModelId: null,
        requiredEnv: 'CLI_CLAUDE',
        transport: 'cli',
        userModelId: 'claude-sonnet-4.5',
      }),
    ).toEqual({ canonical: 'claude-sonnet-4.5', provider: 'cli' });
  });

  it('preserves explicit openrouter ids for native attempts', () => {
    expect(
      buildModelMetaFromAttempt({
        ...baseAttempt,
        llmModelId: 'anthropic/claude-sonnet-4.5',
        userModelId: 'openrouter/anthropic/claude-sonnet-4.5',
      }),
    ).toEqual({ canonical: 'openrouter/anthropic/claude-sonnet-4.5', provider: 'anthropic' });
  });

  it('falls back to the parsed canonical model id for native attempts', () => {
    expect(
      buildModelMetaFromAttempt({ ...baseAttempt, llmModelId: null, userModelId: 'gpt-5.2' }),
    ).toEqual({ canonical: 'openai/gpt-5.2', provider: 'openai' });
  });
});
