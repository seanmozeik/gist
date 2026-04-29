import type { SseSlidesData } from '../../lib/runtime-contracts';
import { hasResolvedSlidesPayload } from './slides-pending';

type SlidesPayload = NonNullable<SseSlidesData>;

export function mergeSlidesPayload(prev: SlidesPayload, next: SlidesPayload): SlidesPayload {
  if (prev.sourceId !== next.sourceId) {return next;}
  const mergedByIndex = new Map<number, SlidesPayload['slides'][number]>();
  for (const slide of prev.slides) {mergedByIndex.set(slide.index, slide);}
  for (const slide of next.slides) {
    const existing = mergedByIndex.get(slide.index);
    mergedByIndex.set(slide.index, existing ? { ...existing, ...slide } : slide);
  }
  const mergedSlides = [...mergedByIndex.values()].toSorted((a, b) => a.index - b.index);
  return { ...prev, ...next, slides: mergedSlides };
}

export function slidesPayloadChanged(prev: SlidesPayload | null, next: SlidesPayload): boolean {
  if (!prev) {return true;}
  if (prev.sourceId !== next.sourceId) {return true;}
  if (prev.slides.length !== next.slides.length) {return true;}
  for (let i = 0; i < next.slides.length; i += 1) {
    const current = next.slides[i];
    const prior = prev.slides[i];
    if (!prior || current.index !== prior.index) {return true;}
    if (current.timestamp !== prior.timestamp) {return true;}
    if (current.imageUrl !== prior.imageUrl) {return true;}
    if ((current.ocrText ?? null) !== (prior.ocrText ?? null)) {return true;}
    if ((current.ocrConfidence ?? null) !== (prior.ocrConfidence ?? null)) {return true;}
  }
  if (next.ocrAvailable !== prev.ocrAvailable) {return true;}
  return false;
}

function shouldReplaceSlidesPayload(
  prev: SlidesPayload | null,
  next: SlidesPayload,
  opts: {
    seededSourceId?: string | null;
    activeSlidesRunId?: string | null;
    appliedSlidesRunId?: string | null;
  },
): boolean {
  if (!prev) {return true;}
  if (prev.sourceId !== next.sourceId) {return true;}
  if (opts.seededSourceId === next.sourceId) {return true;}
  if (opts.activeSlidesRunId && opts.appliedSlidesRunId !== opts.activeSlidesRunId) {return true;}

  const prevResolved = hasResolvedSlidesPayload(prev, opts.seededSourceId);
  const nextResolved = hasResolvedSlidesPayload(next, opts.seededSourceId);

  // The daemon emits full slide payload snapshots. Once we have a real image-bearing
  // Payload, treat it as authoritative so stale seeded placeholders cannot linger.
  if (nextResolved) {return true;}
  if (!prevResolved) {return true;}

  return false;
}

export function resolveSlidesPayload(
  prev: SlidesPayload | null,
  next: SlidesPayload,
  opts: {
    seededSourceId?: string | null;
    activeSlidesRunId?: string | null;
    appliedSlidesRunId?: string | null;
  } = {},
): SlidesPayload {
  if (shouldReplaceSlidesPayload(prev, next, opts)) {return next;}
  return mergeSlidesPayload(prev, next);
}
