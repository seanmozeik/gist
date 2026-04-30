import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { clearCacheFiles, createCacheStore } from '../src/cache';
import { refreshCacheStoreIfMissing } from '../src/run/cache-state';

describe('cache state refresh', () => {
  it('recreates the cache store after the database file is removed', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gist-cache-refresh-'));
    const cachePath = join(root, 'cache.sqlite');

    const store = await createCacheStore({ maxBytes: 1024 * 1024, path: cachePath });
    store.setText('summary', 'key', 'value', null);
    expect(store.getText('summary', 'key')).toBe('value');

    const cacheState = {
      maxBytes: 1024 * 1024,
      mode: 'default' as const,
      path: cachePath,
      store,
      ttlMs: 60_000,
    };

    clearCacheFiles(cachePath);
    expect(existsSync(cachePath)).toBe(false);

    const refreshed = await refreshCacheStoreIfMissing({ cacheState });
    expect(refreshed).toBe(true);
    expect(cacheState.store).not.toBe(store);
    expect(cacheState.store?.getText('summary', 'key')).toBeNull();
    expect(existsSync(cachePath)).toBe(true);
  });
});
