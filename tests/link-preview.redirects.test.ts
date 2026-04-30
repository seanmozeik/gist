import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveTranscriptForLink: vi.fn(async () => ({
    diagnostics: {
      attemptedProviders: [],
      cacheMode: 'default',
      cacheStatus: 'miss',
      notes: null,
      provider: null,
      textProvided: false,
    },
    metadata: null,
    source: null,
    text: null,
  })),
}));

vi.mock('../src/content/transcript/index.js', () => ({
  resolveTranscriptForLink: mocks.resolveTranscriptForLink,
}));

import { fetchLinkContent } from '../src/content/link-preview/content/index.js';

const buildDeps = (fetchImpl: typeof fetch) => ({
  apifyApiToken: null,
  convertHtmlToMarkdown: null,
  falApiKey: null,
  fetch: fetchImpl,
  groqApiKey: null,
  onProgress: null,
  openaiApiKey: null,
  readTweetWithBird: null,
  resolveTwitterCookies: null,
  scrapeWithFirecrawl: null,
  transcriptCache: null,
  ytDlpPath: null,
});

describe('link preview redirects', () => {
  it('uses the final URL for extraction and transcript resolution', async () => {
    mocks.resolveTranscriptForLink.mockClear();

    const html = '<html><head><title>Gist</title></head><body>Hello</body></html>';
    const response = new Response(html, { headers: { 'content-type': 'text/html' }, status: 200 });
    Object.defineProperty(response, 'url', { configurable: true, value: 'https://gist.sh/' });

    const fetchMock = vi.fn(async () => response);

    const result = await fetchLinkContent(
      'https://t.co/abc',
      { format: 'text' },
      buildDeps(fetchMock as unknown as typeof fetch),
    );

    expect(result.url).toBe('https://gist.sh/');
    expect(mocks.resolveTranscriptForLink).toHaveBeenCalledWith(
      'https://gist.sh/',
      expect.any(String),
      expect.any(Object),
      expect.any(Object),
    );
  });
});
