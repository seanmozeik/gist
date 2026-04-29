import type { Message, ToolCall } from '@mariozechner/pi-ai';
import { extractYouTubeVideoId } from '@steipete/summarize-core/content/url';
import MarkdownIt from 'markdown-it';

import { executeToolCall, getAutomationToolNames } from '../../automation/tools';
import type { BgToPanel, PanelToBg } from '../../lib/panel-contracts';
import type { SseSlidesData } from '../../lib/runtime-contracts';
import {
  defaultSettings,
  loadSettings,
  patchSettings,
  type SlidesLayout,
} from '../../lib/settings';
import { splitSummaryFromSlides } from '../../lib/slides-text';
import { generateToken } from '../../lib/token';
import { createAppearanceControls } from './appearance-controls';
import { createSidepanelBgMessageRuntime } from './bg-message-runtime';
import { bindSidepanelUiEvents } from './bindings';
import { bootstrapSidepanel } from './bootstrap-runtime';
import { runChatAgentLoop } from './chat-agent-loop';
import { ChatController } from './chat-controller';
import { createChatHistoryRuntime } from './chat-history-runtime';
import {
  buildEmptyUsage,
  createChatHistoryStore,
  normalizeStoredMessage,
} from './chat-history-store';
import { createChatQueueRuntime } from './chat-queue-runtime';
import { createChatSession } from './chat-session';
import type { ChatHistoryLimits } from './chat-state';
import { createChatStreamRuntime } from './chat-stream-runtime';
import { createChatUiRuntime } from './chat-ui-runtime';
import { createSidepanelDom } from './dom';
import { createErrorController } from './error-controller';
import { createHeaderController } from './header-controller';
import { createSidepanelInteractionRuntime } from './interaction-runtime';
import { createMetricsController } from './metrics-controller';
import { createNavigationRuntime } from './navigation-runtime';
import { createPanelCacheController, type PanelCachePayload } from './panel-cache';
import { createPanelPortRuntime } from './panel-port';
import {
  normalizePanelUrl,
  panelUrlsMatch,
  shouldAcceptRunForCurrentPage,
  shouldAcceptSlidesForCurrentPage,
} from './session-policy';
import { createSetupControlsRuntime } from './setup-controls-runtime';
import { friendlyFetchError } from './setup-runtime';
import { hasResolvedSlidesPayload } from './slides-pending';
import { createSidepanelSlidesRuntime } from './slides-runtime';
import { shouldSeedPlannedSlidesForRun } from './slides-seed-policy';
import { createSlidesSessionStore } from './slides-session-store';
import { selectMarkdownForLayout, type SlideTextMode } from './slides-state';
import { createSlidesTextController } from './slides-text-controller';
import { createSlidesViewRuntime } from './slides-view-runtime';
import { createSummarizeControlRuntime } from './summarize-control-runtime';
import { createSummaryStreamRuntime } from './summary-stream-runtime';
import { createSummaryViewRuntime } from './summary-view-runtime';
import { registerSidepanelTestHooks } from './test-hooks';
import { parseTimestampHref } from './timestamp-links';
import type { ChatMessage, PanelPhase, PanelState, RunStart, UiState } from './types';
import { createTypographyController } from './typography-controller';
import { createUiStateRuntime } from './ui-state-runtime';

let currentRunTabId: number | null = null;
const {
  advancedBtn,
  advancedSettingsBodyEl,
  advancedSettingsEl,
  advancedSettingsSummaryEl,
  autoToggleRoot,
  automationNoticeActionBtn,
  automationNoticeEl,
  automationNoticeMessageEl,
  automationNoticeTitleEl,
  chatContainerEl,
  chatContextStatusEl,
  chatDockEl,
  chatInputEl,
  chatJumpBtn,
  chatMessagesEl,
  chatMetricsSlotEl,
  chatQueueEl,
  chatSendBtn,
  clearBtn,
  drawerEl,
  drawerToggleBtn,
  errorEl,
  errorLogsBtn,
  errorMessageEl,
  errorRetryBtn,
  headerEl,
  inlineErrorCloseBtn,
  inlineErrorEl,
  inlineErrorLogsBtn,
  inlineErrorMessageEl,
  inlineErrorRetryBtn,
  lengthRoot,
  lineLooseBtn,
  lineTightBtn,
  mainEl,
  metricsEl,
  metricsHomeEl,
  modelCustomEl,
  modelPresetEl,
  modelRefreshBtn,
  modelRowEl,
  modelStatusEl,
  pickersRoot,
  progressFillEl,
  refreshBtn,
  renderEl,
  renderMarkdownHostEl,
  renderSlidesHostEl,
  setupEl,
  sizeLgBtn,
  sizeSmBtn,
  slideNoticeEl,
  slideNoticeMessageEl,
  slideNoticeRetryBtn,
  slidesLayoutEl,
  subtitleEl,
  summarizeControlRoot,
  titleEl,
} = createSidepanelDom();

const metricsController = createMetricsController({ chatMetricsSlotEl, metricsEl, metricsHomeEl });

const typographyController = createTypographyController({
  defaultFontSize: defaultSettings.fontSize,
  defaultLineHeight: defaultSettings.lineHeight,
  lineLooseBtn,
  lineTightBtn,
  sizeLgBtn,
  sizeSmBtn,
});

const md = new MarkdownIt({ breaks: false, html: false, linkify: true });

const slideTagPattern = /^\[slide:(\d+)\]/i;
const slideTagPlugin = (markdown: MarkdownIt) => {
  markdown.inline.ruler.before('emphasis', 'slide_tag', (state, silent) => {
    const match = state.src.slice(state.pos).match(slideTagPattern);
    if (!match) {return false;}
    if (!silent) {
      const token = state.push('slide_tag', 'span', 0);
      token.meta = { index: Number(match[1]) };
    }
    state.pos += match[0].length;
    return true;
  });
  markdown.renderer.rules.slide_tag = (tokens, idx) => {
    const index = tokens[idx]?.meta?.index;
    if (!Number.isFinite(index)) {return '';}
    return `<span class="slideInline" data-slide-index="${index}"></span>`;
  };
};

md.use(slideTagPlugin);

const panelState: PanelState = {
  chatStreaming: false,
  currentSource: null,
  error: null,
  lastMeta: { inputSummary: null, model: null, modelLabel: null },
  phase: 'idle',
  runId: null,
  slides: null,
  slidesRunId: null,
  summaryFromCache: null,
  summaryMarkdown: null,
  ui: null,
};

const panelPortRuntime = createPanelPortRuntime<BgToPanel>({
  onMessage: (msg) => {
    handleBgMessage(msg);
  },
});

async function send(message: PanelToBg) {
  if (message.type === 'panel:summarize') {
    lastAction = 'summarize';
  } else if (message.type === 'panel:agent') {
    lastAction = 'chat';
  }
  await panelPortRuntime.send(message);
}

let autoValue = false;
let chatEnabledValue = defaultSettings.chatEnabled;
let automationEnabledValue = defaultSettings.automationEnabled;
let autoKickTimer = 0;

const MAX_CHAT_MESSAGES = 1000;
const MAX_CHAT_CHARACTERS = 160_000;
const MAX_CHAT_QUEUE = 10;
const chatLimits: ChatHistoryLimits = {
  maxChars: MAX_CHAT_CHARACTERS,
  maxMessages: MAX_CHAT_MESSAGES,
};
let activeTabId: number | null = null;
let activeTabUrl: string | null = null;
let lastPanelOpen = false;
let lastAction: 'summarize' | 'chat' | null = null;
let automationNoticeSticky = false;
let slidesRenderer: { applyLayout: () => void; clear: () => void; forceRender: () => void } | null =
  null;
let slidesHydrator: {
  handlePayload: (data: SseSlidesData) => void;
  handleSummaryFromCache: (value: boolean | null) => void;
  hydrateSnapshot: (reason: 'timeout' | 'resume') => Promise<void>;
  isStreaming: () => boolean;
  start: (runId: string) => Promise<void>;
  stop: () => void;
  syncFromCache: (payload: {
    runId: string | null;
    summaryFromCache: boolean | null;
    hasSlides: boolean;
  }) => void;
} | null = null;
let settingsHydrated = false;
let pendingSettingsSnapshot: Partial<typeof defaultSettings> | null = null;
const slidesSession = createSlidesSessionStore({
  slidesEnabled: defaultSettings.slidesEnabled,
  slidesLayout: defaultSettings.slidesLayout,
  slidesOcrEnabled: defaultSettings.slidesOcrEnabled,
  slidesParallel: defaultSettings.slidesParallel,
});
const slidesState = slidesSession.state;
const pendingSummaryRunsByUrl = new Map<string, RunStart>();
const pendingSlidesRunsByUrl = new Map<string, { runId: string; url: string }>();
const slidesTextController = createSlidesTextController({
  getLengthValue: () => appearanceControls.getLengthValue(),
  getSlides: () => panelState.slides?.slides ?? null,
  getSlidesOcrEnabled: () => slidesState.slidesOcrEnabled,
});

const chatHistoryStore = createChatHistoryStore({ chatLimits });

const chatController = new ChatController({
  contextEl: chatContextStatusEl,
  inputEl: chatInputEl,
  limits: chatLimits,
  markdown: md,
  messagesEl: chatMessagesEl,
  onNewContent: () => {
    renderInlineSlides(chatMessagesEl);
  },
  scrollToBottom: () => scrollToBottom(),
  sendBtn: chatSendBtn,
});
const chatHistoryRuntime = createChatHistoryRuntime({
  chatController,
  chatHistoryStore,
  chatLimits,
  getActiveUrl: () => activeTabUrl,
  normalizeStoredMessage,
  requestChatHistory: (summary) => chatSession.requestChatHistory(summary),
});

type AutomationNoticeAction = 'extensions' | 'options';

function hideAutomationNotice(opts?: { force?: boolean }) {
  if (automationNoticeSticky && !opts?.force) {return;}
  automationNoticeSticky = false;
  automationNoticeEl.classList.add('hidden');
}

function showSlideNotice(message: string, opts?: { allowRetry?: boolean }) {
  slideNoticeMessageEl.textContent = message;
  slideNoticeRetryBtn.hidden = !opts?.allowRetry;
  slideNoticeEl.classList.remove('hidden');
  headerController.updateHeaderOffset();
}

function hideSlideNotice() {
  slideNoticeEl.classList.add('hidden');
  slideNoticeMessageEl.textContent = '';
  slideNoticeRetryBtn.hidden = true;
  headerController.updateHeaderOffset();
}

function stopSlidesStream() {
  slidesHydrator.stop();
  setSlidesBusy(false);
  panelState.slidesRunId = null;
  stopSlidesSummaryStream();
}

function setSlidesTranscriptTimedText(value: string | null) {
  slidesTextController.setTranscriptTimedText(value);
}

function stopSlidesSummaryStream() {
  slidesSummaryController.stop();
}

function resolveActiveSlidesRunId(): string | null {
  if (panelState.slidesRunId) {return panelState.slidesRunId;}
  if (!slidesState.slidesParallel && panelState.runId) {return panelState.runId;}
  return null;
}

function maybeStartPendingSummaryRunForUrl(url: string | null) {
  if (!url) {return false;}
  const key = normalizePanelUrl(url);
  const pending = pendingSummaryRunsByUrl.get(key);
  if (!pending) {return false;}
  if (streamController.isStreaming()) {return false;}
  pendingSummaryRunsByUrl.delete(key);
  attachSummaryRun(pending);
  return true;
}

function maybeStartPendingSlidesForUrl(url: string | null) {
  if (!url) {return;}
  const key = normalizePanelUrl(url);
  const pending = pendingSlidesRunsByUrl.get(key);
  if (!pending) {return;}
  if (!slidesState.slidesEnabled) {return;}
  const effectiveInputMode = slidesSession.resolveInputMode();
  if (effectiveInputMode !== 'video') {return;}
  if (slidesHydrator.isStreaming()) {return;}
  pendingSlidesRunsByUrl.delete(key);
  if (hasResolvedSlidesPayload(panelState.slides, slidesState.slidesSeededSourceId)) {return;}
  startSlidesStreamForRunId(pending.runId);
  startSlidesSummaryStreamForRunId(pending.runId, pending.url);
}

function attachSummaryRun(run: RunStart) {
  stopSlidesStream();
  setPhase('connecting');
  lastAction = 'summarize';
  window.clearTimeout(autoKickTimer);
  if (panelState.chatStreaming) {
    chatStreamRuntime.finishStreamingMessage();
  }
  const preserveChat = navigationRuntime.shouldPreserveChatForRun(run.url);
  if (!preserveChat) {
    void clearChatHistoryForActiveTab();
    resetChatState();
  } else {
    summaryStreamRuntime.setPreserveChatOnNextReset(true);
  }
  metricsController.setActiveMode('summary');
  panelState.runId = run.id;
  panelState.slidesRunId = slidesState.slidesParallel ? null : run.id;
  panelState.currentSource = { title: run.title, url: run.url };
  currentRunTabId = activeTabId;
  headerController.setBaseTitle(run.title || run.url || 'Summarize');
  headerController.setBaseSubtitle('');
  {
    const fallbackModel = panelState.ui?.settings.model ?? null;
    panelState.lastMeta = { inputSummary: null, model: fallbackModel, modelLabel: fallbackModel };
  }
  slidesState.pendingRunForPlannedSlides = run;
  if (!panelState.summaryMarkdown?.trim()) {
    renderMarkdownDisplay();
  }
  if (!slidesState.slidesParallel) {
    startSlidesStream(run);
  }
  void streamController.start(run);
}

function maybeSeedPlannedSlidesForPendingRun() {
  if (!slidesState.pendingRunForPlannedSlides) {return false;}
  if (seedPlannedSlidesForRun(slidesState.pendingRunForPlannedSlides)) {
    slidesState.pendingRunForPlannedSlides = null;
    return true;
  }
  return false;
}

function showAutomationNotice({
  title,
  message,
  ctaLabel,
  ctaAction,
  sticky,
}: {
  title: string;
  message: string;
  ctaLabel?: string;
  ctaAction?: AutomationNoticeAction;
  sticky?: boolean;
}) {
  automationNoticeSticky = Boolean(sticky);
  automationNoticeTitleEl.textContent = title;
  automationNoticeMessageEl.textContent = message;
  automationNoticeActionBtn.textContent = ctaLabel || 'Open extension details';
  automationNoticeActionBtn.onclick = () => {
    if (ctaAction === 'options') {
      void chrome.runtime.openOptionsPage();
      return;
    }
    void chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
  };
  automationNoticeEl.classList.remove('hidden');
}

window.addEventListener('summarize:automation-permissions', (event) => {
  const {detail} = (
    event as CustomEvent<{
      title?: string;
      message?: string;
      ctaLabel?: string;
      ctaAction?: AutomationNoticeAction;
    }>
  );
  if (!detail?.message) {return;}
  showAutomationNotice({
    ctaAction: detail.ctaAction,
    ctaLabel: detail.ctaLabel,
    message: detail.message,
    sticky: true,
    title: detail.title ?? 'Automation permission required',
  });
});

async function hideReplOverlayForActiveTab() {
  if (!activeTabId) {return;}
  try {
    await chrome.tabs.sendMessage(activeTabId, {
      action: 'hide',
      message: null,
      type: 'automation:repl-overlay',
    });
  } catch {
    // Ignore
  }
}

function requestAgentAbort(reason: string) {
  chatSession.requestAbort(reason);
}

function wrapMessage(message: Message): ChatMessage {
  return { ...message, id: crypto.randomUUID() };
}

function buildStreamingAssistantMessage(): ChatMessage {
  return {
    api: 'openai-completions',
    content: [],
    id: crypto.randomUUID(),
    model: 'streaming',
    provider: 'openai',
    role: 'assistant',
    stopReason: 'stop',
    timestamp: Date.now(),
    usage: buildEmptyUsage(),
  };
}

const chatSession = createChatSession({
  hideReplOverlay: hideReplOverlayForActiveTab,
  send: async (message) => send(message),
  setStatus: (text) => headerController.setStatus(text),
});

chatMessagesEl.addEventListener('click', (event) => {
  const target = event.target as HTMLElement | null;
  if (!target) {return;}
  const link = target.closest('a.chatTimestamp') as HTMLAnchorElement | null;
  if (!link) {return;}
  const href = link.getAttribute('href') ?? '';
  if (!href.startsWith('timestamp:')) {return;}
  const seconds = parseTimestampHref(href);
  if (seconds == null) {return;}
  event.preventDefault();
  event.stopPropagation();
  void send({ seconds, type: 'panel:seek' });
});

renderEl.addEventListener('click', (event) => {
  const target = event.target as HTMLElement | null;
  if (!target) {return;}
  const link = target.closest('a.chatTimestamp') as HTMLAnchorElement | null;
  if (!link) {return;}
  const href = link.getAttribute('href') ?? '';
  if (!href.startsWith('timestamp:')) {return;}
  const seconds = parseTimestampHref(href);
  if (seconds == null) {return;}
  event.preventDefault();
  event.stopPropagation();
  void send({ seconds, type: 'panel:seek' });
});

let summarizeControlRuntime: ReturnType<typeof createSummarizeControlRuntime> | null = null;

async function handleSummarizeControlChange(value: { mode: 'page' | 'video'; slides: boolean }) {
  await summarizeControlRuntime?.handleSummarizeControlChange(value);
}

function retrySlidesStream() {
  summarizeControlRuntime?.retrySlidesStream();
}

function applySlidesLayout() {
  summarizeControlRuntime?.applySlidesLayout();
}

function setSlidesLayout(next: SlidesLayout) {
  summarizeControlRuntime?.setSlidesLayout(next);
}

function refreshSummarizeControl() {
  summarizeControlRuntime?.refreshSummarizeControl();
}

const isStreaming = () => panelState.phase === 'connecting' || panelState.phase === 'streaming';

const optionsTabStorageKey = 'summarize:options-tab';

const openOptionsTab = (tabId: string) => {
  try {
    localStorage.setItem(optionsTabStorageKey, tabId);
  } catch {
    // Ignore
  }
  void send({ type: 'panel:openOptions' });
};

const headerController = createHeaderController({
  getState: () => ({ phase: panelState.phase, summaryFromCache: panelState.summaryFromCache }),
  headerEl,
  progressFillEl,
  subtitleEl,
  titleEl,
});

headerController.updateHeaderOffset();
window.addEventListener('resize', headerController.updateHeaderOffset);

const errorController = createErrorController({
  inlineCloseBtn: inlineErrorCloseBtn,
  inlineEl: inlineErrorEl,
  inlineLogsBtn: inlineErrorLogsBtn,
  inlineMessageEl: inlineErrorMessageEl,
  inlineRetryBtn: inlineErrorRetryBtn,
  onOpenLogs: () => openOptionsTab('logs'),
  onPanelVisibilityChange: () => headerController.updateHeaderOffset(),
  onRetry: () => retryLastAction(),
  panelEl: errorEl,
  panelLogsBtn: errorLogsBtn,
  panelMessageEl: errorMessageEl,
  panelRetryBtn: errorRetryBtn,
});
const chatQueueRuntime = createChatQueueRuntime({
  chatQueueEl,
  maxQueue: MAX_CHAT_QUEUE,
  setStatus: (value) => {
    headerController.setStatus(value);
  },
});

slideNoticeRetryBtn.addEventListener('click', () => {
  retrySlidesStream();
});

const setPhase = (phase: PanelPhase, opts?: { error?: string | null }) => {
  panelState.phase = phase;
  panelState.error = phase === 'error' ? (opts?.error ?? panelState.error) : null;
  if (phase === 'error') {
    const message =
      panelState.error && panelState.error.trim().length > 0
        ? panelState.error
        : 'Something went wrong.';
    errorController.showPanelError(message);
    setSlidesBusy(false);
  } else {
    errorController.clearPanelError();
    if (phase !== 'streaming' && phase !== 'connecting') {
      setSlidesBusy(false);
    }
  }
  if (phase === 'connecting' || phase === 'streaming') {
    headerController.armProgress();
  }
  if (phase !== 'connecting' && phase !== 'streaming') {
    headerController.stopProgress();
  }
  if (phase !== 'connecting' && phase !== 'streaming' && panelState.slides) {
    rebuildSlideDescriptions();
    queueSlidesRender();
  }
};

chrome.runtime.onMessage.addListener((raw, _sender, sendResponse) => {
  if (!raw || typeof raw !== 'object') {return;}
  const {type} = (raw as { type?: string });
  if (type === 'automation:abort-agent') {
    requestAgentAbort('Agent aborted');
    sendResponse?.({ ok: true });
    return true;
  }
});

const navigationRuntime = createNavigationRuntime({
  getCurrentSource: () => panelState.currentSource,
  resetForNavigation: (preserveChat) => {
    currentRunTabId = null;
    setPhase('idle');
    resetSummaryView({ preserveChat });
    headerController.setBaseSubtitle('');
  },
  setBaseTitle: (title) => {
    headerController.setBaseTitle(title);
  },
  setCurrentSource: (source) => {
    panelState.currentSource = source;
  },
});

async function migrateChatHistory(
  fromTabId: number | null,
  toTabId: number | null,
  toUrl: string | null,
) {
  if (!fromTabId || !toTabId || fromTabId === toTabId) {return;}
  const messages = chatController.getMessages();
  if (messages.length === 0) {return;}
  await chatHistoryStore.persist(toTabId, messages, true, toUrl);
}

const syncWithActiveTab = () => navigationRuntime.syncWithActiveTab();

async function clearCurrentView() {
  if (panelState.chatStreaming) {
    requestAgentAbort('Cleared');
  }
  streamController.abort();
  stopSlidesStream();
  resetSummaryView({ preserveChat: false });
  await clearChatHistoryForActiveTab();
  panelCacheController.scheduleSync();
  headerController.setStatus('');
  setPhase('idle');
}

const summaryViewRuntime = createSummaryViewRuntime({
  clearSlidesSummaryError: () => {
    slidesSummaryController.clearError();
  },
  clearSlidesSummaryPending: () => {
    slidesSummaryController.clearPending();
  },
  getActiveTabId: () => activeTabId,
  getActiveTabUrl: () => activeTabUrl,
  getCurrentRunTabId: () => currentRunTabId,
  getSlidesHydrator: () =>
    slidesHydrator ?? {
      handlePayload: () => {},
      handleSummaryFromCache: () => {},
      hydrateSnapshot: async () => {},
      isStreaming: () => false,
      start: async () => {},
      stop: () => {},
      syncFromCache: () => {},
    },
  getSlidesParallelValue: () => slidesState.slidesParallel,
  getSlidesRenderer: () =>
    slidesRenderer ?? { applyLayout: () => {}, clear: () => {}, forceRender: () => {} },
  getSlidesSummaryState: () => ({
    runId: slidesSummaryController.getRunId(),
    markdown: slidesSummaryController.getMarkdown(),
    complete: slidesSummaryController.getComplete(),
    model: slidesSummaryController.getModel(),
  }),
  headerController,
  metricsController,
  panelState,
  queueSlidesRender,
  refreshSummarizeControl,
  renderEl,
  renderMarkdown,
  renderMarkdownDisplay,
  renderMarkdownHostEl,
  renderSlidesHostEl,
  requestSlidesContext,
  resetChatState,
  resolveActiveSlidesRunId,
  setCurrentRunTabId: (value) => {
    currentRunTabId = value;
  },
  setPhase,
  setSlidesAppliedRunId: (value) => {
    slidesState.slidesAppliedRunId = value;
  },
  setSlidesContextPending: (value) => {
    slidesState.slidesContextPending = value;
  },
  setSlidesContextUrl: (value) => {
    slidesState.slidesContextUrl = value;
  },
  setSlidesExpanded: (value) => {
    slidesState.slidesExpanded = value;
  },
  setSlidesSeededSourceId: (value) => {
    slidesState.slidesSeededSourceId = value;
  },
  setSlidesSummaryState: (payload) => {
    slidesSummaryController.setSnapshot(payload);
  },
  setSlidesTranscriptTimedText,
  slidesTextController,
  stopSlidesStream,
  updateSlideSummaryFromMarkdown,
  updateSlidesTextState,
});
const { applyPanelCache, buildPanelCachePayload, resetSummaryView } = summaryViewRuntime;

const panelCacheController = createPanelCacheController({
  getSnapshot: buildPanelCachePayload,
  sendCache: (payload) => {
    void send({ cache: payload, type: 'panel:cache' });
  },
  sendRequest: (request) => {
    void send({ type: 'panel:get-cache', ...request });
  },
});

window.addEventListener('error', (event) => {
  const message =
    event.error instanceof Error ? event.error.stack || event.error.message : event.message;
  headerController.setStatus(`Error: ${message}`);
  setPhase('error', { error: message });
});

window.addEventListener('unhandledrejection', (event) => {
  const {reason} = (event as PromiseRejectionEvent);
  const message = reason instanceof Error ? reason.stack || reason.message : String(reason);
  headerController.setStatus(`Error: ${message}`);
  setPhase('error', { error: message });
});

let slidesViewRuntime: ReturnType<typeof createSlidesViewRuntime> | null = null;
let chatUiRuntime: ReturnType<typeof createChatUiRuntime> | null = null;

function renderEmptySummaryState() {
  slidesViewRuntime?.renderEmptySummaryState();
}

function renderMarkdownDisplay() {
  slidesViewRuntime?.renderMarkdownDisplay();
}

function renderMarkdown(markdown: string) {
  slidesViewRuntime?.renderMarkdown(markdown);
}

function setSlidesBusy(next: boolean) {
  slidesViewRuntime?.setSlidesBusy(next);
}

function updateSlideSummaryFromMarkdown(
  markdown: string,
  opts?: { preserveIfEmpty?: boolean; source?: 'summary' | 'slides' },
) {
  slidesViewRuntime?.updateSlideSummaryFromMarkdown(markdown, opts);
}

function seekToSlideTimestamp(seconds: number | null | undefined) {
  if (seconds == null || !Number.isFinite(seconds)) {return;}
  void send({ seconds: Math.floor(seconds), type: 'panel:seek' });
}
function updateSlidesTextState() {
  slidesViewRuntime?.updateSlidesTextState();
}

function rebuildSlideDescriptions() {
  slidesViewRuntime?.rebuildSlideDescriptions();
}

slidesViewRuntime = createSlidesViewRuntime({
  chatMessagesEl,
  getSlidesAppliedRunId: () => slidesState.slidesAppliedRunId,
  getSlidesBusy: () => slidesState.slidesBusy,
  getSlidesContextPending: () => slidesState.slidesContextPending,
  getSlidesContextUrl: () => slidesState.slidesContextUrl,
  getSlidesSeededSourceId: () => slidesState.slidesSeededSourceId,
  getState: () => ({
    activeTabUrl,
    autoSummarize: autoValue,
    currentSourceTitle: panelState.currentSource?.title ?? null,
    currentSourceUrl: panelState.currentSource?.url ?? null,
    inputMode: slidesSession.resolveInputMode(),
    panelState,
    slidesEnabled: slidesState.slidesEnabled,
    slidesLayout: slidesState.slidesLayout,
    slidesExpanded: slidesState.slidesExpanded,
    mediaAvailable: slidesState.mediaAvailable,
  }),
  headerSetProgressOverride: (busy) => headerController.setProgressOverride(busy),
  headerSetStatus: (text) => headerController.setStatus(text),
  hideSlideNotice,
  md,
  nextSlidesContextRequestId: () => slidesSession.nextSlidesContextRequestId(),
  panelCacheController,
  refreshSummarizeControl,
  renderMarkdownHostEl,
  renderSlidesHostEl,
  resolveActiveSlidesRunId,
  send,
  setSlidesAppliedRunId: (value) => {
    slidesState.slidesAppliedRunId = value;
  },
  setSlidesBusyValue: (value) => {
    slidesState.slidesBusy = value;
  },
  setSlidesContextPending: (value) => {
    slidesState.slidesContextPending = value;
  },
  setSlidesContextUrl: (value) => {
    slidesState.slidesContextUrl = value;
  },
  setSlidesExpanded: (value) => {
    slidesState.slidesExpanded = value;
  },
  setSlidesSeededSourceId: (value) => {
    slidesState.slidesSeededSourceId = value;
  },
  slidesTextController,
});

({ slidesRenderer } = slidesViewRuntime);

function applySlidesPayload(data: SseSlidesData) {
  slidesViewRuntime.applySlidesPayload(data, setSlidesTranscriptTimedText);
}

registerSidepanelTestHooks({
  applyBgMessage: (message) => {
    handleBgMessage(message);
  },
  applySlidesPayload,
  applySummaryMarkdown: (markdown) => {
    renderMarkdown(markdown);
    setPhase('idle');
  },
  applySummarySnapshot: (payload) => {
    resetSummaryView({ preserveChat: false, clearRunId: false, stopSlides: false });
    panelState.runId = payload.run.id;
    panelState.slidesRunId = slidesState.slidesParallel ? null : payload.run.id;
    panelState.currentSource = { url: payload.run.url, title: payload.run.title };
    currentRunTabId = activeTabId;
    headerController.setBaseTitle(payload.run.title || payload.run.url || 'Summarize');
    headerController.setBaseSubtitle('');
    renderMarkdown(payload.markdown);
    setPhase('idle');
  },
  applyUiState: (state) => {
    panelState.ui = state;
    updateControls(state);
  },
  forceRenderSlides: () => {
    slidesState.slidesEnabled = true;
    slidesState.inputMode = 'video';
    slidesState.inputModeOverride = 'video';
    return slidesRenderer?.forceRender();
  },
  getChatEnabled: () => chatEnabledValue,
  getInlineErrorMessage: () => inlineErrorMessageEl.textContent ?? '',
  getModel: () => panelState.lastMeta.model ?? null,
  getPhase: () => panelState.phase,
  getRunId: () => panelState.runId,
  getSettingsHydrated: () => settingsHydrated,
  getSlideDescriptions: () => slidesTextController.getDescriptionEntries(),
  getSlideSummaryEntries: () => slidesTextController.getSummaryEntries(),
  getSlideTitleEntries: () => Array.from(slidesTextController.getTitles().entries()),
  getSlidesState: () => ({
    slidesCount: panelState.slides?.slides.length ?? 0,
    layout: slidesState.slidesLayout,
    hasSlides: Boolean(panelState.slides),
  }),
  getSlidesSummaryComplete: () => slidesSummaryController.getComplete(),
  getSlidesSummaryMarkdown: () => slidesSummaryController.getMarkdown(),
  getSlidesSummaryModel: () => slidesSummaryController.getModel(),
  getSlidesTimeline: () =>
    panelState.slides?.slides.map((slide) => ({
      index: slide.index,
      timestamp: Number.isFinite(slide.timestamp) ? slide.timestamp : null,
    })) ?? [],
  getSummarizeMode: () => ({
    mode: slidesSession.resolveInputMode(),
    slides: slidesState.slidesEnabled,
    mediaAvailable: slidesState.mediaAvailable,
  }),
  getSummaryMarkdown: () => panelState.summaryMarkdown ?? '',
  getTranscriptTimedText: () => slidesTextController.getTranscriptTimedText(),
  isInlineErrorVisible: () => !inlineErrorEl.classList.contains('hidden'),
  renderSlidesNow: () => {
    queueSlidesRender();
  },
  setSummarizeMode: async (payload) => {
    await handleSummarizeControlChange(payload);
  },
  setTranscriptTimedText: (value) => {
    setSlidesTranscriptTimedText(value);
    updateSlidesTextState();
  },
  showInlineError: (message) => {
    errorController.showInlineError(message);
  },
});

async function requestSlidesContext() {
  await slidesViewRuntime.requestSlidesContext();
}

function queueSlidesRender() {
  slidesViewRuntime.queueSlidesRender();
}

function renderInlineSlides(container: HTMLElement, opts?: { fallback?: boolean }) {
  slidesViewRuntime.renderInlineSlides(container, opts);
}

function applyChatEnabled() {
  chatUiRuntime?.applyChatEnabled();
}

async function clearChatHistoryForActiveTab() {
  await chatUiRuntime?.clearChatHistoryForActiveTab();
}

async function persistChatHistory() {
  await chatUiRuntime?.persistChatHistory();
}

function resetChatState() {
  chatUiRuntime?.resetChatState();
}

async function restoreChatHistory() {
  await chatUiRuntime?.restoreChatHistory();
}

function scrollToBottom(force = false) {
  chatUiRuntime?.scrollToBottom(force);
}

const LINE_HEIGHT_STEP = 0.1;

const appearanceControls = createAppearanceControls({
  applyTypography: (fontFamily, fontSize, lineHeight) => {
    typographyController.apply(fontFamily, fontSize, lineHeight);
    typographyController.setCurrentFontSize(fontSize);
    typographyController.setCurrentLineHeight(lineHeight);
  },
  autoToggleRoot,
  lengthRoot,
  patchSettings,
  pickersRoot,
  sendSetAuto: (checked) => {
    autoValue = checked;
    void send({ type: 'panel:setAuto', value: checked });
  },
  sendSetLength: (value) => {
    void send({ type: 'panel:setLength', value });
  },
});

chatUiRuntime = createChatUiRuntime({
  chatContainerEl,
  chatDockContainerEl: chatDockEl,
  chatDockEl,
  chatInputEl,
  chatJumpBtn,
  clearHistory: (tabId) => chatHistoryRuntime.clear(tabId),
  clearMetrics: () => {
    metricsController.clearForMode('chat');
  },
  clearQueuedMessages: () => {
    chatQueueRuntime.clearQueuedMessages();
  },
  getActiveTabId: () => activeTabId,
  getChatEnabled: () => chatEnabledValue,
  getSummaryMarkdown: () => panelState.summaryMarkdown,
  loadHistory: (tabId) => chatHistoryRuntime.load(tabId),
  mainEl,
  persistHistory: (tabId, chatEnabled) => chatHistoryRuntime.persist(tabId, chatEnabled),
  renderEl,
  resetChatController: () => {
    panelState.chatStreaming = false;
    chatController.reset();
  },
  resetChatSession: () => {
    chatSession.reset();
  },
  restoreHistory: (tabId, summaryMarkdown) => chatHistoryRuntime.restore(tabId, summaryMarkdown),
});

const setupControlsRuntime = createSetupControlsRuntime({
  advancedSettingsBodyEl,
  advancedSettingsEl,
  defaultModel: defaultSettings.model,
  drawerEl,
  drawerToggleBtn,
  friendlyFetchError,
  generateToken,
  getStatusResetText: () => panelState.ui?.status ?? '',
  headerSetStatus: (text) => {
    headerController.setStatus(text);
  },
  loadSettings,
  modelCustomEl,
  modelPresetEl,
  modelRefreshBtn,
  modelRowEl,
  modelStatusEl,
  patchSettings,
  setupEl,
});
const {
  drawerControls,
  isRefreshFreeRunning,
  maybeShowSetup,
  readCurrentModelValue,
  refreshModelsIfStale,
  runRefreshFree,
  setDefaultModelPresets,
  setModelPlaceholderFromDiscovery,
  setModelValue,
  updateModelRowUI,
} = setupControlsRuntime;

const slidesRuntime = createSidepanelSlidesRuntime({
  applySlidesPayload,
  clearSummarySource: () => {
    slidesTextController.clearSummarySource();
  },
  friendlyFetchError,
  getActiveTabUrl: () => activeTabUrl,
  getInputMode: () => slidesState.inputMode,
  getInputModeOverride: () => slidesState.inputModeOverride,
  getLengthValue: () => appearanceControls.getLengthValue(),
  getPanelPhase: () => panelState.phase,
  getPanelState: () => panelState,
  getSlidesEnabled: () => slidesState.slidesEnabled,
  getToken: async () => (await loadSettings()).token,
  getTranscriptTimedText: () => slidesTextController.getTranscriptTimedText(),
  getUiState: () => panelState.ui,
  headerSetStatus: (text) => {
    headerController.setStatus(text);
  },
  hideSlideNotice,
  isStreaming,
  panelUrlsMatch,
  refreshSummarizeControl,
  renderInlineSlidesFallback: () => {
    renderInlineSlides(renderMarkdownHostEl, { fallback: true });
  },
  renderMarkdown,
  schedulePanelCacheSync: () => {
    panelCacheController.scheduleSync();
  },
  setInputMode: (value) => {
    slidesState.inputMode = value;
  },
  setInputModeOverride: (value) => {
    slidesState.inputModeOverride = value;
  },
  setSlidesBusy,
  setSlidesRunId: (value) => {
    panelState.slidesRunId = value;
  },
  showSlideNotice,
  stopSlidesStream,
  stopSlidesSummaryStream,
  updateSlideSummaryFromMarkdown,
});
const {
  applySlidesSummaryMarkdown,
  handleSlidesStatus,
  maybeApplyPendingSlidesSummary,
  slidesHydrator: activeSlidesHydrator,
  slidesSummaryController,
  startSlidesStream,
  startSlidesStreamForRunId,
  startSlidesSummaryStreamForRunId,
} = slidesRuntime;
slidesHydrator = activeSlidesHydrator;

const summaryStreamRuntime = createSummaryStreamRuntime({
  friendlyFetchError,
  getFallbackModel: () => panelState.ui?.settings.model ?? null,
  getToken: async () => (await loadSettings()).token,
  handleSlides: (data) => {
    slidesHydrator.handlePayload(data);
  },
  handleSummaryFromCache: (value) => {
    slidesHydrator.handleSummaryFromCache(value);
  },
  headerArmProgress: () => {
    headerController.armProgress();
  },
  headerSetBaseSubtitle: (text) => {
    headerController.setBaseSubtitle(text);
  },
  headerSetBaseTitle: (text) => {
    headerController.setBaseTitle(text);
  },
  headerSetStatus: (text) => {
    headerController.setStatus(text);
  },
  headerStopProgress: () => {
    headerController.stopProgress();
  },
  isStreaming,
  maybeApplyPendingSlidesSummary,
  panelState,
  queueSlidesRender,
  rebuildSlideDescriptions,
  refreshSummaryMetrics: (summary) => {
    metricsController.setForMode(
      'summary',
      summary,
      panelState.lastMeta.inputSummary,
      panelState.currentSource?.url ?? null,
    );
    metricsController.setActiveMode('summary');
  },
  rememberUrl: (url) => {
    void send({ type: 'panel:rememberUrl', url });
  },
  renderMarkdown,
  resetSummaryView,
  schedulePanelCacheSync: () => {
    panelCacheController.scheduleSync();
  },
  seedPlannedSlidesForPendingRun: () => {
    if (slidesState.pendingRunForPlannedSlides) {
      seedPlannedSlidesForRun(slidesState.pendingRunForPlannedSlides);
      slidesState.pendingRunForPlannedSlides = null;
    }
  },
  setPhase,
  setSlidesBusy,
  shouldRebuildSlideDescriptions: () => !slidesTextController.hasSummaryTitles(),
  syncWithActiveTab,
});
const { streamController } = summaryStreamRuntime;

const uiStateRuntime = createUiStateRuntime({
  appearanceControls,
  applyChatEnabled,
  applyPanelCache,
  chatController,
  clearChatHistoryForActiveTab,
  clearInlineError: () => {
    errorController.clearInlineError();
  },
  getActiveTabId: () => activeTabId,
  getActiveTabUrl: () => activeTabUrl,
  getAutoValue: () => autoValue,
  getAutomationEnabledValue: () => automationEnabledValue,
  getChatEnabledValue: () => chatEnabledValue,
  getCurrentRunTabId: () => currentRunTabId,
  getInputMode: () => slidesState.inputMode,
  getInputModeOverride: () => slidesState.inputModeOverride,
  getLastPanelOpen: () => lastPanelOpen,
  getMediaAvailable: () => slidesState.mediaAvailable,
  getSlidesBusy: () => slidesState.slidesBusy,
  getSlidesEnabledValue: () => slidesState.slidesEnabled,
  getSlidesLayoutValue: () => slidesState.slidesLayout,
  getSlidesOcrEnabledValue: () => slidesState.slidesOcrEnabled,
  getSlidesParallelValue: () => slidesState.slidesParallel,
  headerController,
  hideAutomationNotice,
  hideSlideNotice,
  isRefreshFreeRunning,
  isStreaming,
  maybeApplyPendingSlidesSummary,
  maybeSeedPlannedSlidesForPendingRun,
  maybeShowSetup,
  maybeStartPendingSlidesForUrl,
  maybeStartPendingSummaryRunForUrl,
  migrateChatHistory,
  navigationRuntime,
  onSlidesOcrChanged: updateSlidesTextState,
  panelCacheController,
  panelState,
  readCurrentModelValue,
  rebuildSlideDescriptions,
  refreshSummarizeControl,
  renderInlineSlides,
  renderMarkdownDisplay,
  renderMarkdownHostEl,
  requestAgentAbort,
  resetChatState,
  resetSummaryView,
  resolveActiveSlidesRunId,
  restoreChatHistory,
  setActiveTabId: (value) => {
    activeTabId = value;
  },
  setActiveTabUrl: (value) => {
    activeTabUrl = value;
  },
  setAutoValue: (value) => {
    autoValue = value;
  },
  setAutomationEnabledValue: (value) => {
    automationEnabledValue = value;
  },
  setChatEnabledValue: (value) => {
    chatEnabledValue = value;
  },
  setCurrentRunTabId: (value) => {
    currentRunTabId = value;
  },
  setInputMode: (value) => {
    slidesState.inputMode = value;
  },
  setInputModeOverride: (value) => {
    slidesState.inputModeOverride = value;
  },
  setLastPanelOpen: (value) => {
    lastPanelOpen = value;
  },
  setMediaAvailable: (value) => {
    slidesState.mediaAvailable = value;
  },
  setModelRefreshDisabled: (value) => {
    modelRefreshBtn.disabled = value;
  },
  setModelValue,
  setPhase,
  setSlidesEnabledValue: (value) => {
    slidesState.slidesEnabled = value;
  },
  setSlidesLayout: (value) => {
    setSlidesLayout(value as SlidesLayout);
  },
  setSlidesOcrEnabledValue: (value) => {
    slidesState.slidesOcrEnabled = value;
  },
  setSlidesParallelValue: (value) => {
    slidesState.slidesParallel = value;
  },
  setSummarizePageWords: (value) => {
    slidesState.summarizePageWords = value;
  },
  setSummarizeVideoDurationSeconds: (value) => {
    slidesState.summarizeVideoDurationSeconds = value;
  },
  setSummarizeVideoLabel: (value) => {
    slidesState.summarizeVideoLabel = value;
  },
  typographyController,
  updateModelRowUI,
});

function updateControls(state: UiState) {
  uiStateRuntime.apply(state);
}

const bgMessageRuntime = createSidepanelBgMessageRuntime({
  applyPanelCache: (cache, opts) => {
    applyPanelCache(cache as PanelCachePayload, opts);
  },
  applyUiState: updateControls,
  attachSummaryRun,
  consumeUiCache: (cacheMessage) => panelCacheController.consumeResponse(cacheMessage),
  finishStreamingMessage: () => {
    chatStreamRuntime.finishStreamingMessage();
  },
  getActiveTabId: () => activeTabId,
  getActiveTabUrl: () => activeTabUrl,
  getSlidesContextRequestId: () => slidesState.slidesContextRequestId,
  getSlidesSummaryState: () => ({
    complete: slidesSummaryController.getComplete(),
    markdown: slidesSummaryController.getMarkdown(),
  }),
  handleAgentChunk: (chunk) => {
    chatSession.handleAgentChunk(chunk as never);
  },
  handleAgentResponse: (response) => {
    chatSession.handleAgentResponse(response as never);
  },
  handleChatHistory: (chatHistory) => {
    chatSession.handleChatHistoryResponse(chatHistory as never);
  },
  isStreaming,
  panelState,
  rememberPendingSlidesRun: (value) => {
    pendingSlidesRunsByUrl.set(normalizePanelUrl(value.url), value);
  },
  rememberPendingSummaryRun: (run) => {
    pendingSummaryRunsByUrl.set(normalizePanelUrl(run.url), run);
  },
  renderInlineSlidesFallback: () => {
    renderInlineSlides(renderMarkdownHostEl, { fallback: true });
  },
  schedulePanelCacheSync: () => {
    panelCacheController.scheduleSync();
  },
  setPhase,
  setSlidesBusy,
  setSlidesContextPending: (value) => {
    slidesState.slidesContextPending = value;
  },
  setSlidesTranscriptTimedText,
  setStatus: (text) => {
    headerController.setStatus(text);
  },
  showSlideNotice,
  startSlidesStreamForRunId,
  startSlidesSummaryStreamForRunId: (runId, url) => {
    startSlidesSummaryStreamForRunId(runId, url ?? null);
  },
  updateSlideSummaryFromMarkdown,
  updateSlidesTextState,
});

function handleBgMessage(msg: BgToPanel) {
  bgMessageRuntime.handle(msg);
}

function scheduleAutoKick() {
  if (!autoValue) {return;}
  window.clearTimeout(autoKickTimer);
  autoKickTimer = window.setTimeout(() => {
    if (!autoValue) {return;}
    if (panelState.phase !== 'idle') {return;}
    if (panelState.summaryMarkdown) {return;}
    sendSummarize();
  }, 350);
}

const interactionRuntime = createSidepanelInteractionRuntime({
  blurCustomModel: () => {
    modelCustomEl.blur();
  },
  chatEnabled: () => chatEnabledValue,
  clearChatInput: () => {
    chatInputEl.value = '';
    chatInputEl.style.height = 'auto';
  },
  clearInlineError: () => {
    errorController.clearInlineError();
  },
  enqueueChatMessage: (value) => chatQueueRuntime.enqueueChatMessage(value),
  focusCustomModel: () => {
    modelCustomEl.focus();
  },
  getChatInputScrollHeight: () => chatInputEl.scrollHeight,
  getInputModeOverride: () => slidesState.inputModeOverride,
  getQueuedChatCount: () => chatQueueRuntime.getQueueLength(),
  getRawChatInput: () => chatInputEl.value,
  isChatStreaming: () => panelState.chatStreaming,
  isCustomModelHidden: () => modelCustomEl.hidden,
  maybeSendQueuedChat: () => {
    chatStreamRuntime.maybeSendQueuedChat();
  },
  patchSettings,
  readCurrentModelValue,
  restoreChatInput: (value) => {
    chatInputEl.value = value;
  },
  retryChat: () => {
    chatStreamRuntime.retryChat();
  },
  sendRawMessage: (message) => panelPortRuntime.send(message as PanelToBg),
  setChatInputHeight: (value) => {
    chatInputEl.style.height = value;
  },
  setLastAction: (value) => {
    lastAction = value;
  },
  startChatMessage: (value) => {
    chatStreamRuntime.startChatMessage(value);
  },
  typographyController,
  updateModelRowUI,
});
const { sendSummarize, sendChatMessage, bumpFontSize, bumpLineHeight, persistCurrentModel } =
  interactionRuntime;

summarizeControlRuntime = createSummarizeControlRuntime({
  applySlidesRendererLayout: () => {
    slidesRenderer?.applyLayout();
  },
  getState: () => ({
    inputMode: slidesState.inputMode,
    inputModeOverride: slidesState.inputModeOverride,
    hasSummaryMarkdown: Boolean(panelState.summaryMarkdown),
    slidesEnabled: slidesState.slidesEnabled,
    slidesOcrEnabled: slidesState.slidesOcrEnabled,
    autoSummarize: autoValue,
    slidesBusy: slidesState.slidesBusy,
    mediaAvailable: slidesState.mediaAvailable,
    slidesLayout: slidesState.slidesLayout,
    summarizeVideoLabel: slidesState.summarizeVideoLabel,
    summarizePageWords: slidesState.summarizePageWords,
    summarizeVideoDurationSeconds: slidesState.summarizeVideoDurationSeconds,
    activeTabUrl,
    currentSourceUrl: panelState.currentSource?.url ?? null,
  }),
  hideSlideNotice,
  loadSettings,
  maybeApplyPendingSlidesSummary,
  maybeStartPendingSlidesForUrl,
  patchSettings,
  queueSlidesRender,
  renderInlineSlidesFallback: () => {
    renderInlineSlides(renderMarkdownHostEl, { fallback: true });
  },
  renderMarkdownDisplay,
  renderMarkdownHostEl,
  renderSlidesHostEl,
  resolveActiveSlidesRunId,
  sendSummarize: (opts) => {
    sendSummarize(opts);
  },
  setInputMode: (value) => {
    slidesState.inputMode = value;
  },
  setInputModeOverride: (value) => {
    slidesState.inputModeOverride = value;
  },
  setSlidesBusy,
  setSlidesEnabled: (value) => {
    slidesState.slidesEnabled = value;
  },
  setSlidesLayoutValue: (value) => {
    slidesState.slidesLayout = value;
  },
  showSlideNotice: (message) => {
    showSlideNotice(message);
  },
  slidesLayoutEl,
  slidesTextController,
  startSlidesStreamForRunId,
  startSlidesSummaryStreamForRunId: (runId, url) => {
    startSlidesSummaryStreamForRunId(runId, url ?? null);
  },
  stopSlidesStream,
  summarizeControlRoot,
});

function seedPlannedSlidesForRun(run: RunStart) {
  const durationSeconds =
    slidesState.summarizeVideoDurationSeconds ?? panelState.ui?.stats.videoDurationSeconds ?? null;
  if (
    !shouldSeedPlannedSlidesForRun({
      durationSeconds,
      inputMode: slidesSession.resolveInputMode(),
      media: panelState.ui?.media,
      mediaAvailable: slidesState.mediaAvailable,
      runUrl: run.url,
      slidesEnabled: slidesState.slidesEnabled,
    })
  ) {
    return false;
  }

  const normalized = appearanceControls.getLengthValue().trim().toLowerCase();
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
  const count = Math.max(3, Math.min(80, target));

  const youtubeId = extractYouTubeVideoId(run.url);
  const sourceId = youtubeId ? `youtube-${youtubeId}` : `planned-${run.id}`;
  const sourceKind = youtubeId ? 'youtube' : 'direct';

  if (
    panelState.slides &&
    panelState.slides.sourceId === sourceId &&
    panelState.slides.slides.length > 0
  ) {
    return true;
  }

  const slides = Array.from({ length: count }, (_, i) => {
    const ratio = count <= 1 ? 0 : i / Math.max(1, count - 1);
    const timestamp = Math.max(0, Math.min(durationSeconds - 0.1, ratio * durationSeconds));
    const index = i + 1;
    return { imageUrl: '', index, timestamp };
  });

  panelState.slides = { ocrAvailable: false, slides, sourceId, sourceKind, sourceUrl: run.url };
  slidesState.slidesSeededSourceId = sourceId;
  updateSlidesTextState();
  void requestSlidesContext();
  queueSlidesRender();
  panelCacheController.scheduleSync(0);
  return true;
}

async function runAgentLoop() {
  await runChatAgentLoop({
    automationEnabled: automationEnabledValue,
    chatController,
    chatSession,
    createStreamingAssistantMessage: buildStreamingAssistantMessage,
    executeToolCall: async (call) => (await executeToolCall(call)) as ToolResultMessage,
    getAutomationToolNames,
    hasDebuggerPermission: () => chrome.permissions.contains({ permissions: ['debugger'] }),
    markAgentNavigationIntent: navigationRuntime.markAgentNavigationIntent,
    markAgentNavigationResult: navigationRuntime.markAgentNavigationResult,
    scrollToBottom,
    summaryMarkdown: panelState.summaryMarkdown,
    wrapMessage,
  });
}

const chatStreamRuntime = createChatStreamRuntime({
  addUserMessage: (text) => {
    chatController.addMessage(wrapMessage({ role: 'user', content: text, timestamp: Date.now() }));
  },
  chatEnabled: () => chatEnabledValue,
  clearErrors: () => {
    errorController.clearAll();
  },
  dequeueQueuedMessage: chatQueueRuntime.dequeueQueuedMessage,
  executeAgentLoop: runAgentLoop,
  focusInput: () => {
    chatInputEl.focus();
  },
  getQueuedChatCount: chatQueueRuntime.getQueueLength,
  hasUserMessages: () => chatController.hasUserMessages(),
  isChatStreaming: () => panelState.chatStreaming,
  metricsSetChatMode: () => {
    metricsController.setActiveMode('chat');
  },
  persistChatHistory,
  renderChatQueue: chatQueueRuntime.renderChatQueue,
  resetAbort: () => {
    chatSession.resetAbort();
  },
  scrollToBottom,
  setChatStreaming: (value) => {
    panelState.chatStreaming = value;
  },
  setLastActionChat: () => {
    lastAction = 'chat';
  },
  setStatus: (value) => {
    headerController.setStatus(value);
  },
  showInlineError: (message) => {
    errorController.showInlineError(message);
  },
});

function retryLastAction() {
  interactionRuntime.retryLastAction(lastAction);
}

bindSidepanelUiEvents({
  advancedBtn,
  advancedSettingsEl,
  advancedSettingsSummaryEl,
  bumpFontSize,
  bumpLineHeight,
  chatInputEl,
  chatSendBtn,
  clearBtn,
  clearCurrentView,
  drawerToggleBtn,
  lineHeightStep: LINE_HEIGHT_STEP,
  lineLooseBtn,
  lineTightBtn,
  modelCustomEl,
  modelPresetEl,
  modelRefreshBtn,
  openOptions: () => send({ type: 'panel:openOptions' }),
  persistCurrentModel,
  refreshBtn,
  refreshModelsIfStale: () => {
    if (drawerControls.hasAdvancedSettingsAnimation() && advancedSettingsEl.open) return;
    refreshModelsIfStale();
  },
  runRefreshFree,
  sendChatMessage,
  sendSummarize,
  setSlidesLayout: (next) => {
    setSlidesLayout(next);
    void (async () => {
      await patchSettings({ slidesLayout: next });
    })();
  },
  sizeLgBtn,
  sizeSmBtn,
  slidesLayoutEl,
  toggleAdvancedSettings: drawerControls.toggleAdvancedSettings,
  toggleDrawer: () => drawerControls.toggleDrawer(),
});

bootstrapSidepanel({
  appearanceControls,
  applyChatEnabled,
  applySlidesLayout,
  bindSettingsStorage: {
    applyChatEnabled,
    getPendingSettingsSnapshot: () => pendingSettingsSnapshot,
    getSettingsHydrated: () => settingsHydrated,
    hideAutomationNotice,
    setAutomationEnabledValue: (value) => {
      automationEnabledValue = value;
    },
    setChatEnabledValue: (value) => {
      chatEnabledValue = value;
    },
    setPendingSettingsSnapshot: (value) => {
      pendingSettingsSnapshot = value;
    },
  },
  bindSidepanelLifecycle: {
    clearInlineError: () => {
      errorController.clearInlineError();
    },
    scheduleAutoKick,
    sendClosed: () => {
      window.clearTimeout(autoKickTimer);
      void send({ type: 'panel:closed' });
    },
    sendReady: () => {
      void send({ type: 'panel:ready' });
    },
    sendSummarize,
    syncWithActiveTab,
  },
  clearPendingSettingsSnapshot: () => {
    pendingSettingsSnapshot = null;
  },
  ensurePanelPort: () => panelPortRuntime.ensure(),
  getPendingSettingsSnapshot: () => pendingSettingsSnapshot,
  hideAutomationNotice: () => {
    hideAutomationNotice();
  },
  loadSettings,
  renderMarkdownDisplay,
  scheduleAutoKick,
  sendPing: () => {
    void send({ type: 'panel:ping' });
  },
  sendReady: () => {
    void send({ type: 'panel:ready' });
  },
  setAutoValue: (value) => {
    autoValue = value;
  },
  setAutomationEnabledValue: (value) => {
    automationEnabledValue = value;
  },
  setChatEnabledValue: (value) => {
    chatEnabledValue = value;
  },
  setDefaultModelPresets,
  setModelPlaceholderFromDiscovery,
  setModelRefreshDisabled: (value) => {
    modelRefreshBtn.disabled = value;
  },
  setModelValue,
  setSettingsHydrated: (value) => {
    settingsHydrated = value;
  },
  setSlidesLayoutInputValue: (value) => {
    slidesLayoutEl.value = value;
  },
  setSlidesLayoutValue: (value) => {
    slidesState.slidesLayout = value as SlidesLayout;
  },
  toggleDrawerClosed: () => {
    drawerControls.toggleDrawer(false, { animate: false });
  },
  typographyController,
  updateModelRowUI,
});
