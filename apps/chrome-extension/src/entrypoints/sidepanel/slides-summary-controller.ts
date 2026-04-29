import { coerceSummaryWithSlides } from '../../lib/slides-text';
import { resolveSlidesLengthArg } from './slides-state';
import { createStreamController } from './stream-controller';
import type { PanelState, RunStart, UiState } from './types';

interface SlidesSummarySnapshot {
  runId: string | null;
  markdown: string;
  complete: boolean;
  model: string | null;
}

interface SlidesSummaryControllerOptions {
  getToken: () => Promise<string>;
  friendlyFetchError: (error: unknown, fallback: string) => string;
  panelUrlsMatch: (left: string | null | undefined, right: string | null | undefined) => boolean;
  getPanelState: () => PanelState;
  getUiState: () => UiState | null;
  getActiveTabUrl: () => string | null;
  getInputMode: () => 'page' | 'video';
  getInputModeOverride: () => 'page' | 'video' | null;
  getSlidesEnabled: () => boolean;
  getLengthValue: () => string;
  getTranscriptTimedText: () => string | null;
  clearSummarySource: () => void;
  updateSlideSummaryFromMarkdown: (
    markdown: string,
    opts?: { preserveIfEmpty?: boolean; source?: 'summary' | 'slides' },
  ) => void;
  renderMarkdown: (markdown: string) => void;
  renderInlineSlidesFallback: () => void;
}

interface SlidesSummaryState {
  runId: string | null;
  url: string | null;
  markdown: string;
  pending: string | null;
  hadError: boolean;
  complete: boolean;
  model: string | null;
}

function buildInitialState(): SlidesSummaryState {
  return {
    complete: false,
    hadError: false,
    markdown: '',
    model: null,
    pending: null,
    runId: null,
    url: null,
  };
}

export function createSlidesSummaryController(options: SlidesSummaryControllerOptions) {
  let state = buildInitialState();
  let activeGeneration = 0;

  const isCurrentGeneration = (generation: number) => generation === activeGeneration;

  const getEffectiveInputMode = () => options.getInputModeOverride() ?? options.getInputMode();
  const getCurrentUrl = () =>
    options.getPanelState().currentSource?.url ?? options.getActiveTabUrl() ?? null;
  const getFallbackModel = () =>
    options.getPanelState().lastMeta.model ?? options.getUiState()?.settings.model ?? 'auto';

  const applyMarkdown = (markdown: string) => {
    if (!markdown.trim()) {return;}
    const currentUrl = getCurrentUrl();
    if (state.url && currentUrl && !options.panelUrlsMatch(state.url, currentUrl)) {return;}
    if (!options.getSlidesEnabled()) {
      state.pending = markdown;
      return;
    }
    if (getEffectiveInputMode() !== 'video') {
      state.pending = markdown;
      return;
    }

    let output = markdown;
    const slides = options.getPanelState().slides?.slides ?? [];
    if (slides.length > 0) {
      output = coerceSummaryWithSlides({
        lengthArg: resolveSlidesLengthArg(options.getLengthValue()),
        markdown,
        slides: slides.map((slide) => ({
          index: slide.index,
          timestamp: Number.isFinite(slide.timestamp) ? slide.timestamp : Number.NaN,
        })),
        transcriptTimedText: options.getTranscriptTimedText(),
      });
    }
    options.updateSlideSummaryFromMarkdown(output, { preserveIfEmpty: false, source: 'slides' });
    if (!options.getPanelState().summaryMarkdown?.trim()) {
      options.renderMarkdown(output);
    }
  };

  const maybeApplyPending = () => {
    if (!state.pending) {return;}
    const {phase} = options.getPanelState();
    if (phase === 'connecting' || phase === 'streaming') {return;}
    const markdown = state.pending;
    state.pending = null;
    applyMarkdown(markdown);
  };

  const createGenerationStreamController = (generation: number) =>
    createStreamController({
      getToken: options.getToken,
      idleTimeoutMessage: 'Slides summary stalled. The daemon may have stopped.',
      idleTimeoutMs: 600_000,
      onDone: () => {
        if (!isCurrentGeneration(generation)) return;
        if (state.hadError) {
          state.complete = false;
          return;
        }
        state.complete = true;
        const markdown = state.markdown;
        if (!markdown.trim()) return;
        const phase = options.getPanelState().phase;
        if (phase === 'connecting' || phase === 'streaming') {
          state.pending = markdown;
          return;
        }
        applyMarkdown(markdown);
      },
      onError: (error) => {
        if (!isCurrentGeneration(generation)) return '';
        state.hadError = true;
        return options.friendlyFetchError(error, 'Slides summary failed');
      },
      onMeta: (meta) => {
        if (!isCurrentGeneration(generation)) return;
        if (typeof meta.model === 'string') {
          state.model = meta.model;
        }
      },
      onPhaseChange: () => {},
      onRender: (markdown) => {
        if (!isCurrentGeneration(generation)) return;
        state.markdown = markdown;
        if (options.getSlidesEnabled() && getEffectiveInputMode() === 'video') {
          options.updateSlideSummaryFromMarkdown(markdown, {
            preserveIfEmpty: true,
            source: 'slides',
          });
          if (options.getPanelState().summaryMarkdown && options.getPanelState().slides) {
            options.renderInlineSlidesFallback();
          }
        }
      },
      onReset: () => {
        if (!isCurrentGeneration(generation)) return;
        state.markdown = '';
        state.pending = null;
        state.hadError = false;
        state.complete = false;
        state.model = getFallbackModel();
      },
      onStatus: () => {},
    });

  let streamController = createGenerationStreamController(activeGeneration);

  return {
    applyMarkdown,
    clearError() {
      state.hadError = false;
    },
    clearPending() {
      state.pending = null;
    },
    getComplete() {
      return state.complete;
    },
    getMarkdown() {
      return state.markdown;
    },
    getModel() {
      return state.model;
    },
    getRunId() {
      return state.runId;
    },
    getSnapshot(): SlidesSummarySnapshot {
      return {
        runId: state.runId,
        markdown: state.markdown,
        complete: state.complete,
        model: state.model,
      };
    },
    maybeApplyPending,
    resetSummaryState() {
      state.markdown = '';
      state.pending = null;
      state.hadError = false;
      state.complete = false;
    },
    setModel(value: string | null) {
      state.model = value;
    },
    setRunId(value: string | null) {
      state.runId = value;
    },
    setSnapshot(payload: { markdown: string; complete: boolean; model: string | null }) {
      state.markdown = payload.markdown;
      state.complete = payload.complete;
      state.model = payload.model;
    },
    setUrl(value: string | null) {
      state.url = value;
    },
    start(run: RunStart) {
      activeGeneration += 1;
      streamController.abort();
      streamController = createGenerationStreamController(activeGeneration);
      return streamController.start(run);
    },
    stop() {
      activeGeneration += 1;
      streamController.abort();
      streamController = createGenerationStreamController(activeGeneration);
      state = buildInitialState();
      options.clearSummarySource();
    },
  };
}
