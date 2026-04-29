import { buildIdleSubtitle } from '../../lib/header';
import type { PanelCachePayload } from './panel-cache';
import { normalizeSlideImageUrl } from './slide-images';
import type { PanelPhase, PanelState } from './types';

interface SlidesTextControllerLike {
  reset: () => void;
  getTranscriptTimedText: () => string | null;
  getTranscriptAvailable: () => boolean;
}

interface SlidesHydratorLike {
  syncFromCache: (payload: {
    runId: string | null;
    summaryFromCache: boolean | null;
    hasSlides: boolean;
  }) => void;
}

interface MetricsControllerLike { clearForMode: (mode: 'summary' | 'chat') => void }

interface HeaderControllerLike {
  setBaseTitle: (value: string) => void;
  setBaseSubtitle: (value: string) => void;
}

interface SummaryViewRuntimeOpts {
  panelState: PanelState;
  renderEl: HTMLElement;
  renderSlidesHostEl: HTMLElement;
  renderMarkdownHostEl: HTMLElement;
  getSlidesRenderer: () => { clear: () => void };
  metricsController: MetricsControllerLike;
  headerController: HeaderControllerLike;
  slidesTextController: SlidesTextControllerLike;
  getSlidesHydrator: () => SlidesHydratorLike;
  stopSlidesStream: () => void;
  refreshSummarizeControl: () => void;
  resetChatState: () => void;
  setSlidesTranscriptTimedText: (value: string | null) => void;
  getSlidesParallelValue: () => boolean;
  getCurrentRunTabId: () => number | null;
  getActiveTabId: () => number | null;
  getActiveTabUrl: () => string | null;
  setCurrentRunTabId: (value: number | null) => void;
  setSlidesContextPending: (value: boolean) => void;
  setSlidesContextUrl: (value: string | null) => void;
  setSlidesSeededSourceId: (value: string | null) => void;
  setSlidesAppliedRunId: (value: string | null) => void;
  setSlidesExpanded: (value: boolean) => void;
  resolveActiveSlidesRunId: () => string | null;
  getSlidesSummaryState: () => {
    runId: string | null;
    markdown: string;
    complete: boolean;
    model: string | null;
  };
  setSlidesSummaryState: (payload: {
    markdown: string;
    complete: boolean;
    model: string | null;
  }) => void;
  clearSlidesSummaryPending: () => void;
  clearSlidesSummaryError: () => void;
  updateSlidesTextState: () => void;
  requestSlidesContext: () => void | Promise<void>;
  updateSlideSummaryFromMarkdown: (
    markdown: string,
    opts?: { preserveIfEmpty?: boolean; source?: 'summary' | 'slides' },
  ) => void;
  renderMarkdown: (markdown: string) => void;
  renderMarkdownDisplay: () => void;
  queueSlidesRender: () => void;
  setPhase: (phase: PanelPhase, opts?: { error?: string | null }) => void;
}

export function createSummaryViewRuntime(opts: SummaryViewRuntimeOpts) {
  function resetSummaryView({
    preserveChat = false,
    clearRunId = true,
    stopSlides = true,
  }: { preserveChat?: boolean; clearRunId?: boolean; stopSlides?: boolean } = {}) {
    opts.setCurrentRunTabId(null);
    opts.renderEl.replaceChildren(opts.renderSlidesHostEl, opts.renderMarkdownHostEl);
    opts.renderMarkdownHostEl.innerHTML = '';
    opts.getSlidesRenderer().clear();
    opts.metricsController.clearForMode('summary');
    opts.panelState.summaryMarkdown = null;
    opts.panelState.summaryFromCache = null;
    opts.panelState.slides = null;
    if (clearRunId) {
      opts.panelState.runId = null;
      opts.panelState.slidesRunId = null;
    }
    opts.setSlidesExpanded(true);
    opts.setSlidesContextPending(false);
    opts.setSlidesContextUrl(null);
    opts.setSlidesTranscriptTimedText(null);
    opts.slidesTextController.reset();
    opts.setSlidesSeededSourceId(null);
    opts.setSlidesAppliedRunId(null);
    if (stopSlides) {
      opts.stopSlidesStream();
    }
    opts.refreshSummarizeControl();
    if (!preserveChat) {
      opts.resetChatState();
    }
  }

  function buildPanelCachePayload(): PanelCachePayload | null {
    const tabId = opts.getCurrentRunTabId() ?? opts.getActiveTabId();
    const url = opts.panelState.currentSource?.url ?? opts.getActiveTabUrl();
    if (!tabId || !url) {return null;}
    const slidesSummary = opts.getSlidesSummaryState();
    const hasSlidesSummaryState = Boolean(slidesSummary.runId || slidesSummary.markdown.trim());
    return {
      lastMeta: opts.panelState.lastMeta,
      runId: opts.panelState.runId ?? null,
      slides: opts.panelState.slides ?? null,
      slidesRunId: opts.panelState.slidesRunId ?? null,
      slidesSummaryComplete: hasSlidesSummaryState ? slidesSummary.complete : null,
      slidesSummaryMarkdown: slidesSummary.markdown || null,
      slidesSummaryModel: hasSlidesSummaryState ? slidesSummary.model : null,
      summaryFromCache: opts.panelState.summaryFromCache ?? null,
      summaryMarkdown: opts.panelState.summaryMarkdown ?? null,
      tabId,
      title: opts.panelState.currentSource?.title ?? null,
      transcriptTimedText: opts.slidesTextController.getTranscriptTimedText() ?? null,
      url,
    };
  }

  function applyPanelCache(payload: PanelCachePayload, applyOpts?: { preserveChat?: boolean }) {
    const preserveChat = applyOpts?.preserveChat ?? false;
    resetSummaryView({ preserveChat });
    opts.panelState.runId = payload.runId ?? null;
    opts.panelState.slidesRunId =
      payload.slidesRunId ?? (opts.getSlidesParallelValue() ? null : (payload.runId ?? null));
    opts.setCurrentRunTabId(payload.tabId);
    opts.panelState.currentSource = { title: payload.title ?? null, url: payload.url };
    opts.panelState.lastMeta = payload.lastMeta ?? {
      inputSummary: null,
      model: null,
      modelLabel: null,
    };
    opts.panelState.summaryFromCache = payload.summaryFromCache ?? null;
    opts.setSlidesSummaryState({
      complete:
        payload.slidesSummaryComplete ?? Boolean((payload.slidesSummaryMarkdown ?? '').trim()),
      markdown: payload.slidesSummaryMarkdown ?? '',
      model:
        payload.slidesSummaryModel ??
        opts.panelState.lastMeta.model ??
        opts.panelState.ui?.settings.model ??
        null,
    });
    opts.clearSlidesSummaryPending();
    opts.clearSlidesSummaryError();
    opts.headerController.setBaseTitle(payload.title || payload.url || 'Summarize');
    opts.headerController.setBaseSubtitle(
      buildIdleSubtitle({
        inputSummary: opts.panelState.lastMeta.inputSummary,
        model: opts.panelState.lastMeta.model,
        modelLabel: opts.panelState.lastMeta.modelLabel,
      }),
    );
    opts.setSlidesTranscriptTimedText(payload.transcriptTimedText ?? null);
    if (payload.slides) {
      opts.panelState.slides = {
        ...payload.slides,
        slides: payload.slides.slides.map((slide) => ({
          ...slide,
          imageUrl: normalizeSlideImageUrl(
            slide.imageUrl,
            payload.slides?.sourceId ?? '',
            slide.index,
          ),
        })),
      };
      opts.setSlidesContextPending(false);
      opts.setSlidesContextUrl(payload.url);
      opts.updateSlidesTextState();
      if (!opts.slidesTextController.getTranscriptAvailable()) {
        void opts.requestSlidesContext();
      }
      opts.setSlidesAppliedRunId(opts.resolveActiveSlidesRunId());
    } else {
      opts.panelState.slides = null;
      opts.setSlidesContextPending(false);
      opts.setSlidesContextUrl(null);
      opts.updateSlidesTextState();
      opts.setSlidesAppliedRunId(null);
    }
    opts
      .getSlidesHydrator()
      .syncFromCache({
        hasSlides: Boolean(payload.slides && payload.slides.slides.length > 0),
        runId: opts.panelState.slidesRunId ?? null,
        summaryFromCache: payload.summaryFromCache,
      });
    if ((payload.slidesSummaryMarkdown ?? '').trim()) {
      opts.updateSlideSummaryFromMarkdown(payload.slidesSummaryMarkdown ?? '', {
        preserveIfEmpty: false,
        source: 'slides',
      });
    }
    if (payload.summaryMarkdown) {
      opts.renderMarkdown(payload.summaryMarkdown);
    } else {
      opts.renderMarkdownDisplay();
    }
    opts.queueSlidesRender();
    opts.setPhase('idle');
  }

  return { applyPanelCache, buildPanelCachePayload, resetSummaryView };
}
