import { describe, expect, it, vi } from 'vitest';

import { fetchTranscript } from '../src/content/transcript/providers/podcast.js';

const baseOptions = {
  apifyApiToken: null,
  falApiKey: null,
  fetch: vi.fn() as unknown as typeof fetch,
  groqApiKey: null,
  openaiApiKey: 'OPENAI',
  scrapeWithFirecrawl: null as unknown as ((...args: unknown[]) => unknown) | null,
  youtubeTranscriptMode: 'auto' as const,
  ytDlpPath: null,
};

describe('podcast transcript provider - Spotify error modes', () => {
  it('handles non-OK Spotify embed fetch', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url === 'https://open.spotify.com/embed/episode/abc') {
        return new Response('nope', { headers: { 'content-type': 'text/html' }, status: 403 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const result = await fetchTranscript(
      { html: '<html/>', resourceKey: null, url: 'https://open.spotify.com/episode/abc' },
      { ...baseOptions, fetch: fetchImpl as unknown as typeof fetch },
    );

    expect(result.text).toBeNull();
    expect(result.notes).toContain('Spotify episode fetch failed');
    expect(result.notes).toContain('Spotify embed fetch failed (403)');
  });

  it('does not require Firecrawl when the embed page is blocked but Firecrawl is not configured', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url === 'https://open.spotify.com/embed/episode/abc') {
        return new Response('<html><body>captcha</body></html>', {
          headers: { 'content-type': 'text/html' },
          status: 200,
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const result = await fetchTranscript(
      { html: '<html/>', resourceKey: null, url: 'https://open.spotify.com/episode/abc' },
      { ...baseOptions, fetch: fetchImpl as unknown as typeof fetch, scrapeWithFirecrawl: null },
    );

    expect(result.text).toBeNull();
    expect(result.notes).toContain('Spotify episode fetch failed');
    expect(result.notes).toContain('blocked');
  });

  it('errors when Firecrawl fallback returns empty content', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url === 'https://open.spotify.com/embed/episode/abc') {
        return new Response('<html><body>captcha</body></html>', {
          headers: { 'content-type': 'text/html' },
          status: 200,
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    const scrapeWithFirecrawl = vi.fn(async () => ({ html: '', markdown: '' }));

    const result = await fetchTranscript(
      { html: '<html/>', resourceKey: null, url: 'https://open.spotify.com/episode/abc' },
      {
        ...baseOptions,
        fetch: fetchImpl as unknown as typeof fetch,
        scrapeWithFirecrawl:
          scrapeWithFirecrawl as unknown as typeof baseOptions.scrapeWithFirecrawl,
      },
    );

    expect(result.text).toBeNull();
    expect(result.notes).toContain('Firecrawl returned empty content');
  });

  it('errors when Spotify embed is blocked even via Firecrawl', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url === 'https://open.spotify.com/embed/episode/abc') {
        return new Response('<html><body>captcha</body></html>', {
          headers: { 'content-type': 'text/html' },
          status: 200,
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    const scrapeWithFirecrawl = vi.fn(async () => ({
      html: '<html>recaptcha</html>',
      markdown: '',
    }));

    const result = await fetchTranscript(
      { html: '<html/>', resourceKey: null, url: 'https://open.spotify.com/episode/abc' },
      {
        ...baseOptions,
        fetch: fetchImpl as unknown as typeof fetch,
        scrapeWithFirecrawl:
          scrapeWithFirecrawl as unknown as typeof baseOptions.scrapeWithFirecrawl,
      },
    );

    expect(result.text).toBeNull();
    expect(result.notes).toContain('blocked even via Firecrawl');
  });

  it('errors when embed HTML lacks usable titles in __NEXT_DATA__', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input : new URL(input.url);
      if (url.toString() === 'https://open.spotify.com/embed/episode/abc') {
        return new Response(
          '<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"state":{"data":{"entity":{"title":"","subtitle":""}}}}}}</script>',
          { headers: { 'content-type': 'text/html' }, status: 200 },
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const result = await fetchTranscript(
      { html: '<html/>', resourceKey: null, url: 'https://open.spotify.com/episode/abc' },
      { ...baseOptions, fetch: fetchImpl as unknown as typeof fetch },
    );

    expect(result.text).toBeNull();
    expect(result.notes).toContain('Spotify embed data not found');
  });

  it('errors when iTunes Search fails to resolve an RSS feed', async () => {
    const showTitle = 'My Podcast Show';
    const episodeTitle = 'Episode 1';
    const embedHtml = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: {
        pageProps: { state: { data: { entity: { subtitle: showTitle, title: episodeTitle } } } },
      },
    })}</script>`;

    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url === 'https://open.spotify.com/embed/episode/abc') {
        return new Response(embedHtml, { headers: { 'content-type': 'text/html' }, status: 200 });
      }
      if (url.startsWith('https://itunes.apple.com/search')) {
        return new Response('nope', { headers: { 'content-type': 'text/plain' }, status: 500 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const result = await fetchTranscript(
      { html: '<html/>', resourceKey: null, url: 'https://open.spotify.com/episode/abc' },
      { ...baseOptions, fetch: fetchImpl as unknown as typeof fetch },
    );

    expect(result.text).toBeNull();
    expect(result.notes).toContain('could not resolve RSS feed');
  });
});
