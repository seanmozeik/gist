import { describe, expect, it } from 'vitest';

import {
  accumulateChatChunk,
  accumulateGistChunk,
  getTerminalStreamError,
  shouldSurfaceStreamingStatus,
} from '../apps/chrome-extension/src/entrypoints/sidepanel/stream-controller-policy';

describe('sidepanel stream controller policy', () => {
  it('keeps slide status visible during streaming output', () => {
    expect(
      shouldSurfaceStreamingStatus({
        statusText: 'slides: extracting frames',
        streamedAnyNonWhitespace: true,
      }),
    ).toBe(true);
    expect(
      shouldSurfaceStreamingStatus({
        statusText: 'fetching article',
        streamedAnyNonWhitespace: true,
      }),
    ).toBe(false);
  });

  it('accumulates gist and chat chunks via pure helpers', () => {
    expect(accumulateChatChunk('Hello', ' world')).toBe('Hello world');
    expect(accumulateGistChunk('Hello', ' world')).toContain('Hello world');
  });

  it('normalizes terminal stream completion errors', () => {
    expect(
      getTerminalStreamError({ sawDone: false, streamedAnyNonWhitespace: true })?.message,
    ).toBe('Stream ended unexpectedly. The daemon may have stopped.');
    expect(
      getTerminalStreamError({ sawDone: true, streamedAnyNonWhitespace: false })?.message,
    ).toBe('Model returned no output.');
    expect(getTerminalStreamError({ sawDone: true, streamedAnyNonWhitespace: true })).toBeNull();
  });
});
