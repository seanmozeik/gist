import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createChatSession } from '../apps/chrome-extension/src/entrypoints/sidepanel/chat-session.js';

describe('sidepanel chat session', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('routes agent responses and chunks to the matching pending request', async () => {
    const send = vi.fn(async () => {});
    const chunks: string[] = [];
    const session = createChatSession({ send });
    const request = session.requestAgent([], ['navigate'], 'summary', {
      onChunk: (text) => chunks.push(text),
    });

    const requestId = vi.mocked(send).mock.calls[0]?.[0]?.requestId;
    session.handleAgentChunk({ requestId, text: 'Hello' });
    session.handleAgentResponse({
      assistant: { content: [{ type: 'text', text: 'Done' }], role: 'assistant' } as never,
      ok: true,
      requestId,
    });

    await expect(request).resolves.toEqual({
      assistant: { content: [{ text: 'Done', type: 'text' }], role: 'assistant' },
      error: undefined,
      ok: true,
    });
    expect(chunks).toEqual(['Hello']);
  });

  it('times out requests and aborts active agent work', async () => {
    vi.useFakeTimers();
    const setStatus = vi.fn();
    const hideReplOverlay = vi.fn(async () => {});
    const send = vi.fn(async () => {});
    const session = createChatSession({ agentTimeoutMs: 10, hideReplOverlay, send, setStatus });

    const request = session.requestAgent([], [], null);
    request.catch(() => {});
    await vi.advanceTimersByTimeAsync(10);
    await expect(request).rejects.toThrow('Agent request timed out');

    const second = session.requestAgent([], [], null);
    second.catch(() => {});
    session.requestAbort('Stopped');
    await expect(second).rejects.toThrow('Stopped');
    expect(session.isAbortRequested()).toBe(true);
    expect(setStatus).toHaveBeenCalledWith('Stopped');
    expect(hideReplOverlay).toHaveBeenCalled();
  });

  it('loads chat history responses and supports reset', async () => {
    const send = vi.fn(async () => {});
    const session = createChatSession({ send });
    const request = session.requestChatHistory('summary');
    const requestId = vi.mocked(send).mock.calls[0]?.[0]?.requestId;

    session.handleChatHistoryResponse({
      messages: [{ content: 'hi', role: 'user' }] as never,
      ok: true,
      requestId,
    });
    await expect(request).resolves.toEqual({
      error: undefined,
      messages: [{ content: 'hi', role: 'user' }],
      ok: true,
    });

    session.resetAbort();
    expect(session.isAbortRequested()).toBe(false);
    session.reset();
    expect(session.isAbortRequested()).toBe(false);
  });
});
