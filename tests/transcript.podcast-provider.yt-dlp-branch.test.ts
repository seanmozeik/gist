import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchTranscriptWithYtDlp: vi.fn(async () => ({
    notes: ['yt-dlp used'],
    provider: 'openai' as const,
    text: 'ok',
  })),
}));

vi.mock('../src/content/transcript/providers/youtube/yt-dlp.js', () => ({
  fetchTranscriptWithYtDlp: mocks.fetchTranscriptWithYtDlp,
}));

import { fetchTranscript } from '../src/content/transcript/providers/podcast';

const baseOptions = {
  apifyApiToken: null,
  falApiKey: null,
  fetch: vi.fn() as unknown as typeof fetch,
  groqApiKey: null,
  onProgress: null,
  openaiApiKey: 'OPENAI',
  scrapeWithFirecrawl: null as unknown as ((...args: unknown[]) => unknown) | null,
  youtubeTranscriptMode: 'auto' as const,
  ytDlpPath: '/usr/local/bin/yt-dlp',
};

describe('podcast transcript provider - yt-dlp branch', () => {
  it('uses yt-dlp when no enclosure is found and ytDlpPath is set', async () => {
    const result = await fetchTranscript(
      { html: '<html/>', resourceKey: null, url: 'https://example.com/not-a-feed' },
      baseOptions,
    );
    expect(result.source).toBe('yt-dlp');
    expect(result.text).toBe('ok');
    expect(result.metadata?.kind).toBe('yt_dlp');
    expect(result.notes).toContain('yt-dlp used');
  });

  it('reports yt-dlp transcription failures', async () => {
    mocks.fetchTranscriptWithYtDlp.mockImplementationOnce(async () => {
      throw new Error('boom');
    });
    const result = await fetchTranscript(
      { html: '<html/>', resourceKey: null, url: 'https://example.com/not-a-feed' },
      baseOptions,
    );
    expect(result.text).toBeNull();
    expect(result.notes).toContain('yt-dlp transcription failed');
  });
});
