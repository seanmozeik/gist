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

describe('config prompt', () => {
  it('uses config.prompt when --prompt is absent', async () => {
    mocks.streamSimple.mockImplementation(() =>
      makeTextDeltaStream(
        ['OK'],
        makeAssistantMessage({ text: 'OK', usage: { input: 1, output: 1, totalTokens: 2 } }),
      ),
    );
    mocks.streamSimple.mockClear();

    const root = mkdtempSync(join(tmpdir(), 'gist-prompt-'));
    const gistDir = join(root, '.gist');
    const cacheDir = join(gistDir, 'cache');
    mkdirSync(cacheDir, { recursive: true });

    writeFileSync(
      join(gistDir, 'config.json'),
      JSON.stringify({ prompt: 'Explain for a kid.' }),
      'utf8',
    );

    // LiteLLM cache: used for model limits; avoid network fetch in tests
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

    const stdout = collectStream();
    (stdout.stream as unknown as { isTTY?: boolean }).isTTY = false;
    const stderr = collectStream();

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
        stderr: stderr.stream,
        stdout: stdout.stream,
      },
    );

    const context = mocks.streamSimple.mock.calls[0]?.[1] as { messages?: { content?: unknown }[] };
    const promptText = String(context.messages?.[0]?.content ?? '');
    expect(promptText).toContain('<instructions>');
    expect(promptText).toContain('Explain for a kid.');
    expect(promptText).not.toContain('You gist online articles');

    globalFetchSpy.mockRestore();
  });

  it('keeps config output defaults when config.prompt overrides base instructions', async () => {
    mocks.streamSimple.mockImplementation(() =>
      makeTextDeltaStream(
        ['OK'],
        makeAssistantMessage({ text: 'OK', usage: { input: 1, output: 1, totalTokens: 2 } }),
      ),
    );
    mocks.streamSimple.mockClear();

    const root = mkdtempSync(join(tmpdir(), 'gist-prompt-'));
    const gistDir = join(root, '.gist');
    const cacheDir = join(gistDir, 'cache');
    mkdirSync(cacheDir, { recursive: true });

    writeFileSync(
      join(gistDir, 'config.json'),
      JSON.stringify({ output: { language: 'de', length: 'short' }, prompt: 'Explain for a kid.' }),
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

    const stdout = collectStream();
    (stdout.stream as unknown as { isTTY?: boolean }).isTTY = false;
    const stderr = collectStream();

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
        stderr: stderr.stream,
        stdout: stdout.stream,
      },
    );

    const context = mocks.streamSimple.mock.calls[0]?.[1] as { messages?: { content?: unknown }[] };
    const promptText = String(context.messages?.[0]?.content ?? '');
    expect(promptText).toContain('Explain for a kid.');
    expect(promptText).toContain('Target length: around 900 characters');
    expect(promptText).toContain('Output should be German.');

    globalFetchSpy.mockRestore();
  });
});
