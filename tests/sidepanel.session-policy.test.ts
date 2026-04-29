import { describe, expect, it } from 'vitest';

import {
  isMatchablePanelUrl,
  normalizePanelUrl,
  panelUrlsMatch,
  resolvePanelNavigationDecision,
  shouldAcceptRunForCurrentPage,
  shouldAcceptSlidesForCurrentPage,
  shouldIgnoreTransientPanelTabState,
  shouldInvalidateCurrentSource,
} from '../apps/chrome-extension/src/entrypoints/sidepanel/session-policy.js';

describe('sidepanel session policy', () => {
  it('preserves chat and migrates it on a tab switch when asked', () => {
    expect(
      resolvePanelNavigationDecision({
        activeTabId: 1,
        activeTabUrl: 'https://example.com/a',
        chatEnabled: true,
        hasActiveChat: true,
        inputModeOverride: 'page',
        nextTabId: 2,
        nextTabUrl: 'https://example.com/b',
        preferUrlMode: true,
        preserveChat: true,
      }),
    ).toEqual({
      kind: 'tab',
      nextInputMode: 'video',
      preserveChat: true,
      resetInputModeOverride: true,
      shouldAbortChatStream: false,
      shouldClearChat: false,
      shouldMigrateChat: true,
    });
  });

  it('clears chat on a same-tab url change', () => {
    expect(
      resolvePanelNavigationDecision({
        activeTabId: 2,
        activeTabUrl: 'https://example.com/a',
        chatEnabled: true,
        hasActiveChat: true,
        inputModeOverride: null,
        nextTabId: 2,
        nextTabUrl: 'https://example.com/b',
        preferUrlMode: false,
        preserveChat: false,
      }),
    ).toEqual({
      kind: 'url',
      nextInputMode: 'page',
      preserveChat: false,
      resetInputModeOverride: false,
      shouldAbortChatStream: false,
      shouldClearChat: true,
      shouldMigrateChat: false,
    });
  });

  it('accepts a summary run for the current page even when only the active tab url is known', () => {
    expect(
      shouldAcceptRunForCurrentPage({
        activeTabUrl: 'https://www.youtube.com/watch?v=abc123',
        currentSourceUrl: null,
        runUrl: 'https://www.youtube.com/watch?v=abc123&t=5',
      }),
    ).toBe(true);
  });

  it('rejects a stale summary run for another page', () => {
    expect(
      shouldAcceptRunForCurrentPage({
        activeTabUrl: 'https://www.youtube.com/watch?v=bravo456',
        currentSourceUrl: null,
        runUrl: 'https://www.youtube.com/watch?v=alpha123',
      }),
    ).toBe(false);
  });

  it('does not reject a real run when the only known active url is the extension page', () => {
    expect(
      shouldAcceptRunForCurrentPage({
        activeTabUrl: 'chrome-extension://test/sidepanel.html',
        currentSourceUrl: null,
        runUrl: 'https://example.com/video',
      }),
    ).toBe(true);
  });

  it('rejects a stale slides run for another page', () => {
    expect(
      shouldAcceptSlidesForCurrentPage({
        activeTabUrl: 'https://www.youtube.com/watch?v=bravo456',
        currentSourceUrl: null,
        targetUrl: 'https://www.youtube.com/watch?v=alpha123',
      }),
    ).toBe(false);
  });

  it('invalidates the current source when the active page changes', () => {
    expect(
      shouldInvalidateCurrentSource({
        currentSourceUrl: 'https://example.com/a',
        stateTabUrl: 'https://example.com/b',
      }),
    ).toBe(true);
  });

  it('normalizes hashes and equivalent youtube urls', () => {
    expect(normalizePanelUrl('https://example.com/a#hash')).toBe('https://example.com/a');
    expect(
      panelUrlsMatch(
        'https://www.youtube.com/watch?v=abc123',
        'https://www.youtube.com/watch?v=abc123&t=10',
      ),
    ).toBe(true);
  });

  it('treats extension and blank urls as transient when a real source is already active', () => {
    expect(isMatchablePanelUrl('chrome-extension://test/sidepanel.html')).toBe(false);
    expect(
      shouldIgnoreTransientPanelTabState({
        activeTabUrl: 'https://www.youtube.com/watch?v=abc123',
        currentSourceUrl: null,
        nextTabUrl: 'chrome-extension://test/sidepanel.html',
      }),
    ).toBe(true);
    expect(
      shouldIgnoreTransientPanelTabState({
        activeTabUrl: null,
        currentSourceUrl: 'https://www.youtube.com/watch?v=abc123',
        nextTabUrl: null,
      }),
    ).toBe(true);
    expect(
      shouldIgnoreTransientPanelTabState({
        activeTabUrl: 'https://www.youtube.com/watch?v=abc123',
        currentSourceUrl: null,
        nextTabUrl: 'https://www.youtube.com/watch?v=abc123',
      }),
    ).toBe(false);
  });
});
