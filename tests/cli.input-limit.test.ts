import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
}));

vi.mock('@mariozechner/pi-ai', () => ({
  completeSimple: mocks.completeSimple,
  getModel: mocks.getModel,
}));

describe('cli input token limits', () => {
  it('rejects large URL inputs before LLM calls', async () => {
    mocks.completeSimple.mockImplementation(async (model: MockModel) =>
      makeAssistantMessage({
        api: model.api,
        model: model.id,
        provider: model.provider,
        text: 'OK',
      }),
    );
    mocks.completeSimple.mockReset();

    const root = mkdtempSync(join(tmpdir(), 'summarize-input-limit-'));
    const cacheDir = join(root, '.summarize', 'cache');
    mkdirSync(cacheDir, { recursive: true });

    writeFileSync(
      join(cacheDir, 'litellm-model_prices_and_context_window.json'),
      JSON.stringify({
        'gpt-5.2': {
          input_cost_per_token: 0.000_001_75,
          max_input_tokens: 10,
          output_cost_per_token: 0.000_014,
        },
      }),
      'utf8',
    );
    writeFileSync(
      join(cacheDir, 'litellm-model_prices_and_context_window.meta.json'),
      JSON.stringify({ fetchedAtMs: Date.now() }),
      'utf8',
    );

    const html =
      '<!doctype html><html><head><title>Big</title></head>' +
      `<body><article><p>${'A'.repeat(2000)}</p></article></body></html>`;

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === 'https://example.com') {
        return htmlResponse(html);
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });

    const stdout = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });
    const stderr = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });

    await expect(
      runCli(['--model', 'openai/gpt-5.2', '--timeout', '10s', 'https://example.com'], {
        env: { HOME: root, OPENAI_API_KEY: 'test' },
        fetch: fetchMock as unknown as typeof fetch,
        stderr,
        stdout,
      }),
    ).rejects.toThrow(/Input token count/i);
    expect(mocks.completeSimple).toHaveBeenCalledTimes(0);
  });
});
