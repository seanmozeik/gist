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

function noopStream(): Writable {
  return new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
}

function collectStdout() {
  let text = '';
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      text += chunk.toString();
      callback();
    },
  });
  return { getText: () => text, stream };
}

describe('cli config env', () => {
  it('uses API keys from config env when process env is missing', async () => {
    mocks.completeSimple.mockClear();

    const root = mkdtempSync(join(tmpdir(), 'summarize-cli-config-env-'));
    mkdirSync(join(root, '.summarize'), { recursive: true });
    writeFileSync(
      join(root, '.summarize', 'config.json'),
      JSON.stringify({
        env: { OPENAI_API_KEY: 'test-config-key' },
        model: { id: 'openai/gpt-5-chat' },
      }),
      'utf8',
    );

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
    const stdout = collectStdout();

    await runCli(['--timeout', '2s', 'https://example.com'], {
      env: { HOME: root },
      fetch: fetchMock as unknown as typeof fetch,
      stderr: noopStream(),
      stdout: stdout.stream,
    });

    expect(stdout.getText().trim()).toBe('OK');
    expect(mocks.completeSimple).toHaveBeenCalledTimes(1);
  });

  it('uses API keys from config env for auto model selection', async () => {
    mocks.completeSimple.mockClear();

    const root = mkdtempSync(join(tmpdir(), 'summarize-cli-config-env-auto-'));
    mkdirSync(join(root, '.summarize'), { recursive: true });
    writeFileSync(
      join(root, '.summarize', 'config.json'),
      JSON.stringify({
        env: { OPENAI_API_KEY: 'test-config-key' },
        model: { mode: 'auto', rules: [{ candidates: ['openai/gpt-5-chat'] }] },
      }),
      'utf8',
    );

    const html =
      '<!doctype html><html><head><title>Hello</title></head>' +
      `<body><article><p>${'Hello world. '.repeat(800)}</p></article></body></html>`;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === 'https://example.com') {
        return htmlResponse(html);
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });
    const stdout = collectStdout();

    await runCli(['--force-summary', '--timeout', '2s', 'https://example.com'], {
      env: { HOME: root },
      fetch: fetchMock as unknown as typeof fetch,
      stderr: noopStream(),
      stdout: stdout.stream,
    });

    expect(stdout.getText().trim()).toBe('OK');
    expect(mocks.completeSimple).toHaveBeenCalledTimes(1);
  });
});
