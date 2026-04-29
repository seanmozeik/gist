import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveSlideSettings } from '../src/slides/settings.js';
import {
  buildSlidesDirId,
  readSlidesCacheIfValid,
  resolveSlideImagePath,
  resolveSlidesDir,
  serializeSlideImagePath,
  validateSlidesCache,
} from '../src/slides/store.js';
import type { SlideExtractionResult } from '../src/slides/types.js';

describe('slides store', () => {
  it('serializes relative paths and resolves cached slides', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'summarize-slides-store-'));
    const settings = resolveSlideSettings({ cwd: root, slides: true });
    expect(settings).not.toBeNull();
    if (!settings) {return;}

    const source = {
      kind: 'direct' as const,
      sourceId: 'video-abc',
      url: 'https://example.com/video.mp4',
    };
    const slidesDir = resolveSlidesDir(settings.outputDir, source.sourceId);
    await fs.mkdir(slidesDir, { recursive: true });
    const imagePath = path.join(slidesDir, 'slide_0001.png');
    await fs.writeFile(imagePath, 'fake');

    const payload: SlideExtractionResult = {
      autoTune: {
        chosenThreshold: settings.sceneThreshold,
        confidence: 0,
        enabled: false,
        strategy: 'none',
      },
      autoTuneThreshold: settings.autoTuneThreshold,
      maxSlides: settings.maxSlides,
      minSlideDuration: settings.minDurationSeconds,
      ocrAvailable: false,
      ocrRequested: settings.ocr,
      sceneThreshold: settings.sceneThreshold,
      slides: [
        { index: 1, timestamp: 12.3, imagePath: serializeSlideImagePath(slidesDir, imagePath) },
      ],
      slidesDir,
      slidesDirId: buildSlidesDirId(slidesDir),
      sourceId: source.sourceId,
      sourceKind: source.kind,
      sourceUrl: source.url,
      warnings: [],
    };

    await fs.writeFile(
      path.join(slidesDir, 'slides.json'),
      JSON.stringify(payload, null, 2),
      'utf8',
    );
    const cached = await readSlidesCacheIfValid({ settings, source });
    expect(cached?.slides[0]?.imagePath).toBe(imagePath);
    expect(cached?.slidesDirId).toBe(buildSlidesDirId(slidesDir));
  });

  it('rejects cache outside expected output dir', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'summarize-slides-store-'));
    const settings = resolveSlideSettings({ cwd: root, slides: true });
    expect(settings).not.toBeNull();
    if (!settings) {return;}

    const source = {
      kind: 'direct' as const,
      sourceId: 'video-xyz',
      url: 'https://example.com/video.mp4',
    };

    const otherDir = await fs.mkdtemp(path.join(os.tmpdir(), 'summarize-slides-other-'));
    const imagePath = path.join(otherDir, 'slide_0001.png');
    await fs.writeFile(imagePath, 'fake');

    const cached: SlideExtractionResult = {
      autoTune: {
        chosenThreshold: settings.sceneThreshold,
        confidence: 0,
        enabled: false,
        strategy: 'none',
      },
      autoTuneThreshold: settings.autoTuneThreshold,
      maxSlides: settings.maxSlides,
      minSlideDuration: settings.minDurationSeconds,
      ocrAvailable: false,
      ocrRequested: settings.ocr,
      sceneThreshold: settings.sceneThreshold,
      slides: [{ index: 1, timestamp: 1.2, imagePath }],
      slidesDir: otherDir,
      slidesDirId: buildSlidesDirId(otherDir),
      sourceId: source.sourceId,
      sourceKind: source.kind,
      sourceUrl: source.url,
      warnings: [],
    };

    const validated = await validateSlidesCache({ cached, settings, source });
    expect(validated).toBeNull();
  });

  it('rejects image paths outside slides dir', () => {
    const slidesDir = '/tmp/summarize-slides';
    const resolved = resolveSlideImagePath(slidesDir, '../escape.png');
    expect(resolved).toBeNull();
  });
});
