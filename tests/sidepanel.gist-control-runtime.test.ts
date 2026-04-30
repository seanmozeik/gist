import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createGistControlRuntime } from '../apps/chrome-extension/src/entrypoints/sidepanel/gist-control-runtime';
import type { SlideTextMode } from '../apps/chrome-extension/src/entrypoints/sidepanel/slides-state';
import type { Settings, SlidesLayout } from '../apps/chrome-extension/src/lib/settings';

interface GistControlProps {
  mode: 'page' | 'video';
  slidesEnabled: boolean;
  mediaAvailable: boolean;
  busy?: boolean;
  videoLabel?: string;
  pageWords?: number | null;
  videoDurationSeconds?: number | null;
  slidesTextMode?: SlideTextMode;
  slidesTextToggleVisible?: boolean;
  onSlidesTextModeChange?: (value: SlideTextMode) => void;
  onChange: (value: { mode: 'page' | 'video'; slides: boolean }) => void | Promise<void>;
  onGist: () => void;
}

let currentProps: GistControlProps | null = null;
const gistControlUpdate = vi.fn();

vi.mock('../apps/chrome-extension/src/entrypoints/sidepanel/pickers', () => ({
  mountGistControl: (_root: HTMLElement, props: GistControlProps) => {
    currentProps = props;
    return {
      update: (next: GistControlProps) => {
        currentProps = next;
        gistControlUpdate(next);
      },
    };
  },
}));

function buildState(overrides: Partial<ReturnType<typeof baseState>> = {}) {
  return { ...baseState(), ...overrides };
}

function baseState() {
  return {
    activeTabUrl: 'https://example.com/video',
    autoGist: false,
    currentSourceUrl: 'https://example.com/video',
    gistPageWords: 320,
    gistVideoDurationSeconds: 120,
    gistVideoLabel: 'Video',
    hasSummaryMarkdown: false,
    inputMode: 'page' as const,
    inputModeOverride: null as 'page' | 'video' | null,
    mediaAvailable: true,
    slidesBusy: false,
    slidesEnabled: false,
    slidesLayout: 'gallery' as SlidesLayout,
    slidesOcrEnabled: true,
  };
}

function buildRuntime(
  overrides: {
    state?: Partial<ReturnType<typeof baseState>>;
    resolveActiveSlidesRunId?: () => string | null;
    slidesTextSetResult?: boolean;
  } = {},
) {
  currentProps = null;
  gistControlUpdate.mockReset();

  const state = buildState(overrides.state);
  const calls = {
    applySlidesRendererLayout: vi.fn(),
    hideSlideNotice: vi.fn(),
    loadSettings: vi.fn(async () => ({ token: 'token' })),
    maybeApplyPendingSlidesSummary: vi.fn(),
    maybeStartPendingSlidesForUrl: vi.fn(),
    patchSettings: vi.fn(async (_patch: Partial<Settings>) => {
      /* Empty */
    }),
    queueSlidesRender: vi.fn(),
    renderInlineSlidesFallback: vi.fn(),
    renderMarkdownDisplay: vi.fn(),
    sendGist: vi.fn(),
    setSlidesBusy: vi.fn((value: boolean) => {
      state.slidesBusy = value;
    }),
    showSlideNotice: vi.fn(),
    startSlidesStreamForRunId: vi.fn(),
    startSlidesSummaryStreamForRunId: vi.fn(),
    stopSlidesStream: vi.fn(),
  };

  const renderMarkdownHostEl = { classList: { remove: vi.fn() } } as unknown as HTMLElement;
  const renderSlidesHostEl = { dataset: {} as Record<string, string> } as HTMLElement;
  const slidesLayoutEl = { value: state.slidesLayout } as HTMLSelectElement;

  const slidesTextController = {
    getTextMode: vi.fn(() => 'transcript' as SlideTextMode),
    getTextToggleVisible: vi.fn(() => true),
    setTextMode: vi.fn(() => overrides.slidesTextSetResult ?? true),
  };

  const runtime = createGistControlRuntime({
    applySlidesRendererLayout: calls.applySlidesRendererLayout,
    getState: () => state,
    gistControlRoot: {} as HTMLElement,
    hideSlideNotice: calls.hideSlideNotice,
    loadSettings: calls.loadSettings,
    maybeApplyPendingSlidesSummary: calls.maybeApplyPendingSlidesSummary,
    maybeStartPendingSlidesForUrl: calls.maybeStartPendingSlidesForUrl,
    patchSettings: calls.patchSettings,
    queueSlidesRender: calls.queueSlidesRender,
    renderInlineSlidesFallback: calls.renderInlineSlidesFallback,
    renderMarkdownDisplay: calls.renderMarkdownDisplay,
    renderMarkdownHostEl,
    renderSlidesHostEl,
    resolveActiveSlidesRunId: overrides.resolveActiveSlidesRunId ?? (() => null),
    sendGist: calls.sendGist,
    setInputMode: (value) => {
      state.inputMode = value;
    },
    setInputModeOverride: (value) => {
      state.inputModeOverride = value;
    },
    setSlidesBusy: calls.setSlidesBusy,
    setSlidesEnabled: (value) => {
      state.slidesEnabled = value;
    },
    setSlidesLayoutValue: (value) => {
      state.slidesLayout = value;
    },
    showSlideNotice: calls.showSlideNotice,
    slidesLayoutEl,
    slidesTextController,
    startSlidesStreamForRunId: calls.startSlidesStreamForRunId,
    startSlidesSummaryStreamForRunId: calls.startSlidesSummaryStreamForRunId,
    stopSlidesStream: calls.stopSlidesStream,
  });

  return {
    calls,
    currentProps: () => currentProps,
    renderMarkdownHostEl,
    renderSlidesHostEl,
    runtime,
    slidesLayoutEl,
    slidesTextController,
    state,
  };
}

describe('sidepanel gist control runtime', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    gistControlUpdate.mockReset();
    currentProps = null;
  });

  it('blocks enabling slides when required tools are missing', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue({
        json: async () => ({
          ok: true,
          tools: {
            ffmpeg: { available: false },
            tesseract: { available: true },
            ytDlp: { available: true },
          },
        }),
        ok: true,
      } as Response);
    const { state, calls } = buildRuntime();

    await currentProps?.onChange({ mode: 'video', slides: true });

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(calls.showSlideNotice).toHaveBeenCalledWith(
      'Slide extraction requires ffmpeg. Install and restart the daemon.',
    );
    expect(calls.patchSettings).not.toHaveBeenCalled();
    expect(state.slidesEnabled).toBe(false);
  });

  it('disabling slides stops active work and persists the setting', async () => {
    const { state, calls } = buildRuntime({
      state: { autoGist: true, inputMode: 'video', slidesBusy: true, slidesEnabled: true },
    });

    await currentProps?.onChange({ mode: 'page', slides: false });

    expect(calls.hideSlideNotice).toHaveBeenCalledOnce();
    expect(calls.setSlidesBusy).toHaveBeenCalledWith(false);
    expect(calls.stopSlidesStream).toHaveBeenCalledOnce();
    expect(calls.patchSettings).toHaveBeenCalledWith({ slidesEnabled: false });
    expect(calls.sendGist).toHaveBeenCalledWith({ refresh: true });
    expect(state.slidesEnabled).toBe(false);
    expect(state.inputModeOverride).toBe('page');
  });

  it('retries existing slide streams instead of re-gisting', () => {
    const { calls, runtime } = buildRuntime({
      resolveActiveSlidesRunId: () => 'slides-run-1',
      state: { currentSourceUrl: 'https://example.com/current', slidesEnabled: true },
    });

    runtime.retrySlidesStream();

    expect(calls.hideSlideNotice).toHaveBeenCalledOnce();
    expect(calls.startSlidesStreamForRunId).toHaveBeenCalledWith('slides-run-1');
    expect(calls.startSlidesSummaryStreamForRunId).toHaveBeenCalledWith(
      'slides-run-1',
      'https://example.com/current',
    );
    expect(calls.sendGist).not.toHaveBeenCalled();
  });

  it('refreshes gist when retrying slides without an active run', () => {
    const { calls, runtime } = buildRuntime({ state: { slidesEnabled: true } });

    runtime.retrySlidesStream();

    expect(calls.sendGist).toHaveBeenCalledWith({ refresh: true });
    expect(calls.startSlidesStreamForRunId).not.toHaveBeenCalled();
  });

  it('switches slide text mode through fallback rendering when summary markdown exists', () => {
    const { calls, slidesTextController } = buildRuntime({ state: { hasSummaryMarkdown: true } });

    currentProps?.onSlidesTextModeChange?.('ocr');

    expect(slidesTextController.setTextMode).toHaveBeenCalledWith('ocr');
    expect(calls.renderInlineSlidesFallback).toHaveBeenCalledOnce();
    expect(calls.queueSlidesRender).not.toHaveBeenCalled();
  });

  it('queues slides render when switching text mode without summary markdown', () => {
    const { calls, runtime, renderMarkdownHostEl, renderSlidesHostEl } = buildRuntime({
      state: { hasSummaryMarkdown: false, inputMode: 'video', slidesEnabled: true },
    });

    currentProps?.onSlidesTextModeChange?.('ocr');
    runtime.applySlidesLayout();

    expect(calls.queueSlidesRender).toHaveBeenCalledOnce();
    expect(calls.renderInlineSlidesFallback).not.toHaveBeenCalled();
    expect(renderMarkdownHostEl.classList.remove).toHaveBeenCalledWith('hidden');
    expect(renderSlidesHostEl.dataset.layout).toBe('gallery');
  });
});
