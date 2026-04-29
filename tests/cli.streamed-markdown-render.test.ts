import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { runCli } from '../src/run.js';
import { makeAssistantMessage, makeTextDeltaStream } from './helpers/pi-ai-mock.js';

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
  getModel: vi.fn(() => {
    throw new Error('no model');
  }),
  streamSimple: vi.fn(),
}));

vi.mock('@mariozechner/pi-ai', () => ({
  getModel: mocks.getModel,
  streamSimple: mocks.streamSimple,
}));

describe('cli streamed markdown rendering', () => {
  it('streams rendered markdown (append-only) when stdout is a TTY', async () => {
    mocks.streamSimple.mockImplementation(() =>
      makeTextDeltaStream(
        ['[A](https://example.com)\n'],
        makeAssistantMessage({
          text: '[A](https://example.com)\n',
          usage: { input: 100, output: 50, totalTokens: 150 },
        }),
      ),
    );
    const root = mkdtempSync(join(tmpdir(), 'summarize-stream-md-'));
    const cacheDir = join(root, '.summarize', 'cache');
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
    (stdout.stream as unknown as { isTTY?: boolean; columns?: number }).isTTY = true;
    (stdout.stream as unknown as { columns?: number }).columns = 80;
    const stderr = collectStream();

    await runCli(
      ['--model', 'openai/gpt-5.2', '--timeout', '2s', '--stream', 'auto', 'https://example.com'],
      {
        env: { HOME: root, OPENAI_API_KEY: 'test', TERM: 'xterm-256color' },
        fetch: fetchMock as unknown as typeof fetch,
        stderr: stderr.stream,
        stdout: stdout.stream,
      },
    );

    const out = stdout.getText();
    expect(out).toContain('https://example.com');
    expect(out).not.toContain('\u001B[?2026h');
    expect(out).not.toContain('\u001B[?2026l');
    expect(out).not.toContain('\u001B[0J');
    expect(out).not.toContain('\u001B[?25l');
    expect(out).not.toContain('\u001B[?25h');

    globalFetchSpy.mockRestore();
  });

  it('does not add an extra blank line before headings', async () => {
    mocks.streamSimple.mockImplementationOnce(() =>
      makeTextDeltaStream(
        ['A\n\n## B\n'],
        makeAssistantMessage({
          text: 'A\n\n## B\n',
          usage: { input: 100, output: 50, totalTokens: 150 },
        }),
      ),
    );

    const root = mkdtempSync(join(tmpdir(), 'summarize-stream-md-'));
    const cacheDir = join(root, '.summarize', 'cache');
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
    (stdout.stream as unknown as { isTTY?: boolean; columns?: number }).isTTY = true;
    (stdout.stream as unknown as { columns?: number }).columns = 80;
    const stderr = collectStream();

    await runCli(
      [
        '--model',
        'openai/gpt-5.2',
        '--timeout',
        '2s',
        '--stream',
        'auto',
        '--no-color',
        'https://example.com',
      ],
      {
        env: { HOME: root, OPENAI_API_KEY: 'test', TERM: 'xterm-256color' },
        fetch: fetchMock as unknown as typeof fetch,
        stderr: stderr.stream,
        stdout: stdout.stream,
      },
    );

    const out = stdout.getText();
    expect(out).toContain('A\n\nB\n');
    expect(out).not.toContain('A\n\n\nB\n');

    globalFetchSpy.mockRestore();
  });
});
