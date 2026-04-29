import { describe, expect, it } from 'vitest';

import { encodeSseEvent, parseSseEvent, type SseEvent } from '../src/shared/sse-events.js';

describe('sse events', () => {
  it('encodes and parses known events', () => {
    const events: SseEvent[] = [
      {
        data: {
          inputSummary: 'Example',
          model: 'openai/gpt-5.2',
          modelLabel: 'gpt-5.2',
          summaryFromCache: false,
        },
        event: 'meta',
      },
      { data: { text: 'Working…' }, event: 'status' },
      { data: { text: 'Hello' }, event: 'chunk' },
      {
        data: {
          ocrAvailable: true,
          slides: [
            {
              index: 0,
              timestamp: 12,
              imageUrl: 'https://example.com/slide-1.jpg',
              ocrText: 'Intro',
              ocrConfidence: 0.99,
            },
          ],
          sourceId: 'video-1',
          sourceKind: 'video',
          sourceUrl: 'https://example.com/video',
        },
        event: 'slides',
      },
      {
        data: {
          api: 'openai-completions',
          content: [{ type: 'text', text: 'Hi' }],
          model: 'gpt-5.2',
          provider: 'openai',
          role: 'assistant',
          stopReason: 'stop',
          timestamp: 1,
          usage: {
            cacheRead: 0,
            cacheWrite: 0,
            cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
            input: 1,
            output: 1,
            totalTokens: 2,
          },
        },
        event: 'assistant',
      },
      {
        data: {
          details: null,
          detailsDetailed: null,
          elapsedMs: 1200,
          summary: '7.5s · example.com',
          summaryDetailed: '7.5s · example.com · ↑1.2k ↓300',
        },
        event: 'metrics',
      },
      { data: {}, event: 'done' },
      { data: { message: 'Boom' }, event: 'error' },
    ];

    for (const event of events) {
      const encoded = encodeSseEvent(event);
      expect(encoded).toBe(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`);

      const parsed = parseSseEvent({ data: JSON.stringify(event.data), event: event.event });
      expect(parsed).toEqual(event);
    }
  });

  it('ignores unknown events', () => {
    expect(parseSseEvent({ data: '{}', event: 'unknown' })).toBeNull();
  });
});
