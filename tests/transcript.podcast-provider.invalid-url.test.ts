import { describe, expect, it, vi } from 'vitest';

import { fetchTranscript } from '../src/content/transcript/providers/podcast.js';

describe('podcast transcript provider - invalid URL branches', () => {
  it('handles invalid URLs gracefully and returns no-enclosure metadata', async () => {
    const result = await fetchTranscript(
      { html: null, resourceKey: null, url: 'not a url' },
      {
        apifyApiToken: null,
        falApiKey: null,
        fetch: vi.fn() as unknown as typeof fetch,
        groqApiKey: null,
        onProgress: null,
        openaiApiKey: 'OPENAI',
        scrapeWithFirecrawl: null,
        youtubeTranscriptMode: 'auto',
        ytDlpPath: null,
      },
    );
    expect(result.text).toBeNull();
    expect(result.metadata?.reason).toBe('no_enclosure_and_no_yt_dlp');
  });
});
