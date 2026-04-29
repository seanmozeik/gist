import { describe, expect, it } from 'vitest';

import type { ExtractedLinkContent } from '../packages/core/src/content/link-preview/content/types.js';
import {
  createSlidesSummaryStreamHandler,
  createSlidesTerminalOutput,
} from '../src/run/flows/url/slides-output.js';

const makeStdout = (isTTY: boolean) => {
  const chunks: string[] = [];
  const stream = {
    isTTY,
    write: (chunk: string) => {
      chunks.push(String(chunk));
      return true;
    },
  } as unknown as NodeJS.WritableStream;
  return { chunks, stream };
};

describe('slides summary stream handler', () => {
  it('renders markdown in rich TTY and inserts slides inline', async () => {
    const { stream, chunks } = makeStdout(true);
    const renderedSlides: number[] = [];
    const handler = createSlidesSummaryStreamHandler({
      clearProgressForStdout: () => {},
      env: { TERM: 'xterm' },
      envForRun: { TERM: 'xterm' },
      getSlideIndexOrder: () => [1],
      outputMode: 'line',
      plain: false,
      renderSlide: async (index) => {
        renderedSlides.push(index);
        stream.write(`[SLIDE ${index}]\n`);
      },
      stdout: stream,
    });

    const payload = 'Hello world\n\n[slide:1]\nAfter slide';
    await handler.onChunk({ appended: payload, prevStreamed: '', streamed: payload });
    await handler.onDone?.(payload);

    const output = chunks.join('');
    expect(output).toContain('Hello');
    expect(output).toContain('[SLIDE 1]');
    expect(output).toContain('After slide');
    expect(output).not.toContain('[slide:1]');
    expect(renderedSlides).toEqual([1]);
  });

  it('streams visible text through the output gate', async () => {
    const { stream, chunks } = makeStdout(false);
    const renderedSlides: number[] = [];
    const handler = createSlidesSummaryStreamHandler({
      clearProgressForStdout: () => {},
      env: {},
      envForRun: {},
      getSlideIndexOrder: () => [1],
      outputMode: 'line',
      plain: true,
      renderSlide: async (index) => {
        renderedSlides.push(index);
        stream.write(`[SLIDE ${index}]\n`);
      },
      stdout: stream,
    });

    const payload = 'Intro line\n\n[slide:1]\nAfter';
    await handler.onChunk({ appended: payload, prevStreamed: '', streamed: payload });
    await handler.onDone?.(payload);

    const output = chunks.join('');
    expect(output).toContain('Intro line');
    expect(output).toContain('[SLIDE 1]');
    expect(output).toContain('After');
    expect(output).not.toContain('[slide:1]');
    expect(renderedSlides).toEqual([1]);
  });

  it('detects headline-style first lines as slide titles', async () => {
    const { stream, chunks } = makeStdout(false);
    const titles: (string | null)[] = [];
    const handler = createSlidesSummaryStreamHandler({
      clearProgressForStdout: () => {},
      env: {},
      envForRun: {},
      getSlideIndexOrder: () => [1],
      getSlideMeta: () => ({ timestamp: 4, total: 1 }),
      outputMode: 'line',
      plain: true,
      renderSlide: async (_index, title) => {
        titles.push(title ?? null);
      },
      stdout: stream,
    });

    const payload =
      'Intro line\n\n[slide:1]\nGraphene breakthroughs\nGraphene is strong and conductive.';
    await handler.onChunk({ appended: payload, prevStreamed: '', streamed: payload });
    await handler.onDone?.(payload);

    const output = chunks.join('');
    expect(output).toContain('Graphene is strong and conductive.');
    expect(titles[0]).toContain('Graphene breakthroughs');
  });

  it('treats bare slide:N] tokens as slide markers instead of visible text', async () => {
    const { stream, chunks } = makeStdout(false);
    const renderedSlides: number[] = [];
    const handler = createSlidesSummaryStreamHandler({
      clearProgressForStdout: () => {},
      env: {},
      envForRun: {},
      getSlideIndexOrder: () => [2],
      outputMode: 'line',
      plain: true,
      renderSlide: async (index) => {
        renderedSlides.push(index);
        stream.write(`[SLIDE ${index}]\n`);
      },
      stdout: stream,
    });

    const payload = 'Intro line\n\nslide:2]\nAfter';
    await handler.onChunk({ appended: payload, prevStreamed: '', streamed: payload });
    await handler.onDone?.(payload);

    const output = chunks.join('');
    expect(output).toContain('Intro line');
    expect(output).toContain('[SLIDE 2]');
    expect(output).toContain('After');
    expect(output).not.toContain('slide:2]');
    expect(renderedSlides).toEqual([2]);
  });

  it('handles delta output mode and appends a newline on finalize', async () => {
    const { stream, chunks } = makeStdout(false);
    const handler = createSlidesSummaryStreamHandler({
      clearProgressForStdout: () => {},
      env: {},
      envForRun: {},
      getSlideIndexOrder: () => [],
      outputMode: 'delta',
      plain: true,
      renderSlide: async () => {},
      stdout: stream,
    });

    await handler.onChunk({ appended: 'First', prevStreamed: '', streamed: 'First' });
    await handler.onChunk({ appended: 'Reset', prevStreamed: 'First', streamed: 'Reset' });
    await handler.onDone?.('Reset');

    const output = chunks.join('');
    expect(output).toContain('First');
    expect(output).toContain('Reset');
    expect(output.endsWith('\n')).toBe(true);
  });

  it('returns null when slides output is disabled', () => {
    const { stream } = makeStdout(false);
    const extracted: ExtractedLinkContent = {
      content: '',
      description: null,
      diagnostics: {},
      isVideoOnly: false,
      mediaDurationSeconds: null,
      siteName: null,
      title: null,
      totalCharacters: 0,
      transcriptCharacters: null,
      transcriptLines: null,
      transcriptMetadata: null,
      transcriptSegments: null,
      transcriptSource: null,
      transcriptTimedText: null,
      transcriptWordCount: null,
      transcriptionProvider: null,
      truncated: false,
      url: 'https://example.com',
      video: null,
      wordCount: 0,
    };

    const output = createSlidesTerminalOutput({
      clearProgressForStdout: () => {},
      enabled: false,
      extracted,
      flags: { lengthArg: { kind: 'preset', preset: 'short' }, plain: true },
      io: { env: {}, envForRun: {}, stderr: stream, stdout: stream },
      slides: null,
    });

    expect(output).toBeNull();
  });

  it('renders slides inline from markers', async () => {
    const { stream, chunks } = makeStdout(false);
    const extracted: ExtractedLinkContent = {
      content: '',
      description: null,
      diagnostics: {},
      isVideoOnly: false,
      mediaDurationSeconds: null,
      siteName: null,
      title: null,
      totalCharacters: 0,
      transcriptCharacters: null,
      transcriptLines: null,
      transcriptMetadata: null,
      transcriptSegments: null,
      transcriptSource: null,
      transcriptTimedText: null,
      transcriptWordCount: null,
      transcriptionProvider: null,
      truncated: false,
      url: 'https://example.com',
      video: null,
      wordCount: 0,
    };

    const slides = {
      autoTune: { chosenThreshold: 0, confidence: 0, enabled: false, strategy: 'none' },
      autoTuneThreshold: false,
      maxSlides: 10,
      minSlideDuration: 5,
      ocrAvailable: false,
      ocrRequested: false,
      sceneThreshold: 0.3,
      slides: [
        { imagePath: '/tmp/1.png', index: 1, timestamp: 10 },
        { imagePath: '/tmp/2.png', index: 2, timestamp: 20 },
      ],
      slidesDir: '/tmp/slides',
      slidesDirId: null,
      sourceId: 'abc',
      sourceKind: 'youtube',
      sourceUrl: 'https://example.com',
      warnings: [],
    };

    const output = createSlidesTerminalOutput({
      clearProgressForStdout: () => {},
      enabled: true,
      extracted,
      flags: { lengthArg: { kind: 'preset', preset: 'short' }, plain: true },
      io: { env: {}, envForRun: {}, stderr: stream, stdout: stream },
      slides,
    });

    expect(output).not.toBeNull();
    await output?.renderFromText(['Intro', '[slide:1]', 'After'].join('\n'));

    const outputText = chunks.join('');
    expect(outputText).toContain('Slide 1');
    expect(outputText).toContain('Intro');
    expect(outputText).toContain('After');
    expect(outputText).not.toContain('[slide:1]');
  });
});
