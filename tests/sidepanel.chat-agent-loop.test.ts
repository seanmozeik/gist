import { describe, expect, it, vi } from 'vitest';

import { runChatAgentLoop } from '../apps/chrome-extension/src/entrypoints/sidepanel/chat-agent-loop';

function createController() {
  return {
    addMessage: vi.fn(),
    buildRequestMessages: vi.fn(() => [{ content: 'hi', role: 'user' }]),
    finishStreamingMessage: vi.fn(),
    removeMessage: vi.fn(),
    replaceMessage: vi.fn(),
    updateStreamingMessage: vi.fn(),
  };
}

describe('sidepanel chat agent loop', () => {
  it('streams assistant content and stops when no tool calls remain', async () => {
    const controller = createController();
    const chatSession = {
      isAbortRequested: vi.fn(() => false),
      requestAgent: vi.fn(async (_messages, _tools, _summary, opts) => {
        opts?.onChunk?.('Hello');
        return {
          assistant: { content: [{ text: 'Hello', type: 'text' }], role: 'assistant' },
          ok: true,
        };
      }),
    };

    await runChatAgentLoop({
      automationEnabled: true,
      chatController: controller as never,
      chatSession,
      createStreamingAssistantMessage: () =>
        ({ content: [], id: 'stream', role: 'assistant' }) as never,
      executeToolCall: vi.fn(),
      getAutomationToolNames: () => ['debugger', 'navigate'],
      hasDebuggerPermission: async () => false,
      markAgentNavigationIntent: vi.fn(),
      markAgentNavigationResult: vi.fn(),
      scrollToBottom: vi.fn(),
      summaryMarkdown: 'summary',
      wrapMessage: vi.fn((message) => ({ ...message, id: 'wrapped' }) as never),
    });

    expect(chatSession.requestAgent).toHaveBeenCalledWith(
      [{ content: 'hi', role: 'user' }],
      ['navigate'],
      'summary',
      expect.objectContaining({ onChunk: expect.any(Function) }),
    );
    expect(controller.updateStreamingMessage).toHaveBeenCalledWith('Hello');
    expect(controller.replaceMessage).toHaveBeenCalled();
    expect(controller.finishStreamingMessage).toHaveBeenCalled();
  });

  it('executes tool calls and appends tool results', async () => {
    const controller = createController();
    const toolCall = {
      arguments: { url: 'https://example.com' },
      name: 'navigate',
      toolCallId: '1',
      type: 'toolCall',
    };
    const requestAgent = vi
      .fn()
      .mockResolvedValueOnce({ assistant: { content: [toolCall], role: 'assistant' }, ok: true })
      .mockResolvedValueOnce({
        assistant: { content: [{ text: 'done', type: 'text' }], role: 'assistant' },
        ok: true,
      });
    const executeToolCall = vi.fn(async () => ({
      content: [{ text: 'navigated', type: 'text' }],
      details: { ok: true },
      isError: false,
      role: 'toolResult',
      toolName: 'navigate',
    }));
    const markIntent = vi.fn();
    const markResult = vi.fn();
    const wrapMessage = vi.fn((message) => ({ ...message, id: 'tool-message' }) as never);

    await runChatAgentLoop({
      automationEnabled: true,
      chatController: controller as never,
      chatSession: { isAbortRequested: vi.fn(() => false), requestAgent },
      createStreamingAssistantMessage: () =>
        ({ content: [], id: crypto.randomUUID(), role: 'assistant' }) as never,
      executeToolCall,
      getAutomationToolNames: () => ['navigate'],
      hasDebuggerPermission: async () => true,
      markAgentNavigationIntent: markIntent,
      markAgentNavigationResult: markResult,
      scrollToBottom: vi.fn(),
      summaryMarkdown: null,
      wrapMessage,
    });

    expect(executeToolCall).toHaveBeenCalledWith(toolCall);
    expect(markIntent).toHaveBeenCalledWith('https://example.com');
    expect(markResult).toHaveBeenCalledWith({ ok: true });
    expect(wrapMessage).toHaveBeenCalled();
    expect(controller.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'tool-message' }),
    );
  });

  it('treats plain string assistant content as no tool calls', async () => {
    const controller = createController();
    const chatSession = {
      isAbortRequested: vi.fn(() => false),
      requestAgent: vi.fn(async (_messages, _tools, _summary, opts) => {
        opts?.onChunk?.('Plain reply');
        return { assistant: { content: 'Plain reply', role: 'assistant' }, ok: true };
      }),
    };
    const executeToolCall = vi.fn();

    await runChatAgentLoop({
      automationEnabled: true,
      chatController: controller as never,
      chatSession,
      createStreamingAssistantMessage: () =>
        ({ content: [], id: 'stream', role: 'assistant' }) as never,
      executeToolCall,
      getAutomationToolNames: () => ['navigate'],
      hasDebuggerPermission: async () => true,
      markAgentNavigationIntent: vi.fn(),
      markAgentNavigationResult: vi.fn(),
      scrollToBottom: vi.fn(),
      summaryMarkdown: null,
      wrapMessage: vi.fn((message) => ({ ...message, id: 'wrapped' }) as never),
    });

    expect(controller.updateStreamingMessage).toHaveBeenCalledWith('Plain reply');
    expect(controller.replaceMessage).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'Plain reply' }),
    );
    expect(executeToolCall).not.toHaveBeenCalled();
  });

  it('removes the placeholder message on request failure', async () => {
    const controller = createController();
    const chatSession = {
      isAbortRequested: vi.fn(() => false),
      requestAgent: vi.fn(async () => {
        throw new Error('boom');
      }),
    };

    await expect(
      runChatAgentLoop({
        automationEnabled: false,
        chatController: controller as never,
        chatSession,
        createStreamingAssistantMessage: () =>
          ({ content: [], id: 'stream', role: 'assistant' }) as never,
        executeToolCall: vi.fn(),
        getAutomationToolNames: () => [],
        hasDebuggerPermission: async () => true,
        markAgentNavigationIntent: vi.fn(),
        markAgentNavigationResult: vi.fn(),
        scrollToBottom: vi.fn(),
        summaryMarkdown: null,
        wrapMessage: vi.fn((message) => ({ ...message, id: 'wrapped' }) as never),
      }),
    ).rejects.toThrow('boom');

    expect(controller.removeMessage).toHaveBeenCalledWith('stream');
  });
});
