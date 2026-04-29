import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CACHE_MODE,
  DEFAULT_MAX_CONTENT_CHARACTERS,
  DEFAULT_TIMEOUT_MS,
} from '../packages/core/src/content/link-preview/content/types.js';
import {
  appendNote,
  ensureTranscriptDiagnostics,
  finalizeExtractedLinkContent,
  pickFirstText,
  resolveCacheMode,
  resolveFirecrawlMode,
  resolveMaxCharacters,
  resolveTimeoutMs,
  safeHostname,
  selectBaseContent,
  summarizeTranscript,
} from '../packages/core/src/content/link-preview/content/utils.js';
import type {
  ContentFetchDiagnostics,
  TranscriptDiagnostics,
} from '../packages/core/src/content/link-preview/types.js';

function makeDiagnostics(overrides?: Partial<ContentFetchDiagnostics>): ContentFetchDiagnostics {
  return {
    firecrawl: {
      attempted: false,
      cacheMode: 'default',
      cacheStatus: 'unknown',
      notes: null,
      used: false,
    },
    markdown: { notes: null, provider: null, requested: false, used: false },
    strategy: 'html',
    transcript: {
      attemptedProviders: [],
      cacheMode: 'default',
      cacheStatus: 'unknown',
      notes: null,
      provider: null,
      textProvided: false,
    },
    ...overrides,
  };
}

describe('link-preview content utils', () => {
  it('resolves cache/max/timeouts with sane defaults', () => {
    expect(resolveCacheMode()).toBe(DEFAULT_CACHE_MODE);
    expect(resolveCacheMode({ cacheMode: 'bypass' })).toBe('bypass');

    expect(resolveMaxCharacters()).toBeNull();
    expect(resolveMaxCharacters({ maxCharacters: -1 })).toBeNull();
    expect(resolveMaxCharacters({ maxCharacters: 1 })).toBe(1);
    expect(resolveMaxCharacters({ maxCharacters: DEFAULT_MAX_CONTENT_CHARACTERS })).toBe(
      DEFAULT_MAX_CONTENT_CHARACTERS,
    );
    expect(resolveMaxCharacters({ maxCharacters: DEFAULT_MAX_CONTENT_CHARACTERS + 0.8 })).toBe(
      DEFAULT_MAX_CONTENT_CHARACTERS,
    );
    expect(resolveMaxCharacters({ maxCharacters: DEFAULT_MAX_CONTENT_CHARACTERS + 123.9 })).toBe(
      DEFAULT_MAX_CONTENT_CHARACTERS + 123,
    );

    expect(resolveTimeoutMs()).toBe(DEFAULT_TIMEOUT_MS);
    expect(resolveTimeoutMs({ timeoutMs: 0 })).toBe(DEFAULT_TIMEOUT_MS);
    expect(resolveTimeoutMs({ timeoutMs: 123.9 })).toBe(123);
  });

  it('resolves firecrawl mode with fallback', () => {
    expect(resolveFirecrawlMode()).toBe('auto');
    expect(resolveFirecrawlMode({ firecrawl: 'off' })).toBe('off');
    expect(resolveFirecrawlMode({ firecrawl: 'auto' })).toBe('auto');
    expect(resolveFirecrawlMode({ firecrawl: 'always' })).toBe('always');
    expect(resolveFirecrawlMode({ firecrawl: 'nope' as never })).toBe('auto');
  });

  it('handles basic string helpers', () => {
    expect(appendNote(null, '')).toBe('');
    expect(appendNote(null, 'a')).toBe('a');
    expect(appendNote('', 'a')).toBe('a');
    expect(appendNote('a', 'b')).toBe('a; b');

    expect(safeHostname('https://www.example.com/path')).toBe('example.com');
    expect(safeHostname('not-a-url')).toBeNull();

    expect(pickFirstText([null, '   ', '\n', ' ok ', 'later'])).toBe('ok');
    expect(pickFirstText([null, undefined, ''])).toBeNull();
  });

  it('selects transcript content only when present', () => {
    expect(selectBaseContent('SOURCE', null)).toBe('SOURCE');
    expect(selectBaseContent('SOURCE', '   \n')).toBe('SOURCE');
    expect(selectBaseContent('SOURCE', '  hello \n world ')).toContain('Transcript:\n');
  });

  it('prefers timed transcript content when segments are available', () => {
    const content = selectBaseContent('SOURCE', 'plain transcript', [
      { endMs: 2000, startMs: 1000, text: 'Hello' },
    ]);
    expect(content).toContain('Transcript:\n');
    expect(content).toContain('[0:01] Hello');
  });

  it('summarizes transcript basics', () => {
    expect(summarizeTranscript(null)).toEqual({
      transcriptCharacters: null,
      transcriptLines: null,
      transcriptWordCount: null,
    });
    expect(summarizeTranscript('')).toEqual({
      transcriptCharacters: null,
      transcriptLines: null,
      transcriptWordCount: null,
    });
    expect(summarizeTranscript('a\n\nb')).toEqual({
      transcriptCharacters: 4,
      transcriptLines: 2,
      transcriptWordCount: 2,
    });
  });

  it('ensures transcript diagnostics when missing', () => {
    const existing: TranscriptDiagnostics = {
      attemptedProviders: ['html'],
      cacheMode: 'default',
      cacheStatus: 'hit',
      notes: null,
      provider: 'html',
      textProvided: true,
    };
    expect(
      ensureTranscriptDiagnostics({ diagnostics: existing, source: 'html', text: 'ok' }, 'default'),
    ).toBe(existing);

    expect(ensureTranscriptDiagnostics({ source: 'html', text: 'ok' }, 'default')).toMatchObject({
      attemptedProviders: ['html'],
      cacheMode: 'default',
      cacheStatus: 'miss',
      notes: null,
      provider: 'html',
      textProvided: true,
    });

    expect(ensureTranscriptDiagnostics({ source: null, text: null }, 'default')).toMatchObject({
      attemptedProviders: [],
      cacheStatus: 'unknown',
    });

    expect(
      ensureTranscriptDiagnostics({ source: 'captionTracks', text: 'ok' }, 'bypass'),
    ).toMatchObject({
      attemptedProviders: ['captionTracks'],
      cacheMode: 'bypass',
      cacheStatus: 'bypassed',
      notes: 'Cache bypass requested',
    });
  });

  it('finalizes extracted content with/without budget', () => {
    const diagnostics = makeDiagnostics();

    const withBudget = finalizeExtractedLinkContent({
      baseContent: 'A'.repeat(100),
      description: null,
      diagnostics,
      maxCharacters: 20,
      siteName: null,
      title: 't',
      transcriptResolution: { source: 'html', text: 'x' },
      url: 'https://example.com',
    });
    expect(withBudget.content.length).toBeLessThanOrEqual(20);
    expect(withBudget.totalCharacters).toBeGreaterThan(20);
    expect(withBudget.truncated).toBe(true);
    expect(withBudget.transcriptCharacters).toBe(1);
    expect(withBudget.transcriptLines).toBe(1);
    expect(withBudget.transcriptWordCount).toBe(1);
    expect(withBudget.mediaDurationSeconds).toBeNull();

    const noBudget = finalizeExtractedLinkContent({
      baseContent: 'one two  three',
      description: null,
      diagnostics,
      maxCharacters: null,
      siteName: null,
      title: null,
      transcriptResolution: { source: 'unknown', text: '' },
      url: 'https://example.com',
    });
    expect(noBudget.truncated).toBe(false);
    expect(noBudget.wordCount).toBe(3);
    expect(noBudget.transcriptCharacters).toBeNull();
    expect(noBudget.transcriptLines).toBeNull();
    expect(noBudget.transcriptWordCount).toBeNull();
    expect(noBudget.mediaDurationSeconds).toBeNull();
  });

  it('pulls media duration from transcript metadata', () => {
    const diagnostics = makeDiagnostics();
    const result = finalizeExtractedLinkContent({
      baseContent: 'Transcript:\nhello',
      description: null,
      diagnostics,
      maxCharacters: null,
      siteName: null,
      title: null,
      transcriptResolution: {
        metadata: { durationSeconds: 123 },
        source: 'whisper',
        text: 'hello',
      },
      url: 'https://example.com',
    });
    expect(result.mediaDurationSeconds).toBe(123);
  });

  it('adds timed transcript text when segments are available', () => {
    const diagnostics = makeDiagnostics();
    const result = finalizeExtractedLinkContent({
      baseContent: 'Transcript:\nhello',
      description: null,
      diagnostics,
      maxCharacters: null,
      siteName: null,
      title: null,
      transcriptResolution: {
        segments: [{ startMs: 0, endMs: 1000, text: 'hello' }],
        source: 'html',
        text: 'hello',
      },
      url: 'https://example.com',
    });

    expect(result.transcriptSegments).toEqual([{ endMs: 1000, startMs: 0, text: 'hello' }]);
    expect(result.transcriptTimedText).toBe('[0:00] hello');
  });
});
