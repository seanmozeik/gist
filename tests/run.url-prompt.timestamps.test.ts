import { describe, expect, it } from 'vitest';

import type { ExtractedLinkContent } from '../src/content/index.js';
import { buildUrlPrompt } from '../src/run/flows/url/summary.js';

const baseExtracted: ExtractedLinkContent = {
  content: 'Transcript:\nhello',
  description: null,
  diagnostics: {
    firecrawl: { attempted: false, cacheMode: 'bypass', cacheStatus: 'unknown', used: false },
    markdown: { provider: null, requested: false, used: false },
    strategy: 'html',
    transcript: {
      attemptedProviders: ['captionTracks'],
      cacheMode: 'bypass',
      cacheStatus: 'unknown',
      provider: 'captionTracks',
      textProvided: true,
    },
  },
  isVideoOnly: false,
  mediaDurationSeconds: 120,
  siteName: 'YouTube',
  title: 'Video',
  totalCharacters: 20,
  transcriptCharacters: 10,
  transcriptLines: 1,
  transcriptMetadata: null,
  transcriptSegments: null,
  transcriptSource: 'captionTracks',
  transcriptTimedText: null,
  transcriptWordCount: 2,
  transcriptionProvider: null,
  truncated: false,
  url: 'https://example.com/video',
  video: null,
  wordCount: 2,
};

describe('buildUrlPrompt with transcript timestamps', () => {
  it('forces timestamped bullets when timed transcript is present', () => {
    const prompt = buildUrlPrompt({
      extracted: {
        ...baseExtracted,
        transcriptSegments: [{ startMs: 1000, endMs: 2000, text: 'hello' }],
        transcriptTimedText: '[0:01] hello',
      },
      languageInstruction: null,
      lengthArg: { kind: 'preset', preset: 'short' },
      lengthInstruction: null,
      outputLanguage: { kind: 'auto' },
      promptOverride: null,
    });

    expect(prompt).toContain('Key moments');
    expect(prompt).toContain('Start each bullet with a [mm:ss]');
    expect(prompt).toContain('do not prepend timestamps outside the Key moments section');
    expect(prompt).toContain('The last available timestamp is 2:00');
    expect(prompt).toContain('Use 1-2 short paragraphs');
  });

  it('keeps default formatting when timestamps are unavailable', () => {
    const prompt = buildUrlPrompt({
      extracted: { ...baseExtracted, transcriptSegments: null, transcriptTimedText: null },
      languageInstruction: null,
      lengthArg: { kind: 'preset', preset: 'short' },
      lengthInstruction: null,
      outputLanguage: { kind: 'auto' },
      promptOverride: null,
    });

    expect(prompt).not.toContain('Key moments');
    expect(prompt).toContain('Use 1-2 short paragraphs');
  });
});
