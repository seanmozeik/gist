import { describe, expect, it } from 'vitest';

import {
  chooseSlideDescription,
  sanitizeSlideSummaryTitle,
} from '../apps/chrome-extension/src/entrypoints/sidepanel/slide-text-policy.js';

describe('sidepanel slide text policy', () => {
  it('drops generic summary titles', () => {
    expect(sanitizeSlideSummaryTitle('Summary')).toBe('');
    expect(sanitizeSlideSummaryTitle(' slide   summary ')).toBe('');
    expect(sanitizeSlideSummaryTitle('Explosion in FTL')).toBe('Explosion in FTL');
  });

  it('prefers transcript text over summary-era filler', () => {
    expect(
      chooseSlideDescription({
        allowOcrFallback: false,
        ocrText: 'OCR text',
        preferOcr: false,
        summaryText: '',
        transcriptText: 'Destiny drops out of FTL.',
      }),
    ).toBe('Destiny drops out of FTL.');
  });

  it('returns empty when no transcript or OCR fallback exists', () => {
    expect(
      chooseSlideDescription({
        allowOcrFallback: false,
        ocrText: 'ignored',
        preferOcr: false,
        summaryText: '',
        transcriptText: '',
      }),
    ).toBe('');
  });

  it('uses OCR only when explicitly preferred or allowed as fallback', () => {
    expect(
      chooseSlideDescription({
        allowOcrFallback: false,
        ocrText: 'Visible slide text',
        preferOcr: true,
        summaryText: '',
        transcriptText: '',
      }),
    ).toBe('Visible slide text');

    expect(
      chooseSlideDescription({
        allowOcrFallback: true,
        ocrText: 'Visible slide text',
        preferOcr: false,
        summaryText: '',
        transcriptText: '',
      }),
    ).toBe('Visible slide text');
  });

  it('prefers summary text over transcript text when available', () => {
    expect(
      chooseSlideDescription({
        allowOcrFallback: false,
        ocrText: 'OCR text',
        preferOcr: false,
        summaryText: 'Londo realizes the room is a setup.',
        transcriptText: 'we have a drink lord refa yes thank you',
      }),
    ).toBe('Londo realizes the room is a setup.');
  });
});
