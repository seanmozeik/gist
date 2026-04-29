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
  makeAssistantMessage({ api: model.api, model: model.id, provider: model.provider, text: '   ' }),
);

vi.mock('@mariozechner/pi-ai', () => ({
  completeSimple: mocks.completeSimple,
  getModel: mocks.getModel,
  streamSimple: mocks.streamSimple,
}));

describe('cli empty summary handling', () => {
  it('throws when model returns only whitespace', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === 'https://example.com') {
        return htmlResponse(
          '<!doctype html><html><body><article><p>Hello</p></article></body></html>',
        );
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });

    const stdout = new Writable({
      write(chunk, _encoding, callback) {
        void chunk;
        callback();
      },
    });
    const stderr = new Writable({
      write(chunk, _encoding, callback) {
        void chunk;
        callback();
      },
    });

    await expect(
      runCli(['--model', 'openai/gpt-5-chat', '--timeout', '10s', 'https://example.com'], {
        env: { OPENAI_API_KEY: 'test' },
        fetch: fetchMock as unknown as typeof fetch,
        stderr,
        stdout,
      }),
    ).rejects.toThrow(/empty summary/i);
  });
});
