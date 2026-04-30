import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { runCli } from '../src/run.js';

const htmlResponse = (html: string, status = 200) =>
  new Response(html, { headers: { 'Content-Type': 'text/html' }, status });

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

function createTextStream(chunks: string[]): AsyncIterable<string> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield chunk;
      }
    },
  };
}

vi.mock('../src/llm/generate-text.js', () => ({
  generateTextWithModelId: vi.fn(async () => {
    throw new Error('unexpected non-streaming call');
  }),
  streamTextWithModelId: vi.fn(async () => ({
    canonicalModelId: 'openai/gpt-5.2',
    lastError: () => null,
    provider: 'openai',
    textStream: createTextStream(['O', 'K']),
    usage: Promise.resolve({ completionTokens: 2, promptTokens: 1, totalTokens: 3 }),
  })),
}));

describe('cli streaming with auto model selection', () => {
  it('streams when using an auto preset and --stream on', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gist-stream-auto-'));
    mkdirSync(join(root, '.gist'), { recursive: true });
    mkdirSync(join(root, '.gist', 'cache'), { recursive: true });

    writeFileSync(
      join(root, '.gist', 'cache', 'litellm-model_prices_and_context_window.json'),
      JSON.stringify({
        'gpt-5.2': { input_cost_per_token: 0.000_001_75, output_cost_per_token: 0.000_014 },
      }),
      'utf8',
    );
    writeFileSync(
      join(root, '.gist', 'cache', 'litellm-model_prices_and_context_window.meta.json'),
      JSON.stringify({ fetchedAtMs: Date.now() }),
      'utf8',
    );

    writeFileSync(
      join(root, '.gist', 'config.json'),
      JSON.stringify({
        models: { free: { mode: 'auto', rules: [{ candidates: ['openai/gpt-5.2'] }] } },
      }),
      'utf8',
    );

    const globalFetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('unexpected LiteLLM catalog fetch');
    });

    const html =
      '<!doctype html><html><head><title>Hello</title></head>' +
      '<body><article><p>Hi</p></article></body></html>';

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === 'https://example.com') {
        return htmlResponse(html);
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });

    const stdout = collectStream();
    const stderr = collectStream();

    await runCli(
      ['--model', 'free', '--timeout', '2s', '--stream', 'on', '--plain', 'https://example.com'],
      {
        env: { HOME: root, OPENAI_API_KEY: 'test' },
        fetch: fetchMock as unknown as typeof fetch,
        stderr: stderr.stream,
        stdout: stdout.stream,
      },
    );

    expect(stdout.getText()).toContain('OK');

    const { streamTextWithModelId } = await import('../src/llm/generate-text.js');
    const streamMock = streamTextWithModelId as unknown as ReturnType<typeof vi.fn>;
    expect(streamMock).toHaveBeenCalled();

    globalFetchSpy.mockRestore();
  });
});
