import { Writable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { makeAssistantMessage } from './helpers/pi-ai-mock';

const mocks = vi.hoisted(() => {
  const completeSimple = vi.fn();
  const streamSimple = vi.fn();
  const getModel = vi.fn(() => {
    throw new Error('no model');
  });
  const createLinkPreviewClient = vi.fn(() => {
    return {
      fetchLinkContent: vi.fn(async (url: string) => {
        return {
          content: 'Short tweet text',
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
          siteName: 'X',
          title: 'Tweet',
          totalCharacters: 15,
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
          wordCount: 3,
        };
      }),
    };
  });

  return { completeSimple, createLinkPreviewClient, getModel, streamSimple };
});

mocks.completeSimple.mockImplementation(async () =>
  makeAssistantMessage({
    api: 'openai-responses',
    model: 'gpt-5.2',
    provider: 'openai',
    text: 'SUMMARY',
  }),
);

vi.mock('@mariozechner/pi-ai', () => ({
  completeSimple: mocks.completeSimple,
  getModel: mocks.getModel,
  streamSimple: mocks.streamSimple,
}));

vi.mock('../src/content/index.js', () => ({
  createLinkPreviewClient: mocks.createLinkPreviewClient,
}));

import { runCli } from '../src/run';

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

describe('cli twitter skip-summary branches', () => {
  it('skips summarization for short tweet content in --json mode', async () => {
    mocks.completeSimple.mockClear();
    const stdout = collectStream();
    const stderr = collectStream();

    await runCli(
      ['--json', '--metrics', 'off', '--timeout', '2s', 'https://twitter.com/x/status/123'],
      {
        env: { OPENAI_API_KEY: 'test' },
        fetch: vi.fn() as unknown as typeof fetch,
        stderr: stderr.stream,
        stdout: stdout.stream,
      },
    );

    expect(stderr.getText()).toBe('');
    const payload = JSON.parse(stdout.getText());
    expect(payload.llm).toBeNull();
    expect(payload.summary).toBe('Short tweet text');
    expect(payload.input.url).toBe('https://twitter.com/x/status/123');
    expect(mocks.completeSimple).not.toHaveBeenCalled();
  });

  it('prints a finish line when metrics are enabled (json)', async () => {
    const stdout = collectStream();
    const stderr = collectStream();

    await runCli(
      ['--json', '--metrics', 'detailed', '--timeout', '2s', 'https://twitter.com/x/status/123'],
      {
        env: {},
        fetch: vi.fn() as unknown as typeof fetch,
        stderr: stderr.stream,
        stdout: stdout.stream,
      },
    );

    const payload = JSON.parse(stdout.getText());
    expect(payload.llm).toBeNull();
    expect(payload.metrics).not.toBeNull();
    expect(stderr.getText()).toContain('·');
  });
});
