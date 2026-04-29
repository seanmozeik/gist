import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createNavigationRuntime } from '../apps/chrome-extension/src/entrypoints/sidepanel/navigation-runtime.js';

describe('sidepanel navigation runtime', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.stubGlobal('chrome', { tabs: { query: vi.fn(async () => []) } });
  });

  it('preserves chat when the active tab matches a recent agent navigation', async () => {
    const resetForNavigation = vi.fn();
    const setBaseTitle = vi.fn();
    let currentSource = { title: 'A', url: 'https://example.com/a' };

    const runtime = createNavigationRuntime({
      getCurrentSource: () => currentSource,
      resetForNavigation,
      setBaseTitle,
      setCurrentSource: (next) => {
        currentSource = next;
      },
    });

    runtime.markAgentNavigationIntent('https://example.com/b');
    vi.mocked(chrome.tabs.query).mockResolvedValueOnce([
      { id: 2, title: 'B', url: 'https://example.com/b' },
    ]);

    await runtime.syncWithActiveTab();

    expect(currentSource).toBeNull();
    expect(resetForNavigation).toHaveBeenCalledWith(true);
    expect(setBaseTitle).toHaveBeenCalledWith('B');
    expect(runtime.shouldPreserveChatForRun('https://example.com/b')).toBe(true);
  });

  it('updates the current title when the active tab stays on the same page', async () => {
    const resetForNavigation = vi.fn();
    const setBaseTitle = vi.fn();
    let currentSource = { title: 'Old', url: 'https://example.com/a' };

    const runtime = createNavigationRuntime({
      getCurrentSource: () => currentSource,
      resetForNavigation,
      setBaseTitle,
      setCurrentSource: (next) => {
        currentSource = next;
      },
    });

    vi.mocked(chrome.tabs.query).mockResolvedValueOnce([
      { id: 1, title: 'New', url: 'https://example.com/a#hash' },
    ]);

    await runtime.syncWithActiveTab();

    expect(currentSource).toEqual({ title: 'New', url: 'https://example.com/a' });
    expect(resetForNavigation).not.toHaveBeenCalled();
    expect(setBaseTitle).toHaveBeenCalledWith('New');
  });

  it('ignores blank navigation intents and malformed results', () => {
    const runtime = createNavigationRuntime({
      getCurrentSource: () => null,
      resetForNavigation: vi.fn(),
      setBaseTitle: vi.fn(),
      setCurrentSource: vi.fn(),
    });

    runtime.markAgentNavigationIntent('   ');
    runtime.markAgentNavigationResult(null);
    runtime.markAgentNavigationResult({});

    expect(runtime.getLastAgentNavigationUrl()).toBeNull();
  });

  it('preserves chat for matching pending URLs only within ttl', () => {
    vi.useFakeTimers();
    const runtime = createNavigationRuntime({
      getCurrentSource: () => null,
      resetForNavigation: vi.fn(),
      setBaseTitle: vi.fn(),
      setCurrentSource: vi.fn(),
      ttlMs: 100,
    });

    runtime.notePreserveChatForUrl('https://example.com/next');
    expect(runtime.shouldPreserveChatForRun('https://example.com/next')).toBe(true);
    expect(runtime.shouldPreserveChatForRun('https://example.com/next')).toBe(false);

    runtime.notePreserveChatForUrl('https://example.com/later');
    vi.advanceTimersByTime(101);
    expect(runtime.shouldPreserveChatForRun('https://example.com/later')).toBe(false);
  });

  it('treats matching tab ids as recent agent navigation', () => {
    vi.useFakeTimers();
    const runtime = createNavigationRuntime({
      getCurrentSource: () => null,
      resetForNavigation: vi.fn(),
      setBaseTitle: vi.fn(),
      setCurrentSource: vi.fn(),
      ttlMs: 100,
    });

    runtime.markAgentNavigationResult({ finalUrl: 'https://example.com/final', tabId: 7 });
    expect(runtime.isRecentAgentNavigation(7, null)).toBe(true);
    vi.advanceTimersByTime(101);
    expect(runtime.isRecentAgentNavigation(7, null)).toBe(false);
  });

  it('ignores unsupported active-tab schemes and missing current source', async () => {
    const resetForNavigation = vi.fn();
    const setBaseTitle = vi.fn();
    const runtime = createNavigationRuntime({
      getCurrentSource: () => null,
      resetForNavigation,
      setBaseTitle,
      setCurrentSource: vi.fn(),
    });

    await runtime.syncWithActiveTab();
    vi.mocked(chrome.tabs.query).mockResolvedValueOnce([
      { title: 'X', url: 'chrome://extensions' },
    ]);

    const runtimeWithSource = createNavigationRuntime({
      getCurrentSource: () => ({ url: 'https://example.com/a', title: 'A' }),
      resetForNavigation,
      setBaseTitle,
      setCurrentSource: vi.fn(),
    });
    await runtimeWithSource.syncWithActiveTab();

    expect(resetForNavigation).not.toHaveBeenCalled();
    expect(setBaseTitle).not.toHaveBeenCalled();
  });

  it('falls back to non-preserved reset when there is no recent navigation', async () => {
    const resetForNavigation = vi.fn();
    const setBaseTitle = vi.fn();
    let currentSource = { title: 'A', url: 'https://example.com/a' };

    const runtime = createNavigationRuntime({
      getCurrentSource: () => currentSource,
      resetForNavigation,
      setBaseTitle,
      setCurrentSource: (next) => {
        currentSource = next;
      },
    });

    vi.mocked(chrome.tabs.query).mockResolvedValueOnce([
      { id: 2, title: '', url: 'https://example.com/b' },
    ]);

    await runtime.syncWithActiveTab();

    expect(currentSource).toBeNull();
    expect(resetForNavigation).toHaveBeenCalledWith(false);
    expect(setBaseTitle).toHaveBeenCalledWith('https://example.com/b');
  });

  it('swallows tab-query failures', async () => {
    const resetForNavigation = vi.fn();
    const setBaseTitle = vi.fn();

    const runtime = createNavigationRuntime({
      getCurrentSource: () => ({ url: 'https://example.com/a', title: 'A' }),
      resetForNavigation,
      setBaseTitle,
      setCurrentSource: vi.fn(),
    });

    vi.mocked(chrome.tabs.query).mockRejectedValueOnce(new Error('boom'));
    await expect(runtime.syncWithActiveTab()).resolves.toBeUndefined();
    expect(resetForNavigation).not.toHaveBeenCalled();
  });
});
