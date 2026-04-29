import { Writable } from 'node:stream';

import type { Api } from '@mariozechner/pi-ai';
import { describe, expect, it, vi } from 'vitest';

import { runCli } from '../src/run.js';
import { makeAssistantMessage } from './helpers/pi-ai-mock.js';

interface MockModel {
  provider: string;
  id: string;
  api: Api;
}

const htmlResponse = (html: string, status = 200) =>
  new Response(html, { headers: { 'Content-Type': 'text/html' }, status });

const mocks = vi.hoisted(() => ({
  completeSimple: vi.fn(),
  getModel: vi.fn(() => {
    throw new Error('no model');
  }),
  streamSimple: vi.fn(),
}));

mocks.completeSimple.mockImplementation(async (model: MockModel) =>
  makeAssistantMessage({ api: model.api, model: model.id, provider: model.provider, text: 'OK' }),
);

vi.mock('@mariozechner/pi-ai', () => ({
  completeSimple: mocks.completeSimple,
  getModel: mocks.getModel,
  streamSimple: mocks.streamSimple,
}));

const collectStdout = () => {
  let text = '';
  const stdout = new Writable({
    write(chunk, _encoding, callback) {
      text += chunk.toString();
      callback();
    },
  });
  return { getText: () => text, stdout };
};

const silentStderr = new Writable({
  write(_chunk, _encoding, callback) {
    callback();
  },
});

describe('--max-output-tokens (OpenRouter)', () => {
  it('sends maxOutputTokens to OpenRouter calls when explicitly set', async () => {
    mocks.completeSimple.mockClear();
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

    const out = collectStdout();
    await runCli(
      [
        '--model',
        'openrouter/openai/gpt-5-chat',
        '--max-output-tokens',
        '1234',
        '--timeout',
        '2s',
        'https://example.com',
      ],
      {
        env: { OPENROUTER_API_KEY: 'test' },
        fetch: fetchMock as unknown as typeof fetch,
        stderr: silentStderr,
        stdout: out.stdout,
      },
    );

    const options = (mocks.completeSimple.mock.calls[0]?.[2] ?? {}) as Record<string, unknown>;
    expect(options.maxTokens).toBe(1234);
  });
});
