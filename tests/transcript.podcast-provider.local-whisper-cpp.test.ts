import { describe, expect, it, vi } from 'vitest';

describe('podcast transcript provider: local whisper.cpp', () => {
  it('transcribes without API keys when whisper.cpp is available', async () => {
    vi.resetModules();

    vi.doMock('../src/transcription/whisper.js', () => ({
      MAX_OPENAI_UPLOAD_BYTES: 24 * 1024 * 1024,
      isFfmpegAvailable: async () => false,
      isWhisperCppReady: async () => true,
      probeMediaDurationSecondsWithFfprobe: async () => null,
      resolveWhisperCppModelNameForDisplay: async () => 'base',
      transcribeMediaFileWithWhisper: async () => ({
        error: null,
        notes: ['whisper.cpp: used local'],
        provider: 'whisper.cpp',
        text: 'local transcript ok',
      }),
      transcribeMediaWithWhisper: async () => ({
        error: null,
        notes: ['whisper.cpp: used local'],
        provider: 'whisper.cpp',
        text: 'local transcript ok',
      }),
    }));

    try {
      const { fetchTranscript } = await import('../src/content/transcript/providers/podcast.js');

      const enclosureUrl = 'https://example.com/episode.mp3';
      const xml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><item><itunes:duration>12:34</itunes:duration><enclosure url="${enclosureUrl}" type="audio/mpeg"/></item></channel></rss>`;

      const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === 'string' ? input : (input instanceof URL ? input.toString() : input.url);
        const method = (init?.method ?? 'GET').toUpperCase();
        if (url !== enclosureUrl) {
          throw new Error(`Unexpected fetch: ${method} ${url}`);
        }

        if (method === 'HEAD') {
          return new Response(null, {
            headers: { 'content-length': '4', 'content-type': 'audio/mpeg' },
            status: 200,
          });
        }
        return new Response(new Uint8Array([0, 1, 2, 3]), {
          headers: { 'content-length': '4', 'content-type': 'audio/mpeg' },
          status: 200,
        });
      });

      const result = await fetchTranscript(
        { html: xml, resourceKey: null, url: 'https://example.com/feed.xml' },
        {
          apifyApiToken: null,
          falApiKey: null,
          fetch: fetchImpl as unknown as typeof fetch,
          groqApiKey: null,
          openaiApiKey: null,
          scrapeWithFirecrawl: null,
          youtubeTranscriptMode: 'auto',
          ytDlpPath: null,
        },
      );

      expect(result.text).toContain('local transcript ok');
      expect(result.source).toBe('whisper');
      expect(result.attemptedProviders).toEqual(['whisper']);
      expect(result.metadata?.durationSeconds).toBe(12 * 60 + 34);
    } finally {
      vi.doUnmock('../src/transcription/whisper.js');
      vi.resetModules();
    }
  });
});
