import { describe, expect, it, vi } from 'vitest';

import { fetchTranscript } from '../src/content/transcript/providers/generic.js';

const buildOptions = (overrides?: Partial<Parameters<typeof fetchTranscript>[1]>) => ({
  apifyApiToken: null,
  falApiKey: null,
  fetch,
  groqApiKey: null,
  mediaTranscriptMode: 'auto',
  onProgress: null,
  openaiApiKey: null,
  resolveTwitterCookies: null,
  scrapeWithFirecrawl: null,
  youtubeTranscriptMode: 'auto',
  ytDlpPath: null,
  ...overrides,
});

describe('generic transcript provider (embedded captions)', () => {
  it('uses embedded caption tracks when present', async () => {
    const html = `
      <html>
        <body>
          <video src="/video.mp4">
            <track kind="captions" srclang="en" src="/captions.vtt" />
          </video>
        </body>
      </html>
    `;

    const fetchMock = vi.fn(
      async () =>
        new Response(['WEBVTT', '', '00:00:00.000 --> 00:00:01.000', 'Hello world.'].join('\n'), {
          headers: { 'content-type': 'text/vtt' },
          status: 200,
        }),
    );

    const result = await fetchTranscript(
      { html, resourceKey: null, url: 'https://example.com/page' },
      buildOptions({ fetch: fetchMock }),
    );

    expect(fetchMock).toHaveBeenCalled();
    expect(result.source).toBe('embedded');
    expect(result.text).toContain('Hello world');
    expect(result.attemptedProviders).toContain('embedded');
  });
});
