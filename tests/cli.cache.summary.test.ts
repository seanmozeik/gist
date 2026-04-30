import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { runCli } from '../src/run';
import { makeAssistantMessage, makeTextDeltaStream } from './helpers/pi-ai-mock';

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

const mocks = vi.hoisted(() => ({
  completeSimple: vi.fn(),
  getModel: vi.fn(() => {
    throw new Error('no model');
  }),
  streamSimple: vi.fn(),
}));

mocks.streamSimple.mockImplementation(() =>
  makeTextDeltaStream(
    ['Cached summary.'],
    makeAssistantMessage({
      text: 'Cached summary.',
      usage: { input: 1, output: 1, totalTokens: 2 },
    }),
  ),
);

vi.mock('@mariozechner/pi-ai', () => ({
  completeSimple: mocks.completeSimple,
  getModel: mocks.getModel,
  streamSimple: mocks.streamSimple,
}));

describe('cli cache summary', () => {
  it('reuses cached summaries and extracted content', async () => {
    mocks.streamSimple.mockClear();

    const root = mkdtempSync(join(tmpdir(), 'gist-cache-cli-'));
    const gistDir = join(root, '.gist');
    const cacheDir = join(gistDir, 'cache');
    mkdirSync(cacheDir, { recursive: true });

    writeFileSync(
      join(gistDir, 'config.json'),
      JSON.stringify({ cache: { enabled: true, maxMb: 32, ttlDays: 30 } }),
      'utf8',
    );

    writeFileSync(
      join(cacheDir, 'litellm-model_prices_and_context_window.json'),
      JSON.stringify({ 'gpt-5.2': { max_input_tokens: 999_999 } }),
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

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === 'https://example.com') {
        return htmlResponse('<!doctype html><html><body>Hi</body></html>');
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });

    const stdout1 = collectStream();
    (stdout1.stream as unknown as { isTTY?: boolean }).isTTY = false;
    const stderr1 = collectStream();

    await runCli(
      [
        '--model',
        'openai/gpt-5.2',
        '--timeout',
        '2s',
        '--stream',
        'on',
        '--metrics',
        'off',
        'https://example.com',
      ],
      {
        env: { HOME: root, OPENAI_API_KEY: 'test' },
        fetch: fetchMock as unknown as typeof fetch,
        stderr: stderr1.stream,
        stdout: stdout1.stream,
      },
    );

    expect(mocks.streamSimple).toHaveBeenCalledTimes(1);
    const first = stdout1.getText();

    const stdout2 = collectStream();
    (stdout2.stream as unknown as { isTTY?: boolean }).isTTY = false;
    const stderr2 = collectStream();

    await runCli(
      [
        '--model',
        'openai/gpt-5.2',
        '--timeout',
        '2s',
        '--stream',
        'on',
        '--metrics',
        'off',
        'https://example.com',
      ],
      {
        env: { HOME: root, OPENAI_API_KEY: 'test' },
        fetch: fetchMock as unknown as typeof fetch,
        stderr: stderr2.stream,
        stdout: stdout2.stream,
      },
    );

    expect(mocks.streamSimple).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(stdout2.getText()).toBe(first);

    globalFetchSpy.mockRestore();
  }, 30_000);
});
