import { describe, expect, it, vi } from 'vitest';

import { fetchLinkContent } from '../src/content/link-preview/content/index';

describe('Spotify episode short-circuit', () => {
  it('skips fetching the Spotify episode HTML page and returns transcript content (URL variations)', async () => {
    const episodeId = '5auotqWAXhhKyb9ymCuBJY';
    const urls = [
      `https://open.spotify.com/episode/${episodeId}`,
      `https://open.spotify.com/episode/${episodeId}?si=deadbeef`,
      `https://open.spotify.com/episode/${episodeId}/`,
      `https://open.spotify.com/embed/episode/${episodeId}`,
    ];
    const showTitle = 'My Podcast Show';
    const episodeTitle = 'Episode 1';
    const feedUrl = 'https://example.com/feed.xml';
    const enclosureUrl = 'https://example.com/episode.mp3';

    const embedHtml = `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(
      {
        props: {
          pageProps: { state: { data: { entity: { subtitle: showTitle, title: episodeTitle } } } },
        },
      },
    )}</script></body></html>`;

    const feedXml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><item><title><![CDATA[${episodeTitle}]]></title><enclosure url="${enclosureUrl}" type="audio/mpeg"/></item></channel></rss>`;

    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const resolved =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();

      if (resolved.startsWith('https://open.spotify.com/episode/')) {
        throw new Error('should not fetch episode HTML');
      }

      if (resolved === `https://open.spotify.com/embed/episode/${episodeId}`) {
        return new Response(embedHtml, { headers: { 'content-type': 'text/html' }, status: 200 });
      }

      if (resolved.startsWith('https://itunes.apple.com/search')) {
        return Response.json(
          { resultCount: 1, results: [{ collectionName: showTitle, feedUrl }] },
          { headers: { 'content-type': 'application/json' }, status: 200 },
        );
      }

      if (resolved === feedUrl) {
        return new Response(feedXml, {
          headers: { 'content-type': 'application/xml' },
          status: 200,
        });
      }

      if (resolved === enclosureUrl) {
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
      }

      throw new Error(`unexpected fetch: ${method} ${resolved}`);
    });

    const transcribeGlobalFetch = vi.fn(async (input: RequestInfo | URL) => {
      const resolved =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (resolved.includes('https://openrouter.ai/api/v1/chat/completions')) {
        return Response.json({ choices: [{ message: { content: 'hello world from spotify' } }] });
      }
      throw new Error(`unexpected transcribe fetch: ${resolved}`);
    });

    try {
      vi.stubGlobal('fetch', transcribeGlobalFetch as unknown as typeof fetch);

      for (const url of urls) {
        const result = await fetchLinkContent(
          url,
          { cacheMode: 'bypass', timeoutMs: 60_000 },
          {
            apifyApiToken: null,
            convertHtmlToMarkdown: null,
            env: {
              GEMINI_API_KEY: '',
              GIST_DISABLE_LOCAL_WHISPER_CPP: '1',
              GOOGLE_API_KEY: '',
              GOOGLE_GENERATIVE_AI_API_KEY: '',
              OPENROUTER_API_KEY: 'test-openrouter',
            },
            falApiKey: null,
            fetchImplementation: fetchImpl as unknown as typeof fetch,
            groqApiKey: null,
            openaiApiKey: 'OPENAI',
            scrapeWithFirecrawl: null,
            transcriptCache: null,
            ytDlpPath: null,
          },
        );

        expect(result.transcriptSource).toBe('whisper');
        expect(result.content).toContain('Transcript:');
        expect(result.content).toContain('hello world from spotify');
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('fails loudly when no transcription keys are configured', async () => {
    vi.stubEnv('GIST_DISABLE_LOCAL_WHISPER_CPP', '1');
    try {
      await expect(
        fetchLinkContent(
          'https://open.spotify.com/episode/5auotqWAXhhKyb9ymCuBJY',
          { cacheMode: 'bypass', timeoutMs: 60_000 },
          {
            apifyApiToken: null,
            convertHtmlToMarkdown: null,
            env: {
              GEMINI_API_KEY: '',
              GIST_DISABLE_LOCAL_WHISPER_CPP: '1',
              GOOGLE_API_KEY: '',
              GOOGLE_GENERATIVE_AI_API_KEY: '',
            },
            falApiKey: null,
            fetchImplementation: vi.fn() as unknown as typeof fetch,
            groqApiKey: null,
            openaiApiKey: null,
            scrapeWithFirecrawl: null,
            transcriptCache: null,
            ytDlpPath: null,
          },
        ),
      ).rejects.toThrow(/Spotify episode transcription requires|transcription provider/i);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('supports Gemini-only transcription for Spotify episode short-circuit', async () => {
    const episodeId = '5auotqWAXhhKyb9ymCuBJY';
    const showTitle = 'My Podcast Show';
    const episodeTitle = 'Episode 1';
    const feedUrl = 'https://example.com/feed.xml';
    const enclosureUrl = 'https://example.com/episode.mp3';

    const embedHtml = `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(
      {
        props: {
          pageProps: { state: { data: { entity: { subtitle: showTitle, title: episodeTitle } } } },
        },
      },
    )}</script></body></html>`;

    const feedXml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><item><title><![CDATA[${episodeTitle}]]></title><enclosure url="${enclosureUrl}" type="audio/mpeg"/></item></channel></rss>`;

    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const resolved =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();

      if (resolved === `https://open.spotify.com/embed/episode/${episodeId}`) {
        return new Response(embedHtml, { headers: { 'content-type': 'text/html' }, status: 200 });
      }
      if (resolved.startsWith('https://itunes.apple.com/search')) {
        return Response.json(
          { resultCount: 1, results: [{ collectionName: showTitle, feedUrl }] },
          { headers: { 'content-type': 'application/json' }, status: 200 },
        );
      }
      if (resolved === feedUrl) {
        return new Response(feedXml, {
          headers: { 'content-type': 'application/xml' },
          status: 200,
        });
      }
      if (resolved === enclosureUrl) {
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
      }
      throw new Error(`unexpected fetch: ${method} ${resolved}`);
    });

    const transcribeGlobalFetch = vi.fn(async (input: RequestInfo | URL) => {
      const resolved =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (resolved.includes('https://openrouter.ai/api/v1/chat/completions')) {
        return Response.json({
          choices: [{ message: { content: 'hello world from gemini spotify' } }],
        });
      }
      throw new Error(`unexpected transcribe fetch: ${resolved}`);
    });

    try {
      vi.stubEnv('GIST_DISABLE_LOCAL_WHISPER_CPP', '1');
      vi.stubGlobal('fetch', transcribeGlobalFetch as unknown as typeof fetch);
      const result = await fetchLinkContent(
        `https://open.spotify.com/episode/${episodeId}`,
        { cacheMode: 'bypass', timeoutMs: 60_000 },
        {
          apifyApiToken: null,
          convertHtmlToMarkdown: null,
          env: {
            GEMINI_API_KEY: 'GEMINI',
            GIST_DISABLE_LOCAL_WHISPER_CPP: '1',
            GOOGLE_API_KEY: '',
            GOOGLE_GENERATIVE_AI_API_KEY: '',
            OPENROUTER_API_KEY: 'test-openrouter',
          },
          falApiKey: null,
          fetchImplementation: fetchImpl as unknown as typeof fetch,
          geminiApiKey: 'GEMINI',
          groqApiKey: null,
          openaiApiKey: null,
          scrapeWithFirecrawl: null,
          transcriptCache: null,
          ytDlpPath: null,
        },
      );

      expect(result.transcriptSource).toBe('whisper');
      expect(result.content).toContain('hello world from gemini spotify');
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
});
