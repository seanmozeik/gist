import { describe, expect, it } from 'vitest';

import {
  resolveSlidesRenderLayout,
  shouldHideSummaryForSlides,
} from '../apps/chrome-extension/src/entrypoints/sidepanel/slides-view-policy.js';

describe('sidepanel slides view policy', () => {
  it('forces gallery layout in video slides mode', () => {
    expect(
      resolveSlidesRenderLayout({
        inputMode: 'video',
        preferredLayout: 'strip',
        slidesEnabled: true,
      }),
    ).toBe('gallery');
  });

  it('keeps the preferred layout outside slide mode', () => {
    expect(
      resolveSlidesRenderLayout({
        inputMode: 'page',
        preferredLayout: 'strip',
        slidesEnabled: false,
      }),
    ).toBe('strip');
  });

  it('hides the big summary block once slides are present', () => {
    expect(
      shouldHideSummaryForSlides({ hasSlides: true, inputMode: 'video', slidesEnabled: true }),
    ).toBe(true);
    expect(
      shouldHideSummaryForSlides({ hasSlides: false, inputMode: 'video', slidesEnabled: true }),
    ).toBe(false);
  });
});
