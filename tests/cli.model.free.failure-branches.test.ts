import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

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

  const generateTextWithModelId = vi.fn();
  const streamTextWithModelId = vi.fn(async () => {
    throw new Error('unexpected streaming call');
  });

  return { createLinkPreviewClient, generateTextWithModelId, streamTextWithModelId };
});

vi.mock('../src/content/index.js', () => ({
  createLinkPreviewClient: mocks.createLinkPreviewClient,
}));

vi.mock('../src/llm/generate-text.js', () => ({
  generateTextWithModelId: mocks.generateTextWithModelId,
  streamTextWithModelId: mocks.streamTextWithModelId,
}));

describe('cli run.ts free preset error branches', () => {
  const setupLiteLlmCache = (root: string) => {
    const cacheDir = join(root, '.gist', 'cache');
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(
      join(cacheDir, 'litellm-model_prices_and_context_window.json'),
      JSON.stringify({}),
      'utf8',
    );
    writeFileSync(
      join(cacheDir, 'litellm-model_prices_and_context_window.meta.json'),
      JSON.stringify({ fetchedAtMs: Date.now() }),
      'utf8',
    );
  };

  it('throws lastError message when all free attempts fail with Error', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gist-free-fail-'));
    setupLiteLlmCache(root);

    const globalFetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('unexpected network fetch');
    });

    mocks.generateTextWithModelId.mockImplementation(async () => {
      throw new Error('boom error');
    });

    const stdout = collectStream();
    const stderr = collectStream();

    await expect(
      runCli(['--model', 'free', '--timeout', '2s', 'https://example.com'], {
        env: { HOME: root, OPENROUTER_API_KEY: 'test' },
        fetch: vi.fn() as unknown as typeof fetch,
        stderr: stderr.stream,
        stdout: stdout.stream,
      }),
    ).rejects.toThrow(/boom error/);

    globalFetchSpy.mockRestore();
  });

  it('throws a generic "no model available" when failures are non-Error throwables', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gist-free-fail-'));
    setupLiteLlmCache(root);

    const globalFetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('unexpected network fetch');
    });

    mocks.generateTextWithModelId.mockImplementation(async () => {
      throw new Error('boom string');
    });

    const stdout = collectStream();
    const stderr = collectStream();

    await expect(
      runCli(['--model', 'free', '--timeout', '2s', 'https://example.com'], {
        env: { HOME: root, OPENROUTER_API_KEY: 'test' },
        fetch: vi.fn() as unknown as typeof fetch,
        stderr: stderr.stream,
        stdout: stdout.stream,
      }),
    ).rejects.toThrow(/No model available for --model free/i);

    globalFetchSpy.mockRestore();
  });
});
