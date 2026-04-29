import { describe, expect, it } from 'vitest';

import {
  mergeSlidesPayload,
  resolveSlidesPayload,
  slidesPayloadChanged,
} from '../apps/chrome-extension/src/entrypoints/sidepanel/slides-payload';
import type { SseSlidesData } from '../src/shared/sse-events';

function buildSlidesPayload({
  sourceId = 'youtube-abc123',
  count,
  withImages,
  textPrefix = 'Slide',
}: {
  sourceId?: string;
  count: number;
  withImages: boolean;
  textPrefix?: string;
}): SseSlidesData {
  return {
    ocrAvailable: true,
    slides: Array.from({ length: count }, (_, index) => {
      const slideIndex = index + 1;
      return {
        index: slideIndex,
        timestamp: index * 10,
        imageUrl: withImages ? `http://127.0.0.1:8787/v1/slides/${sourceId}/${slideIndex}?v=1` : '',
        ocrText: `${textPrefix} ${slideIndex}`,
        ocrConfidence: 0.9,
      };
    }),
    sourceId,
    sourceKind: 'youtube',
    sourceUrl: `https://www.youtube.com/watch?v=${sourceId.replace(/^youtube-/, '')}`,
  };
}

describe('sidepanel slides payload policy', () => {
  it('merges same-source payloads when the previous payload is already resolved and the next one is partial', () => {
    const initial = buildSlidesPayload({ count: 2, textPrefix: 'Initial', withImages: true });
    const partial: SseSlidesData = {
      ...initial,
      slides: [{ imageUrl: '', index: 1, ocrConfidence: 0.8, ocrText: 'Updated 1', timestamp: 0 }],
    };

    const next = resolveSlidesPayload(initial, partial, {
      activeSlidesRunId: 'slides-a',
      appliedSlidesRunId: 'slides-a',
    });

    expect(next.slides).toHaveLength(2);
    expect(next.slides[0]?.ocrText).toBe('Updated 1');
    expect(next.slides[1]?.ocrText).toBe('Initial 2');
  });

  it('replaces unresolved placeholders with a resolved smaller payload for the same source', () => {
    const seeded = buildSlidesPayload({ count: 2, textPrefix: 'Seeded', withImages: false });
    const resolved = buildSlidesPayload({ count: 1, textPrefix: 'Real', withImages: true });

    const next = resolveSlidesPayload(seeded, resolved, {
      activeSlidesRunId: 'slides-a',
      appliedSlidesRunId: 'slides-a',
      seededSourceId: null,
    });

    expect(next.slides).toHaveLength(1);
    expect(next.slides[0]?.ocrText).toBe('Real 1');
    expect(next.slides[0]?.imageUrl).toContain('/1?v=1');
  });

  it('replaces a resolved payload when a rerun for the same source returns fewer slides', () => {
    const initial = buildSlidesPayload({ count: 3, textPrefix: 'First run', withImages: true });
    const rerun = buildSlidesPayload({ count: 1, textPrefix: 'Second run', withImages: true });

    const next = resolveSlidesPayload(initial, rerun, {
      activeSlidesRunId: 'slides-b',
      appliedSlidesRunId: 'slides-b',
    });

    expect(next.slides).toHaveLength(1);
    expect(next.slides[0]?.ocrText).toBe('Second run 1');
  });

  it('marks unchanged authoritative payloads as unchanged', () => {
    const payload = buildSlidesPayload({ count: 1, withImages: true });

    expect(slidesPayloadChanged(payload, payload)).toBe(false);
  });

  it('marks changed payloads when slide metadata changes', () => {
    const payload = buildSlidesPayload({ count: 1, withImages: true });
    const changed: SseSlidesData = {
      ...payload,
      ocrAvailable: false,
      slides: [{ ...payload.slides[0], imageUrl: `${payload.slides[0]?.imageUrl}&v=2` }],
    };

    expect(slidesPayloadChanged(payload, changed)).toBe(true);
  });

  it('replaces when the seeded source marker still matches', () => {
    const seeded = buildSlidesPayload({ count: 2, textPrefix: 'Seeded', withImages: false });
    const resolved = buildSlidesPayload({ count: 2, textPrefix: 'Resolved', withImages: true });

    const next = resolveSlidesPayload(seeded, resolved, {
      activeSlidesRunId: 'slides-a',
      appliedSlidesRunId: 'slides-a',
      seededSourceId: 'youtube-abc123',
    });

    expect(next.slides[0]?.ocrText).toBe('Resolved 1');
    expect(next.slides[1]?.imageUrl).toContain('/2?v=1');
  });

  it('replaces when a different slides run becomes active', () => {
    const initial = buildSlidesPayload({ count: 2, textPrefix: 'Initial', withImages: true });
    const rerun = buildSlidesPayload({ count: 1, textPrefix: 'Rerun', withImages: true });

    const next = resolveSlidesPayload(initial, rerun, {
      activeSlidesRunId: 'slides-b',
      appliedSlidesRunId: 'slides-a',
    });

    expect(next.slides).toHaveLength(1);
    expect(next.slides[0]?.ocrText).toBe('Rerun 1');
  });

  it('merges explicit payloads by slide index', () => {
    const initial = buildSlidesPayload({ count: 2, textPrefix: 'Initial', withImages: true });
    const merged = mergeSlidesPayload(initial, {
      ...initial,
      ocrAvailable: false,
      slides: [
        {
          imageUrl: initial.slides[1]?.imageUrl ?? '',
          index: 2,
          ocrConfidence: 0.5,
          ocrText: 'Merged 2',
          timestamp: 12,
        },
      ],
    });

    expect(merged.ocrAvailable).toBe(false);
    expect(merged.slides).toHaveLength(2);
    expect(merged.slides[1]?.ocrText).toBe('Merged 2');
    expect(merged.slides[1]?.timestamp).toBe(12);
  });
});
