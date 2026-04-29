import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createSlidesSummaryController } from '../apps/chrome-extension/src/entrypoints/sidepanel/slides-summary-controller';
import type { StreamControllerOptions } from '../apps/chrome-extension/src/entrypoints/sidepanel/stream-controller';
import type { PanelState, UiState } from '../apps/chrome-extension/src/entrypoints/sidepanel/types';

let streamOptions: StreamControllerOptions | null = null;
let streamOptionsList: StreamControllerOptions[] = [];
let streamStartSpy: ReturnType<typeof vi.fn> | null = null;
let streamAbortSpy: ReturnType<typeof vi.fn> | null = null;
let streamAbortSpies: ReturnType<typeof vi.fn>[] = [];

vi.mock('../apps/chrome-extension/src/entrypoints/sidepanel/stream-controller', () => ({
  createStreamController: (options: StreamControllerOptions) => {
    streamOptions = options;
    streamOptionsList.push(options);
    streamStartSpy = vi.fn(async () => {
      /* empty */
    });
    streamAbortSpy = vi.fn();
    streamAbortSpies.push(streamAbortSpy);
    return { abort: streamAbortSpy, isStreaming: vi.fn(() => false), start: streamStartSpy };
  },
}));

function buildUiState(): UiState {
  return {
    daemon: { authed: true, ok: true },
    media: { hasAudio: true, hasCaptions: true, hasVideo: true },
    panelOpen: true,
    settings: {
      autoSummarize: false,
      automationEnabled: false,
      chatEnabled: true,
      hoverSummaries: false,
      length: 'medium',
      model: 'auto',
      slidesEnabled: true,
      slidesLayout: 'gallery',
      slidesOcrEnabled: true,
      slidesParallel: true,
      tokenPresent: true,
    },
    stats: { pageWords: null, videoDurationSeconds: 120 },
    status: '',
    tab: { id: 1, title: 'Video', url: 'https://example.com/video' },
  };
}

function buildPanelState(): PanelState {
  return {
    chatStreaming: false,
    currentSource: { title: 'Video', url: 'https://example.com/video' },
    error: null,
    lastMeta: { inputSummary: null, model: 'auto', modelLabel: 'auto' },
    phase: 'idle',
    runId: null,
    slides: null,
    slidesRunId: null,
    summaryFromCache: null,
    summaryMarkdown: null,
    ui: buildUiState(),
  };
}

describe('slides summary controller', () => {
  beforeEach(() => {
    streamOptions = null;
    streamOptionsList = [];
    streamStartSpy = null;
    streamAbortSpy = null;
    streamAbortSpies = [];
  });

  it('defers markdown while slides are disabled and applies it later', () => {
    const panelState = buildPanelState();
    let slidesEnabled = false;
    const updateSlideSummaryFromMarkdown = vi.fn();
    const renderMarkdown = vi.fn();
    const clearSummarySource = vi.fn();

    const controller = createSlidesSummaryController({
      clearSummarySource,
      friendlyFetchError: (_error, fallback) => fallback,
      getActiveTabUrl: () => panelState.currentSource?.url ?? null,
      getInputMode: () => 'video',
      getInputModeOverride: () => 'video',
      getLengthValue: () => 'medium',
      getPanelState: () => panelState,
      getSlidesEnabled: () => slidesEnabled,
      getToken: async () => 'token',
      getTranscriptTimedText: () => null,
      getUiState: () => panelState.ui,
      panelUrlsMatch: (left, right) => left === right,
      renderInlineSlidesFallback: vi.fn(),
      renderMarkdown,
      updateSlideSummaryFromMarkdown,
    });

    controller.applyMarkdown('Slide summary');
    expect(updateSlideSummaryFromMarkdown).not.toHaveBeenCalled();

    slidesEnabled = true;
    controller.maybeApplyPending();

    expect(updateSlideSummaryFromMarkdown).toHaveBeenCalledWith('Slide summary', {
      preserveIfEmpty: false,
      source: 'slides',
    });
    expect(renderMarkdown).toHaveBeenCalledWith('Slide summary');
    expect(clearSummarySource).not.toHaveBeenCalled();
  });

  it('defers markdown while the panel is in page mode', () => {
    const panelState = buildPanelState();
    const updateSlideSummaryFromMarkdown = vi.fn();
    const renderMarkdown = vi.fn();
    let inputModeOverride: 'page' | 'video' | null = 'page';

    const controller = createSlidesSummaryController({
      clearSummarySource: vi.fn(),
      friendlyFetchError: (_error, fallback) => fallback,
      getActiveTabUrl: () => panelState.currentSource?.url ?? null,
      getInputMode: () => 'video',
      getInputModeOverride: () => inputModeOverride,
      getLengthValue: () => 'medium',
      getPanelState: () => panelState,
      getSlidesEnabled: () => true,
      getToken: async () => 'token',
      getTranscriptTimedText: () => null,
      getUiState: () => panelState.ui,
      panelUrlsMatch: (left, right) => left === right,
      renderInlineSlidesFallback: vi.fn(),
      renderMarkdown,
      updateSlideSummaryFromMarkdown,
    });

    controller.applyMarkdown('Pending summary');
    expect(updateSlideSummaryFromMarkdown).not.toHaveBeenCalled();

    inputModeOverride = 'video';
    controller.maybeApplyPending();

    expect(updateSlideSummaryFromMarkdown).toHaveBeenCalledTimes(1);
    expect(renderMarkdown).toHaveBeenCalledTimes(1);
  });

  it('does not render markdown when a primary summary already exists', () => {
    const panelState = buildPanelState();
    panelState.summaryMarkdown = 'Primary summary';
    const updateSlideSummaryFromMarkdown = vi.fn();
    const renderMarkdown = vi.fn();

    const controller = createSlidesSummaryController({
      clearSummarySource: vi.fn(),
      friendlyFetchError: (_error, fallback) => fallback,
      getActiveTabUrl: () => panelState.currentSource?.url ?? null,
      getInputMode: () => 'video',
      getInputModeOverride: () => 'video',
      getLengthValue: () => 'medium',
      getPanelState: () => panelState,
      getSlidesEnabled: () => true,
      getToken: async () => 'token',
      getTranscriptTimedText: () => null,
      getUiState: () => panelState.ui,
      panelUrlsMatch: (left, right) => left === right,
      renderInlineSlidesFallback: vi.fn(),
      renderMarkdown,
      updateSlideSummaryFromMarkdown,
    });

    controller.applyMarkdown('Slides-only summary');

    expect(updateSlideSummaryFromMarkdown).toHaveBeenCalledOnce();
    expect(renderMarkdown).not.toHaveBeenCalled();
  });

  it('ignores stale markdown for a different url and clears summary source on stop', () => {
    const panelState = buildPanelState();
    const updateSlideSummaryFromMarkdown = vi.fn();
    const renderMarkdown = vi.fn();
    const clearSummarySource = vi.fn();

    const controller = createSlidesSummaryController({
      clearSummarySource,
      friendlyFetchError: (_error, fallback) => fallback,
      getActiveTabUrl: () => panelState.currentSource?.url ?? null,
      getInputMode: () => 'video',
      getInputModeOverride: () => 'video',
      getLengthValue: () => 'medium',
      getPanelState: () => panelState,
      getSlidesEnabled: () => true,
      getToken: async () => 'token',
      getTranscriptTimedText: () => null,
      getUiState: () => panelState.ui,
      panelUrlsMatch: (left, right) => left === right,
      renderInlineSlidesFallback: vi.fn(),
      renderMarkdown,
      updateSlideSummaryFromMarkdown,
    });

    controller.setUrl('https://example.com/other');
    controller.applyMarkdown('Stale summary');
    expect(updateSlideSummaryFromMarkdown).not.toHaveBeenCalled();

    controller.setRunId('slides-run');
    controller.setSnapshot({ complete: true, markdown: 'Persisted', model: 'test-model' });
    expect(controller.getSnapshot()).toEqual({
      complete: true,
      markdown: 'Persisted',
      model: 'test-model',
      runId: 'slides-run',
    });

    controller.stop();
    expect(clearSummarySource).toHaveBeenCalledOnce();
    expect(controller.getSnapshot()).toEqual({
      complete: false,
      markdown: '',
      model: null,
      runId: null,
    });
  });

  it('handles stream lifecycle callbacks for render, meta, error, reset, and done', () => {
    const panelState = buildPanelState();
    panelState.summaryMarkdown = 'Primary summary';
    panelState.slides = {
      ocrAvailable: true,
      slides: [{ imageUrl: '', index: 1, ocrText: 'Hello world from slide one.', timestamp: 12 }],
      sourceId: 'slides-1',
      sourceKind: 'youtube',
      sourceUrl: panelState.currentSource?.url ?? '',
    };
    const updateSlideSummaryFromMarkdown = vi.fn();
    const renderMarkdown = vi.fn();
    const renderInlineSlidesFallback = vi.fn();

    const controller = createSlidesSummaryController({
      clearSummarySource: vi.fn(),
      friendlyFetchError: (_error, fallback) => fallback,
      getActiveTabUrl: () => panelState.currentSource?.url ?? null,
      getInputMode: () => 'video',
      getInputModeOverride: () => 'video',
      getLengthValue: () => 'medium',
      getPanelState: () => panelState,
      getSlidesEnabled: () => true,
      getToken: async () => 'token',
      getTranscriptTimedText: () => '[0:12] Transcript fallback text.',
      getUiState: () => panelState.ui,
      panelUrlsMatch: (left, right) => left === right,
      renderInlineSlidesFallback,
      renderMarkdown,
      updateSlideSummaryFromMarkdown,
    });

    expect(streamOptions).not.toBeNull();
    streamOptions?.onMeta({ model: 'gpt-test' });
    expect(controller.getModel()).toBe('gpt-test');

    streamOptions?.onRender?.('Rendered summary');
    expect(controller.getMarkdown()).toBe('Rendered summary');
    expect(updateSlideSummaryFromMarkdown).toHaveBeenCalledWith('Rendered summary', {
      preserveIfEmpty: true,
      source: 'slides',
    });
    expect(renderInlineSlidesFallback).toHaveBeenCalledOnce();

    const message = streamOptions?.onError?.(new Error('boom'));
    expect(message).toBe('Slides summary failed');

    streamOptions?.onDone?.();
    expect(controller.getComplete()).toBe(false);

    streamOptions?.onReset?.();
    expect(controller.getSnapshot()).toEqual({
      complete: false,
      markdown: '',
      model: 'auto',
      runId: null,
    });

    streamOptions?.onRender?.('Final summary');
    panelState.phase = 'streaming';
    streamOptions?.onDone?.();
    expect(controller.getComplete()).toBe(true);

    panelState.phase = 'idle';
    controller.maybeApplyPending();
    expect(updateSlideSummaryFromMarkdown).toHaveBeenLastCalledWith(expect.any(String), {
      preserveIfEmpty: false,
      source: 'slides',
    });
    expect(renderMarkdown).not.toHaveBeenCalled();
  });

  it('ignores stale callbacks after switching to a newer slides summary run', async () => {
    const panelState = buildPanelState();
    const updateSlideSummaryFromMarkdown = vi.fn();
    const renderMarkdown = vi.fn();

    const controller = createSlidesSummaryController({
      clearSummarySource: vi.fn(),
      friendlyFetchError: (_error, fallback) => fallback,
      getActiveTabUrl: () => panelState.currentSource?.url ?? null,
      getInputMode: () => 'video',
      getInputModeOverride: () => 'video',
      getLengthValue: () => 'medium',
      getPanelState: () => panelState,
      getSlidesEnabled: () => true,
      getToken: async () => 'token',
      getTranscriptTimedText: () => null,
      getUiState: () => panelState.ui,
      panelUrlsMatch: (left, right) => left === right,
      renderInlineSlidesFallback: vi.fn(),
      renderMarkdown,
      updateSlideSummaryFromMarkdown,
    });

    await controller.start({ runId: 'slides-a', url: 'https://example.com/alpha' });
    const alphaStream = streamOptionsList.at(-1);
    expect(alphaStream).toBeTruthy();

    panelState.currentSource = { title: 'Bravo', url: 'https://example.com/bravo' };
    await controller.start({ runId: 'slides-b', url: 'https://example.com/bravo' });
    const bravoStream = streamOptionsList.at(-1);
    expect(bravoStream).toBeTruthy();
    expect(bravoStream).not.toBe(alphaStream);

    alphaStream?.onRender?.('Alpha stale summary');
    alphaStream?.onDone?.();
    expect(updateSlideSummaryFromMarkdown).not.toHaveBeenCalledWith('Alpha stale summary', {
      preserveIfEmpty: true,
      source: 'slides',
    });

    bravoStream?.onRender?.('Bravo fresh summary');
    bravoStream?.onDone?.();

    expect(updateSlideSummaryFromMarkdown).toHaveBeenCalledWith('Bravo fresh summary', {
      preserveIfEmpty: true,
      source: 'slides',
    });
    expect(updateSlideSummaryFromMarkdown).toHaveBeenLastCalledWith('Bravo fresh summary', {
      preserveIfEmpty: false,
      source: 'slides',
    });
    expect(controller.getMarkdown()).toBe('Bravo fresh summary');
    expect(controller.getComplete()).toBe(true);
  });

  it('covers empty, pending, and reset branches', async () => {
    const panelState = buildPanelState();
    panelState.lastMeta.model = null;
    panelState.ui.settings.model = 'ui-model';
    let slidesEnabled = false;
    const activeTabUrl: string | null = null;
    const updateSlideSummaryFromMarkdown = vi.fn();
    const renderMarkdown = vi.fn();

    const controller = createSlidesSummaryController({
      clearSummarySource: vi.fn(),
      friendlyFetchError: (_error, fallback) => fallback,
      getActiveTabUrl: () => activeTabUrl,
      getInputMode: () => 'video',
      getInputModeOverride: () => null,
      getLengthValue: () => 'short',
      getPanelState: () => panelState,
      getSlidesEnabled: () => slidesEnabled,
      getToken: async () => 'token',
      getTranscriptTimedText: () => null,
      getUiState: () => panelState.ui,
      panelUrlsMatch: (left, right) => left === right,
      renderInlineSlidesFallback: vi.fn(),
      renderMarkdown,
      updateSlideSummaryFromMarkdown,
    });

    controller.applyMarkdown('   ');
    expect(updateSlideSummaryFromMarkdown).not.toHaveBeenCalled();

    await controller.start({ runId: 'run-1', url: 'https://example.com/video' });
    expect(streamStartSpy).toHaveBeenCalledWith({
      runId: 'run-1',
      url: 'https://example.com/video',
    });

    controller.applyMarkdown('Pending summary');
    controller.clearPending();
    slidesEnabled = true;
    controller.maybeApplyPending();
    expect(updateSlideSummaryFromMarkdown).not.toHaveBeenCalled();

    streamOptions?.onMeta({});
    expect(controller.getModel()).toBeNull();

    streamOptions?.onRender?.('');
    streamOptions?.onDone?.();
    expect(controller.getComplete()).toBe(true);
    expect(updateSlideSummaryFromMarkdown).toHaveBeenCalledWith('', {
      preserveIfEmpty: true,
      source: 'slides',
    });

    streamOptions?.onError?.(new Error('boom'));
    controller.clearError();
    streamOptions?.onReset?.();
    expect(controller.getModel()).toBe('ui-model');

    controller.setModel('override-model');
    controller.resetSummaryState();
    expect(controller.getSnapshot()).toEqual({
      complete: false,
      markdown: '',
      model: 'override-model',
      runId: null,
    });

    controller.stop();
    expect(streamAbortSpies.some((spy) => spy.mock.calls.length === 1)).toBe(true);
  });
});
