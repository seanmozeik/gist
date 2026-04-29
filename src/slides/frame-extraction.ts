import { promises as fs } from 'node:fs';
import path from 'node:path';

import { resolveExecutableInPath } from '../run/env.js';
import { runProcess, runWithConcurrency } from './process.js';
import {
  buildSegments,
  calibrateSceneThreshold,
  clamp,
  detectSceneTimestamps,
  parseShowinfoTimestamp,
  probeVideoInfo,
  resolveExtractedTimestamp,
  roundThreshold,
} from './scene-detection.js';
import type { SlideAutoTune, SlideImage } from './types.js';

export async function detectSlideTimestamps({
  ffmpegPath,
  ffprobePath,
  inputPath,
  sceneThreshold,
  autoTuneThreshold,
  env,
  timeoutMs,
  warnings,
  workers,
  sampleCount,
  onSegmentProgress,
  logSlides,
  logSlidesTiming,
}: {
  ffmpegPath: string;
  ffprobePath: string | null;
  inputPath: string;
  sceneThreshold: number;
  autoTuneThreshold: boolean;
  env: Record<string, string | undefined>;
  timeoutMs: number;
  warnings: string[];
  workers: number;
  sampleCount: number;
  onSegmentProgress?: ((completed: number, total: number) => void) | null;
  logSlides?: ((message: string) => void) | null;
  logSlidesTiming?: ((label: string, startedAt: number) => number) | null;
}): Promise<{ timestamps: number[]; autoTune: SlideAutoTune; durationSeconds: number | null }> {
  const probeStartedAt = Date.now();
  const resolvedFfprobePath = ffprobePath ?? resolveExecutableInPath('ffprobe', env);
  const videoInfo = resolvedFfprobePath
    ? await probeVideoInfo({ ffprobePath: resolvedFfprobePath, inputPath, timeoutMs })
    : { durationSeconds: null, height: null, width: null };
  logSlidesTiming?.('ffprobe video info', probeStartedAt);

  const calibration = await calibrateSceneThreshold({
    durationSeconds: videoInfo.durationSeconds,
    ffmpegPath,
    inputPath,
    logSlides,
    sampleCount,
    timeoutMs,
  });

  const baseThreshold = sceneThreshold;
  const calibratedThreshold = calibration.threshold;
  const chosenThreshold = autoTuneThreshold ? calibratedThreshold : baseThreshold;
  if (autoTuneThreshold && chosenThreshold !== baseThreshold) {
    warnings.push(`Auto-tuned scene threshold from ${baseThreshold} to ${chosenThreshold}`);
  }

  const segments = buildSegments(videoInfo.durationSeconds, workers);
  const detectStartedAt = Date.now();
  let effectiveThreshold = chosenThreshold;
  let timestamps = await detectSceneTimestamps({
    ffmpegPath,
    inputPath,
    onSegmentProgress,
    runWithConcurrency,
    segments,
    threshold: effectiveThreshold,
    timeoutMs,
    workers,
  });
  logSlidesTiming?.(
    `scene detection base (threshold=${effectiveThreshold}, segments=${segments.length})`,
    detectStartedAt,
  );

  if (timestamps.length === 0) {
    const fallbackThreshold = Math.max(0.05, roundThreshold(effectiveThreshold * 0.5));
    if (fallbackThreshold !== effectiveThreshold) {
      const retryStartedAt = Date.now();
      timestamps = await detectSceneTimestamps({
        ffmpegPath,
        inputPath,
        onSegmentProgress,
        runWithConcurrency,
        segments,
        threshold: fallbackThreshold,
        timeoutMs,
        workers,
      });
      logSlidesTiming?.(
        `scene detection retry (threshold=${fallbackThreshold}, segments=${segments.length})`,
        retryStartedAt,
      );
      warnings.push(
        `Scene detection retry used lower threshold ${fallbackThreshold} after zero detections`,
      );
      if (timestamps.length > 0) {
        effectiveThreshold = fallbackThreshold;
      }
    }
  }

  const autoTune: SlideAutoTune = autoTuneThreshold
    ? {
        chosenThreshold: timestamps.length > 0 ? effectiveThreshold : baseThreshold,
        confidence: calibration.confidence,
        enabled: true,
        strategy: 'hash',
      }
    : { chosenThreshold: baseThreshold, confidence: 0, enabled: false, strategy: 'none' };

  return { autoTune, durationSeconds: videoInfo.durationSeconds, timestamps };
}

export async function extractFramesAtTimestamps({
  ffmpegPath,
  inputPath,
  outputDir,
  timestamps,
  segments,
  durationSeconds,
  timeoutMs,
  workers,
  onProgress,
  onStatus,
  onSlide,
  logSlides,
  logSlidesTiming,
}: {
  ffmpegPath: string;
  inputPath: string;
  outputDir: string;
  timestamps: number[];
  segments?: ({ start: number; end: number | null } | null)[];
  durationSeconds?: number | null;
  timeoutMs: number;
  workers: number;
  onProgress?: ((completed: number, total: number) => void) | null;
  onStatus?: ((text: string) => void) | null;
  onSlide?: ((slide: SlideImage) => void) | null;
  logSlides?: ((message: string) => void) | null;
  logSlidesTiming?: ((label: string, startedAt: number) => number) | null;
}): Promise<SlideImage[]> {
  interface FrameStats { ymin: number | null; ymax: number | null; yavg: number | null }
  interface FrameQuality { brightness: number; contrast: number }

  const FRAME_ADJUST_RANGE_SECONDS = 10;
  const FRAME_ADJUST_STEP_SECONDS = 2;
  const FRAME_MIN_BRIGHTNESS = 0.24;
  const FRAME_MIN_CONTRAST = 0.16;
  const SEEK_PAD_SECONDS = 8;

  const clampTimestamp = (value: number) => {
    const upper =
      typeof durationSeconds === 'number' && Number.isFinite(durationSeconds) && durationSeconds > 0
        ? Math.max(0, durationSeconds - 0.1)
        : Number.POSITIVE_INFINITY;
    return clamp(value, 0, upper);
  };

  const resolveSegmentBounds = (segment: { start: number; end: number | null } | null) => {
    if (!segment) {return null;}
    const start = Math.max(0, segment.start);
    const end =
      typeof segment.end === 'number' && Number.isFinite(segment.end) ? segment.end : null;
    if (end != null && end <= start) {return null;}
    return { end, start };
  };

  const resolveSegmentPadding = (segment: { start: number; end: number | null } | null) => {
    if (segment?.end == null) {return 0;}
    const duration = Math.max(0, segment.end - segment.start);
    if (duration <= 0) {return 0;}
    return Math.min(1.5, Math.max(0.2, duration * 0.08));
  };

  const parseSignalstats = (line: string, stats: FrameStats): void => {
    if (!line.includes('lavfi.signalstats.')) {return;}
    const match = /lavfi\.signalstats\.(YMIN|YMAX|YAVG)=(\d+(?:\.\d+)?)/.exec(line);
    if (!match) {return;}
    const value = Number(match[2]);
    if (!Number.isFinite(value)) {return;}
    if (match[1] === 'YMIN') {stats.ymin = value;}
    if (match[1] === 'YMAX') {stats.ymax = value;}
    if (match[1] === 'YAVG') {stats.yavg = value;}
  };

  const toQuality = (stats: FrameStats): FrameQuality | null => {
    if (stats.ymin == null || stats.ymax == null || stats.yavg == null) {return null;}
    const brightness = clamp(stats.yavg / 255, 0, 1);
    const contrast = clamp((stats.ymax - stats.ymin) / 255, 0, 1);
    return { brightness, contrast };
  };

  const scoreQuality = (quality: FrameQuality, deltaSeconds: number) => {
    const penalty = Math.min(1, Math.abs(deltaSeconds) / FRAME_ADJUST_RANGE_SECONDS) * 0.05;
    return quality.brightness * 0.55 + quality.contrast * 0.45 - penalty;
  };

  const extractFrame = async (
    timestamp: number,
    outputPath: string,
    opts?: { timeoutMs?: number },
  ): Promise<{
    slide: SlideImage;
    quality: FrameQuality | null;
    actualTimestamp: number | null;
    seekBase: number;
  }> => {
    const stats: FrameStats = { yavg: null, ymax: null, ymin: null };
    let actualTimestamp: number | null = null;
    const effectiveTimeoutMs =
      typeof opts?.timeoutMs === 'number' && Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0
        ? opts.timeoutMs
        : timeoutMs;
    const seekBase = Math.max(0, timestamp - SEEK_PAD_SECONDS);
    const seekOffset = Math.max(0, timestamp - seekBase);
    const args = [
      '-hide_banner',
      ...(seekBase > 0 ? ['-ss', String(seekBase)] : []),
      '-i',
      inputPath,
      ...(seekOffset > 0 ? ['-ss', String(seekOffset)] : []),
      '-vf',
      'signalstats,showinfo,metadata=print',
      '-vframes',
      '1',
      '-q:v',
      '2',
      '-an',
      '-sn',
      '-update',
      '1',
      outputPath,
    ];
    await runProcess({
      args,
      command: ffmpegPath,
      errorLabel: 'ffmpeg',
      onStderrLine: (line) => {
        if (actualTimestamp == null) {
          const parsed = parseShowinfoTimestamp(line);
          if (parsed != null) actualTimestamp = parsed;
        }
        parseSignalstats(line, stats);
      },
      timeoutMs: effectiveTimeoutMs,
    });
    const stat = await fs.stat(outputPath).catch(() => null);
    if (!stat?.isFile() || stat.size === 0) {
      throw new Error(`ffmpeg produced no output frame at ${outputPath}`);
    }
    const quality = toQuality(stats);
    return {
      actualTimestamp,
      quality,
      seekBase,
      slide: { imagePath: outputPath, index: 0, timestamp },
    };
  };

  const slides: SlideImage[] = [];
  const startedAt = Date.now();
  const tasks = timestamps.map((timestamp, index) => async () => {
    const segment = segments?.[index] ?? null;
    const bounds = resolveSegmentBounds(segment);
    const padding = resolveSegmentPadding(segment);
    const clampedTimestamp = clampTimestamp(timestamp);
    const safeTimestamp =
      bounds?.end != null
        ? (bounds.end - padding <= bounds.start + padding
          ? clampTimestamp(bounds.start + (bounds.end - bounds.start) * 0.5)
          : clamp(clampedTimestamp, bounds.start + padding, bounds.end - padding))
        : (bounds
          ? Math.max(bounds.start + padding, clampedTimestamp)
          : clampedTimestamp);
    const outputPath = path.join(outputDir, `slide_${String(index + 1).padStart(4, '0')}.png`);
    const extracted = await extractFrame(safeTimestamp, outputPath);
    const resolvedTimestamp = resolveExtractedTimestamp({
      actual: extracted.actualTimestamp,
      requested: safeTimestamp,
      seekBase: extracted.seekBase,
    });
    const delta = resolvedTimestamp - safeTimestamp;
    if (Math.abs(delta) >= 0.25) {
      const actualLabel =
        extracted.actualTimestamp != null && Number.isFinite(extracted.actualTimestamp)
          ? extracted.actualTimestamp.toFixed(2)
          : 'n/a';
      logSlides?.(
        `frame pts slide=${index + 1} req=${safeTimestamp.toFixed(2)}s actual=${actualLabel}s base=${extracted.seekBase.toFixed(2)}s -> ${resolvedTimestamp.toFixed(2)}s delta=${delta.toFixed(2)}s`,
      );
    }
    const imageVersion = Date.now();
    onSlide?.({
      imagePath: outputPath,
      imageVersion,
      index: index + 1,
      timestamp: resolvedTimestamp,
    });
    return {
      imagePath: outputPath,
      imageVersion,
      index: index + 1,
      quality: extracted.quality,
      requestedTimestamp: safeTimestamp,
      segment: bounds,
      timestamp: resolvedTimestamp,
    };
  });
  const results = await runWithConcurrency(tasks, workers, onProgress ?? undefined);
  const ordered = results.filter(Boolean).toSorted((a, b) => a.index - b.index);

  const fixTasks: (() => Promise<void>)[] = [];
  for (const frame of ordered) {
    slides.push({
      imagePath: frame.imagePath,
      imageVersion: frame.imageVersion,
      index: frame.index,
      timestamp: frame.timestamp,
    });
    const {quality} = frame;
    if (!quality) {continue;}
    const shouldPreferBrighterFirstSlide = frame.index === 1 && frame.timestamp < 8;
    const needsAdjust =
      quality.brightness < FRAME_MIN_BRIGHTNESS ||
      quality.contrast < FRAME_MIN_CONTRAST ||
      (shouldPreferBrighterFirstSlide && (quality.brightness < 0.58 || quality.contrast < 0.2));
    if (!needsAdjust) {continue;}
    fixTasks.push(async () => {
      const bounds = resolveSegmentBounds(frame.segment ?? null);
      const padding = resolveSegmentPadding(frame.segment ?? null);
      const minTs = bounds
        ? clampTimestamp(bounds.start + padding)
        : clampTimestamp(frame.timestamp - FRAME_ADJUST_RANGE_SECONDS);
      const maxTs =
        bounds?.end != null
          ? clampTimestamp(bounds.end - padding)
          : clampTimestamp(frame.timestamp + FRAME_ADJUST_RANGE_SECONDS);
      if (maxTs <= minTs) {return;}
      const baseTimestamp = clamp(frame.timestamp, minTs, maxTs);
      const maxRange = Math.min(FRAME_ADJUST_RANGE_SECONDS, maxTs - minTs);
      if (!Number.isFinite(maxRange) || maxRange < FRAME_ADJUST_STEP_SECONDS) {return;}
      const candidateOffsets: number[] = [];
      for (
        let offset = FRAME_ADJUST_STEP_SECONDS;
        offset <= maxRange;
        offset += FRAME_ADJUST_STEP_SECONDS
      ) {
        candidateOffsets.push(offset, -offset);
      }
      let best = {
        offsetSeconds: 0,
        quality,
        score: scoreQuality(quality, 0),
        timestamp: baseTimestamp,
      };
      let selectedTimestamp = baseTimestamp;
      let didReplace = false;
      const minImproveDelta = shouldPreferBrighterFirstSlide ? 0.015 : 0.03;
      for (const offsetSeconds of candidateOffsets) {
        if (offsetSeconds === 0) {continue;}
        const candidateTimestamp = clamp(baseTimestamp + offsetSeconds, minTs, maxTs);
        if (Math.abs(candidateTimestamp - baseTimestamp) < 0.01) {continue;}
        const tempPath = path.join(
          outputDir,
          `slide_${String(frame.index).padStart(4, '0')}_alt.png`,
        );
        try {
          const candidate = await extractFrame(candidateTimestamp, tempPath, {
            timeoutMs: Math.min(timeoutMs, 12_000),
          });
          if (!candidate.quality) {continue;}
          const resolvedCandidateTimestamp = resolveExtractedTimestamp({
            actual: candidate.actualTimestamp,
            requested: candidateTimestamp,
            seekBase: candidate.seekBase,
          });
          const score = scoreQuality(candidate.quality, offsetSeconds);
          if (score > best.score + minImproveDelta) {
            best = {
              offsetSeconds,
              quality: candidate.quality,
              score,
              timestamp: resolvedCandidateTimestamp,
            };
            try {
              await fs.rename(tempPath, frame.imagePath);
            } catch (error) {
              const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
              if (code === 'EEXIST') {
                await fs.rm(frame.imagePath, { force: true }).catch(() => null);
                await fs.rename(tempPath, frame.imagePath);
              } else {
                throw error;
              }
            }
            didReplace = true;
            selectedTimestamp = resolvedCandidateTimestamp;
          } else {
            await fs.rm(tempPath, { force: true }).catch(() => null);
          }
        } catch {
          await fs.rm(tempPath, { force: true }).catch(() => null);
        }
      }
      if (!didReplace) {return;}
      const updatedVersion = Date.now();
      const slide = slides[frame.index - 1];
      if (slide) {
        slide.imageVersion = updatedVersion;
        slide.timestamp = selectedTimestamp;
      }
      if (selectedTimestamp !== frame.timestamp) {
        const offsetSeconds = (selectedTimestamp - frame.timestamp).toFixed(2);
        const baseBrightness = quality.brightness.toFixed(2);
        const baseContrast = quality.contrast.toFixed(2);
        const bestBrightness = best.quality?.brightness?.toFixed(2) ?? baseBrightness;
        const bestContrast = best.quality?.contrast?.toFixed(2) ?? baseContrast;
        logSlides?.(
          `thumbnail adjust slide=${frame.index} ts=${frame.timestamp.toFixed(2)}s -> ${selectedTimestamp.toFixed(2)}s offset=${offsetSeconds}s base=${baseBrightness}/${baseContrast} best=${bestBrightness}/${bestContrast}`,
        );
      }
      onSlide?.({
        imagePath: frame.imagePath,
        imageVersion: updatedVersion,
        index: frame.index,
        timestamp: selectedTimestamp,
      });
    });
  }
  if (fixTasks.length > 0) {
    const fixStartedAt = Date.now();
    const THUMB_START = 90;
    const THUMB_END = 96;
    onStatus?.(`Slides: improving thumbnails ${THUMB_START}%`);
    logSlides?.(
      `thumbnail adjust start count=${fixTasks.length} range=±${FRAME_ADJUST_RANGE_SECONDS}s step=${FRAME_ADJUST_STEP_SECONDS}s`,
    );
    await runWithConcurrency(fixTasks, Math.min(4, workers), (completed, total) => {
      const ratio = total > 0 ? completed / total : 0;
      const percent = Math.round(THUMB_START + ratio * (THUMB_END - THUMB_START));
      onStatus?.(`Slides: improving thumbnails ${percent}%`);
    });
    onStatus?.(`Slides: improving thumbnails ${THUMB_END}%`);
    logSlidesTiming?.('thumbnail adjust done', fixStartedAt);
  }
  logSlidesTiming?.(
    `extract frame loop (count=${timestamps.length}, workers=${workers})`,
    startedAt,
  );
  return slides;
}
