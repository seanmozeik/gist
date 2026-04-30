import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { runCli } from '../src/run';

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

const mocks = vi.hoisted(() => {
  const extracted = {
    content: 'Hello from the article body.',
    description: null,
    diagnostics: {
      firecrawl: {
        attempted: false,
        cacheMode: 'bypassed',
        cacheStatus: 'bypassed',
        notes: null,
        used: false,
      },
      markdown: { notes: null, provider: null, requested: false, used: false },
      strategy: 'html',
      transcript: {
        attemptedProviders: [],
        cacheMode: 'bypassed',
        cacheStatus: 'bypassed',
        notes: null,
        provider: null,
        textProvided: false,
      },
    },
    isVideoOnly: false,
    mediaDurationSeconds: null,
    siteName: 'YouTube',
    title: 'Test video',
    totalCharacters: 28,
    transcriptCharacters: null,
    transcriptLines: null,
    transcriptMetadata: null,
    transcriptSegments: null,
    transcriptSource: null,
    transcriptTimedText: null,
    transcriptWordCount: null,
    transcriptionProvider: null,
    truncated: false,
    url: 'https://www.youtube.com/watch?v=abc123def45',
    video: null,
    wordCount: 5,
  };

  return {
    extractSlidesForSource: vi.fn(async () => {
      throw new Error('Missing ffmpeg (install ffmpeg or add it to PATH).');
    }),
    extracted,
    fetchLinkContentWithBirdTip: vi.fn(async () => extracted),
  };
});

vi.mock('../src/run/flows/url/extract.js', async () => {
  const actual = await vi.importActual<typeof import('../src/run/flows/url/extract.js')>(
    '../src/run/flows/url/extract.js',
  );
  return { ...actual, fetchLinkContentWithBirdTip: mocks.fetchLinkContentWithBirdTip };
});

vi.mock('../src/slides/index.js', async () => {
  const actual =
    await vi.importActual<typeof import('../src/slides/index.js')>('../src/slides/index.js');
  return { ...actual, extractSlidesForSource: mocks.extractSlidesForSource };
});

describe('--slides dependency warning', () => {
  it('warns when slide extraction dependencies are missing in summary mode', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gist-slides-warning-'));
    const stdout = collectStream();
    const stderr = collectStream();

    await runCli([mocks.extracted.url, '--plain', '--timeout', '2s', '--slides'], {
      env: { HOME: root },
      fetch: globalThis.fetch.bind(globalThis),
      stderr: stderr.stream,
      stdout: stdout.stream,
    });

    expect(stderr.getText()).toContain(
      '--slides could not extract slide images: Missing ffmpeg (install ffmpeg or add it to PATH).',
    );
    expect(stderr.getText()).toContain(
      'Install ffmpeg + yt-dlp for --slides, and tesseract for --slides-ocr.',
    );
    expect(stdout.getText()).toContain('Hello from the article body.');
  });
});
