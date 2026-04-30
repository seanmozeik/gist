import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';

import type { Api } from '@mariozechner/pi-ai';
import { describe, expect, it, vi } from 'vitest';

import { runCli } from '../src/run';
import { makeAssistantMessage } from './helpers/pi-ai-mock';

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

function captureStream() {
  let text = '';
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      text += chunk.toString();
      callback();
    },
  });
  return { getText: () => text, stream };
}

function resolveFetchUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

describe('cli config precedence', () => {
  it('uses config file model when --model and GIST_MODEL are absent', async () => {
    mocks.completeSimple.mockClear();

    const html =
      '<!doctype html><html><head><title>Hello</title></head>' +
      '<body><article><p>Hi</p></article></body></html>';

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = resolveFetchUrl(input);
      if (url === 'https://example.com') {
        return htmlResponse(html);
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });

    const tempRoot = mkdtempSync(join(tmpdir(), 'gist-cli-config-'));
    const configPath = join(tempRoot, '.gist', 'config.json');
    mkdirSync(join(tempRoot, '.gist'), { recursive: true });
    writeFileSync(configPath, JSON.stringify({ model: { id: 'openai/gpt-5-chat' } }), 'utf8');

    await runCli(['--timeout', '2s', 'https://example.com'], {
      env: { HOME: tempRoot, OPENAI_API_KEY: 'test' },
      fetch: fetchMock as unknown as typeof fetch,
      stderr: noopStream(),
      stdout: noopStream(),
    });

    expect(mocks.completeSimple).toHaveBeenCalledTimes(1);
  });

  it('uses config file model preset when --model and GIST_MODEL are absent', async () => {
    mocks.completeSimple.mockClear();

    const html =
      '<!doctype html><html><head><title>Hello</title></head>' +
      '<body><article><p>Hi</p></article></body></html>';

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = resolveFetchUrl(input);
      if (url === 'https://example.com') {
        return htmlResponse(html);
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });

    const tempRoot = mkdtempSync(join(tmpdir(), 'gist-cli-config-'));
    const configPath = join(tempRoot, '.gist', 'config.json');
    mkdirSync(join(tempRoot, '.gist'), { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify({
        model: 'mypreset',
        models: { mypreset: { mode: 'auto', rules: [{ candidates: ['openai/gpt-5-chat'] }] } },
      }),
      'utf8',
    );

    const stdout = captureStream();

    await runCli(
      ['--timeout', '2s', '--extract', '--format', 'text', '--json', 'https://example.com'],
      {
        env: { HOME: tempRoot },
        fetch: fetchMock as unknown as typeof fetch,
        stderr: noopStream(),
        stdout: stdout.stream,
      },
    );

    const parsed = JSON.parse(stdout.getText()) as { input: { model: string } };
    expect(parsed.input.model).toBe('mypreset');

    // --extract means no LLM calls; ensure we didn't try to init a provider.
    expect(mocks.completeSimple).toHaveBeenCalledTimes(0);
  });

  it('prefers GIST_MODEL over config file', async () => {
    mocks.completeSimple.mockClear();

    const html =
      '<!doctype html><html><head><title>Hello</title></head>' +
      '<body><article><p>Hi</p></article></body></html>';

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = resolveFetchUrl(input);
      if (url === 'https://example.com') {
        return htmlResponse(html);
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });

    const tempRoot = mkdtempSync(join(tmpdir(), 'gist-cli-config-'));
    const configPath = join(tempRoot, '.gist', 'config.json');
    mkdirSync(join(tempRoot, '.gist'), { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify({ model: { id: 'xai/grok-4-fast-non-reasoning' } }),
      'utf8',
    );

    const stdout = captureStream();

    await runCli(
      ['--timeout', '2s', '--extract', '--format', 'text', '--json', 'https://example.com'],
      {
        env: { GIST_MODEL: 'openai/gpt-5-chat', HOME: tempRoot },
        fetch: fetchMock as unknown as typeof fetch,
        stderr: noopStream(),
        stdout: stdout.stream,
      },
    );

    const parsed = JSON.parse(stdout.getText()) as { input: { model: string } };
    expect(parsed.input.model).toBe('openai/gpt-5-chat');

    // --extract means no LLM calls; ensure we didn't try to init a provider.
    expect(mocks.completeSimple).toHaveBeenCalledTimes(0);
  });

  it('uses config file output.length when --length is absent', async () => {
    mocks.completeSimple.mockClear();

    const html =
      '<!doctype html><html><head><title>Hello</title></head>' +
      '<body><article><p>Hi</p></article></body></html>';

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = resolveFetchUrl(input);
      if (url === 'https://example.com') {
        return htmlResponse(html);
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });

    const tempRoot = mkdtempSync(join(tmpdir(), 'gist-cli-config-'));
    const configPath = join(tempRoot, '.gist', 'config.json');
    mkdirSync(join(tempRoot, '.gist'), { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify({ model: { id: 'openai/gpt-5-chat' }, output: { length: 'short' } }),
      'utf8',
    );

    const stdout = captureStream();

    await runCli(['--timeout', '2s', '--json', 'https://example.com'], {
      env: { HOME: tempRoot, OPENAI_API_KEY: 'test' },
      fetch: fetchMock as unknown as typeof fetch,
      stderr: noopStream(),
      stdout: stdout.stream,
    });

    const parsed = JSON.parse(stdout.getText()) as { input: { length: { preset: string } } };
    expect(parsed.input.length).toEqual({ kind: 'preset', preset: 'short' });
  });

  it('prefers --length over config file output.length', async () => {
    mocks.completeSimple.mockClear();

    const html =
      '<!doctype html><html><head><title>Hello</title></head>' +
      '<body><article><p>Hi</p></article></body></html>';

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = resolveFetchUrl(input);
      if (url === 'https://example.com') {
        return htmlResponse(html);
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });

    const tempRoot = mkdtempSync(join(tmpdir(), 'gist-cli-config-'));
    const configPath = join(tempRoot, '.gist', 'config.json');
    mkdirSync(join(tempRoot, '.gist'), { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify({ model: { id: 'openai/gpt-5-chat' }, output: { length: 'short' } }),
      'utf8',
    );

    const stdout = captureStream();

    await runCli(['--timeout', '2s', '--length', '20k', '--json', 'https://example.com'], {
      env: { HOME: tempRoot, OPENAI_API_KEY: 'test' },
      fetch: fetchMock as unknown as typeof fetch,
      stderr: noopStream(),
      stdout: stdout.stream,
    });

    const parsed = JSON.parse(stdout.getText()) as {
      input: { length: { kind: string; maxCharacters: number } };
    };
    expect(parsed.input.length).toEqual({ kind: 'chars', maxCharacters: 20_000 });
  });
});
