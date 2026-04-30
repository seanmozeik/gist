import { describe, expect, it, vi } from 'vitest';

import type { TranscriptCache } from '../src/content/cache/types.js';
import { readTranscriptCache, writeTranscriptCache } from '../src/content/transcript/cache.js';
import { resolveTranscriptForLink } from '../src/content/transcript/index.js';

describe('transcript cache helpers', () => {
  it('reads a cached transcript hit', async () => {
    const transcriptCache: TranscriptCache = {
      get: vi.fn(async () => ({
        content: 'cached transcript',
        expired: false,
        metadata: null,
        source: 'captionTracks',
      })),
      set: vi.fn(async () => {
        /* Empty */
      }),
    };

    const outcome = await readTranscriptCache({
      cacheMode: 'default',
      transcriptCache,
      url: 'https://www.youtube.com/watch?v=abcdefghijk',
    });

    expect(outcome.resolution?.text).toBe('cached transcript');
    expect(outcome.resolution?.source).toBe('captionTracks');
    expect(outcome.diagnostics.cacheStatus).toBe('hit');
    expect(vi.mocked(transcriptCache.get)).toHaveBeenCalledTimes(1);
  });

  it('returns cache miss when timestamps requested but cached segments missing', async () => {
    const transcriptCache: TranscriptCache = {
      get: vi.fn(async () => ({
        content: 'cached transcript',
        expired: false,
        metadata: { timestamps: true },
        source: 'captionTracks',
      })),
      set: vi.fn(async () => {
        /* Empty */
      }),
    };

    const outcome = await readTranscriptCache({
      cacheMode: 'default',
      transcriptCache,
      transcriptTimestamps: true,
      url: 'https://example.com',
    });

    expect(outcome.resolution).toBeNull();
    expect(outcome.diagnostics.notes).toContain('missing timestamps');
  });

  it('keeps cached transcript when timestamps are explicitly unavailable', async () => {
    const transcriptCache: TranscriptCache = {
      get: vi.fn(async () => ({
        content: 'cached transcript',
        expired: false,
        metadata: { timestamps: false },
        source: 'captionTracks',
      })),
      set: vi.fn(async () => {
        /* Empty */
      }),
    };

    const outcome = await readTranscriptCache({
      cacheMode: 'default',
      transcriptCache,
      transcriptTimestamps: true,
      url: 'https://example.com',
    });

    expect(outcome.resolution?.text).toBe('cached transcript');
    expect(outcome.diagnostics.notes).toContain('timestamps unavailable');
  });

  it('returns cached segments when timestamps are requested', async () => {
    const transcriptCache: TranscriptCache = {
      get: vi.fn(async () => ({
        content: 'cached transcript',
        expired: false,
        metadata: {
          segments: [
            { endMs: 2000, startMs: 1000, text: 'Hello' },
            { endMs: null, startMs: 2000, text: 'world' },
          ],
        },
        source: 'captionTracks',
      })),
      set: vi.fn(async () => {
        /* Empty */
      }),
    };

    const outcome = await readTranscriptCache({
      cacheMode: 'default',
      transcriptCache,
      transcriptTimestamps: true,
      url: 'https://example.com',
    });

    expect(outcome.resolution?.segments).toEqual([
      { endMs: 2000, startMs: 1000, text: 'Hello' },
      { endMs: null, startMs: 2000, text: 'world' },
    ]);
  });

  it('skips cache reads when bypass requested', async () => {
    const transcriptCache: TranscriptCache = {
      get: vi.fn(async () => ({
        content: 'cached transcript',
        expired: true,
        metadata: null,
        source: 'captionTracks',
      })),
      set: vi.fn(async () => {
        /* Empty */
      }),
    };

    const outcome = await readTranscriptCache({
      cacheMode: 'bypass',
      transcriptCache,
      url: 'https://example.com',
    });

    expect(outcome.resolution).toBeNull();
    expect(outcome.diagnostics.cacheStatus).toBe('bypassed');
  });

  it('writes negative cache entries with shorter TTL', async () => {
    const transcriptCache: TranscriptCache = {
      get: vi.fn(async () => null),
      set: vi.fn(async () => {
        /* Empty */
      }),
    };

    await writeTranscriptCache({
      resourceKey: null,
      result: { metadata: { reason: 'nope' }, source: 'unavailable', text: null },
      service: 'generic',
      transcriptCache,
      url: 'https://example.com',
    });

    expect(vi.mocked(transcriptCache.set)).toHaveBeenCalledTimes(1);
    const args = vi.mocked(transcriptCache.set).mock.calls[0]?.[0];
    expect(args?.ttlMs).toBeGreaterThan(0);
    expect(args?.ttlMs).toBeLessThan(1000 * 60 * 60 * 24);
    expect(args?.source).toBe('unavailable');
  });
});

describe('transcript cache integration', () => {
  it('falls back to cached transcript content when provider misses', async () => {
    const transcriptCache: TranscriptCache = {
      get: vi.fn(async () => ({
        content: 'cached transcript',
        expired: true,
        metadata: null,
        source: 'captionTracks',
      })),
      set: vi.fn(async () => {
        /* Empty */
      }),
    };

    const fetchMock = vi.fn(async () => new Response('nope', { status: 500 }));

    const result = await resolveTranscriptForLink(
      'https://www.youtube.com/watch?v=abcdefghijk',
      '<html></html>',
      {
        apifyApiToken: null,
        convertHtmlToMarkdown: null,
        falApiKey: null,
        fetch: fetchMock as unknown as typeof fetch,
        groqApiKey: null,
        openaiApiKey: null,
        readTweetWithBird: null,
        scrapeWithFirecrawl: null,
        transcriptCache,
        ytDlpPath: null,
      },
      { cacheMode: 'default', youtubeTranscriptMode: 'web' },
    );

    expect(result.text).toBe('cached transcript');
    expect(result.source).toBe('captionTracks');
    expect(result.diagnostics?.cacheStatus).toBe('fallback');
    expect(result.diagnostics?.notes).toContain('Falling back');
  });
});
