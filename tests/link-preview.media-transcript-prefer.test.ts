import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveTranscriptForLink: vi.fn(async () => ({
    diagnostics: {
      attemptedProviders: ['embedded'],
      cacheMode: 'default',
      cacheStatus: 'miss',
      notes: null,
      provider: 'embedded',
      textProvided: true,
    },
    metadata: null,
    source: 'embedded',
    text: 'Transcript text',
  })),
}));

vi.mock('../packages/core/src/content/transcript/index.js', () => ({
  resolveTranscriptForLink: mocks.resolveTranscriptForLink,
}));

import { fetchLinkContent } from '../packages/core/src/content/link-preview/content/index.js';

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

describe('link preview media transcript preference', () => {
  it('short-circuits to transcript for direct media URLs', async () => {
    mocks.resolveTranscriptForLink.mockClear();
    const fetchMock = vi.fn(async () => {
      throw new Error('HTML fetch should not occur for direct media');
    });

    const url = 'https://example.com/video.mp4';
    const result = await fetchLinkContent(
      url,
      { format: 'text', mediaTranscript: 'prefer' },
      buildDeps(fetchMock as unknown as typeof fetch),
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.resolveTranscriptForLink).toHaveBeenCalled();
    expect(result.content).toContain('Transcript');
    expect(result.transcriptSource).toBe('embedded');
  });

  it('passes media transcript mode through for HTML pages', async () => {
    mocks.resolveTranscriptForLink.mockClear();
    const html = '<!doctype html><html><head><title>Ok</title></head><body>Hello</body></html>';
    const fetchMock = vi.fn(
      async () => new Response(html, { headers: { 'content-type': 'text/html' }, status: 200 }),
    );

    await fetchLinkContent(
      'https://example.com',
      { format: 'text', mediaTranscript: 'prefer' },
      buildDeps(fetchMock as unknown as typeof fetch),
    );

    expect(mocks.resolveTranscriptForLink).toHaveBeenCalledWith(
      'https://example.com',
      expect.any(String),
      expect.any(Object),
      expect.objectContaining({ mediaTranscriptMode: 'prefer' }),
    );
  });
});
