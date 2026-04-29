import { createSlidesHydrator } from './slides-hydrator';
import { createSlidesRunRuntime } from './slides-run-runtime';
import { createSlidesSummaryController } from './slides-summary-controller';

export function createSidepanelSlidesRuntime({
  applySlidesPayload,
  clearSummarySource,
  friendlyFetchError,
  getActiveTabUrl,
  getInputMode,
  getInputModeOverride,
  getLengthValue,
  getPanelPhase,
  getPanelState,
  getSlidesEnabled,
  getToken,
  getTranscriptTimedText,
  getUiState,
  headerSetStatus,
  hideSlideNotice,
  isStreaming,
  panelUrlsMatch,
  refreshSummarizeControl,
  renderInlineSlidesFallback,
  renderMarkdown,
  schedulePanelCacheSync,
  setInputMode,
  setInputModeOverride,
  setSlidesBusy,
  setSlidesRunId,
  showSlideNotice,
  stopSlidesStream,
  stopSlidesSummaryStream,
  updateSlideSummaryFromMarkdown,
}: {
  applySlidesPayload: (
    data: Parameters<typeof createSlidesHydrator>[0]['onSlides'] extends (value: infer T) => void
      ? T
      : never,
  ) => void;
  clearSummarySource: () => void;
  friendlyFetchError: (error: unknown, fallback: string) => string;
  getActiveTabUrl: () => string | null;
  getInputMode: () => 'page' | 'video';
  getInputModeOverride: () => 'page' | 'video' | null;
  getLengthValue: () => string;
  getPanelPhase: () => 'idle' | 'connecting' | 'streaming' | 'error' | 'setup';
  getPanelState: Parameters<typeof createSlidesSummaryController>[0]['getPanelState'];
  getSlidesEnabled: () => boolean;
  getToken: () => Promise<string>;
  getTranscriptTimedText: () => string | null;
  getUiState: Parameters<typeof createSlidesSummaryController>[0]['getUiState'];
  headerSetStatus: (text: string) => void;
  hideSlideNotice: () => void;
  isStreaming: () => boolean;
  panelUrlsMatch: Parameters<typeof createSlidesSummaryController>[0]['panelUrlsMatch'];
  refreshSummarizeControl: () => void;
  renderInlineSlidesFallback: () => void;
  renderMarkdown: (markdown: string) => void;
  schedulePanelCacheSync: () => void;
  setInputMode: (value: 'page' | 'video') => void;
  setInputModeOverride: (value: 'page' | 'video' | null) => void;
  setSlidesBusy: (value: boolean) => void;
  setSlidesRunId: (value: string | null) => void;
  showSlideNotice: (message: string, opts?: { allowRetry?: boolean }) => void;
  stopSlidesStream: () => void;
  stopSlidesSummaryStream: () => void;
  updateSlideSummaryFromMarkdown: Parameters<
    typeof createSlidesSummaryController
  >[0]['updateSlideSummaryFromMarkdown'];
}) {
  const slidesSummaryController = createSlidesSummaryController({
    clearSummarySource,
    friendlyFetchError,
    getActiveTabUrl,
    getInputMode,
    getInputModeOverride,
    getLengthValue,
    getPanelState,
    getSlidesEnabled,
    getToken,
    getTranscriptTimedText,
    getUiState,
    panelUrlsMatch,
    renderInlineSlidesFallback,
    renderMarkdown,
    updateSlideSummaryFromMarkdown,
  });

  const applySlidesSummaryMarkdown = (markdown: string) => {
    slidesSummaryController.applyMarkdown(markdown);
  };

  const maybeApplyPendingSlidesSummary = () => {
    slidesSummaryController.maybeApplyPending();
  };

  const slidesHydrator = createSlidesHydrator({
    getToken,
    onDone: () => {
      setSlidesBusy(false);
      if (getPanelPhase() === 'idle') {
        headerSetStatus('');
      }
    },
    onError: (err) => {
      const message = friendlyFetchError(err, 'Slides stream failed');
      showSlideNotice(message, { allowRetry: true });
      setSlidesBusy(false);
      if (!isStreaming()) {
        headerSetStatus('');
      }
      void slidesHydrator.hydrateSnapshot('timeout');
      return message;
    },
    onSlides: (data) => {
      applySlidesPayload(data);
    },
    onSnapshotError: (err) => {
      const message = err instanceof Error ? err.message : String(err);
      console.debug('[summarize] slides snapshot failed', message);
    },
    onStatus: (text) => {
      slidesRunRuntime.handleSlidesStatus(text);
    },
  });

  const slidesRunRuntime = createSlidesRunRuntime({
    getActiveTabUrl,
    getInputMode,
    getInputModeOverride,
    getPanelPhase,
    getPanelState,
    getSlidesEnabled,
    getSlidesSummaryRunId: () => slidesSummaryController.getRunId(),
    getUiState,
    headerSetStatus,
    hideSlideNotice,
    refreshSummarizeControl,
    resetSlidesSummaryState: () => {
      slidesSummaryController.resetSummaryState();
    },
    schedulePanelCacheSync,
    setInputMode,
    setInputModeOverride,
    setSlidesBusy,
    setSlidesRunId,
    setSlidesSummaryModel: (value) => {
      slidesSummaryController.setModel(value);
    },
    setSlidesSummaryRunId: (value) => {
      slidesSummaryController.setRunId(value);
    },
    setSlidesSummaryUrl: (value) => {
      slidesSummaryController.setUrl(value);
    },
    startSlidesHydrator: (runId) => {
      void slidesHydrator.start(runId);
    },
    startSlidesSummaryController: (payload) => {
      void slidesSummaryController.start(payload);
    },
    stopSlidesStream,
    stopSlidesSummaryStream,
  });

  return {
    applySlidesSummaryMarkdown,
    handleSlidesStatus: slidesRunRuntime.handleSlidesStatus,
    maybeApplyPendingSlidesSummary,
    slidesHydrator,
    slidesSummaryController,
    startSlidesStream: slidesRunRuntime.startSlidesStream,
    startSlidesStreamForRunId: slidesRunRuntime.startSlidesStreamForRunId,
    startSlidesSummaryStreamForRunId: slidesRunRuntime.startSlidesSummaryStreamForRunId,
  };
}
