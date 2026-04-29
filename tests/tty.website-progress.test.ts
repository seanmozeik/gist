import { describe, expect, it, vi } from 'vitest';

import { createWebsiteProgress } from '../src/tty/website-progress.js';

describe('tty website progress', () => {
  it('returns null when disabled', () => {
    expect(createWebsiteProgress({ enabled: false, spinner: { setText: vi.fn() } })).toBeNull();
  });

  it('renders fetch progress with ticker + rate and stops ticking after done', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);

    const setText = vi.fn();
    const progress = createWebsiteProgress({ enabled: true, spinner: { setText } });
    expect(progress).not.toBeNull();
    if (!progress) {return;}

    progress.onProgress({ kind: 'fetch-html-start', url: 'https://example.com' });
    expect(setText).toHaveBeenLastCalledWith('Fetching website (connecting)…');

    vi.advanceTimersByTime(1000);
    expect(setText).toHaveBeenLastCalledWith('Fetching website (connecting, 1.0s)…');

    vi.setSystemTime(3000);
    progress.onProgress({
      downloadedBytes: 2048,
      kind: 'fetch-html-progress',
      totalBytes: 4096,
      url: 'https://example.com',
    });
    expect(setText).toHaveBeenLastCalledWith('Fetching website (2.0 KB/4.0 KB, 2.0s, 1.0 KB/s)…');

    progress.onProgress({
      downloadedBytes: 2048,
      kind: 'fetch-html-done',
      totalBytes: 4096,
      url: 'https://example.com',
    });

    const callsAfterDone = setText.mock.calls.length;
    vi.advanceTimersByTime(2000);
    expect(setText.mock.calls.length).toBe(callsAfterDone);

    vi.useRealTimers();
  });

  it('renders other phases', () => {
    const setText = vi.fn();
    const progress = createWebsiteProgress({ enabled: true, spinner: { setText } });
    expect(progress).not.toBeNull();
    if (!progress) {return;}

    progress.onProgress({ client: null, kind: 'bird-start', url: 'https://x.com/test/status/1' });
    expect(setText).toHaveBeenLastCalledWith('X: reading tweet…');

    progress.onProgress({
      client: 'xurl',
      kind: 'bird-done',
      ok: false,
      textBytes: null,
      url: 'https://x.com/test/status/1',
    });
    expect(setText).toHaveBeenLastCalledWith('Xurl: failed; fallback…');

    progress.onProgress({ kind: 'nitter-start', url: 'https://x.com/test/status/1' });
    expect(setText).toHaveBeenLastCalledWith('Nitter: fetching…');

    progress.onProgress({
      kind: 'nitter-done',
      ok: true,
      textBytes: 999,
      url: 'https://x.com/test/status/1',
    });
    expect(setText).toHaveBeenLastCalledWith('Nitter: got 999 B…');

    progress.onProgress({
      kind: 'firecrawl-start',
      reason: 'Blocked / thin HTML',
      url: 'https://example.com',
    });
    expect(setText).toHaveBeenLastCalledWith('Firecrawl: scraping (fallback: blocked/thin HTML)…');

    progress.onProgress({
      htmlBytes: null,
      kind: 'firecrawl-done',
      markdownBytes: 10 * 1024,
      ok: true,
      url: 'https://example.com',
    });
    expect(setText).toHaveBeenLastCalledWith('Firecrawl: got 10 KB…');

    progress.onProgress({
      hint: 'Podcast: resolving transcript',
      kind: 'transcript-start',
      service: 'podcast',
      url: 'https://podcasts.example/episode',
    });
    expect(setText).toHaveBeenLastCalledWith('Podcast: resolving transcript…');

    progress.onProgress({
      hint: null,
      kind: 'transcript-done',
      ok: true,
      service: 'podcast',
      source: 'whisper',
      url: 'https://podcasts.example/episode',
    });
    expect(setText).toHaveBeenLastCalledWith('Transcribed…');
  });

  it('renders podcast download + whisper progress', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);

    const setText = vi.fn();
    const progress = createWebsiteProgress({ enabled: true, spinner: { setText } });
    expect(progress).not.toBeNull();
    if (!progress) {return;}

    progress.onProgress({
      kind: 'transcript-media-download-start',
      mediaUrl: 'https://cdn.example/episode.mp3',
      service: 'podcast',
      totalBytes: 15 * 1024,
      url: 'https://podcasts.example/episode',
    });
    expect(setText).toHaveBeenLastCalledWith('Downloading audio…');

    vi.setSystemTime(163_000);
    progress.onProgress({
      downloadedBytes: 136 * 1024,
      kind: 'transcript-media-download-progress',
      service: 'podcast',
      totalBytes: 15 * 1024,
      url: 'https://podcasts.example/episode',
    });
    expect(setText).toHaveBeenLastCalledWith(
      expect.stringContaining('Downloading audio (podcast, 136 KB, 2m 42s'),
    );
    expect(setText).toHaveBeenLastCalledWith(expect.stringContaining('B/s'));
    expect(setText).toHaveBeenLastCalledWith(expect.not.stringContaining('2m42s'));

    progress.onProgress({
      downloadedBytes: 136 * 1024,
      kind: 'transcript-media-download-done',
      service: 'podcast',
      totalBytes: 15 * 1024,
      url: 'https://podcasts.example/episode',
    });

    vi.setSystemTime(163_000);
    progress.onProgress({
      kind: 'transcript-whisper-start',
      modelId: 'whisper-1',
      parts: 6,
      providerHint: 'openai',
      service: 'podcast',
      totalDurationSeconds: 3600,
      url: 'https://podcasts.example/episode',
    });
    expect(setText).toHaveBeenLastCalledWith(
      expect.stringContaining('Transcribing (podcast, Whisper/OpenAI, whisper-1'),
    );

    vi.setSystemTime(288_000);
    progress.onProgress({
      kind: 'transcript-whisper-progress',
      partIndex: 1,
      parts: 6,
      processedDurationSeconds: 600,
      service: 'podcast',
      totalDurationSeconds: 3600,
      url: 'https://podcasts.example/episode',
    });
    const last = setText.mock.calls.at(-1)?.[0] ?? '';
    expect(last).toContain('10m/1h');
    expect(last).toContain('1/6');
    expect(last).toContain('2m 5s');

    vi.useRealTimers();
  });

  it('renders whisper provider hints and optional duration/parts', () => {
    const setText = vi.fn();
    const progress = createWebsiteProgress({ enabled: true, spinner: { setText } });
    expect(progress).not.toBeNull();
    if (!progress) {return;}

    progress.onProgress({
      kind: 'transcript-whisper-start',
      modelId: 'fal-ai/wizper',
      parts: null,
      providerHint: 'fal',
      service: 'podcast',
      totalDurationSeconds: null,
      url: 'https://podcasts.example/episode',
    });
    expect(setText).toHaveBeenLastCalledWith(expect.stringContaining('Whisper/FAL, fal-ai/wizper'));

    progress.onProgress({
      kind: 'transcript-whisper-start',
      modelId: 'whisper-1->fal-ai/wizper',
      parts: null,
      providerHint: 'openai->fal',
      service: 'podcast',
      totalDurationSeconds: 44,
      url: 'https://podcasts.example/episode',
    });
    expect(setText).toHaveBeenLastCalledWith(expect.stringContaining('Whisper/OpenAI, whisper-1'));
    expect(setText).toHaveBeenLastCalledWith(expect.not.stringContaining('FAL'));
    expect(setText).toHaveBeenLastCalledWith(expect.stringContaining('44s'));

    progress.onProgress({
      kind: 'transcript-whisper-start',
      modelId: 'assemblyai/universal-2',
      parts: null,
      providerHint: 'assemblyai',
      service: 'podcast',
      totalDurationSeconds: 25,
      url: 'https://podcasts.example/episode',
    });
    expect(setText).toHaveBeenLastCalledWith(
      expect.stringContaining('AssemblyAI, assemblyai/universal-2'),
    );

    progress.onProgress({
      kind: 'transcript-whisper-start',
      modelId: 'google/gemini-2.5-flash',
      parts: null,
      providerHint: 'gemini',
      service: 'podcast',
      totalDurationSeconds: 30,
      url: 'https://podcasts.example/episode',
    });
    expect(setText).toHaveBeenLastCalledWith(
      expect.stringContaining('Gemini, google/gemini-2.5-flash'),
    );

    progress.onProgress({
      kind: 'transcript-whisper-start',
      modelId: null,
      parts: 3,
      providerHint: 'unknown',
      service: 'podcast',
      totalDurationSeconds: null,
      url: 'https://podcasts.example/episode',
    });
    expect(setText).toHaveBeenLastCalledWith(
      expect.stringContaining('Transcribing (podcast, Whisper'),
    );
  });
});
