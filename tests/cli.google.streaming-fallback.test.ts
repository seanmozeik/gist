import type { ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import type { ExecFileFn } from '../src/markitdown.js';
import { runCli } from '../src/run.js';
import { makeAssistantMessage, makeTextDeltaStream } from './helpers/pi-ai-mock.js';

const mocks = vi.hoisted(() => ({
  completeSimple: vi.fn(),
  getModel: vi.fn(() => {
    throw new Error('no model');
  }),
  streamSimple: vi.fn(),
}));

vi.mock('@mariozechner/pi-ai', () => ({
  completeSimple: mocks.completeSimple,
  getModel: mocks.getModel,
  streamSimple: mocks.streamSimple,
}));

mocks.completeSimple.mockImplementation(async () =>
  makeAssistantMessage({
    provider: 'google',
    text: 'OK',
    usage: { input: 10, output: 2, totalTokens: 12 },
  }),
);
mocks.streamSimple.mockImplementation(() => {
  const error = new Error(
    'models/gemini-3-flash-preview is not found for API version v1beta, or is not supported for generateContent. Call ListModels to see the list of available models and their supported methods.',
  ) as Error & { url?: string; statusCode?: number; responseBody?: string };
  error.url =
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:streamGenerateContent?alt=sse';
  error.statusCode = 404;
  error.responseBody = JSON.stringify({
    error: {
      code: 404,
      message:
        'models/gemini-3-flash-preview is not found for API version v1beta, or is not supported for generateContent. Call ListModels to see the list of available models and their supported methods.',
      status: 'NOT_FOUND',
    },
  });
  throw error;
});

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

const execFileMock: ExecFileFn = ((file, args, _options, callback) => {
  undefined;
  undefined;
  callback(null, '# converted\n\nhello\n', '');
  return { pid: 123 } as unknown as ChildProcess;
}) as ExecFileFn;

describe('cli google streaming fallback', () => {
  it('falls back to non-streaming when streaming times out', async () => {
    mocks.completeSimple.mockClear();
    mocks.streamSimple.mockClear();
    mocks.streamSimple.mockImplementationOnce(() => {
      throw new Error('LLM request timed out');
    });

    const root = mkdtempSync(join(tmpdir(), 'summarize-google-stream-timeout-'));
    const cacheDir = join(root, '.summarize', 'cache');
    mkdirSync(cacheDir, { recursive: true });

    writeFileSync(
      join(cacheDir, 'litellm-model_prices_and_context_window.json'),
      JSON.stringify({
        'gemini-3-flash-preview': {
          input_cost_per_token: 0.000_000_2,
          output_cost_per_token: 0.000_000_8,
        },
      }),
      'utf8',
    );
    writeFileSync(
      join(cacheDir, 'litellm-model_prices_and_context_window.meta.json'),
      JSON.stringify({ fetchedAtMs: Date.now() }),
      'utf8',
    );

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.startsWith('https://generativelanguage.googleapis.com/v1beta/models?key=')) {
        expect(init?.method ?? 'GET').toBe('GET');
        return Response.json(
          {
            models: [
              {
                name: 'models/gemini-3-flash-preview',
                supportedGenerationMethods: ['generateContent'],
              },
            ],
          },
          { headers: { 'content-type': 'application/json' }, status: 200 },
        );
      }
      if (url === 'https://example.com') {
        return new Response('<html><body><h1>Example</h1></body></html>', {
          headers: { 'content-type': 'text/html; charset=utf-8' },
          status: 200,
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const stdout = collectStream();
    (stdout.stream as unknown as { isTTY?: boolean }).isTTY = true;
    const stderr = collectStream();

    await runCli(
      [
        '--model',
        'google/gemini-3-flash-preview',
        '--timeout',
        '2s',
        '--stream',
        'on',
        'https://example.com',
      ],
      {
        env: { GOOGLE_GENERATIVE_AI_API_KEY: 'test', HOME: root, UVX_PATH: 'uvx' },
        execFile: execFileMock,
        fetch: fetchMock as unknown as typeof fetch,
        stderr: stderr.stream,
        stdout: stdout.stream,
      },
    );

    expect(stdout.getText()).toContain('OK');
    expect(mocks.completeSimple).toHaveBeenCalledTimes(1);
    expect(mocks.streamSimple).toHaveBeenCalledTimes(1);
  });

  it('falls back to non-streaming when streamGenerateContent is rejected at runtime', async () => {
    mocks.completeSimple.mockClear();
    mocks.streamSimple.mockClear();

    const root = mkdtempSync(join(tmpdir(), 'summarize-google-stream-fallback-'));
    const cacheDir = join(root, '.summarize', 'cache');
    mkdirSync(cacheDir, { recursive: true });

    writeFileSync(
      join(cacheDir, 'litellm-model_prices_and_context_window.json'),
      JSON.stringify({
        'gemini-3-flash-preview': {
          input_cost_per_token: 0.000_000_2,
          output_cost_per_token: 0.000_000_8,
        },
      }),
      'utf8',
    );
    writeFileSync(
      join(cacheDir, 'litellm-model_prices_and_context_window.meta.json'),
      JSON.stringify({ fetchedAtMs: Date.now() }),
      'utf8',
    );

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.startsWith('https://generativelanguage.googleapis.com/v1beta/models?key=')) {
        expect(init?.method ?? 'GET').toBe('GET');
        return Response.json(
          {
            models: [
              {
                name: 'models/gemini-3-flash-preview',
                supportedGenerationMethods: ['generateContent'],
              },
            ],
          },
          { headers: { 'content-type': 'application/json' }, status: 200 },
        );
      }
      if (url === 'https://example.com') {
        return new Response('<html><body><h1>Example</h1></body></html>', {
          headers: { 'content-type': 'text/html; charset=utf-8' },
          status: 200,
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const stdout = collectStream();
    (stdout.stream as unknown as { isTTY?: boolean }).isTTY = true;
    const stderr = collectStream();

    await runCli(
      [
        '--model',
        'google/gemini-3-flash-preview',
        '--timeout',
        '2s',
        '--stream',
        'on',
        'https://example.com',
      ],
      {
        env: { GOOGLE_GENERATIVE_AI_API_KEY: 'test', HOME: root, UVX_PATH: 'uvx' },
        execFile: execFileMock,
        fetch: fetchMock as unknown as typeof fetch,
        stderr: stderr.stream,
        stdout: stdout.stream,
      },
    );

    expect(stdout.getText()).toContain('OK');
    expect(mocks.completeSimple).toHaveBeenCalledTimes(1);
    expect(mocks.streamSimple).toHaveBeenCalledTimes(1);
  });

  it('still streams when ListModels omits streamGenerateContent', async () => {
    mocks.completeSimple.mockClear();
    mocks.streamSimple.mockClear();

    mocks.streamSimple.mockImplementationOnce(() =>
      makeTextDeltaStream(
        ['STREAMED'],
        makeAssistantMessage({
          provider: 'google',
          text: 'STREAMED',
          usage: { input: 10, output: 2, totalTokens: 12 },
        }),
      ),
    );

    const root = mkdtempSync(join(tmpdir(), 'summarize-google-stream-ok-'));
    const cacheDir = join(root, '.summarize', 'cache');
    mkdirSync(cacheDir, { recursive: true });

    writeFileSync(
      join(cacheDir, 'litellm-model_prices_and_context_window.json'),
      JSON.stringify({
        'gemini-3-flash-preview': {
          input_cost_per_token: 0.000_000_2,
          output_cost_per_token: 0.000_000_8,
        },
      }),
      'utf8',
    );
    writeFileSync(
      join(cacheDir, 'litellm-model_prices_and_context_window.meta.json'),
      JSON.stringify({ fetchedAtMs: Date.now() }),
      'utf8',
    );

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.startsWith('https://generativelanguage.googleapis.com/v1beta/models?key=')) {
        expect(init?.method ?? 'GET').toBe('GET');
        return Response.json(
          {
            models: [
              {
                name: 'models/gemini-3-flash-preview',
                supportedGenerationMethods: ['generateContent'],
              },
            ],
          },
          { headers: { 'content-type': 'application/json' }, status: 200 },
        );
      }
      if (url === 'https://example.com') {
        return new Response('<html><body><h1>Example</h1></body></html>', {
          headers: { 'content-type': 'text/html; charset=utf-8' },
          status: 200,
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const stdout = collectStream();
    (stdout.stream as unknown as { isTTY?: boolean }).isTTY = true;
    const stderr = collectStream();

    await runCli(
      [
        '--model',
        'google/gemini-3-flash-preview',
        '--timeout',
        '2s',
        '--stream',
        'on',
        'https://example.com',
      ],
      {
        env: { GOOGLE_GENERATIVE_AI_API_KEY: 'test', HOME: root, UVX_PATH: 'uvx' },
        execFile: execFileMock,
        fetch: fetchMock as unknown as typeof fetch,
        stderr: stderr.stream,
        stdout: stdout.stream,
      },
    );

    expect(stdout.getText()).toContain('STREAMED');
    expect(mocks.streamSimple).toHaveBeenCalledTimes(1);
    expect(mocks.completeSimple).toHaveBeenCalledTimes(0);
  });
});
