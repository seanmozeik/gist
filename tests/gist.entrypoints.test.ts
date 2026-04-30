import { describe, expect, it } from 'vitest';

import { SUMMARY_LENGTHS as INDEX_LENGTHS } from '../src/index';
import { SUMMARY_LENGTHS as CONTRACT_LENGTHS } from '../src/shared/contracts';

describe('gist entrypoints', () => {
  it('exports summary length presets', () => {
    expect(INDEX_LENGTHS).toEqual(['short', 'medium', 'long', 'xl', 'xxl']);
    expect(CONTRACT_LENGTHS).toEqual(['short', 'medium', 'long', 'xl', 'xxl']);
  });
});
