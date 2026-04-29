import { describe, expect, it } from 'vitest';

import {
  countWords,
  estimateDurationSecondsFromWords,
  formatInputSummary,
} from '../src/daemon/meta.js';

describe('daemon/meta', () => {
  describe('countWords', () => {
    it('counts words with whitespace normalization', () => {
      expect(countWords('')).toBe(0);
      expect(countWords('   ')).toBe(0);
      expect(countWords('hello')).toBe(1);
      expect(countWords('hello   world\n\nok')).toBe(3);
    });
  });

  describe('formatInputSummary', () => {
    it('formats website input lengths', () => {
      expect(
        formatInputSummary({
          characters: 12_000,
          durationSeconds: null,
          kindLabel: null,
          words: 1234,
        }),
      ).toBe('1.2k words · 12k chars');
    });

    it('formats media input with approximate duration', () => {
      expect(
        formatInputSummary({
          characters: 10_200,
          durationSeconds: 600,
          isDurationApproximate: true,
          kindLabel: 'YouTube',
          words: 1700,
        }),
      ).toBe('10 min YouTube · 1.7k words · 10k chars');
    });

    it('does not round word-derived duration to whole minutes', () => {
      const durationSeconds = estimateDurationSecondsFromWords(401);
      expect(
        formatInputSummary({
          characters: null,
          durationSeconds,
          isDurationApproximate: true,
          kindLabel: 'YouTube',
          words: 401,
        }),
      ).toBe('2.5 min YouTube · 401 words');
    });

    it('includes kind label without duration', () => {
      expect(
        formatInputSummary({
          characters: null,
          durationSeconds: null,
          kindLabel: 'YouTube',
          words: 1200,
        }),
      ).toBe('YouTube · 1.2k words');
    });
  });
});
