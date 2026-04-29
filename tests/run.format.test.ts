import { describe, expect, it } from 'vitest';

import {
  estimateWhisperTranscriptionCostUsd,
  formatOptionalNumber,
  formatOptionalString,
  formatUSD,
  resolveTargetCharacters,
  sumNumbersOrNull,
} from '../src/run/format.js';

describe('run/format', () => {
  it('formats optional strings', () => {
    expect(formatOptionalString(' hello ')).toBe('hello');
    expect(formatOptionalString('   ')).toBe('none');
    expect(formatOptionalString(null)).toBe('none');
  });

  it('formats optional numbers', () => {
    expect(formatOptionalNumber(42)).toBe('42');
    expect(formatOptionalNumber(Number.NaN)).toBe('none');
    expect(formatOptionalNumber(null)).toBe('none');
  });

  it('sums finite numbers and ignores nullish or non-finite entries', () => {
    expect(sumNumbersOrNull([1, null, 2, Number.NaN, Number.POSITIVE_INFINITY])).toBe(3);
    expect(sumNumbersOrNull([null, Number.NaN])).toBeNull();
  });

  it('formats usd values', () => {
    expect(formatUSD(1.234_56)).toBe('$1.2346');
    expect(formatUSD(Number.NaN)).toBe('n/a');
  });

  it('estimates OpenAI whisper transcription cost only for valid whisper runs', () => {
    expect(
      estimateWhisperTranscriptionCostUsd({
        mediaDurationSeconds: 60,
        openaiWhisperUsdPerMinute: 0.006,
        transcriptSource: 'captions',
        transcriptionProvider: 'openai',
      }),
    ).toBeNull();

    expect(
      estimateWhisperTranscriptionCostUsd({
        mediaDurationSeconds: 60,
        openaiWhisperUsdPerMinute: 0.006,
        transcriptSource: 'whisper',
        transcriptionProvider: 'groq',
      }),
    ).toBeNull();

    expect(
      estimateWhisperTranscriptionCostUsd({
        mediaDurationSeconds: 0,
        openaiWhisperUsdPerMinute: 0.006,
        transcriptSource: 'whisper',
        transcriptionProvider: 'OPENAI',
      }),
    ).toBeNull();

    expect(
      estimateWhisperTranscriptionCostUsd({
        mediaDurationSeconds: 120,
        openaiWhisperUsdPerMinute: 0.006,
        transcriptSource: 'whisper',
        transcriptionProvider: 'OPENAI',
      }),
    ).toBeCloseTo(0.012, 6);
  });

  it('resolves target characters for both preset and explicit char modes', () => {
    const maxMap = { long: 3600, medium: 1800, short: 900, xl: 7200, xxl: 14_400 } as const;

    expect(resolveTargetCharacters({ kind: 'chars', maxCharacters: 321 }, maxMap)).toBe(321);
    expect(resolveTargetCharacters({ kind: 'preset', preset: 'long' }, maxMap)).toBe(3600);
  });
});
