import { describe, expect, it } from 'vitest';

import {
  buildChatRequestMessages,
  compactChatHistory,
  computeChatContextUsage,
  hasUserChatMessage,
} from '../apps/chrome-extension/src/entrypoints/sidepanel/chat-state';
import type { ChatMessage } from '../apps/chrome-extension/src/entrypoints/sidepanel/types';

const limits = { maxChars: 10, maxMessages: 3 };

describe('sidepanel/chat-state', () => {
  it('compacts chat history by max messages and chars', () => {
    const messages: ChatMessage[] = [
      { content: 'hello', id: '1', role: 'user', timestamp: 1 },
      { content: 'world', id: '2', role: 'assistant', timestamp: 2 },
      { content: '12345', id: '3', role: 'user', timestamp: 3 },
      { content: '67890', id: '4', role: 'assistant', timestamp: 4 },
    ];

    const compacted = compactChatHistory(messages, limits);
    expect(compacted.map((m) => m.id)).toEqual(['3', '4']);
  });

  it('computes context usage and user message presence', () => {
    const messages: ChatMessage[] = [
      { content: 'ok', id: '1', role: 'assistant', timestamp: 1 },
      { content: 'hi', id: '2', role: 'user', timestamp: 2 },
    ];

    const usage = computeChatContextUsage(messages, { maxChars: 10, maxMessages: 100 });
    expect(usage.totalChars).toBe(4);
    expect(usage.percent).toBe(40);
    expect(usage.totalMessages).toBe(2);
    expect(hasUserChatMessage(messages)).toBe(true);
  });

  it('builds chat request messages without empty content', () => {
    const messages: ChatMessage[] = [
      { content: 'hi', id: '1', role: 'assistant', timestamp: 1 },
      { content: '', id: '2', role: 'user', timestamp: 2 },
    ];

    expect(buildChatRequestMessages(messages)).toEqual([{ content: 'hi', role: 'assistant' }]);
  });

  it('counts array text parts, keeps tool results, and ignores unsupported roles', () => {
    const messages: ChatMessage[] = [
      { content: 'ignore me', id: '1', role: 'system', timestamp: 1 } as ChatMessage,
      {
        content: [
          { type: 'text', text: 'hello ' },
          { type: 'image', image: 'ignored' },
          { type: 'text', text: 'world' },
        ],
        id: '2',
        role: 'user',
        timestamp: 2,
      } as ChatMessage,
      { content: '', id: '3', role: 'toolResult', timestamp: 3 } as ChatMessage,
    ];

    const usage = computeChatContextUsage(messages, { maxChars: 5, maxMessages: 10 });
    expect(usage.totalChars).toBe(11);
    expect(usage.percent).toBe(100);
    expect(hasUserChatMessage(messages)).toBe(true);
    expect(buildChatRequestMessages(messages)).toEqual([
      {
        content: [
          { type: 'text', text: 'hello ' },
          { type: 'image', image: 'ignored' },
          { type: 'text', text: 'world' },
        ],
        role: 'user',
      },
      { content: '', role: 'toolResult' },
    ]);
  });

  it('drops empty user messages before compacting', () => {
    const messages: ChatMessage[] = [
      { content: '', id: '1', role: 'user', timestamp: 1 },
      { content: 'ok', id: '2', role: 'assistant', timestamp: 2 },
      { content: 'real', id: '3', role: 'user', timestamp: 3 },
    ];

    expect(
      compactChatHistory(messages, { maxChars: 100, maxMessages: 10 }).map((m) => m.id),
    ).toEqual(['2', '3']);
  });
});
