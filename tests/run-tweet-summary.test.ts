import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runCli } from '../src/run.js';

const mocks = vi.hoisted(() => ({
  fetchLinkContent: vi.fn(),
  generateTextWithModelId: vi.fn(),
  streamTextWithModelId: vi.fn(),
}));

vi.mock('../src/content/index.js', () => ({
  createLinkPreviewClient: () => ({
    fetchLinkContent: (...args: unknown[]) => mocks.fetchLinkContent(...args),
  }),
}));

vi.mock('../src/llm/generate-text.js', () => ({
  generateTextWithModelId: (...args: unknown[]) => mocks.generateTextWithModelId(...args),
  streamTextWithModelId: (...args: unknown[]) => mocks.streamTextWithModelId(...args),
}));

const createBufferStream = () => {
  let buffer = '';
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      buffer += chunk.toString();
      callback();
    },
  });
  return { read: () => buffer, stream };
};

const baseExtracted = {
  content: 'Short tweet content.',
  description: null,
  diagnostics: {
    firecrawl: { attempted: false, cacheMode: 'default', cacheStatus: 'miss', used: false },
    markdown: { notes: null, provider: null, requested: false, used: false },
    strategy: 'bird',
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
  siteName: 'X',
  title: null,
  totalCharacters: 21,
  transcriptCharacters: null,
  transcriptLines: null,
  transcriptMetadata: null,
  transcriptSegments: null,
  transcriptSource: null,
  transcriptTimedText: null,
  transcriptWordCount: null,
  transcriptionProvider: null,
  truncated: false,
  url: 'https://x.com/ivanhzhao/status/2003192654545539400',
  video: null,
  wordCount: 3,
};

beforeEach(() => {
  mocks.fetchLinkContent.mockReset();
  mocks.generateTextWithModelId.mockReset();
  mocks.streamTextWithModelId.mockReset();
});

describe('tweet summary behavior', () => {
  it('skips LLM for short tweets by default', async () => {
    const home = mkdtempSync(join(tmpdir(), 'summarize-tests-run-tweet-summary-'));
    mocks.fetchLinkContent.mockResolvedValue(baseExtracted);
    mocks.generateTextWithModelId.mockResolvedValue({
      canonicalModelId: 'openai/gpt-4o-mini',
      provider: 'openai',
      text: 'LLM summary output.',
      usage: { completionTokens: 12, promptTokens: 10, totalTokens: 22 },
    });

    const stdout = createBufferStream();
    const stderr = createBufferStream();

    await runCli(
      [baseExtracted.url, '--model', 'openai/gpt-4o-mini', '--stream', 'off', '--plain'],
      {
        env: { ...process.env, HOME: home, OPENAI_API_KEY: 'test-key' },
        fetch: async () => {
          throw new Error('unexpected fetch');
        },
        stderr: stderr.stream,
        stdout: stdout.stream,
      },
    );

    expect(mocks.generateTextWithModelId).not.toHaveBeenCalled();
    expect(mocks.streamTextWithModelId).not.toHaveBeenCalled();
    expect(stdout.read()).toContain(baseExtracted.content);
    expect(stderr.read()).toContain('short content');
  });
});
