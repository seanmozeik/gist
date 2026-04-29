import { beforeEach, describe, expect, it, vi } from 'vitest';

import { stubMissingTranscriptionEnv } from './helpers/transcription-env.js';

const api = vi.hoisted(() => ({
  extractYoutubeiTranscriptConfig: vi.fn(),
  fetchTranscriptFromTranscriptEndpoint: vi.fn(),
}));
const captions = vi.hoisted(() => ({
  extractYoutubeDurationSeconds: vi.fn(),
  fetchTranscriptFromCaptionTracks: vi.fn(),
  fetchYoutubeDurationSecondsViaPlayer: vi.fn(),
}));
const apify = vi.hoisted(() => ({ fetchTranscriptWithApify: vi.fn() }));
const ytdlp = vi.hoisted(() => ({
  fetchDurationSecondsWithYtDlp: vi.fn(),
  fetchTranscriptWithYtDlp: vi.fn(),
}));

vi.mock('../packages/core/src/content/transcript/providers/youtube/api.js', () => api);
vi.mock('../packages/core/src/content/transcript/providers/youtube/captions.js', () => captions);
vi.mock('../packages/core/src/content/transcript/providers/youtube/apify.js', () => apify);
vi.mock('../packages/core/src/content/transcript/providers/youtube/yt-dlp.js', () => ytdlp);

import { fetchTranscript } from '../packages/core/src/content/transcript/providers/youtube.js';

const baseOptions = {
  apifyApiToken: null,
  falApiKey: null,
  fetch: vi.fn() as unknown as typeof fetch,
  geminiApiKey: null,
  groqApiKey: null,
  openaiApiKey: null,
  youtubeTranscriptMode: 'auto' as const,
  ytDlpPath: null,
};

describe('YouTube transcript provider module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubMissingTranscriptionEnv();
    api.extractYoutubeiTranscriptConfig.mockReturnValue(null);
    api.fetchTranscriptFromTranscriptEndpoint.mockResolvedValue(null);
    captions.fetchTranscriptFromCaptionTracks.mockResolvedValue(null);
    captions.extractYoutubeDurationSeconds.mockReturnValue(null);
    captions.fetchYoutubeDurationSecondsViaPlayer.mockResolvedValue(null);
    apify.fetchTranscriptWithApify.mockResolvedValue(null);
    ytdlp.fetchTranscriptWithYtDlp.mockResolvedValue({
      error: null,
      notes: [],
      provider: null,
      text: null,
    });
    ytdlp.fetchDurationSecondsWithYtDlp.mockResolvedValue(null);
  });

  it('returns null when HTML is missing or video id cannot be resolved', async () => {
    expect(
      await fetchTranscript(
        { html: null, resourceKey: null, url: 'https://www.youtube.com/watch?v=abcdefghijk' },
        baseOptions,
      ),
    ).toEqual({ attemptedProviders: [], source: null, text: null });

    expect(
      await fetchTranscript(
        { html: '<html></html>', resourceKey: null, url: 'https://www.youtube.com/watch' },
        baseOptions,
      ),
    ).toEqual({ attemptedProviders: [], source: null, text: null });
  });

  it('uses apify mode even when HTML is null (fixes #51)', async () => {
    apify.fetchTranscriptWithApify.mockResolvedValue('Hello from apify');

    const result = await fetchTranscript(
      { html: null, resourceKey: null, url: 'https://www.youtube.com/watch?v=abcdefghijk' },
      { ...baseOptions, apifyApiToken: 'TOKEN', youtubeTranscriptMode: 'apify' },
    );

    expect(result.text).toBe('Hello from apify');
    expect(result.source).toBe('apify');
    expect(result.attemptedProviders).toEqual(['apify']);
    expect(api.extractYoutubeiTranscriptConfig).not.toHaveBeenCalled();
    expect(captions.fetchTranscriptFromCaptionTracks).not.toHaveBeenCalled();
    expect(ytdlp.fetchTranscriptWithYtDlp).not.toHaveBeenCalled();
  });

  it('returns unavailable when apify mode fails with null HTML', async () => {
    apify.fetchTranscriptWithApify.mockResolvedValue(null);

    const result = await fetchTranscript(
      { html: null, resourceKey: null, url: 'https://www.youtube.com/watch?v=abcdefghijk' },
      { ...baseOptions, apifyApiToken: 'TOKEN', youtubeTranscriptMode: 'apify' },
    );

    expect(result.text).toBeNull();
    expect(result.source).toBe('unavailable');
    expect(result.attemptedProviders).toEqual(['apify', 'unavailable']);
  });

  it('throws when apify mode used without token and HTML is null', async () => {
    await expect(
      fetchTranscript(
        { html: null, resourceKey: null, url: 'https://www.youtube.com/watch?v=abcdefghijk' },
        { ...baseOptions, apifyApiToken: null, youtubeTranscriptMode: 'apify' },
      ),
    ).rejects.toThrow(/Missing APIFY_API_TOKEN/i);
  });

  it('uses apify-only mode and skips web + yt-dlp', async () => {
    apify.fetchTranscriptWithApify.mockResolvedValue('Hello from apify');
    captions.extractYoutubeDurationSeconds.mockReturnValue(1872);

    const result = await fetchTranscript(
      {
        html: '<html></html>',
        resourceKey: null,
        url: 'https://www.youtube.com/watch?v=abcdefghijk',
      },
      { ...baseOptions, apifyApiToken: 'TOKEN', youtubeTranscriptMode: 'apify' },
    );

    expect(result.text).toBe('Hello from apify');
    expect(result.source).toBe('apify');
    expect(result.attemptedProviders).toEqual(['apify']);
    expect(result.metadata).toEqual({ durationSeconds: 1872, provider: 'apify' });
    expect(api.extractYoutubeiTranscriptConfig).not.toHaveBeenCalled();
    expect(captions.fetchTranscriptFromCaptionTracks).not.toHaveBeenCalled();
    expect(ytdlp.fetchTranscriptWithYtDlp).not.toHaveBeenCalled();
  });

  it('uses web-only mode and skips apify + yt-dlp', async () => {
    const result = await fetchTranscript(
      {
        html: '<html></html>',
        resourceKey: null,
        url: 'https://www.youtube.com/watch?v=abcdefghijk',
      },
      { ...baseOptions, apifyApiToken: 'TOKEN', youtubeTranscriptMode: 'web' },
    );

    expect(result.source).toBe('unavailable');
    expect(result.attemptedProviders).toEqual(['captionTracks', 'unavailable']);
    expect(apify.fetchTranscriptWithApify).not.toHaveBeenCalled();
    expect(ytdlp.fetchTranscriptWithYtDlp).not.toHaveBeenCalled();
  });

  it('attempts providers in order for auto mode', async () => {
    api.extractYoutubeiTranscriptConfig.mockReturnValue({
      apiKey: 'KEY',
      context: {},
      params: 'PARAMS',
    });

    const result = await fetchTranscript(
      {
        html: '<html></html>',
        resourceKey: null,
        url: 'https://www.youtube.com/watch?v=abcdefghijk',
      },
      {
        ...baseOptions,
        openaiApiKey: 'OPENAI',
        youtubeTranscriptMode: 'auto',
        ytDlpPath: '/usr/bin/yt-dlp',
      },
    );

    expect(result.attemptedProviders).toEqual([
      'youtubei',
      'captionTracks',
      'yt-dlp',
      'unavailable',
    ]);
  });

  it('skips yt-dlp in auto mode when credentials are missing', async () => {
    api.extractYoutubeiTranscriptConfig.mockReturnValue(null);

    const result = await fetchTranscript(
      {
        html: '<html></html>',
        resourceKey: null,
        url: 'https://www.youtube.com/watch?v=abcdefghijk',
      },
      { ...baseOptions, youtubeTranscriptMode: 'auto' },
    );

    expect(result.attemptedProviders).toEqual(['captionTracks', 'unavailable']);
    expect(ytdlp.fetchTranscriptWithYtDlp).not.toHaveBeenCalled();
    expect(apify.fetchTranscriptWithApify).not.toHaveBeenCalled();
  });

  it('treats Gemini as a valid yt-dlp transcription credential in auto mode', async () => {
    api.extractYoutubeiTranscriptConfig.mockReturnValue(null);

    await fetchTranscript(
      {
        html: '<html></html>',
        resourceKey: null,
        url: 'https://www.youtube.com/watch?v=abcdefghijk',
      },
      {
        ...baseOptions,
        geminiApiKey: 'GEMINI',
        youtubeTranscriptMode: 'auto',
        ytDlpPath: '/usr/bin/yt-dlp',
      },
    );

    expect(ytdlp.fetchTranscriptWithYtDlp).toHaveBeenCalled();
  });

  it('tries yt-dlp before apify in auto mode (apify last resort)', async () => {
    api.extractYoutubeiTranscriptConfig.mockReturnValue(null);
    apify.fetchTranscriptWithApify.mockResolvedValue('Hello from apify');

    const result = await fetchTranscript(
      {
        html: '<html></html>',
        resourceKey: null,
        url: 'https://www.youtube.com/watch?v=abcdefghijk',
      },
      {
        ...baseOptions,
        apifyApiToken: 'TOKEN',
        openaiApiKey: 'OPENAI',
        youtubeTranscriptMode: 'auto',
        ytDlpPath: '/usr/bin/yt-dlp',
      },
    );

    expect(result.source).toBe('apify');
    expect(result.attemptedProviders).toEqual(['captionTracks', 'yt-dlp', 'apify']);
  });

  it('errors in yt-dlp mode when transcription keys are missing', async () => {
    await expect(
      fetchTranscript(
        {
          html: '<html></html>',
          resourceKey: null,
          url: 'https://www.youtube.com/watch?v=abcdefghijk',
        },
        {
          ...baseOptions,
          falApiKey: null,
          openaiApiKey: null,
          youtubeTranscriptMode: 'yt-dlp',
          ytDlpPath: '/usr/bin/yt-dlp',
        },
      ),
    ).rejects.toThrow(/Missing transcription provider for --youtube yt-dlp/i);
  });

  it('uses no-auto mode with skipAutoGenerated flag', async () => {
    captions.fetchTranscriptFromCaptionTracks.mockResolvedValue({
      segments: null,
      text: 'Creator caption',
    });
    captions.extractYoutubeDurationSeconds.mockReturnValue(1872);

    const result = await fetchTranscript(
      {
        html: '<html></html>',
        resourceKey: null,
        url: 'https://www.youtube.com/watch?v=abcdefghijk',
      },
      { ...baseOptions, youtubeTranscriptMode: 'no-auto' },
    );

    expect(result.text).toBe('Creator caption');
    expect(result.source).toBe('captionTracks');
    expect(result.metadata).toEqual({
      durationSeconds: 1872,
      manualOnly: true,
      provider: 'captionTracks',
    });
    expect(captions.fetchTranscriptFromCaptionTracks).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ skipAutoGenerated: true }),
    );
    expect(api.extractYoutubeiTranscriptConfig).not.toHaveBeenCalled();
    expect(apify.fetchTranscriptWithApify).not.toHaveBeenCalled();
    expect(ytdlp.fetchTranscriptWithYtDlp).not.toHaveBeenCalled();
  });

  it('falls back to player duration when html lacks lengthSeconds', async () => {
    captions.fetchTranscriptFromCaptionTracks.mockResolvedValue({
      segments: null,
      text: 'Creator caption',
    });
    captions.extractYoutubeDurationSeconds.mockReturnValue(null);
    captions.fetchYoutubeDurationSecondsViaPlayer.mockResolvedValue(2220);

    const result = await fetchTranscript(
      {
        html: '<html></html>',
        resourceKey: null,
        url: 'https://www.youtube.com/watch?v=abcdefghijk',
      },
      { ...baseOptions, youtubeTranscriptMode: 'no-auto' },
    );

    expect(result.metadata).toEqual({
      durationSeconds: 2220,
      manualOnly: true,
      provider: 'captionTracks',
    });
    expect(captions.fetchYoutubeDurationSecondsViaPlayer).toHaveBeenCalled();
  });

  it('uses yt-dlp duration when player duration is unavailable', async () => {
    captions.fetchTranscriptFromCaptionTracks.mockResolvedValue({
      segments: null,
      text: 'Creator caption',
    });
    captions.extractYoutubeDurationSeconds.mockReturnValue(null);
    captions.fetchYoutubeDurationSecondsViaPlayer.mockResolvedValue(null);
    ytdlp.fetchDurationSecondsWithYtDlp.mockResolvedValue(3300);

    const result = await fetchTranscript(
      {
        html: '<html></html>',
        resourceKey: null,
        url: 'https://www.youtube.com/watch?v=abcdefghijk',
      },
      { ...baseOptions, youtubeTranscriptMode: 'no-auto', ytDlpPath: '/usr/bin/yt-dlp' },
    );

    expect(result.metadata).toEqual({
      durationSeconds: 3300,
      manualOnly: true,
      provider: 'captionTracks',
    });
    expect(ytdlp.fetchDurationSecondsWithYtDlp).toHaveBeenCalled();
  });

  it('falls back to yt-dlp in no-auto mode when no creator captions found', async () => {
    captions.fetchTranscriptFromCaptionTracks.mockResolvedValue(null);
    ytdlp.fetchTranscriptWithYtDlp.mockResolvedValue({
      error: null,
      notes: [],
      provider: 'openai',
      text: 'Transcribed audio',
    });

    const result = await fetchTranscript(
      {
        html: '<html></html>',
        resourceKey: null,
        url: 'https://www.youtube.com/watch?v=abcdefghijk',
      },
      {
        ...baseOptions,
        openaiApiKey: 'OPENAI',
        youtubeTranscriptMode: 'no-auto',
        ytDlpPath: '/usr/bin/yt-dlp',
      },
    );

    expect(result.text).toBe('Transcribed audio');
    expect(result.source).toBe('yt-dlp');
    expect(result.attemptedProviders).toEqual(['captionTracks', 'yt-dlp']);
    expect(result.notes).toContain('No creator captions found, using yt-dlp transcription');
    expect(api.extractYoutubeiTranscriptConfig).not.toHaveBeenCalled();
    expect(apify.fetchTranscriptWithApify).not.toHaveBeenCalled();
  });

  it('falls through when youtubei captions look truncated for a long video', async () => {
    api.extractYoutubeiTranscriptConfig.mockReturnValue({
      apiKey: 'KEY',
      context: {},
      params: 'PARAMS',
    });
    api.fetchTranscriptFromTranscriptEndpoint.mockResolvedValue({
      segments: null,
      text: 'short intro transcript only',
    });
    captions.extractYoutubeDurationSeconds.mockReturnValue(1800);
    ytdlp.fetchTranscriptWithYtDlp.mockResolvedValue({
      error: null,
      notes: [],
      provider: 'openai',
      text: 'Recovered full transcript',
    });

    const result = await fetchTranscript(
      {
        html: '<html></html>',
        resourceKey: null,
        url: 'https://www.youtube.com/watch?v=abcdefghijk',
      },
      {
        ...baseOptions,
        openaiApiKey: 'OPENAI',
        youtubeTranscriptMode: 'auto',
        ytDlpPath: '/usr/bin/yt-dlp',
      },
    );

    expect(result.text).toBe('Recovered full transcript');
    expect(result.source).toBe('yt-dlp');
    expect(result.attemptedProviders).toEqual(['youtubei', 'captionTracks', 'yt-dlp']);
    expect(result.notes).toContain('youtubei transcript appears truncated');
  });

  it('falls through when caption track text looks truncated for a long video', async () => {
    captions.fetchTranscriptFromCaptionTracks.mockResolvedValue({
      segments: null,
      text: 'tiny caption sample',
    });
    captions.extractYoutubeDurationSeconds.mockReturnValue(1500);
    ytdlp.fetchTranscriptWithYtDlp.mockResolvedValue({
      error: null,
      notes: [],
      provider: 'openai',
      text: 'Recovered full transcript',
    });

    const result = await fetchTranscript(
      {
        html: '<html></html>',
        resourceKey: null,
        url: 'https://www.youtube.com/watch?v=abcdefghijk',
      },
      {
        ...baseOptions,
        openaiApiKey: 'OPENAI',
        youtubeTranscriptMode: 'auto',
        ytDlpPath: '/usr/bin/yt-dlp',
      },
    );

    expect(result.text).toBe('Recovered full transcript');
    expect(result.source).toBe('yt-dlp');
    expect(result.attemptedProviders).toEqual(['captionTracks', 'yt-dlp']);
    expect(result.notes).toContain('captionTracks transcript appears truncated');
  });

  it('returns unavailable with a note when yt-dlp finds no audio stream', async () => {
    ytdlp.fetchTranscriptWithYtDlp.mockResolvedValue({
      error: null,
      notes: ['yt-dlp: Media has no audio stream'],
      provider: null,
      text: '',
    });

    const result = await fetchTranscript(
      {
        html: '<html></html>',
        resourceKey: null,
        url: 'https://www.youtube.com/watch?v=abcdefghijk',
      },
      {
        ...baseOptions,
        openaiApiKey: 'OPENAI',
        youtubeTranscriptMode: 'auto',
        ytDlpPath: '/usr/bin/yt-dlp',
      },
    );

    expect(result.text).toBeNull();
    expect(result.source).toBe('unavailable');
    expect(result.attemptedProviders).toEqual(['captionTracks', 'yt-dlp', 'unavailable']);
    expect(result.notes).toContain('yt-dlp: Media has no audio stream');
  });

  it('includes yt-dlp error message in notes when transcription fails', async () => {
    ytdlp.fetchTranscriptWithYtDlp.mockResolvedValue({
      error: new Error('Simulated failure'),
      notes: [],
      provider: null,
      text: null,
    });

    const result = await fetchTranscript(
      {
        html: '<html></html>',
        resourceKey: null,
        url: 'https://www.youtube.com/watch?v=abcdefghijk',
      },
      {
        ...baseOptions,
        openaiApiKey: 'OPENAI',
        youtubeTranscriptMode: 'auto',
        ytDlpPath: '/usr/bin/yt-dlp',
      },
    );

    expect(result.notes).toContain('yt-dlp transcription failed: Simulated failure');
  });

  it('throws yt-dlp error in yt-dlp mode', async () => {
    ytdlp.fetchTranscriptWithYtDlp.mockResolvedValue({
      error: new Error('Critical yt-dlp failure'),
      notes: [],
      provider: null,
      text: null,
    });

    await expect(
      fetchTranscript(
        {
          html: '<html></html>',
          resourceKey: null,
          url: 'https://www.youtube.com/watch?v=abcdefghijk',
        },
        {
          ...baseOptions,
          openaiApiKey: 'OPENAI',
          youtubeTranscriptMode: 'yt-dlp',
          ytDlpPath: '/usr/bin/yt-dlp',
        },
      ),
    ).rejects.toThrow('Critical yt-dlp failure');
  });

  it('returns segments when timestamps are requested', async () => {
    captions.fetchTranscriptFromCaptionTracks.mockResolvedValue({
      segments: [{ endMs: 2000, startMs: 1000, text: 'Hello' }],
      text: 'Creator caption',
    });

    const result = await fetchTranscript(
      {
        html: '<html></html>',
        resourceKey: null,
        url: 'https://www.youtube.com/watch?v=abcdefghijk',
      },
      { ...baseOptions, transcriptTimestamps: true, youtubeTranscriptMode: 'web' },
    );

    expect(result.segments).toEqual([{ endMs: 2000, startMs: 1000, text: 'Hello' }]);
  });

  it('errors in no-auto mode when yt-dlp fallback is not available', async () => {
    await expect(
      fetchTranscript(
        {
          html: '<html></html>',
          resourceKey: null,
          url: 'https://www.youtube.com/watch?v=abcdefghijk',
        },
        {
          ...baseOptions,
          falApiKey: null,
          openaiApiKey: null,
          youtubeTranscriptMode: 'no-auto',
          ytDlpPath: null,
        },
      ),
    ).rejects.toThrow(/--youtube no-auto requires yt-dlp/i);

    expect(captions.fetchTranscriptFromCaptionTracks).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ skipAutoGenerated: true }),
    );
    expect(api.extractYoutubeiTranscriptConfig).not.toHaveBeenCalled();
    expect(apify.fetchTranscriptWithApify).not.toHaveBeenCalled();
    expect(ytdlp.fetchTranscriptWithYtDlp).not.toHaveBeenCalled();
  });
});
