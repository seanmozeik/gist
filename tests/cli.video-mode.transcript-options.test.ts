import { Writable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

function collectStream({ isTTY }: { isTTY: boolean }) {
  let text = '';
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      text += chunk.toString();
      callback();
    },
  });
  (stream as unknown as { isTTY?: boolean }).isTTY = isTTY;
  (stream as unknown as { columns?: number }).columns = 120;
  return { getText: () => text, stream };
}

const mocks = vi.hoisted(() => {
  const fetchLinkContent = vi.fn(async (_url: string, options?: Record<string, unknown>) => {
    return {
      __options: options ?? null,
      content: 'Transcript: hello',
      description: null,
      diagnostics: {
        cacheMode: 'default',
        cacheStatus: 'miss',
        firecrawl: { attempted: false, notes: null, used: false },
        markdown: { notes: null, provider: null, requested: false, used: false },
        strategy: 'html',
        transcript: {
          attemptedProviders: ['embedded'],
          cacheMode: 'default',
          cacheStatus: 'miss',
          notes: null,
          provider: 'embedded',
          textProvided: true,
        },
      },
      isVideoOnly: true,
      mediaDurationSeconds: null,
      siteName: null,
      title: 'Media',
      totalCharacters: 17,
      transcriptCharacters: 11,
      transcriptLines: null,
      transcriptMetadata: null,
      transcriptSegments: null,
      transcriptSource: 'embedded',
      transcriptTimedText: null,
      transcriptWordCount: 1,
      transcriptionProvider: null,
      truncated: false,
      url: _url,
      video: { kind: 'direct', url: _url },
      wordCount: 2,
    };
  });

  const createLinkPreviewClient = vi.fn(() => ({ fetchLinkContent }));

  return { createLinkPreviewClient, fetchLinkContent };
});

vi.mock('../src/content/index.js', () => ({
  createLinkPreviewClient: mocks.createLinkPreviewClient,
}));

import { runCli } from '../src/run.js';

describe('cli --video-mode transcript', () => {
  it('passes media transcript preference to the extractor', async () => {
    const stdout = collectStream({ isTTY: false });
    const stderr = collectStream({ isTTY: true });

    await runCli(
      ['--extract', '--metrics', 'off', '--video-mode', 'transcript', 'https://example.com/page'],
      {
        env: {},
        fetch: vi.fn() as unknown as typeof fetch,
        stderr: stderr.stream,
        stdout: stdout.stream,
      },
    );

    const options = mocks.fetchLinkContent.mock.calls[0]?.[1];
    expect(options?.mediaTranscript).toBe('prefer');
  });
});
