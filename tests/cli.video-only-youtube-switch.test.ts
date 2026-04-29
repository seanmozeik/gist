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

// Deterministic spinner: start writes once, updates are no-ops.
vi.mock('ora', () => {
  interface MockSpinner {
    isSpinning: boolean;
    text: string;
    stop: () => void;
    clear: () => void;
    start: () => MockSpinner;
    setText: (text: string) => void;
  }

  const ora = (opts: { text: string; stream: NodeJS.WritableStream }) => {
    const spinner: MockSpinner = {
      clear() {
        /* empty */
      },
      isSpinning: true,
      setText(text: string) {
        spinner.text = text;
      },
      start() {
        opts.stream.write(`- ${spinner.text}`);
        return spinner;
      },
      stop() {
        spinner.isSpinning = false;
      },
      text: opts.text,
    };
    return spinner;
  };
  return { default: ora };
});

const mocks = vi.hoisted(() => {
  const fetchLinkContent = vi.fn(async (url: string) => {
    if (url === 'https://example.com/video-only') {
      return {
        content: 'placeholder',
        description: null,
        diagnostics: {
          cacheMode: 'default',
          cacheStatus: 'miss',
          firecrawl: { attempted: false, notes: null, used: false },
          markdown: { notes: null, provider: null, requested: false, used: false },
          strategy: 'html',
          transcript: {
            attemptedProviders: [],
            cacheMode: 'default',
            cacheStatus: 'miss',
            notes: null,
            provider: null,
            textProvided: false,
          },
        },
        isVideoOnly: true,
        mediaDurationSeconds: null,
        siteName: 'Example',
        title: 'Video Only',
        totalCharacters: 11,
        transcriptCharacters: null,
        transcriptLines: null,
        transcriptMetadata: null,
        transcriptSegments: null,
        transcriptSource: null,
        transcriptTimedText: null,
        transcriptWordCount: null,
        transcriptionProvider: null,
        truncated: false,
        url,
        video: { kind: 'youtube', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
        wordCount: 1,
      };
    }

    if (url === 'https://www.youtube.com/watch?v=dQw4w9WgXcQ') {
      return {
        content: 'Transcript: hello',
        description: null,
        diagnostics: {
          cacheMode: 'default',
          cacheStatus: 'miss',
          firecrawl: { attempted: false, notes: null, used: false },
          markdown: { notes: null, provider: null, requested: false, used: false },
          strategy: 'youtube',
          transcript: {
            attemptedProviders: ['youtube'],
            cacheMode: 'default',
            cacheStatus: 'miss',
            notes: null,
            provider: 'youtube',
            textProvided: true,
          },
        },
        isVideoOnly: false,
        mediaDurationSeconds: null,
        siteName: 'YouTube',
        title: 'YouTube',
        totalCharacters: 17,
        transcriptCharacters: 11,
        transcriptLines: null,
        transcriptMetadata: null,
        transcriptSegments: null,
        transcriptSource: 'youtube',
        transcriptTimedText: null,
        transcriptWordCount: 1,
        transcriptionProvider: null,
        truncated: false,
        url,
        video: null,
        wordCount: 2,
      };
    }

    throw new Error(`Unexpected url: ${url}`);
  });

  const createLinkPreviewClient = vi.fn(() => ({ fetchLinkContent }));

  return { createLinkPreviewClient, fetchLinkContent };
});

vi.mock('../src/content/index.js', () => ({
  createLinkPreviewClient: mocks.createLinkPreviewClient,
}));

import { runCli } from '../src/run.js';

describe('cli video-only pages', () => {
  it('switches to YouTube transcript when a page is video-only', async () => {
    const stdout = collectStream({ isTTY: false });
    const stderr = collectStream({ isTTY: true });

    await runCli(
      ['--extract', '--metrics', 'off', '--timeout', '2s', 'https://example.com/video-only'],
      {
        env: {},
        fetch: vi.fn() as unknown as typeof fetch,
        stderr: stderr.stream,
        stdout: stdout.stream,
      },
    );

    expect(mocks.fetchLinkContent).toHaveBeenCalledTimes(2);
    expect(mocks.fetchLinkContent.mock.calls[0]?.[0]).toBe('https://example.com/video-only');
    expect(mocks.fetchLinkContent.mock.calls[1]?.[0]).toBe(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    );
    expect(stdout.getText()).toContain('Transcript: hello');
  });
});
