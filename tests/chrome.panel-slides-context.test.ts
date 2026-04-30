import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handlePanelSlidesContextRequest } from '../apps/chrome-extension/src/entrypoints/background/panel-slides-context.js';

describe('chrome panel slides context', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('returns an error when there is no active tab url', async () => {
    const send = vi.fn();

    await handlePanelSlidesContextRequest({
      canGistUrl: () => false,
      fetchImpl: vi.fn() as never,
      getActiveTab: vi.fn(async () => null) as never,
      loadSettings: vi.fn(async () => ({ extendedLogging: false, token: '' })) as never,
      panelSessionStore: { getCachedExtract: () => null, setCachedExtract: vi.fn() },
      requestId: 'slides-1',
      requestedUrl: null,
      resolveLogLevel: () => 'verbose',
      send,
      session: { windowId: 1 } as never,
      urlsMatch: () => false,
    });

    expect(send).toHaveBeenCalledWith({
      error: 'No active tab for slides.',
      ok: false,
      requestId: 'slides-1',
      type: 'slides:context',
    });
  });

  it('fetches timed transcript text and stores it in the tab cache', async () => {
    const send = vi.fn();
    const setCachedExtract = vi.fn();
    const fetchImpl = vi.fn(async () => ({
      json: async () => ({ extracted: { transcriptTimedText: '0:01 intro' }, ok: true }),
      ok: true,
      status: 200,
      statusText: 'OK',
    })) as never;

    await handlePanelSlidesContextRequest({
      canGistUrl: () => true,
      fetchImpl,
      getActiveTab: vi.fn(async () => ({
        id: 4,
        title: 'Video',
        url: 'https://example.com/video',
      })) as never,
      loadSettings: vi.fn(async () => ({ extendedLogging: false, token: 'secret' })) as never,
      panelSessionStore: { getCachedExtract: () => null, setCachedExtract },
      requestId: 'slides-2',
      requestedUrl: 'https://example.com/video',
      resolveLogLevel: () => 'verbose',
      send,
      session: { windowId: 7 } as never,
      urlsMatch: () => true,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(setCachedExtract).toHaveBeenCalledWith(
      4,
      expect.objectContaining({
        transcriptTimedText: '0:01 intro',
        url: 'https://example.com/video',
      }),
    );
    expect(send).toHaveBeenCalledWith({
      ok: true,
      requestId: 'slides-2',
      transcriptTimedText: '0:01 intro',
      type: 'slides:context',
    });
  });
});
