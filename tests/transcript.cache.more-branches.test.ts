import { describe, expect, it, vi } from 'vitest';

import type { TranscriptCache } from '../src/content/cache/types';
import {
  DEFAULT_TTL_MS,
  mapCachedSource,
  NEGATIVE_TTL_MS,
  readTranscriptCache,
  writeTranscriptCache,
} from '../src/content/transcript/cache.js';

describe('transcript cache - more branches', () => {
  it('reports bypass diagnostics even without a cache', async () => {
    const outcome = await readTranscriptCache({
      cacheMode: 'bypass',
      transcriptCache: null,
      url: 'u',
    });

    expect(outcome.cached).toBeNull();
    expect(outcome.resolution).toBeNull();
    expect(outcome.diagnostics.cacheStatus).toBe('bypassed');
    expect(outcome.diagnostics.notes).toContain('Cache bypass requested');
  });

  it('reads cache miss / bypass / expired / hit', async () => {
    const miss = await readTranscriptCache({
      cacheMode: 'default',
      transcriptCache: null,
      url: 'u',
    });
    expect(miss.cached).toBeNull();
    expect(miss.diagnostics.cacheStatus).toBe('miss');

    const cache: TranscriptCache = {
      get: vi.fn(async (_args: { url: string }) => ({
        content: 'hi',
        expired: false,
        metadata: { a: 1 },
        source: 'youtubei',
      })),
      set: vi.fn(async () => {
        /* Empty */
      }),
    };

    const bypass = await readTranscriptCache({
      cacheMode: 'bypass',
      transcriptCache: cache,
      url: 'u',
    });
    expect(bypass.cached).not.toBeNull();
    expect(bypass.resolution).toBeNull();
    expect(bypass.diagnostics.cacheStatus).toBe('bypassed');
    expect(bypass.diagnostics.notes).toContain('Cache bypass requested');

    cache.get.mockResolvedValueOnce({
      content: 'hi',
      expired: true,
      metadata: null,
      source: 'captionTracks',
    });
    const expired = await readTranscriptCache({
      cacheMode: 'default',
      transcriptCache: cache,
      url: 'u',
    });
    expect(expired.diagnostics.cacheStatus).toBe('expired');
    expect(expired.resolution).toBeNull();

    cache.get.mockResolvedValueOnce({
      content: 'hi',
      expired: false,
      metadata: null,
      source: 'captionTracks',
    });
    const hit = await readTranscriptCache({
      cacheMode: 'default',
      transcriptCache: cache,
      url: 'u',
    });
    expect(hit.diagnostics.cacheStatus).toBe('hit');
    expect(hit.resolution?.text).toBe('hi');
    expect(hit.resolution?.source).toBe('captionTracks');

    cache.get.mockResolvedValueOnce({
      content: '',
      expired: false,
      metadata: null,
      source: 'weird',
    });
    const empty = await readTranscriptCache({
      cacheMode: 'default',
      transcriptCache: cache,
      url: 'u',
    });
    expect(empty.diagnostics.textProvided).toBe(false);
    expect(empty.resolution?.source).toBe('unknown');
  });

  it('propagates cached metadata + attempted providers on hit', async () => {
    const cache: TranscriptCache = {
      get: vi.fn(async () => ({
        content: 'cached transcript',
        expired: false,
        metadata: { episode: 12 },
        source: 'podcastTranscript',
      })),
      set: vi.fn(async () => {
        /* Empty */
      }),
    };

    const hit = await readTranscriptCache({
      cacheMode: 'default',
      transcriptCache: cache,
      url: 'u',
    });

    expect(hit.resolution?.metadata).toEqual({ episode: 12 });
    expect(hit.diagnostics.attemptedProviders).toEqual(['podcastTranscript']);
  });

  it('maps cached sources, including unknown values', () => {
    expect(mapCachedSource(null)).toBeNull();
    expect(mapCachedSource('yt-dlp')).toBe('yt-dlp');
    expect(mapCachedSource('weird')).toBe('unknown');
  });

  it('writes cache entries with correct TTL + resolved source', async () => {
    const cache: TranscriptCache = {
      get: vi.fn(async () => null),
      set: vi.fn(async () => {
        /* Empty */
      }),
    };

    await writeTranscriptCache({
      resourceKey: null,
      result: { source: 'youtubei', text: 'hi' },
      service: 'svc',
      transcriptCache: null,
      url: 'u',
    });

    await writeTranscriptCache({
      resourceKey: null,
      result: { source: null, text: null },
      service: 'svc',
      transcriptCache: cache,
      url: 'u',
    });
    expect(cache.set).not.toHaveBeenCalled();

    await writeTranscriptCache({
      resourceKey: null,
      result: { source: 'youtubei', text: null },
      service: 'svc',
      transcriptCache: cache,
      url: 'u',
    });
    expect(cache.set).toHaveBeenCalledWith(
      expect.objectContaining({ content: null, source: 'youtubei', ttlMs: NEGATIVE_TTL_MS }),
    );

    await writeTranscriptCache({
      resourceKey: null,
      result: { metadata: { x: 1 }, source: null, text: 'hi' },
      service: 'svc',
      transcriptCache: cache,
      url: 'u',
    });
    expect(cache.set).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'hi',
        metadata: { x: 1 },
        source: 'unknown',
        ttlMs: DEFAULT_TTL_MS,
      }),
    );
  });
});
