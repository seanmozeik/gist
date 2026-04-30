import { Writable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { runCli } from '../src/run.js';

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

describe('--metrics detailed', () => {
  it('adds YouTube transcript length stats to the finish line (best effort)', async () => {
    mocks.resolveTranscriptForLink.mockResolvedValueOnce({
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
    });

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

    await runCli(['--extract', '--metrics', 'detailed', '--timeout', '2s', youtubeUrl], {
      env: {},
      fetch: fetchMock as unknown as typeof fetch,
      stderr,
      stdout: new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        },
      }),
    });

    expect(stderrText).toMatch(/\btranscript=/);
    expect(stderrText).toMatch(/\btranscript=44s\b/);
    expect(stderrText).toMatch(/\btranscript=.*\bwords\b/);
    expect(stderrText).toMatch(/\b44s YouTube · \d+ words\b/);
    expect(stderrText).toMatch(/\btx=/);
  });

  it('includes Whisper/OpenAI transcription cost in total cost output', async () => {
    mocks.resolveTranscriptForLink.mockResolvedValueOnce({
      diagnostics: {
        attemptedProviders: ['whisper'],
        cacheMode: 'default',
        cacheStatus: 'miss',
        notes: null,
        provider: 'whisper',
        textProvided: true,
      },
      metadata: { durationSeconds: 60, transcriptionProvider: 'openai' },
      source: 'whisper',
      text: 'Hello world\nSecond line',
    });

    const url = 'https://example.com/video';
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const resolved = typeof input === 'string' ? input : input.url;
      if (resolved === url) {
        return new Response(
          '<!doctype html><html><head>' +
            '<title>Video</title>' +
            '<meta property="og:site_name" content="Example" />' +
            '</head><body>ok</body></html>',
          { headers: { 'Content-Type': 'text/html' }, status: 200 },
        );
      }
      throw new Error(`Unexpected fetch call: ${resolved}`);
    });

    let stderrText = '';
    const stderr = new Writable({
      write(chunk, _encoding, callback) {
        stderrText += chunk.toString();
        callback();
      },
    });

    await runCli(
      ['--extract', '--format', 'text', '--metrics', 'detailed', '--timeout', '2s', url],
      {
        env: { OPENAI_API_KEY: 'test' },
        fetch: fetchMock as unknown as typeof fetch,
        stderr,
        stdout: new Writable({
          write(_chunk, _encoding, callback) {
            callback();
          },
        }),
      },
    );

    expect(stderrText).toContain('$0.0060');
    expect(stderrText).toContain('txcost=$0.0060');
  });
});
