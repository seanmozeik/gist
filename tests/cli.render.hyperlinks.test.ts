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

mocks.completeSimple.mockImplementation(async (model: MockModel) =>
  makeAssistantMessage({
    api: model.api,
    model: model.id,
    provider: model.provider,
    text: 'See [Heise](https://www.heise.de/) for details.',
    usage: { input: 1, output: 1, totalTokens: 2 },
  }),
);

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

describe('cli markdown hyperlinks', () => {
  it('uses OSC-8 hyperlinks for markdown links on a TTY', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gist-hyperlinks-'));
    const cacheDir = join(root, '.gist', 'cache');
    mkdirSync(cacheDir, { recursive: true });

    writeFileSync(
      join(cacheDir, 'litellm-model_prices_and_context_window.json'),
      JSON.stringify({
        'gpt-5-chat': { input_cost_per_token: 0.000_001_75, output_cost_per_token: 0.000_014 },
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
    (stdout.stream as unknown as { isTTY?: boolean; columns?: number }).isTTY = true;
    (stdout.stream as unknown as { columns?: number }).columns = 80;
    const stderr = collectStream();

    await runCli(['--model', 'openai/gpt-5-chat', '--stream', 'off', 'https://example.com'], {
      env: { HOME: root, OPENAI_API_KEY: 'test', TERM: 'xterm-256color' },
      fetch: fetchMock as unknown as typeof fetch,
      stderr: stderr.stream,
      stdout: stdout.stream,
    });

    const out = stdout.getText();
    expect(out).toContain('\u001B]8;;https://www.heise.de/\u0007');
    expect(out).toContain('\u001B]8;;\u0007');
  });
});
