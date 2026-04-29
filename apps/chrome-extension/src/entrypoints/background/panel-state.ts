import type { UiState as PanelUiState } from '../../lib/panel-contracts';

export type { PanelUiState };

interface CachedExtractLike {
  media: { hasVideo: boolean; hasAudio: boolean; hasCaptions: boolean } | null;
  wordCount: number | null;
  mediaDurationSeconds: number | null;
}

interface SessionLike {
  windowId: number;
  runController: AbortController | null;
  agentController: AbortController | null;
  inflightUrl: string | null;
  daemonRecovery: {
    getPendingUrl: () => string | null;
    maybeRecover: (args: {
      isReady: boolean;
      currentUrlMatches: boolean;
      isIdle: boolean;
    }) => boolean;
    updateStatus: (isReady: boolean) => void;
  };
  daemonStatus: {
    resolve: (
      state: { ok: boolean; authed: boolean; error?: string },
      options: { keepReady: boolean },
    ) => { ok: boolean; authed: boolean; error?: string };
  };
}

interface SettingsLike {
  token: string;
  autoSummarize: boolean;
  hoverSummaries: boolean;
  chatEnabled: boolean;
  automationEnabled: boolean;
  slidesEnabled: boolean;
  slidesParallel: boolean;
  slidesOcrEnabled: boolean;
  slidesLayout: 'strip' | 'gallery';
  fontSize: number;
  lineHeight: number;
  model: string;
  length: string;
}

export async function resolvePanelState({
  session,
  status,
  checkRecovery,
  loadSettings,
  getActiveTab,
  daemonHealth,
  daemonPing,
  panelSessionStore,
  urlsMatch,
  canSummarizeUrl,
}: {
  session: SessionLike;
  status: string;
  checkRecovery?: boolean;
  loadSettings: () => Promise<SettingsLike>;
  getActiveTab: (windowId: number) => Promise<chrome.tabs.Tab | null>;
  daemonHealth: () => Promise<{ ok: boolean; error?: string }>;
  daemonPing: (token: string) => Promise<{ ok: boolean; error?: string }>;
  panelSessionStore: {
    isPanelOpen: (session: SessionLike) => boolean;
    getCachedExtract: (tabId: number, url?: string | null) => CachedExtractLike | null;
  };
  urlsMatch: (a: string, b: string) => boolean;
  canSummarizeUrl: (url: string) => boolean;
}): Promise<{
  state: PanelUiState;
  shouldRecover: boolean;
  shouldClearPending: boolean;
  shouldPrimeMedia: { tabId: number; url: string; title: string | null } | null;
}> {
  const settings = await loadSettings();
  const tab = await getActiveTab(session.windowId);
  const token = settings.token.trim();
  const [health, authed] = await Promise.all([
    daemonHealth(),
    token ? daemonPing(token) : Promise.resolve({ ok: false }),
  ]);
  const daemonReady = health.ok && authed.ok;
  const pendingUrl = session.daemonRecovery.getPendingUrl();
  const currentUrlMatches = Boolean(pendingUrl && tab?.url && urlsMatch(tab.url, pendingUrl));
  const isIdle = !session.runController && !session.inflightUrl;
  const cached = tab?.id ? panelSessionStore.getCachedExtract(tab.id, tab.url ?? null) : null;
  const shouldRecover = checkRecovery
    ? session.daemonRecovery.maybeRecover({ currentUrlMatches, isIdle, isReady: daemonReady })
    : (session.daemonRecovery.updateStatus(daemonReady), false);
  const daemon = session.daemonStatus.resolve(
    { authed: authed.ok, error: health.error ?? authed.error, ok: health.ok },
    { keepReady: Boolean(session.runController || session.agentController || session.inflightUrl) },
  );

  return {
    shouldClearPending: Boolean(pendingUrl && tab?.url && !currentUrlMatches),
    shouldPrimeMedia:
      tab?.id && tab.url && canSummarizeUrl(tab.url)
        ? { tabId: tab.id, url: tab.url, title: tab.title ?? null }
        : null,
    shouldRecover,
    state: {
      daemon,
      media: cached?.media ?? null,
      panelOpen: panelSessionStore.isPanelOpen(session),
      settings: {
        autoSummarize: settings.autoSummarize,
        automationEnabled: settings.automationEnabled,
        chatEnabled: settings.chatEnabled,
        fontSize: settings.fontSize,
        hoverSummaries: settings.hoverSummaries,
        length: settings.length,
        lineHeight: settings.lineHeight,
        model: settings.model,
        slidesEnabled: settings.slidesEnabled,
        slidesLayout: settings.slidesLayout,
        slidesOcrEnabled: settings.slidesOcrEnabled,
        slidesParallel: settings.slidesParallel,
        tokenPresent: Boolean(settings.token.trim()),
      },
      stats: {
        pageWords: typeof cached?.wordCount === 'number' ? cached.wordCount : null,
        videoDurationSeconds:
          typeof cached?.mediaDurationSeconds === 'number' ? cached.mediaDurationSeconds : null,
      },
      status,
      tab: { id: tab?.id ?? null, title: tab?.title ?? null, url: tab?.url ?? null },
    },
  };
}
