import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { runCli } from '../src/run';
import { makeAssistantMessage, makeTextDeltaStream } from './helpers/pi-ai-mock';

const mocks = vi.hoisted(() => ({
  getModel: vi.fn(() => {
    throw new Error('no model');
  }),
  streamSimple: vi.fn(),
}));

vi.mock('@mariozechner/pi-ai', () => ({
  getModel: mocks.getModel,
  streamSimple: mocks.streamSimple,
}));

const htmlResponse = (html: string, status = 200) =>
  new Response(html, { headers: { 'Content-Type': 'text/html' }, status });

function collectChunks() {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  return { chunks, stream };
}

describe('cli streamed markdown write semantics', () => {
  it('buffers until newline and writes complete lines only', async () => {
    mocks.streamSimple.mockImplementation(() =>
      makeTextDeltaStream(
        ['\nHello', ' world\n'],
        makeAssistantMessage({
          text: '\nHello world\n',
          usage: { input: 100, output: 50, totalTokens: 150 },
        }),
      ),
    );
    mocks.streamSimple.mockClear();

    const root = mkdtempSync(join(tmpdir(), 'gist-stream-lines-'));
    const cacheDir = join(root, '.gist', 'cache');
    mkdirSync(cacheDir, { recursive: true });

    writeFileSync(
      join(cacheDir, 'litellm-model_prices_and_context_window.json'),
      JSON.stringify({
        'gpt-5.2': { input_cost_per_token: 0.000_001_75, output_cost_per_token: 0.000_014 },
      }),
      'utf8',
    );
    writeFileSync(
      join(cacheDir, 'litellm-model_prices_and_context_window.meta.json'),
      JSON.stringify({ fetchedAtMs: Date.now() }),
      'utf8',
    );

    const globalFetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('unexpected LiteLLM catalog fetch');
    });

    try {
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.url;
        if (url === 'https://example.com') {
          return htmlResponse(
            '<!doctype html><html><head><title>Hello</title></head>' +
              '<body><article><p>Hi</p></article></body></html>',
          );
        }
        throw new Error(`Unexpected fetch call: ${url}`);
      });

      const stdout = collectChunks();
      (stdout.stream as unknown as { isTTY?: boolean; columns?: number }).isTTY = true;
      (stdout.stream as unknown as { columns?: number }).columns = 80;
      const stderr = collectChunks();

      await runCli(
        ['--model', 'openai/gpt-5.2', '--timeout', '2s', '--stream', 'on', 'https://example.com'],
        {
          env: { HOME: root, OPENAI_API_KEY: 'test' },
          fetch: fetchMock as unknown as typeof fetch,
          stderr: stderr.stream,
          stdout: stdout.stream,
        },
      );

      expect(stdout.chunks).toHaveLength(1);
      expect(stdout.chunks[0]).toBe('\nHello world\n');
    } finally {
      globalFetchSpy.mockRestore();
    }
  });
});
