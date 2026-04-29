import { describe, expect, it } from 'vitest';

import {
  readPresetOrCustomValue,
  resolvePresetOrCustom,
} from '../apps/chrome-extension/src/lib/combo.js';

describe('chrome/combo', () => {
  it('uses preset when value matches (case-insensitive)', () => {
    expect(resolvePresetOrCustom({ presets: ['xl', 'short'], value: ' XL ' })).toEqual({
      customValue: '',
      isCustom: false,
      presetValue: 'xl',
    });
  });

  it('uses custom when value is not in presets', () => {
    expect(resolvePresetOrCustom({ presets: ['xl', 'short'], value: '20k' })).toEqual({
      customValue: '20k',
      isCustom: true,
      presetValue: 'custom',
    });
  });

  it('reads custom value with fallback to default', () => {
    expect(
      readPresetOrCustomValue({ customValue: '  ', defaultValue: 'xl', presetValue: 'custom' }),
    ).toBe('xl');
    expect(
      readPresetOrCustomValue({ customValue: ' 20k ', defaultValue: 'xl', presetValue: 'custom' }),
    ).toBe('20k');
  });
});
