import { describe, expect, it } from 'vitest';

import {
  buildSlideTextFallback,
  buildTimestampUrl,
  coerceSummaryWithSlides,
  extractSlideMarkers,
  findSlidesSectionStart,
  formatOsc8Link,
  formatTimestamp,
  getTranscriptTextForSlide,
  interleaveSlidesIntoTranscript,
  parseSlideSummariesFromMarkdown,
  parseTranscriptTimedText,
  resolveSlideTextBudget,
  resolveSlideWindowSeconds,
  splitSlideTitleFromText,
  splitSummaryFromSlides,
} from '../src/run/flows/url/slides-text.js';

describe('slides text helpers', () => {
  it('finds the earliest slides marker', () => {
    const markdown = ['# Title', '', '[slide:2] Second', '', '### Slides', '[slide:1] First'].join(
      '\n',
    );
    expect(findSlidesSectionStart(markdown)).toBe(markdown.indexOf('[slide:2]'));
  });

  it('returns null when no slides section exists', () => {
    expect(findSlidesSectionStart('Just text.')).toBeNull();
  });

  it('splits summary from slides section', () => {
    const markdown = ['Intro line', '', '### Slides', '[slide:1] Hello'].join('\n');
    expect(splitSummaryFromSlides(markdown)).toEqual({
      slidesSection: '### Slides\n[slide:1] Hello',
      summary: 'Intro line',
    });
    expect(splitSummaryFromSlides('Only summary').slidesSection).toBeNull();
  });

  it('finds slides section from slide labels', () => {
    const markdown = ['Intro', '', 'Slide 1 \u00B7 0:01', 'Text'].join('\n');
    expect(findSlidesSectionStart(markdown)).not.toBeNull();
  });

  it('parses slide summaries and ignores invalid entries', () => {
    const markdown = [
      '### Slides',
      '[slide:0] ignored',
      '[slide:1] First line',
      'continued line',
      '',
      '[slide:2] Second line',
      '',
      '## Next',
      'ignored content',
    ].join('\n');
    const result = parseSlideSummariesFromMarkdown(markdown);
    expect(result.get(1)).toBe('First line\ncontinued line');
    expect(result.get(2)).toBe('Second line');
    expect(result.has(0)).toBe(false);
  });

  it('extracts slide markers from inline tags', () => {
    const markers = extractSlideMarkers('[slide:1]\nText\n[slide:2] More');
    expect(markers).toEqual([1, 2]);
  });

  it('builds slide text fallback from transcript', () => {
    const fallback = buildSlideTextFallback({
      lengthArg: { kind: 'preset', preset: 'short' },
      slides: [
        { index: 1, timestamp: 5 },
        { index: 2, timestamp: 12 },
      ],
      transcriptTimedText: '[00:05] Hello there\n[00:10] General Kenobi',
    });
    expect(fallback.get(1)).toContain('Hello');
    expect(fallback.size).toBeGreaterThan(0);
    expect(
      buildSlideTextFallback({
        lengthArg: { kind: 'preset', preset: 'short' },
        slides: [{ index: 1, timestamp: 5 }],
        transcriptTimedText: '',
      }).size,
    ).toBe(0);
  });

  it('coerces summaries without markers into slide blocks', () => {
    const markdown = [
      '### Intro',
      'Short intro sentence. Another sentence.',
      '',
      '### Slides',
      'Slide 1 \u00B7 0:01',
      'First slide text.',
      '',
      'Slide 2 \u00B7 0:02',
      'Second slide text.',
    ].join('\n');
    const coerced = coerceSummaryWithSlides({
      lengthArg: { kind: 'preset', preset: 'short' },
      markdown,
      slides: [
        { index: 1, timestamp: 1 },
        { index: 2, timestamp: 2 },
      ],
      transcriptTimedText: null,
    });
    expect(coerced).toContain('[slide:1]');
    expect(coerced).toContain('[slide:2]');
    expect(coerced).toContain('First slide text.');
    expect(coerced).toContain('Second slide text.');
  });

  it('does not invent slide title lines', () => {
    const slides = [{ index: 1, timestamp: 4 }];
    const coerced = coerceSummaryWithSlides({
      lengthArg: { kind: 'preset', preset: 'short' },
      markdown: 'Intro\n\n[slide:1]\nThis segment explains the setup.',
      slides,
      transcriptTimedText: null,
    });
    expect(coerced).not.toContain('Title:');
    expect(coerced).toContain('This segment explains the setup.');
  });

  it('detects markdown heading lines as slide titles', () => {
    const parsed = splitSlideTitleFromText({
      slideIndex: 1,
      text: '## Graphene breakthroughs\nGraphene is strong and conductive.',
      total: 3,
    });
    expect(parsed.title).toBe('Graphene breakthroughs');
    expect(parsed.body).toContain('Graphene is strong and conductive.');

    const sentence = splitSlideTitleFromText({
      slideIndex: 1,
      text: 'Graphene is strong and conductive.\nMore details.',
      total: 3,
    });
    expect(sentence.title).toBe('Graphene is strong and conductive');
  });

  it('treats Title labels as slide titles', () => {
    const parsed = splitSlideTitleFromText({
      slideIndex: 1,
      text: 'Title: Graphene breakthroughs\nGraphene is strong and conductive.',
      total: 3,
    });
    expect(parsed.title).toBe('Graphene breakthroughs');
    expect(parsed.body).toBe('Graphene is strong and conductive.');
  });

  it('treats plain title lines as slide titles when followed by body', () => {
    const parsed = splitSlideTitleFromText({
      slideIndex: 1,
      text: 'Podcast Introduction\nThe hosts welcome each other.',
      total: 3,
    });
    expect(parsed.title).toBe('Podcast Introduction');
    expect(parsed.body).toBe('The hosts welcome each other.');
  });

  it('ignores leading slide labels before titles', () => {
    const parsed = splitSlideTitleFromText({
      slideIndex: 1,
      text: 'Slide 1/10 · 0:02\nTitle: Podcast Introduction\nThe hosts welcome each other.',
      total: 3,
    });
    expect(parsed.title).toBe('Podcast Introduction');
    expect(parsed.body).toBe('The hosts welcome each other.');
  });

  it('lifts later heading lines as titles', () => {
    const parsed = splitSlideTitleFromText({
      slideIndex: 1,
      text: 'First paragraph line.\n## Late title\nSecond paragraph line.',
      total: 3,
    });
    expect(parsed.title).toBe('Late title');
    expect(parsed.body).toBe('First paragraph line.\nSecond paragraph line.');
  });

  it('uses the next line when a Title label is empty', () => {
    const parsed = splitSlideTitleFromText({
      slideIndex: 1,
      text: 'Title:\nGraphene breakthroughs\nGraphene is strong and conductive.',
      total: 3,
    });
    expect(parsed.title).toBe('Graphene breakthroughs');
    expect(parsed.body).toBe('Graphene is strong and conductive.');
  });

  it('strips Title labels from markdown headings', () => {
    const parsed = splitSlideTitleFromText({
      slideIndex: 1,
      text: '## Title: Graphene breakthroughs\nGraphene is strong and conductive.',
      total: 3,
    });
    expect(parsed.title).toBe('Graphene breakthroughs');
    expect(parsed.body).toBe('Graphene is strong and conductive.');
  });

  it('uses the next line when a heading Title label is empty', () => {
    const parsed = splitSlideTitleFromText({
      slideIndex: 1,
      text: '## Title:\nGraphene breakthroughs\nGraphene is strong and conductive.',
      total: 3,
    });
    expect(parsed.title).toBe('Graphene breakthroughs');
    expect(parsed.body).toBe('Graphene is strong and conductive.');
  });

  it('coerces summaries with markers and missing slides', () => {
    const slides = [
      { index: 1, timestamp: 10 },
      { index: 2, timestamp: 20 },
    ];
    const coerced = coerceSummaryWithSlides({
      lengthArg: { kind: 'preset', preset: 'short' },
      markdown: 'Intro\n\n[slide:1]\nText',
      slides,
      transcriptTimedText: null,
    });
    expect(coerced).toContain('[slide:1]');
    expect(coerced).toContain('Intro');

    const withSummaries = coerceSummaryWithSlides({
      lengthArg: { kind: 'preset', preset: 'short' },
      markdown: '### Slides\n[slide:1] First',
      slides,
      transcriptTimedText: '[00:20] Second fallback',
    });
    expect(withSummaries).toContain('[slide:2]');

    const onlyIntro = coerceSummaryWithSlides({
      lengthArg: { kind: 'preset', preset: 'short' },
      markdown: 'Just an intro.',
      slides,
      transcriptTimedText: null,
    });
    expect(onlyIntro).toContain('[slide:1]');
  });

  it('does not backfill empty slide markers', () => {
    const slides = [
      { index: 1, timestamp: 10 },
      { index: 2, timestamp: 20 },
    ];
    const coerced = coerceSummaryWithSlides({
      lengthArg: { kind: 'preset', preset: 'short' },
      markdown: 'Intro\n\n[slide:1]\n\n[slide:2] Covered segment.',
      slides,
      transcriptTimedText: '[00:10] FALLBACK SEGMENT\n[00:20] Another segment',
    });
    expect(coerced).toContain('[slide:1]');
    expect(coerced).not.toContain('FALLBACK SEGMENT');
    expect(coerced).toContain('Covered segment.');
  });

  it('redistributes text when slides only have titles', () => {
    const slides = [
      { index: 1, timestamp: 10 },
      { index: 2, timestamp: 20 },
    ];
    const markdown = [
      'Intro paragraph.',
      '',
      '[slide:1]',
      'Welcome and Updates',
      '',
      '[slide:2]',
      'Security Nightmare',
      '',
      'First body paragraph.',
      '',
      'Second body paragraph.',
    ].join('\n');
    const coerced = coerceSummaryWithSlides({
      lengthArg: { kind: 'preset', preset: 'short' },
      markdown,
      slides,
      transcriptTimedText: null,
    });
    expect(coerced).toContain('[slide:1]\nFirst body paragraph.');
    expect(coerced).toContain('[slide:2]\nSecond body paragraph.');
  });

  it('parses transcript timed text and sorts by timestamp', () => {
    const input = [
      '[00:10] Second',
      'bad line',
      '[00:05] First',
      '[00:05] ',
      '[00:aa] Nope',
      '[01:02:03] Hour mark',
    ].join('\n');
    const segments = parseTranscriptTimedText(input);
    expect(segments).toEqual([
      { startSeconds: 5, text: 'First' },
      { startSeconds: 10, text: 'Second' },
      { startSeconds: 3723, text: 'Hour mark' },
    ]);
  });

  it('formats timestamps for minutes and hours', () => {
    expect(formatTimestamp(65)).toBe('1:05');
    expect(formatTimestamp(3661)).toBe('01:01:01');
  });

  it('resolves slide text budget with clamping', () => {
    expect(
      resolveSlideTextBudget({ lengthArg: { kind: 'preset', preset: 'short' }, slideCount: 2 }),
    ).toBe(120);
    expect(
      resolveSlideTextBudget({ lengthArg: { kind: 'chars', maxCharacters: 50 }, slideCount: 1 }),
    ).toBe(80);
    expect(
      resolveSlideTextBudget({ lengthArg: { kind: 'chars', maxCharacters: 20_000 }, slideCount: 1 }),
    ).toBe(900);
  });

  it('resolves slide window seconds with clamping', () => {
    expect(resolveSlideWindowSeconds({ lengthArg: { kind: 'preset', preset: 'xl' } })).toBe(120);
    expect(resolveSlideWindowSeconds({ lengthArg: { kind: 'chars', maxCharacters: 200 } })).toBe(
      30,
    );
    expect(resolveSlideWindowSeconds({ lengthArg: { kind: 'chars', maxCharacters: 50_000 } })).toBe(
      180,
    );
  });

  it('builds transcript text for a slide', () => {
    const segments = [
      { startSeconds: 2, text: 'hello' },
      { startSeconds: 10, text: 'world' },
      { startSeconds: 50, text: 'later' },
    ];
    const text = getTranscriptTextForSlide({
      budget: 200,
      nextSlide: { index: 2, timestamp: 20 },
      segments,
      slide: { index: 1, timestamp: 8 },
      windowSeconds: 30,
    });
    expect(text).toBe('hello world');
    expect(
      getTranscriptTextForSlide({
        budget: 120,
        nextSlide: null,
        segments,
        slide: { index: 1, timestamp: Number.NaN },
        windowSeconds: 30,
      }),
    ).toBe('');
    expect(
      getTranscriptTextForSlide({
        budget: 120,
        nextSlide: null,
        segments: [],
        slide: { index: 1, timestamp: 10 },
        windowSeconds: 30,
      }),
    ).toBe('');
    expect(
      getTranscriptTextForSlide({
        budget: 120,
        nextSlide: null,
        segments,
        slide: { index: 1, timestamp: 10 },
        windowSeconds: -5,
      }),
    ).toBe('');

    const longSegments = [
      { startSeconds: 1, text: 'lorem ipsum dolor sit amet' },
      { startSeconds: 2, text: 'consectetur adipiscing elit' },
    ];
    const truncated = getTranscriptTextForSlide({
      budget: 20,
      nextSlide: null,
      segments: longSegments,
      slide: { index: 1, timestamp: 1 },
      windowSeconds: 10,
    });
    expect(truncated.endsWith('...')).toBe(true);
  });

  it('formats OSC-8 links when enabled', () => {
    expect(formatOsc8Link('Label', 'https://example.com', false)).toBe('Label');
    expect(formatOsc8Link('Label', null, true)).toBe('Label');
    expect(formatOsc8Link('Label', 'https://example.com', true)).toContain('https://example.com');
  });

  it('builds timestamp URLs for known hosts', () => {
    const youtubeId = 'dQw4w9WgXcQ';
    expect(buildTimestampUrl(`https://www.youtube.com/watch?v=${youtubeId}`, 12)).toBe(
      `https://www.youtube.com/watch?v=${youtubeId}&t=12s`,
    );
    expect(buildTimestampUrl(`https://youtu.be/${youtubeId}`, 5)).toBe(
      `https://www.youtube.com/watch?v=${youtubeId}&t=5s`,
    );
    expect(buildTimestampUrl('https://vimeo.com/12345', 7)).toBe('https://vimeo.com/12345#t=7s');
    expect(buildTimestampUrl('https://loom.com/share/abc', 9)).toBe(
      'https://loom.com/share/abc?t=9',
    );
    expect(buildTimestampUrl('https://dropbox.com/s/abc/file.mp4', 11)).toBe(
      'https://dropbox.com/s/abc/file.mp4?t=11',
    );
    expect(buildTimestampUrl('not a url', 5)).toBeNull();
    expect(buildTimestampUrl('https://example.com/video', 5)).toBeNull();
  });

  it('interleaves slide markers into transcript', () => {
    const transcript = ['[00:05] Alpha', '[00:10] Beta'].join('\n');
    const interleaved = interleaveSlidesIntoTranscript({
      slides: [
        { index: 1, timestamp: 3 },
        { index: 2, timestamp: 9 },
      ],
      transcriptTimedText: transcript,
    });
    expect(interleaved).toContain('[slide:1]');
    expect(interleaved).toContain('[slide:2]');
    expect(interleaveSlidesIntoTranscript({ slides: [], transcriptTimedText: '' })).toBe('');
  });
});
