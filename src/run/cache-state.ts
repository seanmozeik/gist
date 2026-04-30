import { existsSync } from 'node:fs';

import {
  type CacheState,
  createCacheStore,
  DEFAULT_CACHE_MAX_MB,
  DEFAULT_CACHE_TTL_DAYS,
  resolveCachePath,
} from '../cache.js';
import type { GistConfig } from '../config';

export async function createCacheStateFromConfig({
  envForRun,
  config,
  noCacheFlag = false,
  transcriptNamespace = null,
}: {
  envForRun: Record<string, string | undefined>;
  config: GistConfig | null;
  noCacheFlag?: boolean;
  transcriptNamespace?: string | null;
}): Promise<CacheState> {
  const cacheEnabled = config?.cache?.enabled !== false;
  const cachePath = resolveCachePath({ cachePath: config?.cache?.path ?? null, env: envForRun });
  const cacheMaxMb =
    typeof config?.cache?.maxMb === 'number' ? config.cache.maxMb : DEFAULT_CACHE_MAX_MB;
  const cacheTtlDays =
    typeof config?.cache?.ttlDays === 'number' ? config.cache.ttlDays : DEFAULT_CACHE_TTL_DAYS;
  const cacheMaxBytes = Math.max(0, cacheMaxMb) * 1024 * 1024;
  const cacheTtlMs = Math.max(0, cacheTtlDays) * 24 * 60 * 60 * 1000;
  const cacheMode: CacheState['mode'] =
    !cacheEnabled || noCacheFlag || !cachePath ? 'bypass' : 'default';
  const cacheStore =
    cacheMode === 'default' && cachePath
      ? await createCacheStore({ maxBytes: cacheMaxBytes, path: cachePath, transcriptNamespace })
      : null;

  return {
    maxBytes: cacheMaxBytes,
    mode: cacheMode,
    path: cachePath,
    store: cacheStore,
    ttlMs: cacheTtlMs,
  };
}

export async function refreshCacheStoreIfMissing({
  cacheState,
  transcriptNamespace = null,
}: {
  cacheState: CacheState;
  transcriptNamespace?: string | null;
}): Promise<boolean> {
  if (cacheState.mode !== 'default') {
    return false;
  }
  const { path } = cacheState;
  if (!path) {
    return false;
  }
  const fileExists = existsSync(path);
  if (cacheState.store) {
    // Keep the existing store to avoid closing statements while requests are in flight.
    if (fileExists) {
      return false;
    }
    cacheState.store.close();
  }
  cacheState.store = await createCacheStore({
    maxBytes: cacheState.maxBytes,
    path,
    transcriptNamespace,
  });
  return true;
}
