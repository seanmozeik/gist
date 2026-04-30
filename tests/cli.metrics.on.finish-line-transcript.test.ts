import { Writable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { runCli } from '../src/run';

const mocks = vi.hoisted(() => ({
  resolveTranscriptForLink: vi.fn(async () => ({
    diagnostics: {
      attemptedProviders: ['youtube'],
      cacheMode: 'default',
      cacheStatus: 'miss',
      notes: null,
      provider: 'youtube',
      textProvided: true,
    },
    metadata: { durationSeconds: 44 },
    source: 'youtube',
    text: 'Hello world\nSecond line',
  })),
}));

vi.mock('../src/content/transcript/index.js', () => ({
  resolveTranscriptForLink: mocks.resolveTranscriptForLink,
}));

describe('--metrics on', () => {
  it('prints transcript length on the finish line (no noisy calls=1)', async () => {
    const youtubeUrl = 'https://www.youtube.com/watch?v=EYSQGkpuzAA&t=69s';
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === youtubeUrl) {
        return new Response(
          '<!doctype html><html><head>' +
            '<title>Video</title>' +
            '<meta property="og:site_name" content="YouTube" />' +
            '</head><body>ok</body></html>',
          { headers: { 'Content-Type': 'text/html' }, status: 200 },
        );
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });

    let stderrText = '';
    const stderr = new Writable({
      write(chunk, _encoding, callback) {
        stderrText += chunk.toString();
        callback();
      },
    });

    await runCli(['--extract', '--metrics', 'on', '--timeout', '2s', youtubeUrl], {
      env: {},
      fetch: fetchMock as unknown as typeof fetch,
      stderr,
      stdout: new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        },
      }),
    });

    expect(stderrText).toMatch(/\b44s YouTube · \d+ words\b/);
    expect(stderrText).toMatch(/\bwords\b/);
    expect(stderrText).not.toContain('calls=');
    expect(stderrText).not.toContain('input=');
  });
});
