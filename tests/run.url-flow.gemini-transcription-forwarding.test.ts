import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CacheState } from '../src/cache';
import type { ExtractedLinkContent } from '../src/content/index';
import type { LinkPreviewClientOptions } from '../src/content/index';
import { createDaemonUrlFlowContext } from '../src/daemon/flow-context';

const mocks = vi.hoisted(() => {
  const fetchLinkContent = vi.fn<(url: string) => Promise<ExtractedLinkContent>>();
  const createLinkPreviewClient = vi.fn((options?: LinkPreviewClientOptions) => ({
    fetchLinkContent: async (url: string) => fetchLinkContent(url),
    options,
  }));
  return { createLinkPreviewClient, fetchLinkContent };
});

vi.mock('../src/content/index.js', () => ({
  createLinkPreviewClient: mocks.createLinkPreviewClient,
}));

import { runUrlFlow } from '../src/run/flows/url/flow';

afterEach(() => {
  vi.clearAllMocks();
});

describe('runUrlFlow transcription wiring', () => {
  it('forwards googleApiKey into link preview transcription config', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gist-gemini-url-flow-'));
    const url = 'https://www.youtube.com/watch?v=hhAbp3iQA44';
    const cache: CacheState = { maxBytes: 0, mode: 'bypass', path: null, store: null, ttlMs: 0 };

    mocks.fetchLinkContent.mockResolvedValueOnce({
      content: 'Transcript text',
      description: null,
      diagnostics: {
        firecrawl: {
          attempted: false,
          cacheMode: 'bypass',
          cacheStatus: 'bypassed',
          notes: null,
          used: false,
        },
        markdown: { notes: null, provider: null, requested: false, used: false },
        strategy: 'html',
        transcript: {
          attemptedProviders: ['yt-dlp'],
          cacheMode: 'bypass',
          cacheStatus: 'unknown',
          notes: null,
          provider: 'yt-dlp',
          textProvided: true,
        },
      },
      isVideoOnly: false,
      mediaDurationSeconds: 120,
      siteName: 'YouTube',
      title: 'Video',
      totalCharacters: 15,
      transcriptCharacters: 15,
      transcriptLines: 1,
      transcriptMetadata: null,
      transcriptSegments: null,
      transcriptSource: 'yt-dlp',
      transcriptTimedText: null,
      transcriptWordCount: 2,
      transcriptionProvider: 'gemini-2.5-flash',
      truncated: false,
      url,
      video: { kind: 'youtube', url },
      wordCount: 2,
    });

    const ctx = createDaemonUrlFlowContext({
      cache,
      env: { HOME: root, OPENAI_API_KEY: 'test' },
      extractOnly: true,
      fetchImpl: vi.fn() as unknown as typeof fetch,
      languageRaw: 'auto',
      lengthRaw: 'short',
      maxExtractCharacters: null,
      modelOverride: 'google/gemini-3-flash',
      promptOverride: null,
      runStartedAtMs: Date.now(),
      stdoutSink: {
        writeChunk: () => {
          /* Empty */
        },
      },
    });

    ctx.model.apiStatus.googleApiKey = 'gemini-key';
    ctx.model.apiStatus.googleConfigured = true;

    await runUrlFlow({ ctx, isYoutubeUrl: true, url });

    expect(mocks.createLinkPreviewClient).toHaveBeenCalledTimes(1);
    const options = mocks.createLinkPreviewClient.mock.calls[0]?.[0];
    expect(options?.transcription?.geminiApiKey).toBe('gemini-key');
    expect(options?.transcription?.openaiApiKey).toBe('test');
  });
});
