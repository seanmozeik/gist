import { describe, expect, it, vi } from 'vitest';

import type { ScrapeWithFirecrawl } from '../packages/core/src/content/link-preview/deps.js';

async function importPodcastProvider() {
  vi.resetModules();

  const transcribeMediaWithWhisper = vi.fn(async () => ({
    error: null,
    notes: [],
    provider: 'openai',
    text: 'ok',
  }));
  const transcribeMediaFileWithWhisper = vi.fn(async () => ({
    error: null,
    notes: [],
    provider: 'openai',
    text: 'ok-file',
  }));

  vi.doMock('../packages/core/src/transcription/whisper.js', () => ({
    MAX_OPENAI_UPLOAD_BYTES: 100,
    isFfmpegAvailable: () => Promise.resolve(true),
    isWhisperCppReady: () => Promise.resolve(false),
    probeMediaDurationSecondsWithFfprobe: async () => null,
    resolveWhisperCppModelNameForDisplay: async () => null,
    transcribeMediaFileWithWhisper,
    transcribeMediaWithWhisper,
  }));

  const mod = await import('../packages/core/src/content/transcript/providers/podcast.js');
  return { ...mod, transcribeMediaFileWithWhisper, transcribeMediaWithWhisper };
}

const baseOptions = {
  apifyApiToken: null,
  falApiKey: null as string | null,
  groqApiKey: null as string | null,
  openaiApiKey: 'OPENAI' as string | null,
  youtubeTranscriptMode: 'auto' as const,
  ytDlpPath: null as string | null,
};

describe('podcast provider extra branches (spotify/apple/transcribe)', () => {
  it('Spotify: fails fast when embed fetch fails and Firecrawl is unavailable', async () => {
    const { fetchTranscript } = await importPodcastProvider();
    const episodeId = 'abc123';
    const pageUrl = `https://open.spotify.com/episode/${episodeId}`;
    const embedUrl = `https://open.spotify.com/embed/episode/${episodeId}`;

    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : (input instanceof URL ? input.toString() : input.url);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url === embedUrl && method === 'GET') {
        return new Response('no', { headers: { 'content-type': 'text/html' }, status: 503 });
      }
      throw new Error(`Unexpected fetch: ${method} ${url}`);
    });

    const result = await fetchTranscript(
      { html: null, resourceKey: null, url: pageUrl },
      { ...baseOptions, fetch: fetchImpl as unknown as typeof fetch, scrapeWithFirecrawl: null },
    );

    expect(result.source).toBeNull();
    expect(String(result.notes)).toContain('Spotify episode fetch failed');
  });

  it('Spotify: uses Firecrawl fallback when embed HTML looks blocked but payload is empty', async () => {
    const { fetchTranscript } = await importPodcastProvider();
    const episodeId = 'abc123';
    const pageUrl = `https://open.spotify.com/episode/${episodeId}`;
    const embedUrl = `https://open.spotify.com/embed/episode/${episodeId}`;

    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : (input instanceof URL ? input.toString() : input.url);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url === embedUrl && method === 'GET') {
        return new Response('<html>captcha</html>', {
          headers: { 'content-type': 'text/html' },
          status: 200,
        });
      }
      throw new Error(`Unexpected fetch: ${method} ${url}`);
    });

    const scrapeWithFirecrawl = vi.fn(async () => null);

    const result = await fetchTranscript(
      { html: null, resourceKey: null, url: pageUrl },
      {
        ...baseOptions,
        fetch: fetchImpl as unknown as typeof fetch,
        scrapeWithFirecrawl: scrapeWithFirecrawl as unknown as ScrapeWithFirecrawl,
      },
    );

    expect(result.source).toBeNull();
    expect(String(result.notes)).toContain('Firecrawl returned empty content');
  });

  it('Spotify: fails when Firecrawl still returns blocked content', async () => {
    const { fetchTranscript } = await importPodcastProvider();
    const episodeId = 'abc123';
    const pageUrl = `https://open.spotify.com/episode/${episodeId}`;
    const embedUrl = `https://open.spotify.com/embed/episode/${episodeId}`;

    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : (input instanceof URL ? input.toString() : input.url);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url === embedUrl && method === 'GET') {
        return new Response('<html>captcha</html>', {
          headers: { 'content-type': 'text/html' },
          status: 200,
        });
      }
      throw new Error(`Unexpected fetch: ${method} ${url}`);
    });

    const scrapeWithFirecrawl = vi.fn(async () => ({
      html: '<html>recaptcha</html>',
      markdown: 'x',
    }));

    const result = await fetchTranscript(
      { html: null, resourceKey: null, url: pageUrl },
      {
        ...baseOptions,
        fetch: fetchImpl as unknown as typeof fetch,
        scrapeWithFirecrawl: scrapeWithFirecrawl as unknown as ScrapeWithFirecrawl,
      },
    );

    expect(result.source).toBeNull();
    expect(String(result.notes)).toContain('blocked even via Firecrawl');
  });

  it('Spotify: falls back to iTunes RSS when embed has no audio URL', async () => {
    const { fetchTranscript } = await importPodcastProvider();
    const episodeId = 'abc123';
    const pageUrl = `https://open.spotify.com/episode/${episodeId}`;
    const embedUrl = `https://open.spotify.com/embed/episode/${episodeId}`;
    const feedUrl = 'https://example.com/feed.xml';
    const enclosureUrl = 'https://example.com/ep.mp3';

    const embedHtml = `<!doctype html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(
      {
        props: {
          pageProps: {
            state: {
              data: {
                defaultAudioFileObject: { url: [] },
                entity: { duration: 60_000, subtitle: 'Show', title: 'Ep' },
              },
            },
          },
        },
      },
    )}</script>`;

    const rss = `<rss><channel><item><title>Ep</title><enclosure url="${enclosureUrl}" type="audio/mpeg"/><itunes:duration>60</itunes:duration></item></channel></rss>`;

    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : (input instanceof URL ? input.toString() : input.url);
      const method = (init?.method ?? 'GET').toUpperCase();

      if (url === embedUrl && method === 'GET') {
        return new Response(embedHtml, { status: 200 });
      }

      if (url.startsWith('https://itunes.apple.com/search') && method === 'GET') {
        return new Response(JSON.stringify({ results: [{ collectionName: 'Show', feedUrl }] }), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        });
      }

      if (url === feedUrl && method === 'GET') {
        return new Response(rss, { status: 200 });
      }

      if (url === enclosureUrl && method === 'HEAD') {
        return new Response(null, {
          headers: { 'content-length': '10', 'content-type': 'audio/mpeg' },
          status: 200,
        });
      }

      if (url === enclosureUrl && method === 'GET') {
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { 'content-type': 'audio/mpeg' },
          status: 200,
        });
      }

      throw new Error(`Unexpected fetch: ${method} ${url}`);
    });

    const result = await fetchTranscript(
      { html: null, resourceKey: null, url: pageUrl },
      { ...baseOptions, fetch: fetchImpl as unknown as typeof fetch, scrapeWithFirecrawl: null },
    );

    expect(result.source).toBe('whisper');
    expect(result.metadata?.kind).toBe('spotify_itunes_rss_enclosure');
  });

  it('Spotify: falls back to iTunes RSS when embed audio transcription throws', async () => {
    const { fetchTranscript, transcribeMediaWithWhisper } = await importPodcastProvider();
    transcribeMediaWithWhisper.mockRejectedValueOnce(new Error('ffmpeg failed (69)'));

    const episodeId = 'abc123';
    const pageUrl = `https://open.spotify.com/episode/${episodeId}`;
    const embedUrl = `https://open.spotify.com/embed/episode/${episodeId}`;
    const embedAudioUrl = 'https://scdn.example.com/drm-preview.mp4';
    const feedUrl = 'https://example.com/feed.xml';
    const enclosureUrl = 'https://example.com/ep.mp3';

    const embedHtml = `<!doctype html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(
      {
        props: {
          pageProps: {
            state: {
              data: {
                defaultAudioFileObject: { url: [embedAudioUrl] },
                entity: { duration: 60_000, subtitle: 'Show', title: 'Ep' },
              },
            },
          },
        },
      },
    )}</script>`;
    const rss = `<rss><channel><item><title>Ep</title><enclosure url="${enclosureUrl}" type="audio/mpeg"/></item></channel></rss>`;

    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : (input instanceof URL ? input.toString() : input.url);
      const method = (init?.method ?? 'GET').toUpperCase();

      if (url === embedUrl && method === 'GET') {
        return new Response(embedHtml, { status: 200 });
      }

      if (url.startsWith('https://itunes.apple.com/search') && method === 'GET') {
        return new Response(JSON.stringify({ results: [{ collectionName: 'Show', feedUrl }] }), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        });
      }

      if (url === feedUrl && method === 'GET') {
        return new Response(rss, { status: 200 });
      }

      if ((url === embedAudioUrl || url === enclosureUrl) && method === 'HEAD') {
        return new Response(null, {
          headers: { 'content-length': '10', 'content-type': 'audio/mpeg' },
          status: 200,
        });
      }

      if ((url === embedAudioUrl || url === enclosureUrl) && method === 'GET') {
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { 'content-type': 'audio/mpeg' },
          status: 200,
        });
      }

      throw new Error(`Unexpected fetch: ${method} ${url}`);
    });

    const result = await fetchTranscript(
      { html: null, resourceKey: null, url: pageUrl },
      { ...baseOptions, fetch: fetchImpl as unknown as typeof fetch, scrapeWithFirecrawl: null },
    );

    expect(result.source).toBe('whisper');
    expect(result.metadata?.kind).toBe('spotify_itunes_rss_enclosure');
    expect(transcribeMediaWithWhisper).toHaveBeenCalledTimes(2);
    expect(result.notes).toContain('falling back to iTunes RSS: ffmpeg failed');
  });

  it('Spotify: skips encrypted CBCS embed audio and falls back to iTunes RSS', async () => {
    const { fetchTranscript, transcribeMediaWithWhisper } = await importPodcastProvider();
    const episodeId = 'abc123';
    const pageUrl = `https://open.spotify.com/episode/${episodeId}`;
    const embedUrl = `https://open.spotify.com/embed/episode/${episodeId}`;
    const encryptedEmbedAudioUrl = 'https://audio4-fa.scdn.co/audio/encrypted';
    const feedUrl = 'https://example.com/feed.xml';
    const enclosureUrl = 'https://example.com/ep.mp3';

    const embedHtml = `<!doctype html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(
      {
        props: {
          pageProps: {
            state: {
              data: {
                defaultAudioFileObject: { format: 'MP4_128_CBCS', url: [encryptedEmbedAudioUrl] },
                entity: { duration: 60_000, subtitle: 'Show', title: 'Ep' },
              },
            },
          },
        },
      },
    )}</script>`;
    const rss = `<rss><channel><item><title>Ep</title><enclosure url="${enclosureUrl}" type="audio/mpeg"/></item></channel></rss>`;

    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : (input instanceof URL ? input.toString() : input.url);
      const method = (init?.method ?? 'GET').toUpperCase();

      if (url === embedUrl && method === 'GET') {
        return new Response(embedHtml, { status: 200 });
      }

      if (url.startsWith('https://itunes.apple.com/search') && method === 'GET') {
        return new Response(JSON.stringify({ results: [{ collectionName: 'Show', feedUrl }] }), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        });
      }

      if (url === feedUrl && method === 'GET') {
        return new Response(rss, { status: 200 });
      }

      if (url === enclosureUrl && method === 'HEAD') {
        return new Response(null, {
          headers: { 'content-length': '10', 'content-type': 'audio/mpeg' },
          status: 200,
        });
      }

      if (url === enclosureUrl && method === 'GET') {
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { 'content-type': 'audio/mpeg' },
          status: 200,
        });
      }

      throw new Error(`Unexpected fetch: ${method} ${url}`);
    });

    const result = await fetchTranscript(
      { html: null, resourceKey: null, url: pageUrl },
      { ...baseOptions, fetch: fetchImpl as unknown as typeof fetch, scrapeWithFirecrawl: null },
    );

    expect(result.source).toBe('whisper');
    expect(result.metadata?.kind).toBe('spotify_itunes_rss_enclosure');
    expect(result.metadata?.enclosureUrl).toBe(enclosureUrl);
    expect(transcribeMediaWithWhisper).toHaveBeenCalledTimes(1);
    expect(fetchImpl).not.toHaveBeenCalledWith(encryptedEmbedAudioUrl, expect.anything());
    expect(result.notes).toContain('format MP4_128_CBCS looks encrypted');
  });

  it('Apple: picks newest episode when i= is missing', async () => {
    const { fetchTranscript } = await importPodcastProvider();
    const showId = '1794526548';
    const pageUrl = `https://podcasts.apple.com/us/podcast/test/id${showId}`;
    const lookupUrl = `https://itunes.apple.com/lookup?id=${showId}&entity=podcastEpisode&limit=200`;
    const olderUrl = 'https://cdn.example/older.mp3';
    const newerUrl = 'https://cdn.example/newer.mp3';

    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : (input instanceof URL ? input.toString() : input.url);
      const method = (init?.method ?? 'GET').toUpperCase();

      if (url === lookupUrl && method === 'GET') {
        return new Response(
          JSON.stringify({
            results: [
              { feedUrl: 'https://example.com/feed.xml', kind: 'podcast', wrapperType: 'track' },
              {
                episodeUrl: olderUrl,
                releaseDate: '2025-01-01T00:00:00Z',
                trackId: 1,
                wrapperType: 'podcastEpisode',
              },
              {
                episodeUrl: newerUrl,
                releaseDate: '2025-12-01T00:00:00Z',
                trackId: 2,
                wrapperType: 'podcastEpisode',
              },
            ],
          }),
          { headers: { 'content-type': 'application/json' }, status: 200 },
        );
      }

      if (url === newerUrl && method === 'HEAD') {
        return new Response(null, {
          headers: { 'content-length': '10', 'content-type': 'audio/mpeg' },
          status: 200,
        });
      }
      if (url === newerUrl && method === 'GET') {
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
    const meta = result.metadata as unknown as { episodeUrl?: string };
    expect(meta.episodeUrl).toBe(newerUrl);
  });

  it('transcribes via temp file when HEAD has no content-length', async () => {
    const { fetchTranscript, transcribeMediaFileWithWhisper } = await importPodcastProvider();
    const enclosureUrl = 'https://example.com/episode.mp3';
    const xml = `<rss><channel><item><enclosure url="${enclosureUrl}" type="audio/mpeg"/></item></channel></rss>`;

    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : (input instanceof URL ? input.toString() : input.url);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'HEAD') {
        return new Response(null, { headers: { 'content-type': 'audio/mpeg' }, status: 200 });
      }
      if (url === enclosureUrl && method === 'GET') {
        return new Response(new Uint8Array([1, 2, 3, 4, 5]), {
          headers: { 'content-type': 'audio/mpeg' },
          status: 200,
        });
      }
      throw new Error(`Unexpected fetch: ${method} ${url}`);
    });

    const result = await fetchTranscript(
      { html: xml, resourceKey: null, url: 'https://example.com/feed.xml' },
      { ...baseOptions, fetch: fetchImpl as unknown as typeof fetch },
    );

    expect(result.source).toBe('whisper');
    expect(transcribeMediaFileWithWhisper).toHaveBeenCalled();
  });

  it('reports enclosure download errors cleanly', async () => {
    const { fetchTranscript } = await importPodcastProvider();
    const enclosureUrl = 'https://example.com/episode.mp3';
    const xml = `<rss><channel><item><enclosure url="${enclosureUrl}" type="audio/mpeg"/></item></channel></rss>`;

    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : (input instanceof URL ? input.toString() : input.url);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'HEAD') {
        return new Response(null, {
          headers: { 'content-length': '10', 'content-type': 'audio/mpeg' },
          status: 200,
        });
      }
      if (url === enclosureUrl && method === 'GET') {
        return new Response('nope', { status: 403 });
      }
      throw new Error(`Unexpected fetch: ${method} ${url}`);
    });

    const result = await fetchTranscript(
      { html: xml, resourceKey: null, url: 'https://example.com/feed.xml' },
      { ...baseOptions, fetch: fetchImpl as unknown as typeof fetch },
    );

    expect(result.source).toBeNull();
    expect(String(result.notes)).toContain('Download failed');
  });
});
