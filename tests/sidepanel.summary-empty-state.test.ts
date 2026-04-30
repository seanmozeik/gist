import { describe, expect, it } from 'vitest';

import { buildSummaryEmptyState } from '../apps/chrome-extension/src/entrypoints/sidepanel/summary-empty-state';

describe('sidepanel summary empty state', () => {
  it('shows a ready state for manual gist', () => {
    expect(
      buildSummaryEmptyState({
        autoGist: false,
        hasSlides: false,
        phase: 'idle',
        tabTitle: 'Example Video',
        tabUrl: 'https://www.youtube.com/watch?v=abc',
      }),
    ).toEqual({ detail: 'Example Video', label: 'Ready', message: 'Click Gist to start.' });
  });

  it('shows a loading state when auto gist is active', () => {
    expect(
      buildSummaryEmptyState({
        autoGist: true,
        hasSlides: false,
        phase: 'idle',
        tabTitle: 'Example Video',
        tabUrl: 'https://www.youtube.com/watch?v=abc',
      }),
    ).toEqual({ detail: 'Example Video', label: 'Loading', message: 'Preparing summary' });
  });

  it('shows a quiet no-page state without extra detail', () => {
    expect(
      buildSummaryEmptyState({
        autoGist: false,
        hasSlides: false,
        phase: 'idle',
        tabTitle: null,
        tabUrl: null,
      }),
    ).toEqual({ detail: null, label: 'No page', message: 'Open a page to gist.' });
  });

  it('hides the empty state once slides exist', () => {
    expect(
      buildSummaryEmptyState({
        autoGist: false,
        hasSlides: true,
        phase: 'idle',
        tabTitle: 'Example Video',
        tabUrl: 'https://www.youtube.com/watch?v=abc',
      }),
    ).toBeNull();
  });
});
