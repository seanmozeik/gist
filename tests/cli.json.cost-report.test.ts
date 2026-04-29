import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';

import type { Api } from '@mariozechner/pi-ai';
import { describe, expect, it, vi } from 'vitest';

import { runCli } from '../src/run.js';
import { makeAssistantMessage } from './helpers/pi-ai-mock.js';

interface MockModel { provider: string; id: string; api: Api }

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
  makeAssistantMessage({
    api: model.api,
    model: model.id,
    provider: model.provider,
    text: 'OK',
    usage: { input: 10, output: 1, totalTokens: 11 },
  }),
);

vi.mock('@mariozechner/pi-ai', () => ({
  completeSimple: mocks.completeSimple,
  getModel: mocks.getModel,
  streamSimple: mocks.streamSimple,
}));

describe('cli json + metrics report', () => {
  it('prints a finish line when --json --metrics detailed', async () => {
    const root = mkdtempSync(join(tmpdir(), 'summarize-json-cost-'));
    const cacheDir = join(root, '.summarize', 'cache');
    mkdirSync(cacheDir, { recursive: true });

    writeFileSync(
      join(cacheDir, 'litellm-model_prices_and_context_window.json'),
      JSON.stringify({
        'gpt-5-chat': {
          input_cost_per_token: 0.000001,
          max_output_tokens: 2048,
          output_cost_per_token: 0.000002,
        },
      }),
      'utf8',
    );
    writeFileSync(
      join(cacheDir, 'litellm-model_prices_and_context_window.meta.json'),
      JSON.stringify({ fetchedAtMs: Date.now() }),
      'utf8',
    );

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === 'https://example.com') {
        return htmlResponse(
          '<!doctype html><html><body><article><p>Hello</p></article></body></html>',
        );
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });

    let stdoutText = '';
    const stdout = new Writable({
      write(chunk, _encoding, callback) {
        stdoutText += chunk.toString();
        callback();
      },
    });

    let stderrText = '';
    const stderr = new Writable({
      write(chunk, _encoding, callback) {
        stderrText += chunk.toString();
        callback();
      },
    });

    await runCli(
      [
        '--json',
        '--metrics',
        'detailed',
        '--model',
        'openai/gpt-5-chat',
        '--timeout',
        '10s',
        'https://example.com',
      ],
      {
        env: { HOME: root, OPENAI_API_KEY: 'test' },
        fetch: fetchMock as unknown as typeof fetch,
        stderr,
        stdout,
      },
    );

    expect(stdoutText).toContain('"summary"');
    expect(stdoutText).toContain('"metrics"');
    expect(stdoutText).not.toContain('estimatedUsd');
    expect(stdoutText).not.toContain('totalEstimatedUsd');
    expect(stderrText).toContain('↑10 ↓1 Δ11');
    expect(stderrText).not.toContain('calls=');
    expect(stderrText).not.toContain('metrics llm provider=');
    expect(stderrText).not.toContain('cost total');
  });
});
