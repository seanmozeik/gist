import { logExtensionEvent } from '../../lib/extension-logs';
import type { PanelSession } from './panel-session-store';

type SlidesContextResponse =
  | { type: 'slides:context'; requestId: string; ok: false; error: string }
  | { type: 'slides:context'; requestId: string; ok: true; transcriptTimedText: string | null };

export async function handlePanelSlidesContextRequest<
  CachedExtract extends {
    transcriptTimedText?: string | null;
    slides?: { slides?: unknown[] } | null;
  },
  Recovery,
  Status,
>(options: {
  session: PanelSession<Recovery, Status>;
  requestId: string;
  requestedUrl: string | null;
  loadSettings: typeof import('../../lib/settings').loadSettings;
  getActiveTab: typeof import('./panel-utils').getActiveTab;
  canSummarizeUrl: (url: string | null | undefined) => boolean;
  panelSessionStore: {
    getCachedExtract: (tabId: number, url?: string | null) => CachedExtract | null;
    setCachedExtract: (tabId: number, payload: CachedExtract) => void;
  };
  urlsMatch: typeof import('./panel-utils').urlsMatch;
  send: (message: SlidesContextResponse) => void;
  fetchImpl?: typeof fetch;
  resolveLogLevel: (event: string) => 'verbose' | 'warn' | 'error';
}) {
  const {
    session,
    requestId,
    requestedUrl,
    loadSettings,
    getActiveTab,
    canSummarizeUrl,
    panelSessionStore,
    urlsMatch,
    send,
    fetchImpl,
    resolveLogLevel,
  } = options;
  const settings = await loadSettings();
  const logSlides = (event: string, detail?: Record<string, unknown>) => {
    if (!settings.extendedLogging) {return;}
    const payload = detail ? { event, ...detail } : { event };
    logExtensionEvent({
      detail: detail ?? {},
      event,
      level: resolveLogLevel(event),
      scope: 'slides:bg',
    });
    console.debug('[summarize][slides:bg]', payload);
  };
  const tab = await getActiveTab(session.windowId);
  const tabUrl = typeof tab?.url === 'string' ? tab.url : null;
  const targetUrl = requestedUrl ?? tabUrl;
  if (!targetUrl || !canSummarizeUrl(targetUrl)) {
    send({ error: 'No active tab for slides.', ok: false, requestId, type: 'slides:context' });
    logSlides('context:error', { reason: 'no-tab', url: targetUrl });
    return;
  }

  const canUseCache = Boolean(tab?.id && tabUrl && urlsMatch(tabUrl, targetUrl));
  let cached = canUseCache ? panelSessionStore.getCachedExtract(tab.id, tabUrl ?? null) : null;
  let transcriptTimedText = cached?.transcriptTimedText ?? null;

  if (!transcriptTimedText && settings.token.trim()) {
    try {
      const res = await (fetchImpl ?? fetch)('http://127.0.0.1:8787/v1/summarize', {
        body: JSON.stringify({
          url: targetUrl,
          mode: 'url',
          extractOnly: true,
          timestamps: true,
          maxCharacters: null,
        }),
        headers: {
          Authorization: `Bearer ${settings.token.trim()}`,
          'content-type': 'application/json',
        },
        method: 'POST',
      });
      const json = (await res.json()) as {
        ok?: boolean;
        extracted?: { transcriptTimedText?: string | null } | null;
        error?: string;
      };
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || `${res.status} ${res.statusText}`);
      }
      transcriptTimedText = json.extracted?.transcriptTimedText ?? null;
      if (transcriptTimedText) {
        if (!cached && canUseCache && tab?.id && tabUrl) {
          cached = {
            diagnostics: null,
            media: null,
            mediaDurationSeconds: null,
            slides: null,
            source: 'url',
            text: '',
            title: tab.title?.trim() ?? null,
            totalCharacters: 0,
            transcriptCharacters: null,
            transcriptLines: null,
            transcriptSource: null,
            transcriptTimedText,
            transcriptWordCount: null,
            transcriptionProvider: null,
            truncated: false,
            url: tabUrl,
            wordCount: null,
          } as CachedExtract;
        } else if (cached) {
          cached = { ...cached, transcriptTimedText };
        }
        if (cached && tab?.id) {
          panelSessionStore.setCachedExtract(tab.id, cached);
        }
      }
      logSlides('context:fetch-transcript', { ok: Boolean(transcriptTimedText), url: targetUrl });
    } catch (error) {
      logSlides('context:fetch-error', {
        url: targetUrl,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  send({ ok: true, requestId, transcriptTimedText, type: 'slides:context' });
  logSlides('context:ready', {
    slides: cached?.slides?.slides?.length ?? 0,
    transcriptTimedText: Boolean(transcriptTimedText),
    url: targetUrl,
  });
}
