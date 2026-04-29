import { promises as fs } from 'node:fs';
import path from 'node:path';

import { buildSlidesDirId, serializeSlideImagePath } from './store.js';
import type {
  SlideAutoTune,
  SlideExtractionResult,
  SlideImage,
  SlideSource,
  SlideSourceKind,
} from './types.js';

export const SLIDES_PROGRESS = {
  DETECT_SCENES: 60,
  DOWNLOAD_VIDEO: 35,
  EXTRACT_FRAMES: 90,
  FETCH_VIDEO: 6,
  FINAL: 100,
  OCR: 99,
  PREPARE: 2,
} as const;

export interface SlidesChunkMeta {
  slidesDir: string;
  sourceUrl: string;
  sourceId: string;
  sourceKind: SlideSourceKind;
  ocrAvailable: boolean;
}

export function buildSlidesChunkMeta(args: {
  slidesDir: string;
  source: SlideSource;
  ocrAvailable: boolean;
}): SlidesChunkMeta {
  return {
    ocrAvailable: args.ocrAvailable,
    slidesDir: args.slidesDir,
    sourceId: args.source.sourceId,
    sourceKind: args.source.kind,
    sourceUrl: args.source.url,
  };
}

export function buildSlideTimeline(args: {
  source: SlideSource;
  slidesDir: string;
  sceneThreshold: number;
  autoTuneThreshold: boolean;
  autoTune: SlideAutoTune;
  maxSlides: number;
  minSlideDuration: number;
  ocrRequested: boolean;
  ocrAvailable: boolean;
  warnings: string[];
  slides: (SlideImage & { segment?: unknown })[];
}): SlideExtractionResult {
  return {
    autoTune: args.autoTune,
    autoTuneThreshold: args.autoTuneThreshold,
    maxSlides: args.maxSlides,
    minSlideDuration: args.minSlideDuration,
    ocrAvailable: args.ocrAvailable,
    ocrRequested: args.ocrRequested,
    sceneThreshold: args.sceneThreshold,
    slides: args.slides.map(({ segment: _segment, ...slide }) => slide),
    slidesDir: args.slidesDir,
    slidesDirId: buildSlidesDirId(args.slidesDir),
    sourceId: args.source.sourceId,
    sourceKind: args.source.kind,
    sourceUrl: args.source.url,
    warnings: args.warnings,
  };
}

export function emitPlaceholderSlides(args: {
  slides: (SlideImage & { segment?: unknown })[];
  meta: SlidesChunkMeta;
  onSlideChunk?: ((value: { slide: SlideImage; meta: SlidesChunkMeta }) => void) | null;
}) {
  if (!args.onSlideChunk) {return;}
  for (const slide of args.slides) {
    const { segment: _segment, ...payload } = slide;
    args.onSlideChunk({ meta: args.meta, slide: { ...payload, imagePath: '' } });
  }
}

export function emitFinalSlides(args: {
  slides: SlideImage[];
  meta: SlidesChunkMeta;
  onSlideChunk?: ((value: { slide: SlideImage; meta: SlidesChunkMeta }) => void) | null;
}) {
  if (!args.onSlideChunk) {return;}
  for (const slide of args.slides) {
    args.onSlideChunk({ meta: args.meta, slide });
  }
}

export async function renameSlidesWithTimestamps(
  slides: SlideImage[],
  slidesDir: string,
): Promise<SlideImage[]> {
  const renamed: SlideImage[] = [];
  for (const slide of slides) {
    const timestampLabel = slide.timestamp.toFixed(2);
    const filename = `slide_${slide.index.toString().padStart(4, '0')}_${timestampLabel}s.png`;
    const nextPath = path.join(slidesDir, filename);
    if (slide.imagePath !== nextPath) {
      await fs.rename(slide.imagePath, nextPath).catch(async () => {
        await fs.copyFile(slide.imagePath, nextPath);
        await fs.rm(slide.imagePath, { force: true });
      });
    }
    renamed.push({ ...slide, imagePath: nextPath });
  }
  return renamed;
}

export async function writeSlidesJson(
  result: SlideExtractionResult,
  slidesDir: string,
): Promise<void> {
  const slidesDirId = result.slidesDirId ?? buildSlidesDirId(slidesDir);
  const payload = {
    autoTune: result.autoTune,
    autoTuneThreshold: result.autoTuneThreshold,
    maxSlides: result.maxSlides,
    minSlideDuration: result.minSlideDuration,
    ocrAvailable: result.ocrAvailable,
    ocrRequested: result.ocrRequested,
    sceneThreshold: result.sceneThreshold,
    slideCount: result.slides.length,
    slides: result.slides.map((slide) => ({
      ...slide,
      imagePath: serializeSlideImagePath(slidesDir, slide.imagePath),
    })),
    slidesDir,
    slidesDirId,
    sourceId: result.sourceId,
    sourceKind: result.sourceKind,
    sourceUrl: result.sourceUrl,
    warnings: result.warnings,
  };
  await fs.writeFile(path.join(slidesDir, 'slides.json'), JSON.stringify(payload, null, 2), 'utf8');
}
