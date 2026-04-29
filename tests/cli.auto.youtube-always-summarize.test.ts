import { Writable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { runCli } from '../src/run.js';

const mocks = vi.hoisted(() => ({
  completeSimple: vi.fn(async () => ({
    api: 'openai-responses',
    content: [{ text: 'SUMMARY', type: 'text' }],
    model: 'gpt-5-chat',
    provider: 'openai',
    role: 'assistant',
    stopReason: 'stop',
    timestamp: Date.now(),
    usage: {
      cacheRead: 0,
      cacheWrite: 0,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
      input: 1,
      output: 1,
      totalTokens: 2,
    },
  })),
  resolveTranscriptForLink: vi.fn(async (...args: unknown[]) => {
    return typeof args[0] === 'string' && args[0].includes('youtube.com/watch')
      ? {
          diagnostics: {
            attemptedProviders: ['youtube'],
            cacheMode: 'default',
            cacheStatus: 'miss',
            notes: null,
            provider: 'youtube',
            textProvided: true,
          },
          source: 'youtube',
          text: 'HELLO FROM TEST',
        }
      : {
          diagnostics: {
            attemptedProviders: [],
            cacheMode: 'default',
            cacheStatus: 'miss',
            notes: null,
            provider: null,
            textProvided: false,
          },
          source: null,
          text: null,
        };
  }),
}));

const htmlResponse = (html: string, status = 200) =>
  new Response(html, { headers: { 'Content-Type': 'text/html' }, status });

vi.mock('@mariozechner/pi-ai', () => ({
  completeSimple: mocks.completeSimple,
  getModel: () => {
    throw new Error('no model');
  },
  streamSimple: () => {
    throw new Error('unexpected pi-ai streamSimple call');
  },
}));

vi.mock('../packages/core/src/content/transcript/index.js', () => ({
  resolveTranscriptForLink: mocks.resolveTranscriptForLink,
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

describe('--model auto (YouTube)', () => {
  it('uses an LLM and does not print the transcript', async () => {
    mocks.completeSimple.mockClear();
    mocks.resolveTranscriptForLink.mockClear();

    const youtubeUrl = 'https://www.youtube.com/watch?v=EYSQGkpuzAA&t=69s';
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === youtubeUrl) {
        return htmlResponse(
          '<!doctype html><html><head><title>Video</title></head><body>ok</body></html>',
        );
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });

    const out = collectStdout();
    await runCli(['--model', 'auto', '--timeout', '2s', youtubeUrl], {
      env: { OPENAI_API_KEY: 'test', OPENAI_BASE_URL: 'not a url' },
      fetch: fetchMock as unknown as typeof fetch,
      stderr: silentStderr,
      stdout: out.stdout,
    });

    expect(out.getText()).toMatch(/summary/i);
    expect(out.getText()).not.toContain('Transcript:');
    expect(out.getText()).not.toContain('HELLO FROM TEST');
    expect(mocks.completeSimple).toHaveBeenCalled();
    expect(mocks.resolveTranscriptForLink).toHaveBeenCalled();
  });
});
