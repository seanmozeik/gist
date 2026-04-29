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
  completeSimple: vi.fn(),
  getModel: vi.fn(() => {
    throw new Error('no model');
  }),
  streamSimple: vi.fn(),
}));

mocks.streamSimple.mockImplementation(() =>
  makeTextDeltaStream(
    ['Hello', ' world'],
    makeAssistantMessage({
      text: 'Hello world',
      usage: { input: 123_456, output: 7890, totalTokens: 131_346 },
    }),
  ),
);

vi.mock('@mariozechner/pi-ai', () => ({
  completeSimple: mocks.completeSimple,
  getModel: mocks.getModel,
  streamSimple: mocks.streamSimple,
}));

describe('cli finish line + metrics', () => {
  it('streams text to stdout and prints token metrics + cost', async () => {
    mocks.streamSimple
      .mockReset()
      .mockImplementation(() =>
        makeTextDeltaStream(
          ['Hello', ' world'],
          makeAssistantMessage({
            text: 'Hello world',
            usage: { input: 123_456, output: 7890, totalTokens: 131_346 },
          }),
        ),
      );

    const root = mkdtempSync(join(tmpdir(), 'summarize-finish-line-'));
    const cacheDir = join(root, '.summarize', 'cache');
    mkdirSync(cacheDir, { recursive: true });

    // LiteLLM cache: used for model limits (avoid network fetch in tests)
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

    // Ensure LiteLLM network fetch is never attempted
    const globalFetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('unexpected LiteLLM catalog fetch');
    });

    const html =
      '<!doctype html><html><head><title>Hello</title></head>' +
      '<body><article><p>Hi</p></article></body></html>';

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === 'https://example.com') {return htmlResponse(html);}
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
        '--plain',
        '--metrics',
        'detailed',
        'https://example.com',
      ],
      {
        env: { HOME: root, OPENAI_API_KEY: 'test' },
        fetch: fetchMock as unknown as typeof fetch,
        stderr: stderr.stream,
        stdout: stdout.stream,
      },
    );

    expect(stdout.getText()).toBe('Hello world\n');
    const err = stderr.getText();
    expect(err).toContain('$0.3265');
    expect(err).not.toContain('estimated=');
    expect(err).toContain('↑123k ↓7.9k Δ131k');
    expect(err).not.toContain('calls=');
    expect(err).not.toContain('metrics llm provider=');
    expect(err).not.toContain('firecrawl=');
    expect(err).not.toContain('apify=');
    expect(err).not.toContain('strategy=');
    expect(err).not.toContain('chunks=');

    globalFetchSpy.mockRestore();
  });

  it('prints a finish line with cost when token counts are small', async () => {
    mocks.streamSimple
      .mockReset()
      .mockImplementation(() =>
        makeTextDeltaStream(
          ['Hi'],
          makeAssistantMessage({ text: 'Hi', usage: { input: 10, output: 10, totalTokens: 20 } }),
        ),
      );

    const root = mkdtempSync(join(tmpdir(), 'summarize-finish-line-small-'));
    const cacheDir = join(root, '.summarize', 'cache');
    mkdirSync(cacheDir, { recursive: true });

    // LiteLLM cache: key without provider prefix to exercise prefix-stripped resolution for xai/...
    writeFileSync(
      join(cacheDir, 'litellm-model_prices_and_context_window.json'),
      JSON.stringify({
        'grok-4-fast-non-reasoning': {
          input_cost_per_token: 0.000_001,
          output_cost_per_token: 0.000_001,
        },
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
      if (url === 'https://example.com') {return htmlResponse(html);}
      throw new Error(`Unexpected fetch call: ${url}`);
    });

    const stdout = collectStream();
    (stdout.stream as unknown as { isTTY?: boolean; columns?: number }).isTTY = true;
    (stdout.stream as unknown as { columns?: number }).columns = 80;
    const stderr = collectStream();

    await runCli(
      [
        '--model',
        'xai/grok-4-fast-non-reasoning',
        '--timeout',
        '2s',
        '--stream',
        'auto',
        '--plain',
        '--metrics',
        'detailed',
        'https://example.com',
      ],
      {
        env: { HOME: root, XAI_API_KEY: 'test' },
        fetch: fetchMock as unknown as typeof fetch,
        stderr: stderr.stream,
        stdout: stdout.stream,
      },
    );

    const err = stderr.getText();
    expect(err).toContain('$0.0000');
    expect(err).not.toContain('estimated=');
    expect(err).toContain('↑10 ↓10 Δ20');
    expect(err).not.toContain('calls=');
    expect(err).not.toContain('firecrawl=');
    expect(err).not.toContain('apify=');
    expect(err).not.toContain('strategy=');
    expect(err).not.toContain('chunks=');

    globalFetchSpy.mockRestore();
  });
});
