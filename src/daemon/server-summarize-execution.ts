import type http from 'node:http';

import type { CacheState } from '../cache.js';
import type { MediaCache } from '../content/index.js';
import { runWithProcessContext } from '../processes.js';
import { formatModelLabelForDisplay } from '../run/finish-line.js';
import { encodeSseEvent, type SseSlidesData } from '../shared/sse-events.js';
import type { SlideExtractionResult, SlideSettings, SlideSourceKind } from '../slides/index.js';
import { type DaemonRequestedMode, resolveAutoDaemonMode } from './auto-mode.js';
import {
  emitMeta,
  emitSlides,
  emitSlidesDone,
  emitSlidesStatus,
  pushToSession,
  scheduleSessionCleanup,
  type Session,
  type SessionEvent,
} from './server-session.js';
import type { ParsedSummarizeRequest } from './server-summarize-request.js';
import {
  extractContentForUrl,
  streamSummaryForUrl,
  streamSummaryForVisiblePage,
} from './summarize.js';

interface LoggerLike {
  info?: (payload: Record<string, unknown>) => void;
  error?: (payload: Record<string, unknown>) => void;
}

interface SlidesLogShape {
  enabled: boolean;
  ocr: boolean;
  outputDir: string;
  sceneThreshold: number | null;
  autoTuneThreshold: boolean;
  maxSlides: number | null;
  minDurationSeconds: number | null;
}

interface SlideLogState {
  startedAt: number | null;
  requested: boolean;
  cacheHit: boolean;
  lastStatus: string | null;
  statusCount: number;
  elapsedMs: number | null;
  slidesCount: number | null;
  ocrAvailable: boolean | null;
  warnings: string[];
}

interface ExecuteSummarizeSessionArgs {
  session: Session;
  request: ParsedSummarizeRequest;
  env: Record<string, string | undefined>;
  fetchImpl: typeof fetch;
  cacheState: CacheState;
  mediaCache: MediaCache | null;
  port: number;
  onSessionEvent?: ((event: SessionEvent, sessionId: string) => void) | null;
  requestLogger?: LoggerLike | null;
  includeContentLog: boolean;
  logStartedAt: number;
  logInput: {
    url: string;
    title: string | null;
    text: string | null;
    truncated: boolean | null;
  } | null;
  logSlidesSettings: SlidesLogShape | null;
  sessions: Map<string, Session>;
  refreshSessions: Map<string, Session>;
}

export function buildSlidesPayload({
  slides,
  port,
}: {
  slides: SlideExtractionResult;
  port: number;
}): SseSlidesData {
  const baseUrl = `http://127.0.0.1:${port}/v1/slides/${slides.sourceId}`;
  return {
    ocrAvailable: slides.ocrAvailable,
    slides: slides.slides.map((slide) => ({
      index: slide.index,
      timestamp: slide.timestamp,
      imageUrl: `${baseUrl}/${slide.index}${
        typeof slide.imageVersion === 'number' && slide.imageVersion > 0
          ? `?v=${slide.imageVersion}`
          : ''
      }`,
      ocrText: slide.ocrText ?? null,
      ocrConfidence: slide.ocrConfidence ?? null,
    })),
    sourceId: slides.sourceId,
    sourceKind: slides.sourceKind,
    sourceUrl: slides.sourceUrl,
  };
}

export async function handleExtractOnlySummarizeRequest({
  request,
  env,
  fetchImpl,
  cacheState,
  mediaCache,
}: {
  request: ParsedSummarizeRequest;
  env: Record<string, string | undefined>;
  fetchImpl: typeof fetch;
  cacheState: CacheState;
  mediaCache: MediaCache | null;
}): Promise<{
  extracted: Awaited<ReturnType<typeof extractContentForUrl>>['extracted'];
  slides: Awaited<ReturnType<typeof extractContentForUrl>>['slides'];
}> {
  const requestCache: CacheState = request.noCache
    ? { ...cacheState, mode: 'bypass' as const, store: null }
    : cacheState;
  const runId = crypto.randomUUID();
  return await runWithProcessContext({ runId, source: 'extract' }, async () =>
    extractContentForUrl({
      cache: requestCache,
      env,
      fetchImpl,
      format: request.format,
      input: { maxCharacters: request.maxCharacters, title: request.title, url: request.pageUrl },
      mediaCache,
      overrides: request.overrides,
      slides: request.slidesSettings,
    }),
  );
}

function createSlideLogState(requested: boolean): SlideLogState {
  return {
    cacheHit: false,
    elapsedMs: null,
    lastStatus: null,
    ocrAvailable: null,
    requested,
    slidesCount: null,
    startedAt: null,
    statusCount: 0,
    warnings: [],
  };
}

function serializeSlideLogState(state: SlideLogState) {
  return {
    cacheHit: state.cacheHit,
    elapsedMs: state.elapsedMs,
    lastStatus: state.lastStatus,
    ocrAvailable: state.ocrAvailable,
    requested: true,
    slidesCount: state.slidesCount,
    statusCount: state.statusCount,
    warnings: state.warnings,
  };
}

function createLiveSlides(meta: {
  slidesDir: string;
  sourceUrl: string;
  sourceId: string;
  sourceKind: SlideSourceKind;
  ocrAvailable: boolean;
}): SlideExtractionResult {
  return {
    autoTune: { chosenThreshold: 0, confidence: 0, enabled: false, strategy: 'none' },
    autoTuneThreshold: false,
    maxSlides: 0,
    minSlideDuration: 0,
    ocrAvailable: meta.ocrAvailable,
    ocrRequested: meta.ocrAvailable,
    sceneThreshold: 0,
    slides: [],
    slidesDir: meta.slidesDir,
    sourceId: meta.sourceId,
    sourceKind: meta.sourceKind,
    sourceUrl: meta.sourceUrl,
    warnings: [],
  };
}

export function toExtractOnlySlidesPayload(
  slides: SlideExtractionResult | null,
): {
  sourceUrl: string;
  sourceId: string;
  sourceKind: string;
  ocrAvailable: boolean;
  slides: {
    index: number;
    timestamp: number;
    ocrText?: string | null;
    ocrConfidence?: number | null;
  }[];
} | null {
  if (!slides || slides.slides.length === 0) {return null;}
  return {
    ocrAvailable: slides.ocrAvailable,
    slides: slides.slides.map((slide) => ({
      index: slide.index,
      timestamp: slide.timestamp,
      ocrText: slide.ocrText ?? null,
      ocrConfidence: slide.ocrConfidence ?? null,
    })),
    sourceId: slides.sourceId,
    sourceKind: slides.sourceKind,
    sourceUrl: slides.sourceUrl,
  };
}

export async function executeSummarizeSession({
  session,
  request,
  env,
  fetchImpl,
  cacheState,
  mediaCache,
  port,
  onSessionEvent,
  requestLogger,
  includeContentLog,
  logStartedAt,
  logInput,
  logSlidesSettings,
  sessions,
  refreshSessions,
}: ExecuteSummarizeSessionArgs): Promise<void> {
  const {
    pageUrl,
    title,
    textContent,
    truncated,
    modelOverride,
    lengthRaw,
    languageRaw,
    promptOverride,
    noCache,
    mode,
    maxCharacters,
    format,
    overrides,
    slidesSettings,
    hasText,
  } = request;
  const slideLogState = createSlideLogState(Boolean(slidesSettings));
  let logSummaryFromCache = false;
  let logInputSummary: string | null = null;
  let logSummaryText = '';
  let logExtracted: Record<string, unknown> | null = null;

  try {
    let emittedOutput = false;
    const sink = {
      onModelChosen: (modelId: string) => {
        if (session.lastMeta.model === modelId) return;
        emittedOutput = true;
        emitMeta(
          session,
          { model: modelId, modelLabel: formatModelLabelForDisplay(modelId) },
          onSessionEvent,
        );
      },
      writeChunk: (chunk: string) => {
        emittedOutput = true;
        if (includeContentLog) logSummaryText += chunk;
        pushToSession(session, { event: 'chunk', data: { text: chunk } }, onSessionEvent);
      },
      writeMeta: (data: { inputSummary?: string | null; summaryFromCache?: boolean | null }) => {
        if (typeof data.inputSummary === 'string') logInputSummary = data.inputSummary;
        if (typeof data.summaryFromCache === 'boolean') {
          logSummaryFromCache = data.summaryFromCache;
        }
        emitMeta(
          session,
          {
            inputSummary: typeof data.inputSummary === 'string' ? data.inputSummary : null,
            summaryFromCache:
              typeof data.summaryFromCache === 'boolean' ? data.summaryFromCache : null,
          },
          onSessionEvent,
        );
      },
      writeStatus: (text: string) => {
        const clean = text.trim();
        if (!clean) return;
        pushToSession(session, { event: 'status', data: { text: clean } }, onSessionEvent);
      },
    };

    const normalizedModelOverride =
      modelOverride && modelOverride.toLowerCase() !== 'auto' ? modelOverride : null;
    const requestCache: CacheState = noCache
      ? { ...cacheState, mode: 'bypass' as const, store: null }
      : cacheState;
    let liveSlides: SlideExtractionResult | null = null;

    const runWithMode = async (resolved: 'url' | 'page') => {
      if (resolved === 'url' && slideLogState.requested) {
        slideLogState.startedAt = Date.now();
        console.log(`[summarize-daemon] slides: start url=${pageUrl} (session=${session.id})`);
        if (includeContentLog) {
          requestLogger?.info?.({
            event: 'slides.start',
            sessionId: session.id,
            url: pageUrl,
            ...(logSlidesSettings ? { settings: logSlidesSettings } : {}),
          });
        }
      }

      if (resolved === 'url') {
        return  streamSummaryForUrl({
          cache: requestCache,
          env,
          fetchImpl,
          format,
          hooks: {
            ...(includeContentLog
              ? {
                  onExtracted: (content) => {
                    logExtracted = content as unknown as Record<string, unknown>;
                  },
                }
              : {}),
            onSlideChunk: ({ slide, meta }) => {
              if (
                !slide ||
                !meta?.slidesDir ||
                !meta.sourceUrl ||
                !meta.sourceId ||
                !meta.sourceKind
              ) {
                return;
              }
              const nextSlides = liveSlides ?? createLiveSlides(meta);
              liveSlides = nextSlides;
              const existingIndex = nextSlides.slides.findIndex(
                (item) => item.index === slide.index,
              );
              if (existingIndex >= 0) {
                nextSlides.slides[existingIndex] = {
                  ...nextSlides.slides[existingIndex],
                  ...slide,
                };
              } else {
                nextSlides.slides.push(slide);
              }
              nextSlides.slides.sort((a, b) => a.index - b.index);
              session.slides = nextSlides;
              emitSlides(session, buildSlidesPayload({ slides: nextSlides, port }), onSessionEvent);
            },
            onSlidesDone: (result) => {
              emitSlidesDone(session, result, onSessionEvent);
            },
            onSlidesExtracted: (slides) => {
              session.slides = slides;
              slideLogState.slidesCount = slides.slides.length;
              slideLogState.ocrAvailable = slides.ocrAvailable;
              slideLogState.warnings = slides.warnings;
              if (slideLogState.startedAt) {
                slideLogState.elapsedMs = Date.now() - slideLogState.startedAt;
                console.log(
                  `[summarize-daemon] slides: done count=${slides.slides.length} ocr=${slides.ocrAvailable} elapsedMs=${slideLogState.elapsedMs} warnings=${slides.warnings.join('; ')}`,
                );
              }
              if (includeContentLog) {
                requestLogger?.info?.({
                  event: 'slides.done',
                  url: pageUrl,
                  sessionId: session.id,
                  slidesCount: slides.slides.length,
                  ocrAvailable: slides.ocrAvailable,
                  elapsedMs: slideLogState.elapsedMs,
                  cacheHit: slideLogState.cacheHit,
                  warnings: slides.warnings,
                });
              }
              emitSlides(session, buildSlidesPayload({ slides, port }), onSessionEvent);
            },
            onSlidesProgress: (text) => {
              const clean = typeof text === 'string' ? text.trim() : '';
              if (!clean) return;
              slideLogState.lastStatus = clean;
              slideLogState.statusCount += 1;
              if (clean.toLowerCase().includes('cached')) {
                slideLogState.cacheHit = true;
              }
              const progressMatch = /(\d+)%/.exec(clean);
              const progress = progressMatch ? Number(progressMatch[1]) : null;
              if (includeContentLog) {
                requestLogger?.info?.({
                  event: 'slides.status',
                  url: pageUrl,
                  sessionId: session.id,
                  status: clean,
                  ...(progress !== null ? { progress } : {}),
                });
              }
              emitSlidesStatus(session, clean, onSessionEvent);
            },
          },
          input: { maxCharacters, title, url: pageUrl },
          languageRaw,
          lengthRaw,
          mediaCache,
          modelOverride: normalizedModelOverride,
          overrides,
          promptOverride,
          sink,
          slides: slidesSettings,
        });
      }

      return  streamSummaryForVisiblePage({
        cache: requestCache,
        env,
        fetchImpl,
        format,
        input: { text: textContent, title, truncated, url: pageUrl },
        languageRaw,
        lengthRaw,
        mediaCache,
        modelOverride: normalizedModelOverride,
        overrides,
        promptOverride,
        sink,
      });
    };

    const result = await (async () => {
      if (mode !== 'auto') {return runWithMode(mode);}
      const { primary, fallback } = resolveAutoDaemonMode({ hasText, url: pageUrl });
      try {
        return await runWithMode(primary);
      } catch (error) {
        if (!fallback || emittedOutput) {throw error;}
        sink.writeStatus('Primary failed. Trying fallback…');
        try {
          return await runWithMode(fallback);
        } catch (fallbackError) {
          const primaryMessage = error instanceof Error ? error.message : String(error);
          const fallbackMessage =
            fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
          throw new Error(
            `Auto mode failed.\nPrimary (${primary}): ${primaryMessage}\nFallback (${fallback}): ${fallbackMessage}`, { cause: fallbackError },
          );
        }
      }
    })();

    if (!session.lastMeta.model) {
      emitMeta(
        session,
        { model: result.usedModel, modelLabel: formatModelLabelForDisplay(result.usedModel) },
        onSessionEvent,
      );
    }

    pushToSession(session, { data: result.metrics, event: 'metrics' }, onSessionEvent);
    pushToSession(session, { data: {}, event: 'done' }, onSessionEvent);
    requestLogger?.info?.({
      elapsedMs: Date.now() - logStartedAt,
      event: 'summarize.done',
      inputSummary: logInputSummary,
      mode,
      model: result.usedModel,
      summaryFromCache: logSummaryFromCache,
      url: pageUrl,
      ...(includeContentLog && slideLogState.requested
        ? { slides: serializeSlideLogState(slideLogState) }
        : {}),
      ...(includeContentLog && !logSummaryFromCache
        ? { extracted: logExtracted, input: logInput, summary: logSummaryText }
        : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    pushToSession(session, { data: { message }, event: 'error' }, onSessionEvent);
    if (session.slidesRequested && !session.slidesDone) {
      emitSlidesDone(session, { error: message, ok: false }, onSessionEvent);
    }
    console.error('[summarize-daemon] summarize failed', error);
    requestLogger?.error?.({
      event: 'summarize.error',
      url: request.pageUrl,
      mode: request.mode,
      elapsedMs: Date.now() - logStartedAt,
      summaryFromCache: logSummaryFromCache,
      inputSummary: logInputSummary,
      ...(includeContentLog && slideLogState.requested
        ? { slides: serializeSlideLogState(slideLogState) }
        : {}),
      error: { message, stack: error instanceof Error ? error.stack : null },
      ...(includeContentLog && !logSummaryFromCache
        ? { extracted: logExtracted, input: logInput, summary: logSummaryText || null }
        : {}),
    });
  } finally {
    scheduleSessionCleanup({ refreshSessions, session, sessions });
  }
}
