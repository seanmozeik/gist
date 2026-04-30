import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const createLinkPreviewClient = vi.hoisted(() => vi.fn());
const buildExtractCacheKey = vi.hoisted(() => vi.fn(() => 'extract-key'));
const fetchLinkContentWithBirdTip = vi.hoisted(() => vi.fn());

vi.mock('../src/content/index.js', () => ({ createLinkPreviewClient }));

vi.mock('../src/cache.js', () => ({ buildExtractCacheKey }));

vi.mock('../src/run/flows/url/extract.js', () => ({ fetchLinkContentWithBirdTip }));

import { createUrlExtractionSession } from '../src/run/flows/url/extraction-session';

function createCtx() {
  return {
    cache: {
      mode: 'default',
      store: { getJson: vi.fn(), setJson: vi.fn(), transcriptCache: null },
      ttlMs: 60_000,
    },
    flags: {
      firecrawlMode: 'off',
      maxExtractCharacters: null,
      slides: null,
      timeoutMs: 1000,
      transcriptTimestamps: false,
      verbose: false,
      verboseColor: false,
      videoMode: 'auto',
      youtubeMode: 'auto',
    },
    io: { env: {}, envForRun: {}, fetch: vi.fn(), stderr: process.stderr },
    mediaCache: null,
    model: {
      apiStatus: {
        apifyToken: null,
        assemblyaiApiKey: null,
        falApiKey: null,
        firecrawlApiKey: null,
        firecrawlConfigured: false,
        googleApiKey: null,
        groqApiKey: null,
        openaiApiKey: null,
        ytDlpPath: null,
      },
    },
  };
}

describe('createUrlExtractionSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createLinkPreviewClient.mockReturnValue({});
    fetchLinkContentWithBirdTip.mockResolvedValue({
      content: 'video transcript',
      description: null,
      diagnostics: {
        firecrawl: {
          attempted: false,
          cacheMode: 'default',
          cacheStatus: 'bypassed',
          notes: null,
          used: false,
        },
        markdown: { notes: null, provider: null, requested: false, used: false },
        strategy: 'html',
        transcript: {
          attemptedProviders: [],
          cacheMode: 'default',
          cacheStatus: 'miss',
          provider: null,
          textProvided: false,
        },
      },
      isVideoOnly: false,
      mediaDurationSeconds: null,
      siteName: null,
      title: null,
      totalCharacters: 16,
      transcriptCharacters: null,
      transcriptLines: null,
      transcriptMetadata: null,
      transcriptSegments: null,
      transcriptSource: null,
      transcriptTimedText: null,
      transcriptWordCount: null,
      transcriptionProvider: null,
      truncated: false,
      url: 'https://example.com/video.mp4',
      video: null,
      wordCount: 2,
    });
  });

  it('bypasses extract-cache reuse for local file URLs and forwards file mtime', async () => {
    const filePath = path.join(tmpdir(), `gist-local-slides-${Date.now().toString()}.webm`);
    await fs.writeFile(filePath, 'video');

    try {
      const ctx = createCtx();
      const session = createUrlExtractionSession({
        ctx: ctx as never,
        markdown: {
          convertHtmlToMarkdown: vi.fn(),
          effectiveMarkdownMode: 'off',
          markdownRequested: false,
        },
        onProgress: null,
      });

      await session.fetchWithCache(pathToFileURL(filePath).href);

      expect(buildExtractCacheKey).not.toHaveBeenCalled();
      expect(ctx.cache.store.getJson).not.toHaveBeenCalled();
      expect(ctx.cache.store.setJson).not.toHaveBeenCalled();
      expect(fetchLinkContentWithBirdTip).toHaveBeenCalledTimes(1);
      expect(fetchLinkContentWithBirdTip.mock.calls[0]?.[0]?.options.fileMtime).toBeGreaterThan(0);
      expect(fetchLinkContentWithBirdTip.mock.calls[0]?.[0]?.options.mediaTranscript).toBe('auto');
    } finally {
      await fs.rm(filePath, { force: true });
    }
  });

  it('prefers transcript extraction for local slide videos', async () => {
    const filePath = path.join(tmpdir(), `gist-local-slides-${Date.now().toString()}.webm`);
    await fs.writeFile(filePath, 'video');

    try {
      const ctx = createCtx();
      ctx.flags.slides = {
        autoTuneThreshold: true,
        enabled: true,
        maxSlides: 6,
        minDurationSeconds: 2,
        ocr: false,
        outputDir: '/tmp/slides',
        sceneThreshold: 0.12,
      };
      const session = createUrlExtractionSession({
        ctx: ctx as never,
        markdown: {
          convertHtmlToMarkdown: vi.fn(),
          effectiveMarkdownMode: 'off',
          markdownRequested: false,
        },
        onProgress: null,
      });

      await session.fetchWithCache(pathToFileURL(filePath).href);

      expect(fetchLinkContentWithBirdTip.mock.calls[0]?.[0]?.options.mediaTranscript).toBe(
        'prefer',
      );
      expect(fetchLinkContentWithBirdTip.mock.calls[0]?.[0]?.options.transcriptTimestamps).toBe(
        false,
      );
    } finally {
      await fs.rm(filePath, { force: true });
    }
  });

  it('prefers transcript extraction for direct video URLs when slides are enabled', async () => {
    const ctx = createCtx();
    ctx.flags.slides = {
      autoTuneThreshold: true,
      enabled: true,
      maxSlides: 6,
      minDurationSeconds: 2,
      ocr: false,
      outputDir: '/tmp/slides',
      sceneThreshold: 0.12,
    };
    const session = createUrlExtractionSession({
      ctx: ctx as never,
      markdown: {
        convertHtmlToMarkdown: vi.fn(),
        effectiveMarkdownMode: 'off',
        markdownRequested: false,
      },
      onProgress: null,
    });

    await session.fetchWithCache('https://cdn.example.com/video.mp4');

    expect(fetchLinkContentWithBirdTip.mock.calls[0]?.[0]?.options.mediaTranscript).toBe('prefer');
  });

  it('surfaces podcast extraction errors instead of falling back to empty URL-only content', async () => {
    const ctx = createCtx();
    const session = createUrlExtractionSession({
      ctx: ctx as never,
      markdown: {
        convertHtmlToMarkdown: vi.fn(),
        effectiveMarkdownMode: 'off',
        markdownRequested: false,
      },
      onProgress: null,
    });
    fetchLinkContentWithBirdTip.mockRejectedValueOnce(new Error('transcript failed'));

    await expect(session.fetchWithCache('https://open.spotify.com/episode/abc')).rejects.toThrow(
      /transcript failed/,
    );
  });
});
