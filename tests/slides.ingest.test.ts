import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { prepareSlidesInput } from '../src/slides/ingest.js';

describe('slides ingest', () => {
  it('short-circuits on cached media', async () => {
    const get = vi.fn(async () => ({ filePath: '/tmp/cached.mp4', sizeBytes: 2048 }));
    const progress = vi.fn();

    const result = await prepareSlidesInput({
      buildSlidesMediaCacheKey: (url) => `${url}#slides`,
      downloadRemoteVideo: vi.fn(),
      downloadYoutubeVideo: vi.fn(),
      formatBytes: (bytes) => `${bytes}B`,
      logSlidesTiming: vi.fn(),
      mediaCache: { get, put: vi.fn() } as never,
      reportSlidesProgress: progress,
      resolveSlidesStreamFallback: () => false,
      resolveSlidesYtDlpExtractFormat: () => 'best',
      resolveYoutubeStreamUrl: vi.fn(),
      source: { kind: 'youtube', sourceId: 'yt:abc', url: 'https://youtube.com/watch?v=abc' },
      timeoutMs: 1000,
      ytDlpCookiesFromBrowser: null,
      ytDlpPath: '/usr/bin/yt-dlp',
    });

    expect(result.inputPath).toBe('/tmp/cached.mp4');
    expect(result.inputCleanup).toBeNull();
    expect(progress).toHaveBeenCalledWith('using cached video', 35, '(2048B)');
  });

  it('falls back to a stream URL for YouTube when enabled', async () => {
    const downloadYoutubeVideo = vi.fn(async () => {
      throw new Error('download failed');
    });
    const resolveYoutubeStreamUrl = vi.fn(async () => 'https://stream.example/video.m3u8');

    const result = await prepareSlidesInput({
      buildSlidesMediaCacheKey: (url) => `${url}#slides`,
      downloadRemoteVideo: vi.fn(),
      downloadYoutubeVideo,
      formatBytes: (bytes) => `${bytes}B`,
      logSlidesTiming: vi.fn(),
      mediaCache: null,
      reportSlidesProgress: vi.fn(),
      resolveSlidesStreamFallback: () => true,
      resolveSlidesYtDlpExtractFormat: () => 'best',
      resolveYoutubeStreamUrl,
      source: { kind: 'youtube', sourceId: 'yt:abc', url: 'https://youtube.com/watch?v=abc' },
      timeoutMs: 1000,
      ytDlpCookiesFromBrowser: 'firefox',
      ytDlpPath: '/usr/bin/yt-dlp',
    });

    expect(downloadYoutubeVideo).toHaveBeenCalled();
    expect(resolveYoutubeStreamUrl).toHaveBeenCalledWith({
      cookiesFromBrowser: 'firefox',
      format: 'best',
      timeoutMs: 1000,
      url: 'https://youtube.com/watch?v=abc',
      ytDlpPath: '/usr/bin/yt-dlp',
    });
    expect(result.inputPath).toBe('https://stream.example/video.m3u8');
    expect(result.warnings[0]).toContain('Failed to download video; falling back to stream URL');
  });

  it('downloads direct remote video and preserves cleanup', async () => {
    const cleanup = vi.fn(async () => {});
    const downloadRemoteVideo = vi.fn(async () => ({ cleanup, filePath: '/tmp/direct.mp4' }));
    const put = vi.fn(async ({ filePath }: { filePath: string }) => ({
      filePath,
      sizeBytes: 4096,
    }));

    const result = await prepareSlidesInput({
      buildSlidesMediaCacheKey: (url) => `${url}#slides`,
      downloadRemoteVideo,
      downloadYoutubeVideo: vi.fn(),
      formatBytes: (bytes) => `${bytes}B`,
      logSlidesTiming: vi.fn(),
      mediaCache: { get: vi.fn(async () => null), put } as never,
      reportSlidesProgress: vi.fn(),
      resolveSlidesStreamFallback: () => false,
      resolveSlidesYtDlpExtractFormat: () => 'best',
      resolveYoutubeStreamUrl: vi.fn(),
      source: { kind: 'direct', sourceId: 'direct:1', url: 'https://cdn.example/video.mp4' },
      timeoutMs: 1000,
      ytDlpCookiesFromBrowser: null,
      ytDlpPath: null,
    });

    expect(downloadRemoteVideo).toHaveBeenCalled();
    expect(put).toHaveBeenCalled();
    expect(result.inputPath).toBe('/tmp/direct.mp4');
    expect(result.inputCleanup).toBe(cleanup);
  });

  it('uses local file URLs directly without downloading', async () => {
    const filePath = path.join(tmpdir(), `summarize-slides-local-${Date.now().toString()}.webm`);
    await fs.writeFile(filePath, 'video');

    try {
      const downloadYoutubeVideo = vi.fn();
      const downloadRemoteVideo = vi.fn();
      const result = await prepareSlidesInput({
        buildSlidesMediaCacheKey: (url) => `${url}#slides`,
        downloadRemoteVideo,
        downloadYoutubeVideo,
        formatBytes: (bytes) => `${bytes}B`,
        logSlidesTiming: vi.fn(),
        mediaCache: null,
        reportSlidesProgress: vi.fn(),
        resolveSlidesStreamFallback: () => false,
        resolveSlidesYtDlpExtractFormat: () => 'best',
        resolveYoutubeStreamUrl: vi.fn(),
        source: { kind: 'direct', sourceId: 'local-video', url: pathToFileURL(filePath).href },
        timeoutMs: 1000,
        ytDlpCookiesFromBrowser: null,
        ytDlpPath: null,
      });

      expect(result.inputPath).toBe(filePath);
      expect(result.inputCleanup).toBeNull();
      expect(downloadYoutubeVideo).not.toHaveBeenCalled();
      expect(downloadRemoteVideo).not.toHaveBeenCalled();
    } finally {
      await fs.rm(filePath, { force: true });
    }
  });
});
