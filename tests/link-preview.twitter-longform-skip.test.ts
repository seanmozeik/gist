import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveTranscriptForLink: vi.fn(async () => ({
    diagnostics: {
      attemptedProviders: ['yt-dlp'],
      cacheMode: 'default',
      cacheStatus: 'miss',
      notes: null,
      provider: 'yt-dlp',
      textProvided: true,
    },
    metadata: null,
    source: 'yt-dlp',
    text: 'Transcript text.',
  })),
}));

vi.mock('../packages/core/src/content/transcript/index.js', () => ({
  resolveTranscriptForLink: mocks.resolveTranscriptForLink,
}));

import { fetchLinkContent } from '../packages/core/src/content/link-preview/content/index.js';

const noopFetch = vi.fn(async () => new Response('nope', { status: 500 }));

const createDeps = (text: string, media?: { kind?: 'video' | 'audio'; url?: string | null }) => ({
  apifyApiToken: null,
  convertHtmlToMarkdown: null,
  falApiKey: null,
  fetch: noopFetch as unknown as typeof fetch,
  groqApiKey: null,
  onProgress: null,
  openaiApiKey: null,
  readTweetWithBird: async () => ({
    author: { username: 'birdy' },
    client: 'xurl',
    media: media?.url
      ? { kind: media.kind ?? 'video', urls: [media.url], preferredUrl: media.url, source: 'card' }
      : null,
    text,
  }),
  resolveTwitterCookies: null,
  scrapeWithFirecrawl: null,
  transcriptCache: null,
  ytDlpPath: '/usr/local/bin/yt-dlp',
});

describe('twitter long-form transcript skip', () => {
  it('skips yt-dlp transcript for long-form tweet text', async () => {
    mocks.resolveTranscriptForLink.mockClear();

    const result = await fetchLinkContent(
      'https://x.com/user/status/123',
      { format: 'text' },
      createDeps('x'.repeat(600)),
    );

    expect(mocks.resolveTranscriptForLink).not.toHaveBeenCalled();
    expect(result.transcriptSource).toBeNull();
    expect(result.diagnostics.strategy).toBe('xurl');
    expect(result.diagnostics.transcript.attemptedProviders).toHaveLength(0);
    expect(result.diagnostics.transcript.notes ?? '').toContain('Skipped yt-dlp transcript');
  });

  it('skips transcript for short tweet text when media transcript mode is auto', async () => {
    mocks.resolveTranscriptForLink.mockClear();

    const result = await fetchLinkContent(
      'https://x.com/user/status/123',
      { format: 'text' },
      createDeps('short tweet'),
    );

    expect(mocks.resolveTranscriptForLink).not.toHaveBeenCalled();
    expect(result.transcriptSource).toBeNull();
    expect(result.diagnostics.strategy).toBe('xurl');
    expect(result.diagnostics.transcript.notes ?? '').toContain('media transcript mode is auto');
  });

  it('attempts transcript for tweet video in auto mode', async () => {
    mocks.resolveTranscriptForLink.mockClear();

    const result = await fetchLinkContent(
      'https://x.com/user/status/123',
      { format: 'text' },
      createDeps('short tweet', { kind: 'video', url: 'https://video.twimg.com/test.mp4' }),
    );

    expect(mocks.resolveTranscriptForLink).toHaveBeenCalledTimes(1);
    expect(result.diagnostics.strategy).toBe('xurl');
    expect(result.video?.url).toBe('https://video.twimg.com/test.mp4');
    expect(result.transcriptSource).toBe('yt-dlp');
  });

  it('still attempts transcript for short tweet text when media transcript mode is prefer', async () => {
    mocks.resolveTranscriptForLink.mockClear();

    const result = await fetchLinkContent(
      'https://x.com/user/status/123',
      { format: 'text', mediaTranscript: 'prefer' },
      createDeps('short tweet'),
    );

    expect(mocks.resolveTranscriptForLink).toHaveBeenCalledTimes(1);
    expect(result.diagnostics.strategy).toBe('xurl');
    expect(result.transcriptSource).toBe('yt-dlp');
  });
});
