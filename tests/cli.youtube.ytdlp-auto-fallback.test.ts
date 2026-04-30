import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { runCli } from '../src/run.js';

vi.mock('../src/content/transcript/providers/youtube/yt-dlp.js', () => ({
  fetchDurationSecondsWithYtDlp: vi.fn(async () => null),
  fetchTranscriptWithYtDlp: vi.fn(async () => {
    return { error: null, notes: [], provider: 'cpp', text: 'hello from ytdlp' };
  }),
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

describe('cli YouTube auto transcript yt-dlp fallback', () => {
  it('falls back to yt-dlp when captions are unavailable', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gist-ytdlp-fallback-'));
    const binDir = join(root, 'bin');
    mkdirSync(binDir, { recursive: true });

    const fakeYtDlp = join(binDir, 'yt-dlp');
    writeFileSync(fakeYtDlp, '#!/bin/sh\nexit 0\n', 'utf8');
    chmodSync(fakeYtDlp, 0o755);

    const url = 'https://www.youtube.com/watch?v=oYU2hAbx_Fc';
    const html =
      '<!doctype html><html><head><title>Ok</title></head><body>' +
      '<script>var ytInitialPlayerResponse = {"videoDetails":{"shortDescription":"I do."},"playabilityStatus":{"status":"OK"}};</script>' +
      '</body></html>';

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const requestUrl = typeof input === 'string' ? input : input.url;
      if (requestUrl === url) {
        return new Response(html, { headers: { 'Content-Type': 'text/html' }, status: 200 });
      }
      throw new Error(`Unexpected fetch call: ${requestUrl}`);
    });

    const stdout = collectStream();
    const stderr = collectStream();

    await runCli(['--extract', '--json', '--timeout', '2s', url], {
      env: { HOME: root, OPENAI_API_KEY: 'test', PATH: binDir },
      fetch: fetchMock as unknown as typeof fetch,
      stderr: stderr.stream,
      stdout: stdout.stream,
    });

    const payload = JSON.parse(stdout.getText()) as {
      extracted: {
        transcriptSource: string | null;
        diagnostics: { transcript: { attemptedProviders: string[]; provider: string | null } };
        content: string;
      };
    };

    expect(payload.extracted.transcriptSource).toBe('yt-dlp');
    expect(payload.extracted.diagnostics.transcript.provider).toBe('yt-dlp');
    expect(payload.extracted.diagnostics.transcript.attemptedProviders).toContain('yt-dlp');
    expect(payload.extracted.content).toContain('hello from ytdlp');
  });
});
