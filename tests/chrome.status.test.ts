import { describe, expect, it } from 'vitest';

import { splitStatusPercent } from '../apps/chrome-extension/src/lib/status.js';

describe('chrome/status', () => {
  it('splits a trailing percent', () => {
    expect(splitStatusPercent('podcast: transcribing… 12%')).toEqual({
      percent: '12%',
      text: 'podcast: transcribing…',
    });
  });

  it('supports percent in parentheses', () => {
    expect(splitStatusPercent('youtube: downloading audio… (34%)')).toEqual({
      percent: '34%',
      text: 'youtube: downloading audio…',
    });
  });

  it('does not split when percent is the whole string', () => {
    expect(splitStatusPercent('50%')).toEqual({ percent: null, text: '50%' });
  });

  it('ignores invalid percent values', () => {
    expect(splitStatusPercent('transcribing… 120%')).toEqual({
      percent: null,
      text: 'transcribing… 120%',
    });
    expect(splitStatusPercent('transcribing… -1%')).toEqual({
      percent: null,
      text: 'transcribing… -1%',
    });
  });
});
