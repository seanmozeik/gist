import { describe, expect, it, vi } from 'vitest';

import { fetchTranscript } from '../packages/core/src/content/transcript/providers/generic.js';

const fetchTranscriptWithYtDlp = vi.fn(async () => ({
  error: null,
  notes: [],
  provider: 'openai',
  text: 'yt-dlp transcript',
}));

vi.mock('../packages/core/src/content/transcript/providers/youtube/yt-dlp.js', () => ({
  fetchTranscriptWithYtDlp,
}));

const buildOptions = (overrides?: Partial<Parameters<typeof fetchTranscript>[1]>) => ({
  fetch,
  scrapeWithFirecrawl: null,
  apifyApiToken: null,
  youtubeTranscriptMode: 'auto',
  mediaTranscriptMode: 'auto',
  ytDlpPath: '/usr/bin/yt-dlp',
  groqApiKey: null,
  falApiKey: null,
  openaiApiKey: 'test',
  resolveTwitterCookies: null,
  onProgress: null,
  ...overrides,
});

describe('generic transcript provider (video tag fallback)', () => {
  it('uses yt-dlp when mediaTranscriptMode=prefer and a video tag lacks src', async () => {
    const html = `
      <html>
        <body>
          <video class="u-full-width" preload="none" controls></video>
        </body>
      </html>
    `;

    const result = await fetchTranscript(
      { html, resourceKey: null, url: 'https://example.com/page' },
      buildOptions({ mediaTranscriptMode: 'prefer' }),
    );

    expect(fetchTranscriptWithYtDlp).toHaveBeenCalledTimes(1);
    expect(fetchTranscriptWithYtDlp).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://example.com/page' }),
    );
    expect(result.source).toBe('yt-dlp');
    expect(result.text).toContain('yt-dlp transcript');
    expect(result.attemptedProviders).toContain('yt-dlp');
  });

  it('does not use yt-dlp without prefer mode', async () => {
    fetchTranscriptWithYtDlp.mockClear();
    const html = `
      <html>
        <body>
          <video class="u-full-width" preload="none" controls></video>
        </body>
      </html>
    `;

    const result = await fetchTranscript(
      { html, resourceKey: null, url: 'https://example.com/page' },
      buildOptions({ mediaTranscriptMode: 'auto' }),
    );

    expect(fetchTranscriptWithYtDlp).not.toHaveBeenCalled();
    expect(result.source).toBeNull();
  });

  it('passes inferred video kind for direct media URLs', async () => {
    fetchTranscriptWithYtDlp.mockClear();

    await fetchTranscript(
      { html: null, resourceKey: null, url: 'file:///tmp/local-video.webm' },
      buildOptions({ mediaTranscriptMode: 'prefer' }),
    );

    expect(fetchTranscriptWithYtDlp).toHaveBeenCalledWith(
      expect.objectContaining({ mediaKind: 'video', url: 'file:///tmp/local-video.webm' }),
    );
  });
});
