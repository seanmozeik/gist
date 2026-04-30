import { describe, expect, it } from 'vitest';

import { resolveSlideSettings } from '../src/slides/index';

describe('resolveSlideSettings', () => {
  it('returns null when slides are disabled', () => {
    const settings = resolveSlideSettings({ cwd: '/tmp' });
    expect(settings).toBeNull();
  });

  it('defaults when slides are enabled', () => {
    const settings = resolveSlideSettings({ cwd: '/tmp', slides: true });
    expect(settings).not.toBeNull();
    expect(settings?.outputDir).toBe('/tmp/slides');
    expect(settings?.sceneThreshold).toBe(0.3);
    expect(settings?.autoTuneThreshold).toBe(true);
    expect(settings?.maxSlides).toBe(6);
    expect(settings?.minDurationSeconds).toBe(2);
  });

  it('enables OCR when slidesOcr is set', () => {
    const settings = resolveSlideSettings({ cwd: '/tmp', slidesOcr: true });
    expect(settings?.ocr).toBe(true);
  });

  it('parses string flags and custom values', () => {
    const settings = resolveSlideSettings({
      cwd: '/tmp',
      slides: 'yes',
      slidesDir: 'captures',
      slidesMax: '8',
      slidesMinDuration: '5',
      slidesOcr: 'off',
      slidesSceneThreshold: '0.45',
    });
    expect(settings).toEqual({
      autoTuneThreshold: true,
      enabled: true,
      maxSlides: 8,
      minDurationSeconds: 5,
      ocr: false,
      outputDir: '/tmp/captures',
      sceneThreshold: 0.45,
    });
  });

  it('rejects invalid scene threshold', () => {
    expect(() =>
      resolveSlideSettings({ cwd: '/tmp', slides: true, slidesSceneThreshold: '2' }),
    ).toThrow(/slides-scene-threshold/i);
  });

  it('rejects invalid max slides and min duration', () => {
    expect(() => resolveSlideSettings({ cwd: '/tmp', slides: true, slidesMax: '0' })).toThrow(
      /slides-max/i,
    );
    expect(() =>
      resolveSlideSettings({ cwd: '/tmp', slides: true, slidesMinDuration: '-1' }),
    ).toThrow(/slides-min-duration/i);
  });
});
