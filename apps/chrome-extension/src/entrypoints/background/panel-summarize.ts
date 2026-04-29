import { shouldPreferUrlMode } from '@steipete/summarize-core/content/url';

import type { RunStart } from '../../lib/panel-contracts';
import type { Settings } from '../../lib/settings';
import { isYouTubeWatchUrl } from '../../lib/youtube-url';
import type { ExtractResponse } from './content-script-bridge';
import type { CachedExtract } from './extract-cache';
import { routeExtract, type ExtractorContext, type ExtractorResult } from './extractors/router';

interface DaemonRecoveryLike { recordFailure: (url: string) => void }

interface DaemonStatusLike { markReady: () => void }

interface BackgroundSummarizeSession {
  windowId: number;
  runController: AbortController | null;
  inflightUrl: string | null;
  lastSummarizedUrl: string | null;
  daemonRecovery: DaemonRecoveryLike;
  daemonStatus: DaemonStatusLike;
}

interface StoreLike {
  isPanelOpen: (session: BackgroundSummarizeSession) => boolean;
  setCachedExtract: (tabId: number, value: CachedExtract) => void;
}

type SendFn = (
  msg:
    | { type: 'run:error'; message: string }
    | { type: 'run:start'; run: RunStart }
    | { type: 'slides:run'; ok: boolean; runId?: string; url?: string; error?: string },
) => void;

function resolveSlidesForLength(
  lengthValue: string,
  durationSeconds: number | null | undefined,
): { maxSlides: number | null; minDurationSeconds: number | null } {
  if (!durationSeconds || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return { maxSlides: null, minDurationSeconds: null };
  }
  const normalized = lengthValue.trim().toLowerCase();
  const chunkSeconds =
    normalized === 'short'
      ? 600
      : normalized === 'medium'
        ? 450
        : normalized === 'long'
          ? 300
          : normalized === 'xl'
            ? 180
            : normalized === 'xxl'
              ? 120
              : 300;
  const target = Math.max(3, Math.round(durationSeconds / chunkSeconds));
  const maxSlides = Math.max(3, Math.min(80, target));
  const minDuration = Math.max(2, Math.floor(durationSeconds / maxSlides));
  return { maxSlides, minDurationSeconds: minDuration };
}

export async function summarizeActiveTab({
  session,
  reason,
  opts,
  loadSettings,
  emitState,
  getActiveTab,
  canSummarizeUrl,
  panelSessionStore,
  sendStatus,
  send,
  fetchImpl,
  extractFromTab,
  urlsMatch,
  buildSummarizeRequestBody,
  friendlyFetchError,
  isDaemonUnreachableError,
  logPanel,
}: {
  session: BackgroundSummarizeSession;
  reason: string;
  opts?: { refresh?: boolean; inputMode?: 'page' | 'video' };
  loadSettings: () => Promise<Settings>;
  emitState: (session: BackgroundSummarizeSession, status: string) => Promise<void>;
  getActiveTab: (windowId?: number) => Promise<chrome.tabs.Tab | null>;
  canSummarizeUrl: (url?: string | null) => boolean;
  panelSessionStore: StoreLike;
  sendStatus: (status: string) => void;
  send: SendFn;
  fetchImpl: typeof fetch;
  extractFromTab: ExtractorContext['extractFromTab'];
  urlsMatch: (left: string, right: string) => boolean;
  buildSummarizeRequestBody: (args: {
    extracted: ExtractResponse & { ok: true };
    settings: Settings;
    noCache: boolean;
    inputMode?: 'page' | 'video';
    timestamps: boolean;
    slides:
      | { enabled: false }
      | {
          enabled: true;
          ocr: boolean;
          maxSlides: number | null;
          minDurationSeconds: number | null;
        };
  }) => Record<string, unknown>;
  friendlyFetchError: (error: unknown, fallback: string) => string;
  isDaemonUnreachableError: (error: unknown) => boolean;
  logPanel: (event: string, detail?: Record<string, unknown>) => void;
}) {
  if (!panelSessionStore.isPanelOpen(session)) {return;}

  const settings = await loadSettings();
  const isManual = reason === 'manual' || reason === 'refresh' || reason === 'length-change';
  if (!isManual && !settings.autoSummarize) {return;}
  if (!settings.token.trim()) {
    await emitState(session, 'Setup required (missing token)');
    return;
  }

  if (reason === 'spa-nav' || reason === 'tab-url-change') {
    await new Promise((resolve) => setTimeout(resolve, 220));
  }

  const tab = await getActiveTab(session.windowId);
  if (!tab?.id || !canSummarizeUrl(tab.url)) {return;}

  session.runController?.abort();
  const controller = new AbortController();
  session.runController = controller;

  const prefersUrlMode = Boolean(tab.url && shouldPreferUrlMode(tab.url));
  const wantsUrlFastPath =
    Boolean(tab.url && isYouTubeWatchUrl(tab.url)) && opts?.inputMode !== 'page' && prefersUrlMode;

  let extracted: ExtractResponse & { ok: true };
  let routedResult: Pick<ExtractorResult, 'source' | 'diagnostics'> | null = null;
  if (wantsUrlFastPath) {
    logPanel('extractor.route.start', { preferUrl: prefersUrlMode, tabId: tab.id });
    logPanel('extractor.route.preferUrlHardSwitch', { tabId: tab.id });
    sendStatus(`Fetching transcript… (${reason})`);
    logPanel('extract:url-fastpath:start', { reason, tabId: tab.id });
    try {
      const res = await fetchImpl('http://127.0.0.1:8787/v1/summarize', {
        body: JSON.stringify({
          url: tab.url,
          title: tab.title ?? null,
          mode: 'url',
          extractOnly: true,
          timestamps: true,
          ...(opts?.refresh ? { noCache: true } : {}),
          maxCharacters: null,
          diagnostics: settings.extendedLogging ? { includeContent: true } : null,
        }),
        headers: {
          Authorization: `Bearer ${settings.token.trim()}`,
          'content-type': 'application/json',
        },
        method: 'POST',
        signal: controller.signal,
      });
      const json = (await res.json()) as {
        ok?: boolean;
        extracted?: {
          url: string;
          title: string | null;
          truncated: boolean;
          mediaDurationSeconds?: number | null;
          transcriptTimedText?: string | null;
        };
        error?: string;
      };
      if (!res.ok || !json.ok || !json.extracted) {
        throw new Error(json.error || `${res.status} ${res.statusText}`);
      }
      const extractedUrl = json.extracted.url || tab.url;
      extracted = {
        media: { hasAudio: true, hasCaptions: true, hasVideo: true },
        mediaDurationSeconds: json.extracted.mediaDurationSeconds ?? null,
        ok: true,
        text: '',
        title: json.extracted.title ?? tab.title ?? null,
        truncated: Boolean(json.extracted.truncated),
        url: extractedUrl,
      };
      panelSessionStore.setCachedExtract(tab.id, {
        diagnostics: null,
        media: { hasAudio: true, hasCaptions: true, hasVideo: true },
        mediaDurationSeconds: json.extracted.mediaDurationSeconds ?? null,
        slides: null,
        source: 'url',
        text: '',
        title: extracted.title ?? null,
        totalCharacters: 0,
        transcriptCharacters: null,
        transcriptLines: null,
        transcriptSource: null,
        transcriptTimedText: json.extracted.transcriptTimedText ?? null,
        transcriptWordCount: null,
        transcriptionProvider: null,
        truncated: Boolean(json.extracted.truncated),
        url: extractedUrl,
        wordCount: null,
      });
      session.daemonStatus.markReady();
      logPanel('extract:url-fastpath:ok', {
        durationSeconds: json.extracted.mediaDurationSeconds ?? null,
        transcriptTimedText: Boolean(json.extracted.transcriptTimedText),
        url: extractedUrl,
      });
    } catch (error) {
      logPanel('extract:url-fastpath:error', {
        error: error instanceof Error ? error.message : String(error),
      });
      extracted = {
        media: { hasAudio: true, hasCaptions: true, hasVideo: true },
        ok: true,
        text: '',
        title: tab.title ?? null,
        truncated: false,
        url: tab.url,
      };
    }
  } else {
    sendStatus(`Extracting… (${reason})`);
    logPanel('extract:start', { maxChars: settings.maxChars, reason, tabId: tab.id });
    const statusFromExtractEvent = (event: string) => {
      if (!panelSessionStore.isPanelOpen(session)) {return;}
      if (event === 'extract:attempt') {
        sendStatus(`Extracting page content… (${reason})`);
        return;
      }
      if (event === 'extract:inject:ok') {
        sendStatus(`Extracting: injecting… (${reason})`);
        return;
      }
      if (event === 'extract:message:ok') {
        sendStatus(`Extracting: reading… (${reason})`);
      }
    };
    if (prefersUrlMode) {
      logPanel('extractor.route.start', { preferUrl: true, tabId: tab.id });
      logPanel('extractor.route.preferUrlHardSwitch', { tabId: tab.id });
      const extractedAttempt = await extractFromTab(tab.id, settings.maxChars, {
        log: (event, detail) => {
          statusFromExtractEvent(event);
          logPanel(event, detail);
        },
        timeoutMs: 8_000,
      });
      logPanel(extractedAttempt.ok ? 'extract:done' : 'extract:failed', {
        ok: extractedAttempt.ok,
        ...(extractedAttempt.ok
          ? { url: extractedAttempt.data.url }
          : { error: extractedAttempt.error }),
      });
      extracted = extractedAttempt.ok
        ? extractedAttempt.data
        : {
            media: null,
            ok: true,
            text: '',
            title: tab.title ?? null,
            truncated: false,
            url: tab.url,
          };
    } else {
      const routed = await routeExtract({
        extractFromTab,
        fetchImpl,
        includeDiagnostics: settings.extendedLogging,
        log: (event, detail) => {
          statusFromExtractEvent(event);
          logPanel(event, detail);
        },
        maxChars: settings.maxChars,
        minTextChars: 1,
        noCache: Boolean(opts?.refresh),
        signal: controller.signal,
        tabId: tab.id,
        title: tab.title?.trim() ?? null,
        token: settings.token,
        url: tab.url,
      });
      logPanel(routed ? 'extract:done' : 'extract:failed', {
        ok: Boolean(routed),
        ...(routed
          ? { source: routed.source, url: routed.extracted.url }
          : { error: 'No extractor result' }),
      });
      if (routed) {
        ({ extracted } = routed);
        routedResult = routed;
      } else {
        extracted = {
          media: null,
          ok: true,
          text: '',
          title: tab.title ?? null,
          truncated: false,
          url: tab.url,
        };
      }
    }
  }

  if (tab.url && extracted.url && !urlsMatch(tab.url, extracted.url)) {
    await new Promise((resolve) => setTimeout(resolve, 180));
    logPanel('extract:retry', { maxChars: settings.maxChars, tabId: tab.id });
    const retry = await extractFromTab(tab.id, settings.maxChars, {
      log: (event, detail) => logPanel(event, detail),
      timeoutMs: 8_000,
    });
    if (retry.ok) {
      extracted = retry.data;
      routedResult = null;
    }
  }

  const extractedMatchesTab = tab.url && extracted.url ? urlsMatch(tab.url, extracted.url) : true;
  const resolvedExtracted =
    tab.url && !extractedMatchesTab
      ? {
          media: null,
          ok: true,
          text: '',
          title: tab.title ?? null,
          truncated: false,
          url: tab.url,
        }
      : extracted;

  if (
    settings.autoSummarize &&
    ((session.lastSummarizedUrl && urlsMatch(session.lastSummarizedUrl, resolvedExtracted.url)) ||
      (session.inflightUrl && urlsMatch(session.inflightUrl, resolvedExtracted.url))) &&
    !isManual
  ) {
    sendStatus('');
    return;
  }

  const resolvedTitle = tab.title?.trim() || resolvedExtracted.title || null;
  const resolvedPayload = { ...resolvedExtracted, title: resolvedTitle };
  const effectiveInputMode =
    opts?.inputMode ??
    (resolvedPayload.url && shouldPreferUrlMode(resolvedPayload.url) ? 'video' : undefined);
  const wordCount =
    resolvedPayload.text.length > 0 ? resolvedPayload.text.split(/\s+/).filter(Boolean).length : 0;
  const wantsSummaryTimestamps =
    settings.summaryTimestamps &&
    (effectiveInputMode === 'video' ||
      resolvedPayload.media?.hasVideo === true ||
      resolvedPayload.media?.hasAudio === true ||
      resolvedPayload.media?.hasCaptions === true ||
      shouldPreferUrlMode(resolvedPayload.url));
  const wantsSlides =
    settings.slidesEnabled &&
    (effectiveInputMode === 'video' ||
      resolvedPayload.media?.hasVideo === true ||
      shouldPreferUrlMode(resolvedPayload.url));
  const wantsParallelSlides = wantsSlides && settings.slidesParallel;
  const summaryTimestamps = wantsSummaryTimestamps || (wantsSlides && !wantsParallelSlides);
  const slidesTimestamps = wantsSummaryTimestamps || wantsSlides;

  logPanel('summarize:start', {
    inputMode: effectiveInputMode ?? null,
    reason,
    url: resolvedPayload.url,
    wantsParallelSlides,
    wantsSlides,
    wantsSummaryTimestamps: summaryTimestamps,
  });

  panelSessionStore.setCachedExtract(tab.id, {
    diagnostics: routedResult?.diagnostics ?? null,
    media: resolvedPayload.media ?? null,
    mediaDurationSeconds: resolvedPayload.mediaDurationSeconds ?? null,
    slides: null,
    source: routedResult?.source ?? 'page',
    text: resolvedPayload.text,
    title: resolvedTitle,
    totalCharacters: resolvedPayload.text.length,
    transcriptCharacters: null,
    transcriptLines: null,
    transcriptSource: null,
    transcriptTimedText: null,
    transcriptWordCount: null,
    transcriptionProvider: null,
    truncated: resolvedPayload.truncated,
    url: resolvedPayload.url,
    wordCount,
  });

  sendStatus('Connecting…');
  session.inflightUrl = resolvedPayload.url;
  const slideAuto = wantsSlides
    ? resolveSlidesForLength(settings.length, resolvedPayload.mediaDurationSeconds)
    : { maxSlides: null, minDurationSeconds: null };
  const slidesConfig = wantsSlides
    ? {
        enabled: true as const,
        maxSlides: slideAuto.maxSlides,
        minDurationSeconds: slideAuto.minDurationSeconds,
        ocr: settings.slidesOcrEnabled,
      }
    : { enabled: false as const };
  const summarySlides = wantsParallelSlides ? { enabled: false as const } : slidesConfig;

  let id: string;
  try {
    const body = buildSummarizeRequestBody({
      extracted: resolvedPayload,
      inputMode: effectiveInputMode,
      noCache: Boolean(opts?.refresh),
      settings,
      slides: summarySlides,
      timestamps: summaryTimestamps,
    });
    logPanel('summarize:request', {
      slides: wantsSlides && !wantsParallelSlides,
      slidesParallel: wantsParallelSlides,
      timestamps: summaryTimestamps,
      url: resolvedPayload.url,
    });
    const res = await fetchImpl('http://127.0.0.1:8787/v1/summarize', {
      body: JSON.stringify(body),
      headers: {
        Authorization: `Bearer ${settings.token.trim()}`,
        'content-type': 'application/json',
      },
      method: 'POST',
      signal: controller.signal,
    });
    const json = (await res.json()) as { ok: boolean; id?: string; error?: string };
    if (!res.ok || !json.ok || !json.id) {
      throw new Error(json.error || `${res.status} ${res.statusText}`);
    }
    session.daemonStatus.markReady();
    ({ id } = json);
  } catch (error) {
    if (controller.signal.aborted) return;
    const message = friendlyFetchError(error, 'Daemon request failed');
    send({ type: 'run:error', message });
    sendStatus(`Error: ${message}`);
    session.inflightUrl = null;
    if (!isManual && isDaemonUnreachableError(error)) {
      session.daemonRecovery.recordFailure(resolvedPayload.url);
    }
    return;
  }

  send({
    run: { id, model: settings.model, reason, title: resolvedTitle, url: resolvedPayload.url },
    type: 'run:start',
  });

  if (!wantsParallelSlides) {return;}

  void (async () => {
    try {
      const slidesBody = buildSummarizeRequestBody({
        extracted: resolvedPayload,
        inputMode: effectiveInputMode,
        noCache: Boolean(opts?.refresh),
        settings,
        slides: slidesConfig,
        timestamps: slidesTimestamps,
      });
      logPanel('slides:request', { url: resolvedPayload.url });
      const res = await fetchImpl('http://127.0.0.1:8787/v1/summarize', {
        body: JSON.stringify(slidesBody),
        headers: {
          Authorization: `Bearer ${settings.token.trim()}`,
          'content-type': 'application/json',
        },
        method: 'POST',
        signal: controller.signal,
      });
      const json = (await res.json()) as { ok: boolean; id?: string; error?: string };
      if (!res.ok || !json.ok || !json.id) {
        throw new Error(json.error || `${res.status} ${res.statusText}`);
      }
      session.daemonStatus.markReady();
      if (
        controller.signal.aborted ||
        session.runController !== controller ||
        (session.inflightUrl && !urlsMatch(session.inflightUrl, resolvedPayload.url))
      ) {
        return;
      }
      send({ ok: true, runId: json.id, type: 'slides:run', url: resolvedPayload.url });
    } catch (error) {
      if (
        controller.signal.aborted ||
        session.runController !== controller ||
        (session.inflightUrl && !urlsMatch(session.inflightUrl, resolvedPayload.url))
      ) {
        return;
      }
      const message = friendlyFetchError(error, 'Slides request failed');
      logPanel('slides:request:error', { error: message });
      send({ error: message, ok: false, type: 'slides:run' });
    }
  })();
}
