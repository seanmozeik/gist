import { describe, expect, it } from 'vitest';

import { resolveExtractedTimestamp } from '../src/slides/index';

describe('resolveExtractedTimestamp', () => {
  it('falls back to requested when actual is missing', () => {
    expect(resolveExtractedTimestamp({ actual: null, requested: 12.5 })).toBe(12.5);
  });

  it('treats small actual values as offsets', () => {
    expect(resolveExtractedTimestamp({ actual: 0.4, requested: 120.1 })).toBeCloseTo(120.5, 4);
  });

  it('uses actual when it looks absolute', () => {
    expect(resolveExtractedTimestamp({ actual: 42.25, requested: 10 })).toBe(42.25);
  });

  it('prefers base-relative timestamps when closer to requested', () => {
    expect(resolveExtractedTimestamp({ actual: 7.5, requested: 120, seekBase: 112 })).toBeCloseTo(
      119.5,
      2,
    );
  });

  it('prefers absolute timestamps when closer to requested', () => {
    expect(resolveExtractedTimestamp({ actual: 120.2, requested: 120, seekBase: 112 })).toBeCloseTo(
      120.2,
      3,
    );
  });
});
