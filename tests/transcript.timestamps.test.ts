import { describe, expect, it } from 'vitest';

import {
  jsonTranscriptToSegments,
  vttToSegments,
} from '../packages/core/src/content/transcript/parse.js';
import {
  formatTimestampMs,
  formatTranscriptSegments,
  parseTimestampStringToMs,
  parseTimestampToMs,
} from '../packages/core/src/content/transcript/timestamps.js';

describe('transcript timestamp helpers', () => {
  it('formats and parses timestamps', () => {
    expect(formatTimestampMs(0)).toBe('0:00');
    expect(formatTimestampMs(61_000)).toBe('1:01');
    expect(formatTimestampMs(3_661_000)).toBe('1:01:01');

    expect(parseTimestampStringToMs('1:02')).toBe(62_000);
    expect(parseTimestampStringToMs('01:02:03')).toBe(3_723_000);
    expect(parseTimestampStringToMs('bad')).toBeNull();

    expect(parseTimestampToMs(1.5, true)).toBe(1500);
    expect(parseTimestampToMs('2.5', true)).toBe(2500);
    expect(parseTimestampToMs('1200', false)).toBe(1200);
  });

  it('parses VTT cues into segments', () => {
    const vtt = [
      'WEBVTT',
      '',
      '00:00:01.000 --> 00:00:02.500',
      'Hello world',
      '',
      '00:00:03.000 --> 00:00:04.000',
      'Again',
      '',
    ].join('\n');

    expect(vttToSegments(vtt)).toEqual([
      { endMs: 2500, startMs: 1000, text: 'Hello world' },
      { endMs: 4000, startMs: 3000, text: 'Again' },
    ]);
  });

  it('parses JSON transcript payloads into segments', () => {
    const payload = [
      { end: 3.5, start: 1.5, text: 'Hello' },
      { end: 5, start: 4, utf8: 'world' },
    ];

    expect(jsonTranscriptToSegments(payload)).toEqual([
      { endMs: 3500, startMs: 1500, text: 'Hello' },
      { endMs: 5000, startMs: 4000, text: 'world' },
    ]);
  });

  it('formats transcript segments into timed text', () => {
    const text = formatTranscriptSegments([{ endMs: 2000, startMs: 1000, text: 'Hello' }]);
    expect(text).toBe('[0:01] Hello');
  });
});
