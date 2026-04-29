import type { Message } from '@mariozechner/pi-ai';

import { compactChatHistory, type ChatHistoryLimits } from './chat-state';
import { normalizePanelUrl } from './session-policy';
import type { ChatMessage } from './types';

function getChatHistoryKey(tabId: number, url?: string | null) {
  if (url) {
    try {
      const normalized = normalizePanelUrl(url);
      return `chat:tab:${tabId}:${normalized}`;
    } catch {
      // Fall through
    }
  }
  return `chat:tab:${tabId}`;
}

export function buildEmptyUsage() {
  return {
    cacheRead: 0,
    cacheWrite: 0,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
    input: 0,
    output: 0,
    totalTokens: 0,
  };
}

export function normalizeStoredMessage(raw: Record<string, unknown>): ChatMessage | null {
  const {role} = raw;
  const timestamp = typeof raw.timestamp === 'number' ? raw.timestamp : Date.now();
  const id = typeof raw.id === 'string' ? raw.id : crypto.randomUUID();

  if (role === 'user') {
    const {content} = raw;
    if (typeof content !== 'string' && !Array.isArray(content)) {return null;}
    return { ...(raw as Message), content, id, role: 'user', timestamp };
  }

  if (role === 'assistant') {
    const content = Array.isArray(raw.content)
      ? raw.content
      : (typeof raw.content === 'string'
        ? [{ type: 'text', text: raw.content }]
        : []);
    return {
      ...(raw as Message),
      api: typeof raw.api === 'string' ? raw.api : 'openai-completions',
      content,
      id,
      model: typeof raw.model === 'string' ? raw.model : 'unknown',
      provider: typeof raw.provider === 'string' ? raw.provider : 'openai',
      role: 'assistant',
      stopReason: typeof raw.stopReason === 'string' ? raw.stopReason : 'stop',
      timestamp,
      usage: typeof raw.usage === 'object' && raw.usage ? raw.usage : buildEmptyUsage(),
    };
  }

  if (role === 'toolResult') {
    const content = Array.isArray(raw.content)
      ? raw.content
      : (typeof raw.content === 'string'
        ? [{ type: 'text', text: raw.content }]
        : []);
    return {
      ...(raw as Message),
      content,
      id,
      isError: Boolean(raw.isError),
      role: 'toolResult',
      timestamp,
      toolCallId: typeof raw.toolCallId === 'string' ? raw.toolCallId : crypto.randomUUID(),
      toolName: typeof raw.toolName === 'string' ? raw.toolName : 'tool',
    };
  }

  return null;
}

export function createChatHistoryStore({
  chatLimits,
  getStorage = () => chrome.storage?.session,
}: {
  chatLimits: ChatHistoryLimits;
  getStorage?: () => chrome.storage.StorageArea | undefined;
}) {
  const cache = new Map<string, ChatMessage[]>();

  async function clear(tabId: number | null, url?: string | null) {
    if (!tabId) {return;}
    const key = getChatHistoryKey(tabId, url);
    cache.delete(key);
    const store = getStorage();
    if (!store) {return;}
    try {
      await store.remove(key);
    } catch {
      // Ignore
    }
  }

  async function load(tabId: number, url?: string | null): Promise<ChatMessage[] | null> {
    const key = getChatHistoryKey(tabId, url);
    const cached = cache.get(key);
    if (cached) {return cached;}
    const store = getStorage();
    if (!store) {return null;}
    try {
      const res = await store.get(key);
      const raw = res?.[key];
      if (!Array.isArray(raw)) {return null;}
      const parsed = raw
        .filter((msg) => msg && typeof msg === 'object')
        .map((msg) => normalizeStoredMessage(msg as Record<string, unknown>))
        .filter((msg): msg is ChatMessage => Boolean(msg));
      if (!parsed.length) {return null;}
      cache.set(key, parsed);
      return parsed;
    } catch {
      return null;
    }
  }

  async function persist(
    tabId: number | null,
    messages: ChatMessage[],
    chatEnabled: boolean,
    url?: string | null,
  ) {
    if (!chatEnabled || !tabId) {return messages;}
    const key = getChatHistoryKey(tabId, url);
    const compacted = compactChatHistory(messages, chatLimits);
    cache.set(key, compacted);
    const store = getStorage();
    if (!store) {return compacted;}
    try {
      await store.set({ [key]: compacted });
    } catch {
      // Ignore
    }
    return compacted;
  }

  return { clear, load, persist };
}
