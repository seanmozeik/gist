import { describe, expect, it, vi } from 'vitest';

async function importPodcastProvider() {
  vi.resetModules();

  const longTranscript = 'hello from spotify '.repeat(20).trim();

  vi.doMock('../src/transcription/whisper.js', () => ({
    MAX_OPENAI_UPLOAD_BYTES: 1024 * 1024,
    isFfmpegAvailable: () => Promise.resolve(true),
    isWhisperCppReady: () => Promise.resolve(false),
    probeMediaDurationSecondsWithFfprobe: async () => null,
    resolveWhisperCppModelNameForDisplay: async () => null,
    transcribeMediaFileWithWhisper: vi.fn(async () => ({
      error: null,
      notes: [],
      provider: 'openai',
      text: `${longTranscript} (file)`,
    })),
    transcribeMediaWithWhisper: vi.fn(async () => ({
      error: null,
      notes: [],
      provider: 'openai',
      text: longTranscript,
    })),
  }));

  return import('../src/content/transcript/providers/podcast.js');
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

describe('podcast provider - Spotify embed audio', () => {
  it('transcribes Spotify embed audio when available (no recaptcha)', async () => {
    const { fetchTranscript } = await importPodcastProvider();
    const episodeId = '5auotqWAXhhKyb9ymCuBJY';
    const pageUrl = `https://open.spotify.com/episode/${episodeId}`;
    const embedUrl = `https://open.spotify.com/embed/episode/${episodeId}`;
    const audioUrl = 'https://audio4-fa.scdn.co/audio/abc?token=x';

    const embedHtml = `<!doctype html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(
      {
        props: {
          pageProps: {
            state: {
              data: {
                defaultAudioFileObject: { format: 'MP4_128', url: [audioUrl] },
                entity: { duration: 90_000, subtitle: 'My Show', title: 'My Episode' },
              },
            },
          },
        },
      },
    )}</script>`;

    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();

      if (url === embedUrl && method === 'GET') {
        return new Response(embedHtml, { headers: { 'content-type': 'text/html' }, status: 200 });
      }

      if (url === audioUrl && method === 'HEAD') {
        return new Response(null, {
          headers: { 'content-length': String(1000), 'content-type': 'video/mp4' },
          status: 200,
        });
      }

      if (url === audioUrl && method === 'GET') {
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { 'content-type': 'video/mp4' },
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
    expect(result.text).toContain('hello from spotify');
    expect(result.metadata?.kind).toBe('spotify_embed_audio');
    const meta = result.metadata as unknown as { audioUrl?: string; durationSeconds?: number };
    expect(meta.audioUrl).toBe(audioUrl);
    expect(meta.durationSeconds).toBe(90);
  });
});
