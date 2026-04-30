import { Writable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const createLinkPreviewClient = vi.fn(() => {
    return {
      fetchLinkContent: vi.fn(async (url: string) => {
        return {
          content: 'Hello world',
          description: null,
          diagnostics: {
            cacheMode: 'default',
            cacheStatus: 'miss',
            firecrawl: { used: false },
            markdown: { provider: null, used: false },
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
          isVideoOnly: false,
          mediaDurationSeconds: null,
          siteName: null,
          title: 'Example',
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
          video: null,
          wordCount: 2,
        };
      }),
    };
  });

  const resolveCliBinary = vi.fn(() => process.execPath);
  const isCliDisabled = vi.fn(() => false);
  const runCliModel = vi.fn(async () => {
    return {
      costUsd: 0.0123,
      text: 'CLI summary',
      usage: { completionTokens: 5, promptTokens: 10, totalTokens: 15 },
    };
  });

  return { createLinkPreviewClient, isCliDisabled, resolveCliBinary, runCliModel };
});

vi.mock('../src/content/index.js', () => ({
  createLinkPreviewClient: mocks.createLinkPreviewClient,
}));

vi.mock('../src/llm/cli.js', () => ({
  isCliDisabled: mocks.isCliDisabled,
  resolveCliBinary: mocks.resolveCliBinary,
  runCliModel: mocks.runCliModel,
}));

import { runCli } from '../src/run.js';

function collectStream() {
  let text = '';
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      text += chunk.toString();
      callback();
    },
  });
  return { getText: () => text, stream };
}

describe('cli run.ts CLI provider model path', () => {
  it('gists via cli/<provider> and includes metrics finish line', async () => {
    const stdout = collectStream();
    const stderr = collectStream();
    (stderr.stream as unknown as { isTTY?: boolean }).isTTY = false;

    await runCli(
      [
        '--model',
        'cli/codex/gpt-5.2',
        '--metrics',
        'detailed',
        '--timeout',
        '2s',
        'https://example.com',
      ],
      {
        env: {},
        fetch: vi.fn() as unknown as typeof fetch,
        stderr: stderr.stream,
        stdout: stdout.stream,
      },
    );

    expect(stdout.getText()).toContain('CLI summary');
    expect(mocks.runCliModel).toHaveBeenCalled();
    expect(stderr.getText()).toMatch(/cli\/codex\/gpt-5\.2/);
  });
});
