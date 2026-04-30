import { describe, expect, it } from 'vitest';

import { createSlidesTextController } from '../apps/chrome-extension/src/entrypoints/sidepanel/slides-text-controller';

describe('sidepanel slides text controller', () => {
  it('builds transcript-first descriptions from timed text', () => {
    const slides = [
      { imageUrl: 'x', index: 1, ocrText: 'Ignored OCR text', timestamp: 0 },
      { imageUrl: 'y', index: 2, ocrText: 'Fallback OCR text for second slide', timestamp: 30 },
    ];
    const controller = createSlidesTextController({
      getLengthValue: () => 'short',
      getSlides: () => slides,
      getSlidesOcrEnabled: () => true,
    });

    controller.setTranscriptTimedText(
      '[00:00] Intro text for the first slide.\n[00:30] Transcript text for the second slide.',
    );
    controller.syncTextState();

    expect(controller.getTranscriptAvailable()).toBe(true);
    expect(controller.getDescriptions().get(1)).toContain('Intro text');
    expect(controller.getDescriptions().get(2)).toContain('Transcript text');
  });

  it('keeps slides-derived titles authoritative over summary titles', () => {
    const controller = createSlidesTextController({
      getLengthValue: () => 'short',
      getSlides: () => [{ imageUrl: 'x', index: 1, ocrText: null, timestamp: 2 }],
      getSlidesOcrEnabled: () => true,
    });

    expect(
      controller.updateSummaryFromMarkdown(
        ['### Slides', 'Slide 1 · 0:02', 'Canonical title', 'Slide body text'].join('\n'),
        { source: 'slides' },
      ),
    ).toBe(true);
    expect(controller.getTitles().get(1)).toBe('Canonical title');

    expect(
      controller.updateSummaryFromMarkdown(
        ['### Slides', 'Slide 1 · 0:02', 'Wrong title', 'Other body text'].join('\n'),
        { source: 'summary' },
      ),
    ).toBe(false);
    expect(controller.getTitles().get(1)).toBe('Canonical title');
  });

  it('upgrades transcript-first descriptions to slide summaries when summary markdown arrives', () => {
    const slides = [
      { imageUrl: 'x', index: 1, ocrText: 'Ignored OCR text', timestamp: 0 },
      { imageUrl: 'y', index: 2, ocrText: 'Fallback OCR text for second slide', timestamp: 30 },
    ];
    const controller = createSlidesTextController({
      getLengthValue: () => 'short',
      getSlides: () => slides,
      getSlidesOcrEnabled: () => true,
    });

    controller.setTranscriptTimedText(
      '[00:00] Raw transcript intro line.\n[00:30] Raw transcript second line.',
    );
    controller.syncTextState();
    expect(controller.getDescriptions().get(1)).toContain('Raw transcript intro line');

    controller.updateSummaryFromMarkdown(
      [
        '### Slides',
        'Slide 1 · 0:00',
        'Opening move',
        'Londo notices the trap and keeps the conversation moving.',
        '',
        'Slide 2 · 0:30',
        'Poison reveal',
        'Refa learns the drink is only lethal once both parts are combined.',
      ].join('\n'),
      { source: 'slides' },
    );

    expect(controller.getTitles().get(1)).toBe('Opening move');
    expect(controller.getDescriptions().get(1)).toContain(
      'Londo notices the trap and keeps the conversation moving.',
    );
    expect(controller.getDescriptions().get(2)).toContain(
      'Refa learns the drink is only lethal once both parts are combined.',
    );
  });

  it('keeps explicit OCR mode authoritative even after slide summaries arrive', () => {
    const slides = [
      {
        imageUrl: 'x',
        index: 1,
        ocrText:
          'Readable OCR body for slide one with enough detail to keep the OCR toggle meaningful.',
        timestamp: 0,
      },
      {
        imageUrl: 'y',
        index: 2,
        ocrText:
          'Readable OCR body for slide two with enough detail to keep the OCR toggle meaningful.',
        timestamp: 30,
      },
      {
        imageUrl: 'z',
        index: 3,
        ocrText:
          'Readable OCR body for slide three with enough detail to keep the OCR toggle meaningful.',
        timestamp: 60,
      },
    ];
    const controller = createSlidesTextController({
      getLengthValue: () => 'short',
      getSlides: () => slides,
      getSlidesOcrEnabled: () => true,
    });

    controller.syncTextState();
    expect(controller.setTextMode('ocr')).toBe(true);
    controller.updateSummaryFromMarkdown(
      [
        '### Slides',
        'Slide 1 · 0:00',
        'Summary title',
        'Summary body that should not replace OCR mode.',
      ].join('\n'),
      { source: 'slides' },
    );

    expect(controller.getDescriptions().get(1)).toContain('Readable OCR body for slide one');
  });

  it('preserves existing titles when asked to ignore empty updates', () => {
    const controller = createSlidesTextController({
      getLengthValue: () => 'short',
      getSlides: () => [{ imageUrl: 'x', index: 1, ocrText: null, timestamp: 2 }],
      getSlidesOcrEnabled: () => true,
    });

    controller.updateSummaryFromMarkdown(
      ['### Slides', 'Slide 1 · 0:02', 'Kept title', 'Some text'].join('\n'),
      { source: 'summary' },
    );
    expect(controller.getTitles().get(1)).toBe('Kept title');

    expect(
      controller.updateSummaryFromMarkdown('', { preserveIfEmpty: true, source: 'summary' }),
    ).toBe(false);
    expect(controller.getTitles().get(1)).toBe('Kept title');
  });

  it('clears summary titles on empty slide-sourced updates and respects text mode availability', () => {
    const slides = [
      {
        imageUrl: 'x',
        index: 1,
        ocrText: 'Readable OCR text for slide one with enough detail to count strongly.',
        timestamp: 2,
      },
      {
        imageUrl: 'y',
        index: 2,
        ocrText: 'Another readable OCR paragraph for slide two with enough detail to count.',
        timestamp: 10,
      },
      {
        imageUrl: 'z',
        index: 3,
        ocrText: 'Third readable OCR paragraph for slide three with enough detail to count.',
        timestamp: 20,
      },
    ];
    const controller = createSlidesTextController({
      getLengthValue: () => 'short',
      getSlides: () => slides,
      getSlidesOcrEnabled: () => true,
    });

    controller.syncTextState();
    expect(controller.getTextToggleVisible()).toBe(true);
    expect(controller.setTextMode('ocr')).toBe(true);
    expect(controller.getTextMode()).toBe('ocr');
    expect(controller.setTextMode('ocr')).toBe(false);

    controller.updateSummaryFromMarkdown(
      ['### Slides', 'Slide 1 · 0:02', 'Canonical title', 'Some text'].join('\n'),
      { source: 'slides' },
    );
    expect(controller.hasSummaryTitles()).toBe(true);

    expect(controller.updateSummaryFromMarkdown('', { source: 'slides' })).toBe(true);
    expect(controller.hasSummaryTitles()).toBe(false);
    controller.clearSummarySource();
  });

  it('resets transcript and ocr state cleanly', () => {
    const controller = createSlidesTextController({
      getLengthValue: () => 'short',
      getSlides: () => [{ imageUrl: 'x', index: 1, ocrText: 'tiny', timestamp: 2 }],
      getSlidesOcrEnabled: () => false,
    });

    controller.setTranscriptTimedText('[00:02] Timed line');
    controller.syncTextState();
    expect(controller.getTranscriptAvailable()).toBe(true);
    expect(controller.getTextToggleVisible()).toBe(false);

    controller.reset();
    expect(controller.getTranscriptTimedText()).toBeNull();
    expect(controller.getTranscriptAvailable()).toBe(false);
    expect(controller.getOcrAvailable()).toBe(false);
    expect(controller.getDescriptionEntries()).toEqual([]);
    expect(controller.getTitles().size).toBe(0);
  });
});
