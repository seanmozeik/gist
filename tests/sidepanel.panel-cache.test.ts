import { describe, expect, it, vi } from 'vitest';

import {
  createPanelCacheController,
  type PanelCachePayload,
} from '../apps/chrome-extension/src/entrypoints/sidepanel/panel-cache.js';

const samplePayload = (overrides: Partial<PanelCachePayload> = {}): PanelCachePayload => ({
  lastMeta: { inputSummary: 'Summary', model: 'model', modelLabel: 'label' },
  runId: 'run-1',
  slides: null,
  summaryFromCache: true,
  summaryMarkdown: 'Hello',
  tabId: 1,
  title: 'Example',
  transcriptTimedText: null,
  url: 'https://example.com',
  ...overrides,
});

describe('panel cache controller', () => {
  it('stores and resolves snapshots per tab', () => {
    const sendCache = vi.fn();
    const sendRequest = vi.fn();
    const payload = samplePayload();
    const controller = createPanelCacheController({
      getSnapshot: () => payload,
      sendCache,
      sendRequest,
    });

    controller.syncNow();
    expect(sendCache).toHaveBeenCalledWith(payload);
    expect(controller.resolve(1, 'https://example.com')).toEqual(payload);
    expect(controller.resolve(1, 'https://other.example')).toBeNull();
  });

  it('debounces scheduled sync and stores latest snapshot', () => {
    vi.useFakeTimers();
    const sendCache = vi.fn();
    const sendRequest = vi.fn();
    let snapshot = samplePayload({ summaryMarkdown: 'First' });
    const controller = createPanelCacheController({
      getSnapshot: () => snapshot,
      sendCache,
      sendRequest,
    });

    controller.scheduleSync(10);
    snapshot = samplePayload({ summaryMarkdown: 'Second' });
    controller.scheduleSync(10);

    vi.runAllTimers();

    expect(sendCache).toHaveBeenCalledTimes(1);
    expect(sendCache).toHaveBeenCalledWith(snapshot);
    expect(controller.resolve(1, 'https://example.com')?.summaryMarkdown).toBe('Second');
    vi.useRealTimers();
  });

  it('stores scheduled snapshots before the async sync fires', () => {
    vi.useFakeTimers();
    const sendCache = vi.fn();
    const sendRequest = vi.fn();
    const payload = samplePayload({
      slides: {
        ocrAvailable: false,
        slides: [
          { index: 1, timestamp: 0, imageUrl: '' },
          { index: 2, timestamp: 30, imageUrl: '' },
        ],
        sourceId: 'youtube-abc123',
        sourceKind: 'youtube',
        sourceUrl: 'https://example.com',
      },
    });
    const controller = createPanelCacheController({
      getSnapshot: () => payload,
      sendCache,
      sendRequest,
    });

    controller.scheduleSync(0);

    expect(controller.resolve(1, 'https://example.com')).toEqual(payload);
    expect(sendCache).not.toHaveBeenCalled();

    vi.runAllTimers();
    expect(sendCache).toHaveBeenCalledWith(payload);
    vi.useRealTimers();
  });

  it('returns pending request info on cache response', () => {
    const sendCache = vi.fn();
    const sendRequest = vi.fn();
    const payload = samplePayload();
    const controller = createPanelCacheController({
      getSnapshot: () => payload,
      sendCache,
      sendRequest,
    });

    const request = controller.request(2, 'https://example.com/2', true);
    const result = controller.consumeResponse({
      cache: payload,
      ok: true,
      requestId: request.requestId,
    });

    expect(sendRequest).toHaveBeenCalledWith(request);
    expect(result).toEqual({
      cache: payload,
      preserveChat: true,
      tabId: 2,
      url: 'https://example.com/2',
    });
  });

  it('ignores stale cache responses', () => {
    const sendCache = vi.fn();
    const sendRequest = vi.fn();
    const payload = samplePayload();
    const controller = createPanelCacheController({
      getSnapshot: () => payload,
      sendCache,
      sendRequest,
    });

    controller.request(2, 'https://example.com/2', false);
    const result = controller.consumeResponse({
      cache: payload,
      ok: true,
      requestId: 'cache-unknown',
    });

    expect(result).toBeNull();
  });
});
