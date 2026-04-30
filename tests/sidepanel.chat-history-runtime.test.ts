import { describe, expect, it, vi } from 'vitest';

import { createChatHistoryRuntime } from '../apps/chrome-extension/src/entrypoints/sidepanel/chat-history-runtime';

describe('sidepanel chat history runtime', () => {
  it('persists compacted messages', async () => {
    const chatController = {
      getMessages: vi.fn(() => [{ content: 'hello', id: '1', role: 'user', timestamp: 1 }]),
      setMessages: vi.fn(),
    };
    const chatHistoryStore = {
      clear: vi.fn(async () => {
        /* Empty */
      }),
      load: vi.fn(async () => null),
      persist: vi.fn(async (_tabId, messages) => messages),
    };
    const runtime = createChatHistoryRuntime({
      chatController,
      chatHistoryStore,
      chatLimits: { maxChars: 100, maxMessages: 10 },
      getActiveUrl: vi.fn(() => 'https://example.com'),
      normalizeStoredMessage: vi.fn(),
      requestChatHistory: vi.fn(),
    });

    await runtime.persist(7, true);

    expect(chatHistoryStore.persist).toHaveBeenCalledWith(
      7,
      [{ content: 'hello', id: '1', role: 'user', timestamp: 1 }],
      true,
      'https://example.com',
    );
    expect(chatController.setMessages).not.toHaveBeenCalled();
  });

  it('restores local history before requesting the daemon', async () => {
    const history = [{ content: 'cached', id: '1', role: 'user', timestamp: 1 }];
    const chatController = { getMessages: vi.fn(() => []), setMessages: vi.fn() };
    const chatHistoryStore = {
      clear: vi.fn(async () => {
        /* Empty */
      }),
      load: vi.fn(async () => history as never),
      persist: vi.fn(async (_tabId, messages) => messages),
    };
    const requestChatHistory = vi.fn();
    const runtime = createChatHistoryRuntime({
      chatController,
      chatHistoryStore,
      chatLimits: { maxChars: 100, maxMessages: 10 },
      getActiveUrl: vi.fn(() => 'https://example.com'),
      normalizeStoredMessage: vi.fn(),
      requestChatHistory,
    });

    await runtime.restore(7, 'summary');

    expect(chatController.setMessages).toHaveBeenCalledWith(history, { scroll: false });
    expect(requestChatHistory).not.toHaveBeenCalled();
  });

  it('falls back to daemon history and ignores invalid payloads', async () => {
    const chatController = { getMessages: vi.fn(() => []), setMessages: vi.fn() };
    const chatHistoryStore = {
      clear: vi.fn(async () => {
        /* Empty */
      }),
      load: vi.fn(async () => null),
      persist: vi.fn(async (_tabId, messages) => messages),
    };
    const requestChatHistory = vi
      .fn()
      .mockResolvedValueOnce({
        messages: [{ content: 'remote', role: 'user', timestamp: 1 }],
        ok: true,
      })
      .mockResolvedValueOnce({ messages: ['bad'], ok: true });
    const runtime = createChatHistoryRuntime({
      chatController,
      chatHistoryStore,
      chatLimits: { maxChars: 100, maxMessages: 10 },
      getActiveUrl: vi.fn(() => 'https://example.com'),
      normalizeStoredMessage: vi.fn((raw) => (raw.role === 'user' ? (raw as never) : null)),
      requestChatHistory,
    });

    await runtime.restore(7, 'summary');
    expect(chatHistoryStore.persist).toHaveBeenCalledWith(
      7,
      [{ content: 'remote', role: 'user', timestamp: 1 }],
      true,
      'https://example.com',
    );
    expect(chatController.setMessages).toHaveBeenCalledWith(
      [{ content: 'remote', role: 'user', timestamp: 1 }],
      { scroll: false },
    );

    chatController.setMessages.mockClear();
    await runtime.restore(7, 'summary');
    expect(chatController.setMessages).not.toHaveBeenCalled();
  });
});
