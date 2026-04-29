import { buildSlidesCacheKey } from '../../../cache.js';
import type { ExtractedLinkContent } from '../../../content/index.js';
import {
  extractSlidesForSource,
  resolveSlideSource,
  type SlideExtractionResult,
  validateSlidesCache,
} from '../../../slides/index.js';
import { writeVerbose } from '../../logging.js';
import { createSlidesTerminalOutput, type SlidesTerminalOutput } from './slides-output.js';
import { composeUrlFlowHooks, type UrlFlowContext } from './types.js';

interface ProgressStatusLike {
  clearSlides: () => void;
  setSlides: (text: string, percent?: number | null) => void;
}

export interface UrlSlidesSession {
  getSlidesExtracted: () => SlideExtractionResult | null;
  runSlidesExtraction: () => Promise<SlideExtractionResult | null>;
  slidesOutput: SlidesTerminalOutput | null;
  slidesTimelinePromise: Promise<SlideExtractionResult | null> | null;
  setExtracted: (value: ExtractedLinkContent) => void;
}

export function createUrlSlidesSession({
  ctx,
  url,
  extracted: initialExtracted,
  cacheStore,
  progressStatus,
  renderStatus,
  renderStatusFromText,
  updateSummaryProgress,
}: {
  ctx: UrlFlowContext;
  url: string;
  extracted: ExtractedLinkContent;
  cacheStore: UrlFlowContext['cache']['store'] | null;
  progressStatus: ProgressStatusLike;
  renderStatus: (label: string, detail?: string) => string;
  renderStatusFromText: (text: string) => string;
  updateSummaryProgress: () => void;
}): UrlSlidesSession {
  const { io, flags, model, cache: cacheState, hooks } = ctx;
  let extracted = initialExtracted;
  let slidesExtracted: SlideExtractionResult | null = null;
  let slidesDone = false;
  let slidesTimelineResolved = false;
  let resolveSlidesTimeline: ((value: SlideExtractionResult | null) => void) | null = null;
  const slidesTimelinePromise = flags.slides
    ? new Promise<SlideExtractionResult | null>((resolve) => {
        resolveSlidesTimeline = resolve;
      })
    : null;

  const resolveTimeline = (value: SlideExtractionResult | null) => {
    if (slidesTimelineResolved) {return;}
    slidesTimelineResolved = true;
    resolveSlidesTimeline?.(value);
  };

  const slidesOutputEnabled =
    Boolean(flags.slides) && flags.slidesOutput !== false && !flags.json && !flags.extractMode;
  const slidesOutput = createSlidesTerminalOutput({
    clearProgressForStdout: hooks.clearProgressForStdout,
    enabled: slidesOutputEnabled,
    extracted,
    flags: { lengthArg: flags.lengthArg, plain: flags.plain, slidesDebug: flags.slidesDebug },
    io,
    onProgressText: flags.progressEnabled
      ? (text) =>{  progressStatus.setSlides(renderStatusFromText(text)); }
      : null,
    outputMode: 'delta',
    restoreProgressAfterStdout: hooks.restoreProgressAfterStdout ?? null,
    slides: null,
  });

  const sessionHooks = slidesOutput
    ? composeUrlFlowHooks(hooks, {
        onSlideChunk: (chunk) => {
          hooks.onSlideChunk?.(chunk);
          slidesOutput.onSlideChunk(chunk);
        },
        onSlidesDone: (result) => {
          hooks.onSlidesDone?.(result);
          progressStatus.clearSlides();
          slidesOutput.onSlidesDone(result);
        },
        onSlidesExtracted: (value) => {
          hooks.onSlidesExtracted?.(value);
          slidesOutput.onSlidesExtracted(value);
        },
      })
    : hooks;

  const markSlidesDone = (result: { ok: boolean; error?: string | null }) => {
    if (slidesDone) {return;}
    slidesDone = true;
    progressStatus.clearSlides();
    sessionHooks.onSlidesDone?.(result);
  };

  const runSlidesExtraction = async (): Promise<SlideExtractionResult | null> => {
    if (!flags.slides) {return null;}
    if (slidesExtracted) {
      if (!slidesDone) {markSlidesDone({ ok: true });}
      return slidesExtracted;
    }
    let errorMessage: string | null = null;
    try {
      const source = resolveSlideSource({ extracted, url });
      if (!source) {
        throw new Error('Slides are only supported for YouTube or direct video URLs.');
      }
      const slidesCacheKey =
        cacheStore && cacheState.mode === 'default'
          ? buildSlidesCacheKey({ settings: flags.slides, url: source.url })
          : null;
      if (slidesCacheKey && cacheStore) {
        const cached = cacheStore.getJson<SlideExtractionResult>('slides', slidesCacheKey);
        const validated = cached
          ? await validateSlidesCache({ cached, settings: flags.slides, source })
          : null;
        if (validated) {
          writeVerbose(
            io.stderr,
            flags.verbose,
            'cache hit slides',
            flags.verboseColor,
            io.envForRun,
          );
          slidesExtracted = validated;
          resolveTimeline(validated);
          sessionHooks.onSlidesExtracted?.(slidesExtracted);
          sessionHooks.onSlidesProgress?.('Slides: cached 100%');
          return slidesExtracted;
        }
        writeVerbose(
          io.stderr,
          flags.verbose,
          'cache miss slides',
          flags.verboseColor,
          io.envForRun,
        );
      }
      if (flags.progressEnabled) {
        progressStatus.setSlides(renderStatus('Extracting slides'));
      }
      const activeSlidesProgress = sessionHooks.onSlidesProgress;
      activeSlidesProgress?.('Slides: extracting');
      const onSlidesLog = (message: string) => {
        writeVerbose(
          io.stderr,
          flags.verbose,
          `slides ${message}`,
          flags.verboseColor,
          io.envForRun,
        );
      };
      slidesExtracted = await extractSlidesForSource({
        env: io.env,
        ffmpegPath: null,
        hooks: {
          onSlideChunk: (chunk) => sessionHooks.onSlideChunk?.(chunk),
          onSlidesLog,
          onSlidesProgress: activeSlidesProgress ?? undefined,
          onSlidesTimeline: (timeline) => {
            resolveTimeline(timeline);
            sessionHooks.onSlidesExtracted?.(timeline);
          },
        },
        mediaCache: ctx.mediaCache,
        noCache: cacheState.mode === 'bypass',
        settings: flags.slides,
        source,
        tesseractPath: null,
        timeoutMs: flags.timeoutMs,
        ytDlpCookiesFromBrowser: model.apiStatus.ytDlpCookiesFromBrowser,
        ytDlpPath: model.apiStatus.ytDlpPath,
      });
      if (slidesExtracted) {
        sessionHooks.onSlidesExtracted?.(slidesExtracted);
        sessionHooks.onSlidesProgress?.(
          `Slides: done (${slidesExtracted.slides.length.toString()} slides) 100%`,
        );
        if (slidesCacheKey && cacheStore) {
          cacheStore.setJson('slides', slidesCacheKey, slidesExtracted, cacheState.ttlMs);
          writeVerbose(
            io.stderr,
            flags.verbose,
            'cache write slides',
            flags.verboseColor,
            io.envForRun,
          );
        }
      }
      if (flags.progressEnabled) {
        updateSummaryProgress();
      }
      return slidesExtracted;
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      if (!slidesTimelineResolved) {
        resolveTimeline(slidesExtracted ?? null);
      }
      if (!slidesDone) {
        markSlidesDone(errorMessage ? { error: errorMessage, ok: false } : { ok: true });
      }
    }
  };

  return {
    getSlidesExtracted: () => slidesExtracted,
    runSlidesExtraction,
    setExtracted: (value) => {
      extracted = value;
    },
    slidesOutput,
    slidesTimelinePromise,
  };
}
