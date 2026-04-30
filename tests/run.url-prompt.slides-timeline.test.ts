import { describe, expect, it } from 'vitest';

import { buildPromptContentHash } from '../src/cache';
import type { ExtractedLinkContent } from '../src/content/index';
import { buildUrlPrompt } from '../src/run/flows/url/summary';
import type { SlideExtractionResult } from '../src/slides/types';

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

const slides: SlideExtractionResult = {
  autoTune: { chosenThreshold: 0, confidence: 0, enabled: false, strategy: 'none' },
  autoTuneThreshold: false,
  maxSlides: 100,
  minSlideDuration: 2,
  ocrAvailable: true,
  ocrRequested: true,
  sceneThreshold: 0.7,
  slides: [
    { imagePath: '/tmp/slide1.png', index: 1, ocrText: 'OCR SHOULD NOT BE USED', timestamp: 10 },
    { imagePath: '/tmp/slide2.png', index: 2, ocrText: 'OCR SHOULD NOT BE USED', timestamp: 50 },
  ],
  slidesDir: '/tmp/slides',
  sourceId: 'abc123',
  sourceKind: 'youtube',
  sourceUrl: 'https://example.com/video',
  warnings: [],
};

describe('buildUrlPrompt with slides transcript timeline', () => {
  it('injects transcript excerpts aligned to slide spans', () => {
    const prompt = buildUrlPrompt({
      extracted: {
        ...baseExtracted,
        transcriptTimedText: [
          '[0:00] intro hello',
          '[0:20] second segment',
          '[0:40] third segment',
          '[1:00] fourth segment',
        ].join('\n'),
      },
      languageInstruction: null,
      lengthArg: { kind: 'preset', preset: 'short' },
      lengthInstruction: null,
      outputLanguage: { kind: 'auto' },
      promptOverride: null,
      slides,
    });

    expect(prompt).toContain('Slide timeline (transcript excerpts):');
    expect(prompt).toContain('[slide:1] [0:00–0:40]');
    expect(prompt).toContain('intro hello second segment third segment');
    expect(prompt).toContain('[slide:2] [0:20–1:30]');
    expect(prompt).toContain('second segment third segment fourth segment');
    expect(prompt).toContain(
      'Slide format example (follow this pattern; markers on their own lines):',
    );
    expect(prompt).toContain('Repeat the 3-line slide block for every marker below, in order.');
    expect(prompt).toContain('Required markers (use each exactly once, in order)');
    expect(prompt).toContain('Do not create a dedicated Slides section or list');
    expect(prompt).not.toContain('Slides (OCR):');
    expect(prompt).not.toContain('OCR SHOULD NOT BE USED');
    expect(prompt).not.toContain('Key moments');
  });

  it('keeps slide formatting instructions even without transcript timed text', () => {
    const prompt = buildUrlPrompt({
      extracted: baseExtracted,
      languageInstruction: null,
      lengthArg: { kind: 'preset', preset: 'short' },
      lengthInstruction: null,
      outputLanguage: { kind: 'auto' },
      promptOverride: null,
      slides,
    });

    expect(prompt).toContain(
      'Slide format example (follow this pattern; markers on their own lines):',
    );
    expect(prompt).toContain(
      'Required markers (use each exactly once, in order): [slide:1] [slide:2]',
    );
    expect(prompt).toContain('Slide timeline (transcript excerpts):');
  });

  it('changes the prompt content hash when slides are enabled', () => {
    const promptWithoutSlides = buildUrlPrompt({
      extracted: baseExtracted,
      languageInstruction: null,
      lengthArg: { kind: 'preset', preset: 'short' },
      lengthInstruction: null,
      outputLanguage: { kind: 'auto' },
      promptOverride: null,
      slides: null,
    });
    const promptWithSlides = buildUrlPrompt({
      extracted: baseExtracted,
      languageInstruction: null,
      lengthArg: { kind: 'preset', preset: 'short' },
      lengthInstruction: null,
      outputLanguage: { kind: 'auto' },
      promptOverride: null,
      slides,
    });

    expect(buildPromptContentHash({ prompt: promptWithSlides })).not.toBe(
      buildPromptContentHash({ prompt: promptWithoutSlides }),
    );
  });
});
