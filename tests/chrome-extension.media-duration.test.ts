import { describe, expect, it } from 'vitest';

import {
  parseClockDuration,
  parseIsoDuration,
  resolveMediaDurationSecondsFromData,
} from '../apps/chrome-extension/src/lib/media-duration.js';

describe('chrome extension media duration helpers', () => {
  it('parses clock durations', () => {
    expect(parseClockDuration('36:10')).toBe(2170);
    expect(parseClockDuration('1:02:03')).toBe(3723);
  });

  it('parses ISO 8601 durations', () => {
    expect(parseIsoDuration('PT36M10S')).toBe(2170);
    expect(parseIsoDuration('PT1H2M3S')).toBe(3723);
  });

  it('resolves duration with correct precedence', () => {
    expect(
      resolveMediaDurationSecondsFromData({
        metaDuration: 'PT5M',
        uiDuration: '6:00',
        videoDuration: 500,
      }),
    ).toBe(300);

    expect(
      resolveMediaDurationSecondsFromData({
        metaDuration: null,
        uiDuration: '6:00',
        videoDuration: 500,
      }),
    ).toBe(360);

    expect(
      resolveMediaDurationSecondsFromData({
        metaDuration: null,
        uiDuration: null,
        videoDuration: 500.4,
      }),
    ).toBe(500);
  });
});
