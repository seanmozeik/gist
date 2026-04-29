import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ runProcess: vi.fn(), runProcessCapture: vi.fn() }));

vi.mock('../src/slides/process.js', () => ({
  runProcess: mocks.runProcess,
  runProcessCapture: mocks.runProcessCapture,
  runProcessCaptureBuffer: vi.fn(),
}));

import {
  adjustTimestampWithinSegment,
  applyMaxSlidesFilter,
  applyMinDurationFilter,
  buildIntervalTimestamps,
  buildSceneSegments,
  buildSegments,
  clamp,
  detectSceneTimestamps,
  filterTimestampsByMinDuration,
  findSceneSegment,
  mergeTimestamps,
  parseShowinfoTimestamp,
  probeVideoInfo,
  selectTimestampTargets,
} from '../src/slides/scene-detection.js';

describe('slides scene detection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('covers parsing, clamping, segments, and timestamp filters', () => {
    expect(clamp(-1, 0, 5)).toBe(0);
    expect(clamp(9, 0, 5)).toBe(5);
    expect(parseShowinfoTimestamp('foo')).toBeNull();
    expect(parseShowinfoTimestamp('showinfo pts_time:12.34')).toBe(12.34);

    expect(buildSegments(null, 4)).toEqual([{ duration: 0, start: 0 }]);
    expect(buildSegments(240, 3)).toEqual([
      { duration: 80, start: 0 },
      { duration: 80, start: 80 },
      { duration: 80, start: 160 },
    ]);

    expect(filterTimestampsByMinDuration([5, 1, 1.4, 4], 1.5)).toEqual([1, 4]);
    expect(mergeTimestamps([1, 5], [1.2, 10], 2)).toEqual([1, 5, 10]);

    const removed: string[] = [];
    const warnings: string[] = [];
    expect(
      applyMinDurationFilter(
        [
          { imagePath: 'a.png', index: 1, timestamp: 0 },
          { imagePath: 'b.png', index: 2, timestamp: 1 },
          { imagePath: 'c.png', index: 3, timestamp: 4 },
        ],
        2,
        warnings,
        (file) => removed.push(file),
      ),
    ).toEqual([
      { imagePath: 'a.png', index: 1, timestamp: 0 },
      { imagePath: 'c.png', index: 2, timestamp: 4 },
    ]);
    expect(removed).toEqual(['b.png']);
    expect(warnings).toEqual(['Filtered 1 slides by min duration']);
  });

  it('builds scene segments, finds active segments, and adjusts timestamps safely', () => {
    const segments = buildSceneSegments([4, 4.02, 10], 15);
    expect(segments).toEqual([
      { end: 4, start: 0 },
      { end: 10, start: 4 },
      { end: 15, start: 10 },
    ]);

    expect(findSceneSegment(segments, 9.9)).toEqual({ end: 10, start: 4 });
    expect(findSceneSegment([], 2)).toBeNull();
    expect(adjustTimestampWithinSegment(0.1, { end: 4, start: 0 })).toBeCloseTo(0.32, 2);
    expect(adjustTimestampWithinSegment(30, { end: 11, start: 10 })).toBeCloseTo(10.8, 2);
    expect(adjustTimestampWithinSegment(30, { end: null, start: 10 })).toBe(30);
  });

  it('selects scene targets near interval targets and builds interval fallbacks', () => {
    expect(
      selectTimestampTargets({
        intervalSeconds: 15,
        minDurationSeconds: 5,
        sceneTimestamps: [4.5, 18.5, 39, 39.2],
        targets: [5, 20, 40],
      }),
    ).toEqual([4.5, 18.5, 39]);

    expect(
      selectTimestampTargets({
        intervalSeconds: 6,
        minDurationSeconds: 10,
        sceneTimestamps: [],
        targets: [5, 8],
      }),
    ).toEqual([5, 8]);

    expect(
      buildIntervalTimestamps({ durationSeconds: 600, maxSlides: 3, minDurationSeconds: 12 }),
    ).toEqual({ intervalSeconds: 200, timestamps: [0, 200, 400] });
    expect(
      buildIntervalTimestamps({ durationSeconds: null, maxSlides: 3, minDurationSeconds: 12 }),
    ).toBeNull();
  });

  it('detects scene timestamps across segments and reports progress', async () => {
    mocks.runProcess.mockImplementation(async ({ args, onStderrLine }) => {
      const startIndex = args.indexOf('-ss');
      const offset = startIndex !== -1 ? Number(args[startIndex + 1]) : 0;
      onStderrLine?.(`showinfo pts_time:${1 + offset}`);
    });
    const progress: [number, number][] = [];

    const timestamps = await detectSceneTimestamps({
      ffmpegPath: 'ffmpeg',
      inputPath: '/tmp/video.mp4',
      onSegmentProgress: (completed, total) => progress.push([completed, total]),
      runWithConcurrency: async (tasks, _workers, onProgress) => {
        const results = [];
        let completed = 0;
        for (const task of tasks) {
          results.push(await task());
          completed += 1;
          onProgress?.(completed, tasks.length);
        }
        return results;
      },
      segments: [
        { duration: 10, start: 0 },
        { duration: 5, start: 10 },
      ],
      threshold: 0.25,
      timeoutMs: 1000,
      workers: 4,
    });

    expect(timestamps).toEqual([1, 21]);
    expect(progress).toEqual([
      [1, 2],
      [2, 2],
    ]);
    expect(mocks.runProcess).toHaveBeenCalledTimes(2);
  });

  it('parses ffprobe output and falls back to format duration', async () => {
    mocks.runProcessCapture.mockResolvedValueOnce(
      JSON.stringify({
        streams: [
          { codec_type: 'audio', duration: '1' },
          { codec_type: 'video', duration: '12.5', height: 1080, width: 1920 },
        ],
      }),
    );
    await expect(
      probeVideoInfo({ ffprobePath: 'ffprobe', inputPath: '/tmp/video.mp4', timeoutMs: 99_999 }),
    ).resolves.toEqual({ durationSeconds: 12.5, height: 1080, width: 1920 });

    mocks.runProcessCapture.mockResolvedValueOnce(
      JSON.stringify({
        format: { duration: '90' },
        streams: [{ codec_type: 'video', height: 720, width: 1280 }],
      }),
    );
    await expect(
      probeVideoInfo({ ffprobePath: 'ffprobe', inputPath: '/tmp/video.mp4', timeoutMs: 99_999 }),
    ).resolves.toEqual({ durationSeconds: 90, height: 720, width: 1280 });

    mocks.runProcessCapture.mockRejectedValueOnce(new Error('boom'));
    await expect(
      probeVideoInfo({ ffprobePath: 'ffprobe', inputPath: '/tmp/video.mp4', timeoutMs: 99_999 }),
    ).resolves.toEqual({ durationSeconds: null, height: null, width: null });
  });

  it('trims extra slides when maxSlides is exceeded', () => {
    const warnings: string[] = [];
    const removed: string[] = [];
    expect(
      applyMaxSlidesFilter(
        [
          { imagePath: 'a.png', index: 1, timestamp: 0 },
          { imagePath: 'b.png', index: 2, timestamp: 10 },
          { imagePath: 'c.png', index: 3, timestamp: 20 },
        ],
        2,
        warnings,
        (file) => removed.push(file),
      ),
    ).toEqual([
      { imagePath: 'a.png', index: 1, timestamp: 0 },
      { imagePath: 'b.png', index: 2, timestamp: 10 },
    ]);
    expect(removed).toEqual(['c.png']);
    expect(warnings).toEqual(['Trimmed slides to max 2']);
  });
});
