import { describe, expect, it, vi } from 'vitest';

import { createUrlProgressStatus } from '../src/run/flows/url/progress-status.js';

describe('url progress status', () => {
  it('keeps slide progress visible while summary updates happen', () => {
    const setText = vi.fn();
    const refresh = vi.fn();
    const oscProgress = { clear: vi.fn(), setIndeterminate: vi.fn(), setPercent: vi.fn() };
    const status = createUrlProgressStatus({
      enabled: true,
      oscProgress,
      spinner: { refresh, setText },
    });

    status.setSummary('Gisting…', 'Gisting');
    status.setSlides('Slides: detecting scenes 35%', 35);
    status.setSummary('Gisting (model: openai/gpt-5.4)…', 'Gisting');

    expect(setText.mock.calls.map((call) => call[0])).toEqual([
      'Gisting…',
      'Slides: detecting scenes 35%',
    ]);
    expect(oscProgress.setPercent).toHaveBeenLastCalledWith('Slides', 35);
    expect(refresh).toHaveBeenCalled();
  });

  it('restores the latest summary line after slides finish', () => {
    const setText = vi.fn();
    const oscProgress = { clear: vi.fn(), setIndeterminate: vi.fn(), setPercent: vi.fn() };
    const status = createUrlProgressStatus({ enabled: true, oscProgress, spinner: { setText } });

    status.setSummary('Gisting…', 'Gisting');
    status.setSlides('Slides: detecting scenes 35%', 35);
    status.setSummary('Gisting (model: openai/gpt-5.4)…', 'Gisting');
    status.clearSlides();

    expect(setText.mock.calls.at(-1)?.[0]).toBe('Gisting (model: openai/gpt-5.4)…');
    expect(oscProgress.setIndeterminate).toHaveBeenLastCalledWith('Gisting');
  });

  it('throttles rapid slide text repaint while still updating OSC progress', () => {
    const setText = vi.fn();
    const oscProgress = { clear: vi.fn(), setIndeterminate: vi.fn(), setPercent: vi.fn() };
    let nowMs = 0;
    const status = createUrlProgressStatus({
      enabled: true,
      now: () => nowMs,
      oscProgress,
      spinner: { setText },
    });

    status.setSlides('Slides: downloading 10%', 10);
    nowMs = 50;
    status.setSlides('Slides: downloading 11%', 11);
    nowMs = 150;
    status.setSlides('Slides: downloading 12%', 12);

    expect(setText.mock.calls.map((call) => call[0])).toEqual([
      'Slides: downloading 10%',
      'Slides: downloading 12%',
    ]);
    expect(oscProgress.setPercent).toHaveBeenNthCalledWith(1, 'Slides', 10);
    expect(oscProgress.setPercent).toHaveBeenNthCalledWith(2, 'Slides', 11);
    expect(oscProgress.setPercent).toHaveBeenNthCalledWith(3, 'Slides', 12);
  });
});
