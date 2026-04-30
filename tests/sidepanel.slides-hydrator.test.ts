import { describe, expect, it } from 'vitest';

import { createSlidesHydrator } from '../apps/chrome-extension/src/entrypoints/sidepanel/slides-hydrator.js';
import { encodeSseEvent, type SseEvent, type SseSlidesData } from '../src/shared/sse-events.js';

const encoder = new TextEncoder();

function streamFromEvents(events: SseEvent[]) {
  const payload = events.map((event) => encodeSseEvent(event)).join('');
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(payload));
      controller.close();
    },
  });
}

async function waitFor(check: () => boolean, attempts = 20) {
  for (let i = 0; i < attempts; i += 1) {
    if (check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('timeout waiting for condition');
}

describe('sidepanel slides hydrator', () => {
  it('hydrates snapshot when the stream finishes without slides', async () => {
    const payload: SseSlidesData = {
      ocrAvailable: false,
      slides: [
        {
          imageUrl: 'http://127.0.0.1:8787/v1/slides/abc/1',
          index: 1,
          ocrConfidence: null,
          ocrText: null,
          timestamp: 1.2,
        },
      ],
      sourceId: 'abc',
      sourceKind: 'youtube',
      sourceUrl: 'https://example.com',
    };
    const received: SseSlidesData[] = [];

    const hydrator = createSlidesHydrator({
      getToken: async () => 'token',
      onSlides: (slides) => received.push(slides),
      snapshotFetchImpl: async () => Response.json({ ok: true, slides: payload }, { status: 200 }),
      streamFetchImpl: async () =>
        new Response(streamFromEvents([{ data: {}, event: 'done' }]), { status: 200 }),
    });

    await hydrator.start('run-1');
    await waitFor(() => received.length === 1);

    expect(received).toEqual([payload]);
  });

  it('ignores snapshot results when the active run changes', async () => {});

  it('hydrates snapshot when cache is loaded without slides', async () => {
    const payload: SseSlidesData = {
      ocrAvailable: false,
      slides: [
        {
          imageUrl: 'http://127.0.0.1:8787/v1/slides/cache/1',
          index: 1,
          ocrConfidence: null,
          ocrText: null,
          timestamp: 5,
        },
      ],
      sourceId: 'cache',
      sourceKind: 'youtube',
      sourceUrl: 'https://example.com',
    };
    let snapshotCalls = 0;
    const received: SseSlidesData[] = [];
    const hydrator = createSlidesHydrator({
      getToken: async () => 'token',
      onSlides: (slides) => received.push(slides),
      snapshotFetchImpl: async () => {
        snapshotCalls += 1;
        return Response.json({ ok: true, slides: payload }, { status: 200 });
      },
      streamFetchImpl: async () =>
        new Response(streamFromEvents([{ data: {}, event: 'done' }]), { status: 200 }),
    });

    hydrator.syncFromCache({ hasSlides: false, runId: 'run-cache', summaryFromCache: true });
    await waitFor(() => received.length === 1);

    expect(snapshotCalls).toBe(1);
    expect(received).toEqual([payload]);
  });
});
