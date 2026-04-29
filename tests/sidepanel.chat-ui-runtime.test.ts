// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createChatUiRuntime } from '../apps/chrome-extension/src/entrypoints/sidepanel/chat-ui-runtime';

class MockResizeObserver {
  observe() {
    /* empty */
  }
  disconnect() {
    /* empty */
  }
}

function setScrollMetrics(
  element: HTMLElement,
  values: { scrollHeight: number; clientHeight: number; scrollTop?: number },
) {
  Object.defineProperty(element, 'scrollHeight', {
    configurable: true,
    value: values.scrollHeight,
  });
  Object.defineProperty(element, 'clientHeight', {
    configurable: true,
    value: values.clientHeight,
  });
  Object.defineProperty(element, 'scrollTop', {
    configurable: true,
    value: values.scrollTop ?? 0,
    writable: true,
  });
}

describe('sidepanel chat ui runtime', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.documentElement.style.removeProperty('--chat-dock-height');
    vi.stubGlobal('ResizeObserver', MockResizeObserver);
  });

  it('disables chat ui and clears chat state when chat is off', async () => {
    const mainEl = document.createElement('main');
    const chatJumpBtn = document.createElement('button');
    const chatInputEl = document.createElement('textarea');
    const chatDockEl = document.createElement('div');
    const chatContainerEl = document.createElement('section');
    const renderEl = document.createElement('div');
    setScrollMetrics(mainEl, { clientHeight: 100, scrollHeight: 200, scrollTop: 100 });
    chatDockEl.getBoundingClientRect = () => ({ height: 48 }) as DOMRect;

    const chatEnabled = false;
    const clearMetrics = vi.fn();
    const clearQueuedMessages = vi.fn();
    const clearHistory = vi.fn(async () => {
      /* empty */
    });
    const loadHistory = vi.fn(async () => null);
    const persistHistory = vi.fn(async () => {
      /* empty */
    });
    const restoreHistory = vi.fn(async () => {
      /* empty */
    });
    const resetChatController = vi.fn();
    const resetChatSession = vi.fn();
    const runtime = createChatUiRuntime({
      chatContainerEl,
      chatDockContainerEl: chatDockEl,
      chatDockEl,
      chatInputEl,
      chatJumpBtn,
      clearHistory,
      clearMetrics,
      clearQueuedMessages,
      getActiveTabId: () => 7,
      getChatEnabled: () => chatEnabled,
      getSummaryMarkdown: () => 'Summary',
      loadHistory,
      mainEl,
      persistHistory,
      renderEl,
      resetChatController,
      resetChatSession,
      restoreHistory,
    });

    runtime.applyChatEnabled();

    expect(chatContainerEl.hasAttribute('hidden')).toBe(true);
    expect(chatDockEl.hasAttribute('hidden')).toBe(true);
    expect(clearMetrics).toHaveBeenCalledOnce();
    expect(resetChatController).toHaveBeenCalledOnce();
    expect(resetChatSession).toHaveBeenCalledOnce();
    expect(clearQueuedMessages).toHaveBeenCalledTimes(2);
    expect(document.documentElement.style.getPropertyValue('--chat-dock-height')).toBe('48px');
  });

  it('forces scroll on jump click and proxies chat history helpers', async () => {
    const mainEl = document.createElement('main');
    const chatJumpBtn = document.createElement('button');
    const chatInputEl = document.createElement('textarea');
    const chatDockEl = document.createElement('div');
    const chatContainerEl = document.createElement('section');
    const renderEl = document.createElement('div');
    setScrollMetrics(mainEl, { clientHeight: 100, scrollHeight: 500, scrollTop: 0 });
    chatDockEl.getBoundingClientRect = () => ({ height: 32 }) as DOMRect;

    const focusSpy = vi.spyOn(chatInputEl, 'focus');
    const clearHistory = vi.fn(async () => {
      /* empty */
    });
    const loadHistory = vi.fn(async () => [{ id: '1' }]);
    const persistHistory = vi.fn(async () => {
      /* empty */
    });
    const restoreHistory = vi.fn(async () => {
      /* empty */
    });

    const runtime = createChatUiRuntime({
      chatContainerEl,
      chatDockContainerEl: chatDockEl,
      chatDockEl,
      chatInputEl,
      chatJumpBtn,
      clearHistory,
      clearMetrics: vi.fn(),
      clearQueuedMessages: vi.fn(),
      getActiveTabId: () => 9,
      getChatEnabled: () => true,
      getSummaryMarkdown: () => 'Current summary',
      loadHistory,
      mainEl,
      persistHistory,
      renderEl,
      resetChatController: vi.fn(),
      resetChatSession: vi.fn(),
      restoreHistory,
    });

    mainEl.dispatchEvent(new Event('scroll'));
    expect(chatJumpBtn.classList.contains('isVisible')).toBe(true);

    chatJumpBtn.click();

    expect(mainEl.scrollTop).toBe(500);
    expect(chatJumpBtn.classList.contains('isVisible')).toBe(false);
    expect(focusSpy).toHaveBeenCalledOnce();

    await runtime.clearChatHistoryForActiveTab();
    await runtime.persistChatHistory();
    await runtime.restoreChatHistory();
    await runtime.loadChatHistory(9);

    expect(clearHistory).toHaveBeenCalledWith(9);
    expect(persistHistory).toHaveBeenCalledWith(9, true);
    expect(restoreHistory).toHaveBeenCalledWith(9, 'Current summary');
    expect(loadHistory).toHaveBeenCalledWith(9);
  });
});
