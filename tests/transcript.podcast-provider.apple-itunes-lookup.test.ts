import { describe, expect, it, vi } from 'vitest';

async function importPodcastProvider() {
  vi.resetModules();

  vi.doMock('../packages/core/src/transcription/whisper.js', () => ({
    MAX_OPENAI_UPLOAD_BYTES: 1024 * 1024,
    isFfmpegAvailable: () => Promise.resolve(true),
    isWhisperCppReady: () => Promise.resolve(false),
    probeMediaDurationSecondsWithFfprobe: async () => null,
    resolveWhisperCppModelNameForDisplay: async () => null,
    transcribeMediaFileWithWhisper: vi.fn(async () => ({
      error: null,
      notes: [],
      provider: 'openai',
      text: 'hello from apple (file)',
    })),
    transcribeMediaWithWhisper: vi.fn(async () => ({
      error: null,
      notes: [],
      provider: 'openai',
      text: 'hello from apple',
    })),
  }));

  return import('../packages/core/src/content/transcript/providers/podcast.js');
}

const baseOptions = {
  apifyApiToken: null,
  falApiKey: null as string | null,
  groqApiKey: null as string | null,
  openaiApiKey: 'OPENAI' as string | null,
  scrapeWithFirecrawl: null as unknown as ((...args: unknown[]) => unknown) | null,
  youtubeTranscriptMode: 'auto' as const,
  ytDlpPath: null as string | null,
};

describe('podcast provider - Apple Podcasts iTunes lookup', () => {
  it('resolves episodeUrl via iTunes lookup when HTML is missing', async () => {
    const { fetchTranscript } = await importPodcastProvider();

    const showId = '1794526548';
    const episodeId = '1000741457032';
    const pageUrl = `https://podcasts.apple.com/us/podcast/test/id${showId}?i=${episodeId}`;
    const lookupUrl = `https://itunes.apple.com/lookup?id=${showId}&entity=podcastEpisode&limit=200`;
    const episodeUrl = 'https://cdn.example/episode.mp3?source=feed';

    const lookupPayload = {
      resultCount: 2,
      results: [
        { feedUrl: 'https://example.com/feed.xml', kind: 'podcast', wrapperType: 'track' },
        {
          episodeFileExtension: 'mp3',
          episodeUrl,
          releaseDate: '2025-12-01T00:00:00Z',
          trackId: Number(episodeId),
          trackTimeMillis: 96_000,
          wrapperType: 'podcastEpisode',
        },
      ],
    };

    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();

      if (url === lookupUrl && method === 'GET') {
        return Response.json(lookupPayload, {
          headers: { 'content-type': 'application/json' },
          status: 200,
        });
      }

      if (url === episodeUrl && method === 'HEAD') {
        return new Response(null, {
          headers: { 'content-length': String(1234), 'content-type': 'audio/mpeg' },
          status: 200,
        });
      }

      if (url === episodeUrl && method === 'GET') {
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { 'content-type': 'audio/mpeg' },
          status: 200,
        });
      }

      throw new Error(`Unexpected fetch: ${method} ${url}`);
    });

    const result = await fetchTranscript(
      { html: null, resourceKey: null, url: pageUrl },
      { ...baseOptions, fetch: fetchImpl as unknown as typeof fetch },
    );

    expect(result.source).toBe('whisper');
    expect(result.text).toContain('hello from apple');
    expect(result.metadata?.kind).toBe('apple_itunes_episode');
    const meta = result.metadata as unknown as {
      showId?: string;
      episodeId?: string;
      episodeUrl?: string;
      durationSeconds?: number;
    };
    expect(meta.showId).toBe(showId);
    expect(meta.episodeId).toBe(episodeId);
    expect(meta.episodeUrl).toBe(episodeUrl);
    expect(meta.durationSeconds).toBe(96);
  });
});
