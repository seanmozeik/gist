import type { PanelCachePayload } from '../../lib/panel-contracts';

export type { PanelCachePayload } from '../../lib/panel-contracts';

export interface PanelCacheResponse { requestId: string; ok: boolean; cache?: PanelCachePayload }

export interface PanelCacheRequest { requestId: string; tabId: number; url: string }

export interface PanelCacheResult {
  tabId: number;
  url: string;
  preserveChat: boolean;
  cache: PanelCachePayload | null;
}

export interface PanelCacheController {
  resolve: (tabId: number, url: string) => PanelCachePayload | null;
  scheduleSync: (delayMs?: number) => void;
  syncNow: () => void;
  request: (tabId: number, url: string, preserveChat: boolean) => PanelCacheRequest;
  consumeResponse: (response: PanelCacheResponse) => PanelCacheResult | null;
}

export interface PanelCacheControllerOptions {
  getSnapshot: () => PanelCachePayload | null;
  sendCache: (payload: PanelCachePayload) => void;
  sendRequest: (request: PanelCacheRequest) => void;
}

export function createPanelCacheController(
  options: PanelCacheControllerOptions,
): PanelCacheController {
  const { getSnapshot, sendCache, sendRequest } = options;
  const cacheByKey = new Map<string, PanelCachePayload>();
  let syncTimer = 0;
  let requestCounter = 0;
  let pendingRequest: {
    requestId: string;
    tabId: number;
    url: string;
    preserveChat: boolean;
  } | null = null;

  const buildKey = (tabId: number, url: string) => `${tabId}:${url}`;

  const store = (payload: PanelCachePayload) => {
    for (const key of cacheByKey.keys()) {
      if (key.startsWith(`${payload.tabId}:`) && key !== buildKey(payload.tabId, payload.url)) {
        cacheByKey.delete(key);
      }
    }
    cacheByKey.set(buildKey(payload.tabId, payload.url), payload);
  };

  const resolve = (tabId: number, url: string) => cacheByKey.get(buildKey(tabId, url)) ?? null;

  const syncNow = () => {
    const snapshot = getSnapshot();
    if (!snapshot) {return;}
    store(snapshot);
    sendCache(snapshot);
  };

  const scheduleSync = (delayMs = 800) => {
    const snapshot = getSnapshot();
    if (snapshot) {
      store(snapshot);
    }
    if (syncTimer) {globalThis.clearTimeout(syncTimer);}
    syncTimer = globalThis.setTimeout(() => {
      syncTimer = 0;
      syncNow();
    }, delayMs);
  };

  const request = (tabId: number, url: string, preserveChat: boolean): PanelCacheRequest => {
    const requestId = `cache-${++requestCounter}`;
    pendingRequest = { preserveChat, requestId, tabId, url };
    const payload = { requestId, tabId, url };
    sendRequest(payload);
    return payload;
  };

  const consumeResponse = (response: PanelCacheResponse): PanelCacheResult | null => {
    if (!pendingRequest || response.requestId !== pendingRequest.requestId) {return null;}
    const pending = pendingRequest;
    pendingRequest = null;
    if (!response.ok || !response.cache) {
      return {
        cache: null,
        preserveChat: pending.preserveChat,
        tabId: pending.tabId,
        url: pending.url,
      };
    }
    store(response.cache);
    return {
      cache: response.cache,
      preserveChat: pending.preserveChat,
      tabId: pending.tabId,
      url: pending.url,
    };
  };

  return { consumeResponse, request, resolve, scheduleSync, syncNow };
}
