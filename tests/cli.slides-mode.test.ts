import { Writable } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { runCli } from '../src/run';

function collectStream({ isTTY }: { isTTY: boolean }) {
  let text = '';
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      text += chunk.toString();
      callback();
    },
  });
  (stream as unknown as { isTTY?: boolean }).isTTY = isTTY;
  (stream as unknown as { columns?: number }).columns = 120;
  return { getText: () => text, stream };
}

const mocks = vi.hoisted(() => {
  const slidesResult = {
    autoTune: { chosenThreshold: 0.3, confidence: 0, enabled: false, strategy: 'none' },
    autoTuneThreshold: true,
    maxSlides: 100,
    minSlideDuration: 2,
    ocrAvailable: false,
    ocrRequested: false,
    sceneThreshold: 0.3,
    slides: [{ imagePath: '/tmp/slides/slide_0001.png', index: 1, timestamp: 12.3 }],
    slidesDir: '/tmp/slides',
    sourceId: 'video-123',
    sourceKind: 'direct',
    sourceUrl: 'https://example.com/video.mp4',
    warnings: [],
  };
  return {
    extractSlidesForSource: vi.fn(async () => slidesResult),
    resolveSlideSourceFromUrl: vi.fn(() => ({
      kind: 'direct',
      sourceId: slidesResult.sourceId,
      url: slidesResult.sourceUrl,
    })),
    slidesResult,
  };
});

const renderMocks = vi.hoisted(() => ({
  renderSlidesInline: vi.fn(async () => ({ protocol: 'kitty', rendered: 1 })),
}));

vi.mock('../src/slides/index.js', async () => {
  const actual =
    await vi.importActual<typeof import('../src/slides/index.js')>('../src/slides/index.js');
  return {
    ...actual,
    extractSlidesForSource: mocks.extractSlidesForSource,
    resolveSlideSourceFromUrl: mocks.resolveSlideSourceFromUrl,
  };
});

vi.mock('../src/run/slides-render.js', async () => {
  const actual = await vi.importActual<typeof import('../src/run/slides-render.js')>(
    '../src/run/slides-render.js',
  );
  return { ...actual, renderSlidesInline: renderMocks.renderSlidesInline };
});

describe('cli slides mode', () => {
  afterEach(() => {
    renderMocks.renderSlidesInline.mockClear();
  });

  it('prints slide paths in text mode', async () => {
    const stdout = collectStream({ isTTY: false });
    const stderr = collectStream({ isTTY: false });
    await runCli(['slides', 'https://example.com/video.mp4'], {
      env: { HOME: '/tmp' },
      fetch: globalThis.fetch.bind(globalThis),
      stderr: stderr.stream,
      stdout: stdout.stream,
    });
    const text = stdout.getText();
    expect(text).toContain('Slides extracted: 1');
    expect(text).toContain('Slides dir: /tmp/slides');
    expect(text).toContain('\t0:12\t/tmp/slides/slide_0001.png');
  });

  it('prints JSON when requested', async () => {
    const stdout = collectStream({ isTTY: false });
    const stderr = collectStream({ isTTY: false });
    await runCli(['slides', 'https://example.com/video.mp4', '--json'], {
      env: { HOME: '/tmp' },
      fetch: globalThis.fetch.bind(globalThis),
      stderr: stderr.stream,
      stdout: stdout.stream,
    });
    const parsed = JSON.parse(stdout.getText());
    expect(parsed.ok).toBe(true);
    expect(parsed.slides?.slides?.length).toBe(1);
  });

  it('fails to render inline when stdout is not a TTY', async () => {
    const stdout = collectStream({ isTTY: false });
    const stderr = collectStream({ isTTY: false });
    await expect(
      runCli(['slides', 'https://example.com/video.mp4', '--render', 'kitty'], {
        env: { HOME: '/tmp' },
        fetch: globalThis.fetch.bind(globalThis),
        stderr: stderr.stream,
        stdout: stdout.stream,
      }),
    ).rejects.toThrow('--render requires a TTY stdout.');
  });

  it('rejects unknown render modes', async () => {
    const stdout = collectStream({ isTTY: false });
    const stderr = collectStream({ isTTY: false });
    await expect(
      runCli(['slides', 'https://example.com/video.mp4', '--render', 'nope'], {
        env: { HOME: '/tmp' },
        fetch: globalThis.fetch.bind(globalThis),
        stderr: stderr.stream,
        stdout: stdout.stream,
      }),
    ).rejects.toThrow("argument 'nope' is invalid");
  });

  it('rejects render with JSON output', async () => {
    const stdout = collectStream({ isTTY: false });
    const stderr = collectStream({ isTTY: false });
    await expect(
      runCli(['slides', 'https://example.com/video.mp4', '--json', '--render', 'auto'], {
        env: { HOME: '/tmp' },
        fetch: globalThis.fetch.bind(globalThis),
        stderr: stderr.stream,
        stdout: stdout.stream,
      }),
    ).rejects.toThrow('--render is not supported with --json output.');
  });

  it('renders inline when stdout is a TTY', async () => {
    const stdout = collectStream({ isTTY: true });
    const stderr = collectStream({ isTTY: true });
    await runCli(['slides', 'https://example.com/video.mp4', '--render', 'auto'], {
      env: { HOME: '/tmp', TERM_PROGRAM: 'iTerm.app' },
      fetch: globalThis.fetch.bind(globalThis),
      stderr: stderr.stream,
      stdout: stdout.stream,
    });

    expect(renderMocks.renderSlidesInline).toHaveBeenCalledTimes(1);
    const call = renderMocks.renderSlidesInline.mock.calls[0]?.[0];
    expect(call?.mode).toBe('auto');
    expect(call?.slides?.length).toBe(1);
    const label = call?.labelForSlide?.({
      imagePath: '/tmp/slides/slide_0002.png',
      index: 2,
      timestamp: 3661,
    });
    expect(label).toContain('01:01:01');
  });
});
