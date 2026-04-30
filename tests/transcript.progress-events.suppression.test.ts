import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchYoutube: vi.fn(async () => ({
    attemptedProviders: [],
    metadata: null,
    source: null,
    text: null,
  })),
}));

vi.mock('../src/content/transcript/providers/youtube.js', () => ({
  canHandle: (ctx: { url: string }) =>
    ctx.url.includes('youtube.com') || ctx.url.includes('youtu.be'),
  fetchTranscript: mocks.fetchYoutube,
}));

import { resolveTranscriptForLink } from '../src/content/transcript/index';

describe('transcript progress events', () => {
  it('does not emit transcript-start/done for generic pages', async () => {
    const onProgress = vi.fn();
    await resolveTranscriptForLink(
      'https://example.com',
      '<!doctype html><html><body><article><p>Hello</p></article></body></html>',
      {
        apifyApiToken: null,
        convertHtmlToMarkdown: null,
        falApiKey: null,
        fetch: vi.fn() as unknown as typeof fetch,
        groqApiKey: null,
        onProgress,
        openaiApiKey: null,
        scrapeWithFirecrawl: null,
        transcriptCache: null,
        ytDlpPath: null,
      },
    );
    expect(onProgress).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'transcript-start' }),
    );
    expect(onProgress).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'transcript-done' }),
    );
  });

  it('emits transcript-start/done for YouTube URLs', async () => {
    const onProgress = vi.fn();
    await resolveTranscriptForLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ', null, {
      apifyApiToken: null,
      convertHtmlToMarkdown: null,
      falApiKey: null,
      fetch: vi.fn() as unknown as typeof fetch,
      onProgress,
      openaiApiKey: null,
      scrapeWithFirecrawl: null,
      transcriptCache: null,
      ytDlpPath: null,
    });
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ kind: 'transcript-start' }));
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ kind: 'transcript-done' }));
  });
});
