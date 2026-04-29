import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';

import type { Api } from '@mariozechner/pi-ai';
import { describe, expect, it, vi } from 'vitest';

import { runCli } from '../src/run.js';
import { makeAssistantMessage } from './helpers/pi-ai-mock.js';

interface MockModel { provider: string; id: string; api: Api }

const mocks = vi.hoisted(() => ({
  completeSimple: vi.fn(),
  getModel: vi.fn(() => {
    throw new Error('no model');
  }),
  streamSimple: vi.fn(),
}));

mocks.completeSimple.mockImplementation(async (model: MockModel) =>
  makeAssistantMessage({
    api: model.api,
    model: model.id,
    provider: model.provider,
    text: 'OK',
    usage: { input: 1, output: 1, totalTokens: 2 },
  }),
);

vi.mock('@mariozechner/pi-ai', () => ({
  completeSimple: mocks.completeSimple,
  getModel: mocks.getModel,
  streamSimple: mocks.streamSimple,
}));

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

describe('metrics model label', () => {
  it('keeps openrouter/… prefix in the finish line', async () => {
    const root = mkdtempSync(join(tmpdir(), 'summarize-openrouter-label-'));
    const cacheDir = join(root, '.summarize', 'cache');
    mkdirSync(cacheDir, { recursive: true });

    writeFileSync(
      join(cacheDir, 'litellm-model_prices_and_context_window.json'),
      JSON.stringify({
        'openai/xiaomi/mimo-v2-flash:free': { input_cost_per_token: 0, output_cost_per_token: 0 },
      }),
      'utf8',
    );
    writeFileSync(
      join(cacheDir, 'litellm-model_prices_and_context_window.meta.json'),
      JSON.stringify({ fetchedAtMs: Date.now() }),
      'utf8',
    );

    const html =
      '<!doctype html><html><head><title>Hello</title></head>' +
      '<body><article><p>Hi</p></article></body></html>';

    const fetchMock = vi.fn(async () => {
      return new Response(html, { headers: { 'Content-Type': 'text/html' }, status: 200 });
    });

    const stdout = collectStream();
    const stderr = collectStream();

    await runCli(
      [
        '--model',
        'openrouter/xiaomi/mimo-v2-flash:free',
        '--metrics',
        'on',
        '--stream',
        'off',
        '--timeout',
        '2s',
        'https://example.com',
      ],
      {
        env: { HOME: root, OPENROUTER_API_KEY: 'test' },
        fetch: fetchMock as unknown as typeof fetch,
        stderr: stderr.stream,
        stdout: stdout.stream,
      },
    );

    expect(stderr.getText()).toContain('openrouter/xiaomi/mimo-v2-flash:free');
    expect(stderr.getText()).not.toContain('openai/xiaomi/mimo-v2-flash:free');
  });
});
