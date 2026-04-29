import { describe, expect, it, vi } from 'vitest';

async function importPodcastProviderWithoutTranscription() {
  vi.resetModules();
  vi.doMock('../packages/core/src/transcription/whisper.js', () => ({
    MAX_OPENAI_UPLOAD_BYTES: 24 * 1024 * 1024,
    isFfmpegAvailable: async () => false,
    isWhisperCppReady: async () => false,
    probeMediaDurationSecondsWithFfprobe: async () => null,
    resolveWhisperCppModelNameForDisplay: async () => null,
    transcribeMediaFileWithWhisper: async () => {
      throw new Error('unexpected transcription call');
    },
    transcribeMediaWithWhisper: async () => {
      throw new Error('unexpected transcription call');
    },
  }));

  try {
    return await import('../packages/core/src/content/transcript/providers/podcast.js');
  } finally {
    vi.doUnmock('../packages/core/src/transcription/whisper.js');
  }
}

const baseOptions = {
  apifyApiToken: null,
  falApiKey: null,
  fetch: vi.fn() as unknown as typeof fetch,
  groqApiKey: null,
  openaiApiKey: null,
  scrapeWithFirecrawl: null as unknown as ((...args: unknown[]) => unknown) | null,
  youtubeTranscriptMode: 'auto' as const,
  ytDlpPath: null,
};

describe('podcast transcript provider: RSS <podcast:transcript>', () => {
  it('uses JSON transcript from RSS without requiring transcription providers', async () => {
    const { fetchTranscript } = await importPodcastProviderWithoutTranscription();

    const transcriptUrl = 'https://example.com/transcript.json';
    const feedXml = `<?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0" xmlns:podcast="https://podcastindex.org/namespace/1.0">
        <channel>
          <item>
            <title>Ep</title>
            <podcast:transcript url="${transcriptUrl}" type="application/json" />
          </item>
        </channel>
      </rss>`;

    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url !== transcriptUrl) {
        throw new Error(`Unexpected fetch: ${url}`);
      }
      return Response.json(
        [
          { end: 0.2, start: 0.1, text: 'Hello' },
          { end: 0.3, start: 0.2, text: 'world' },
        ],
        { headers: { 'content-type': 'application/json' }, status: 200 },
      );
    });

    const result = await fetchTranscript(
      { html: feedXml, resourceKey: null, url: 'https://example.com/feed.xml' },
      { ...baseOptions, fetch: fetchImpl as unknown as typeof fetch },
    );

    expect(result.source).toBe('podcastTranscript');
    expect(result.text).toContain('Hello');
    expect(result.text).toContain('world');
    expect(result.attemptedProviders).toEqual(['podcastTranscript']);
  });

  it('uses RSS transcript for Apple Podcasts episode (iTunes lookup → feed)', async () => {
    const { fetchTranscript } = await importPodcastProviderWithoutTranscription();

    const showId = '1794526548';
    const episodeId = '1000741457032';
    const feedUrl = 'https://example.com/feed.xml';
    const transcriptUrl = 'https://example.com/transcript.vtt';

    const lookupResponse = JSON.stringify({
      resultCount: 2,
      results: [
        { feedUrl, kind: 'podcast', wrapperType: 'track' },
        {
          episodeFileExtension: 'mp3',
          episodeUrl: 'https://example.com/episode.mp3',
          trackId: Number(episodeId),
          trackName: 'Reengineering Europe – KI, Werte und die Zukunft Europas',
          trackTimeMillis: 1000,
          wrapperType: 'podcastEpisode',
        },
      ],
    });

    const feedXml = `<?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0" xmlns:podcast="https://podcastindex.org/namespace/1.0">
        <channel>
          <item>
            <title><![CDATA[Reengineering Europe – KI, Werte und die Zukunft Europas]]></title>
            <podcast:transcript url="${transcriptUrl}" type="text/vtt" />
          </item>
        </channel>
      </rss>`;

    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.startsWith('https://itunes.apple.com/lookup')) {
        return new Response(lookupResponse, {
          headers: { 'content-type': 'application/json' },
          status: 200,
        });
      }
      if (url === feedUrl) {
        return new Response(feedXml, {
          headers: { 'content-type': 'application/xml' },
          status: 200,
        });
      }
      if (url === transcriptUrl) {
        return new Response(
          `WEBVTT

00:00:00.000 --> 00:00:01.000
Hello from VTT
`,
          { headers: { 'content-type': 'text/vtt' }, status: 200 },
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const result = await fetchTranscript(
      {
        html: null,
        resourceKey: null,
        url: `https://podcasts.apple.com/us/podcast/test/id${showId}?i=${episodeId}`,
      },
      { ...baseOptions, fetch: fetchImpl as unknown as typeof fetch },
    );

    expect(result.source).toBe('podcastTranscript');
    expect(result.text).toContain('Hello from VTT');
    expect(result.attemptedProviders).toEqual(['podcastTranscript']);
  });
});
