import { describe, expect, it } from 'vitest';

import type { ExtractedLinkContent } from '../src/content/index.js';
import { buildUrlPrompt } from '../src/run/flows/url/summary.js';

describe('buildUrlPrompt', () => {
  it('propagates extracted.truncated into the prompt context', () => {
    const base: ExtractedLinkContent = {
      content: 'Content',
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
      title: 'Hello',
      totalCharacters: 7,
      transcriptCharacters: null,
      transcriptLines: null,
      transcriptMetadata: null,
      transcriptSegments: null,
      transcriptSource: null,
      transcriptTimedText: null,
      transcriptWordCount: null,
      transcriptionProvider: null,
      truncated: true,
      url: 'https://example.com',
      video: null,
      wordCount: 1,
    };

    const prompt = buildUrlPrompt({
      extracted: base,
      languageInstruction: null,
      lengthArg: { kind: 'preset', preset: 'xl' },
      lengthInstruction: null,
      outputLanguage: { kind: 'auto' },
      promptOverride: null,
    });

    expect(prompt).toContain('Note: Content truncated');
  });
});
