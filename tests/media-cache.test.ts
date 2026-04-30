import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createMediaCache } from '../src/media-cache.js';

const makeTempDir = async (prefix: string) => {
  return mkdtemp(join(tmpdir(), prefix));
};

describe('media cache', () => {
  it('stores and reuses cached media', async () => {
    const cacheDir = await makeTempDir('gist-media-cache-');
    try {
      const cache = await createMediaCache({
        maxBytes: 10 * 1024 * 1024,
        path: cacheDir,
        ttlMs: 60_000,
        verify: 'size',
      });
      const tempFile = join(cacheDir, 'source.bin');
      const bytes = new Uint8Array([1, 2, 3, 4, 5]);
      await writeFile(tempFile, bytes);

      const stored = await cache.put({
        filePath: tempFile,
        filename: 'media.mp4',
        mediaType: 'video/mp4',
        url: 'https://example.com/media.mp4',
      });
      expect(stored).not.toBeNull();
      if (!stored) {
        return;
      }
      const storedStat = await stat(stored.filePath);
      expect(storedStat.size).toBe(bytes.length);

      const cached = await cache.get({ url: 'https://example.com/media.mp4' });
      expect(cached?.filePath).toBe(stored.filePath);
    } finally {
      await rm(cacheDir, { force: true, recursive: true });
    }
  });

  it('uses .m3u8 for HLS playlist media types without filenames', async () => {
    const cacheDir = await makeTempDir('gist-media-cache-');
    try {
      const cache = await createMediaCache({
        maxBytes: 10 * 1024 * 1024,
        path: cacheDir,
        ttlMs: 60_000,
        verify: 'size',
      });
      const tempFile = join(cacheDir, 'playlist.bin');
      await writeFile(tempFile, '#EXTM3U\n');

      const stored = await cache.put({
        filePath: tempFile,
        filename: null,
        mediaType: 'application/vnd.apple.mpegurl',
        url: 'https://example.com/live',
      });
      expect(stored?.filePath.endsWith('.m3u8')).toBe(true);
    } finally {
      await rm(cacheDir, { force: true, recursive: true });
    }
  });

  it('ignores non-http urls and keeps source intact', async () => {
    const cacheDir = await makeTempDir('gist-media-cache-');
    try {
      const cache = await createMediaCache({
        maxBytes: 10 * 1024 * 1024,
        path: cacheDir,
        ttlMs: 60_000,
        verify: 'size',
      });
      const tempFile = join(cacheDir, 'local.bin');
      await writeFile(tempFile, new Uint8Array([1, 2, 3]));

      const stored = await cache.put({
        filePath: tempFile,
        filename: 'local.mp4',
        mediaType: 'video/mp4',
        url: 'file:///tmp/local.bin',
      });
      expect(stored).toBeNull();
      const cached = await cache.get({ url: 'file:///tmp/local.bin' });
      expect(cached).toBeNull();
      await expect(stat(tempFile)).resolves.toBeDefined();
    } finally {
      await rm(cacheDir, { force: true, recursive: true });
    }
  });

  it('evicts least-recently-used entries when max size is exceeded', async () => {
    const cacheDir = await makeTempDir('gist-media-cache-');
    try {
      const cache = await createMediaCache({
        maxBytes: 10,
        path: cacheDir,
        ttlMs: 60_000,
        verify: 'size',
      });
      const fileA = join(cacheDir, 'a.bin');
      const fileB = join(cacheDir, 'b.bin');
      await writeFile(fileA, new Uint8Array(8));
      await writeFile(fileB, new Uint8Array(8));

      await cache.put({
        filePath: fileA,
        filename: 'a.mp3',
        mediaType: 'audio/mpeg',
        url: 'https://example.com/a',
      });
      await cache.put({
        filePath: fileB,
        filename: 'b.mp3',
        mediaType: 'audio/mpeg',
        url: 'https://example.com/b',
      });

      const hitA = await cache.get({ url: 'https://example.com/a' });
      const hitB = await cache.get({ url: 'https://example.com/b' });
      expect(hitA).toBeNull();
      expect(hitB).not.toBeNull();
    } finally {
      await rm(cacheDir, { force: true, recursive: true });
    }
  });

  it('expires entries when ttl has elapsed', async () => {
    const cacheDir = await makeTempDir('gist-media-cache-');
    try {
      const cache = await createMediaCache({
        maxBytes: 1024 * 1024,
        path: cacheDir,
        ttlMs: 60_000,
        verify: 'size',
      });
      const tempFile = join(cacheDir, 'expired.bin');
      await writeFile(tempFile, new Uint8Array([7, 7, 7, 7]));

      const stored = await cache.put({
        filePath: tempFile,
        filename: 'expired.mp3',
        mediaType: 'audio/mpeg',
        url: 'https://example.com/expired',
      });
      expect(stored).not.toBeNull();
      if (!stored) {
        return;
      }

      const indexPath = join(cacheDir, 'index.json');
      const raw = await readFile(indexPath, 'utf8');
      const parsed = JSON.parse(raw) as {
        entries?: Record<string, { expiresAtMs?: number | null }>;
      };
      const entries = parsed.entries ?? {};
      for (const entry of Object.values(entries)) {
        entry.expiresAtMs = Date.now() - 1;
      }
      await writeFile(indexPath, JSON.stringify({ entries, version: 1 }));

      const cached = await cache.get({ url: 'https://example.com/expired' });
      expect(cached).toBeNull();
      await expect(stat(stored.filePath)).rejects.toBeDefined();
    } finally {
      await rm(cacheDir, { force: true, recursive: true });
    }
  });

  it('skips caching when file exceeds max size', async () => {
    const cacheDir = await makeTempDir('gist-media-cache-');
    try {
      const cache = await createMediaCache({
        maxBytes: 4,
        path: cacheDir,
        ttlMs: 60_000,
        verify: 'size',
      });
      const tempFile = join(cacheDir, 'big.bin');
      await writeFile(tempFile, new Uint8Array([1, 2, 3, 4, 5]));

      const stored = await cache.put({
        filePath: tempFile,
        filename: 'big.mp4',
        mediaType: 'video/mp4',
        url: 'https://example.com/big',
      });
      expect(stored).toBeNull();
      await expect(stat(tempFile)).resolves.toBeDefined();
    } finally {
      await rm(cacheDir, { force: true, recursive: true });
    }
  });

  it('drops cached files with size mismatches', async () => {
    const cacheDir = await makeTempDir('gist-media-cache-');
    try {
      const cache = await createMediaCache({
        maxBytes: 1024 * 1024,
        path: cacheDir,
        ttlMs: 60_000,
        verify: 'size',
      });
      const tempFile = join(cacheDir, 'size.bin');
      await writeFile(tempFile, new Uint8Array([2, 2, 2, 2]));

      const stored = await cache.put({
        filePath: tempFile,
        filename: 'size.mp3',
        mediaType: 'audio/mpeg',
        url: 'https://example.com/size',
      });
      expect(stored).not.toBeNull();
      if (!stored) {
        return;
      }

      await writeFile(stored.filePath, new Uint8Array([1, 1]));
      const cached = await cache.get({ url: 'https://example.com/size' });
      expect(cached).toBeNull();
      await expect(stat(stored.filePath)).rejects.toBeDefined();
    } finally {
      await rm(cacheDir, { force: true, recursive: true });
    }
  });

  it('drops cached files with hash mismatches', async () => {
    const cacheDir = await makeTempDir('gist-media-cache-');
    try {
      const cache = await createMediaCache({
        maxBytes: 1024 * 1024,
        path: cacheDir,
        ttlMs: 60_000,
        verify: 'hash',
      });
      const tempFile = join(cacheDir, 'hash.bin');
      await writeFile(tempFile, new Uint8Array([9, 9, 9]));

      const stored = await cache.put({
        filePath: tempFile,
        filename: 'hash.mp3',
        mediaType: 'audio/mpeg',
        url: 'https://example.com/hash',
      });
      expect(stored).not.toBeNull();
      if (!stored) {
        return;
      }

      await writeFile(stored.filePath, new Uint8Array([1, 1, 1]));
      const cached = await cache.get({ url: 'https://example.com/hash' });
      expect(cached).toBeNull();
    } finally {
      await rm(cacheDir, { force: true, recursive: true });
    }
  });

  it('updates metadata when verify is none', async () => {
    const cacheDir = await makeTempDir('gist-media-cache-');
    try {
      const cache = await createMediaCache({
        maxBytes: 1024 * 1024,
        path: cacheDir,
        ttlMs: 60_000,
        verify: 'none',
      });
      const tempFile = join(cacheDir, 'none.bin');
      await writeFile(tempFile, new Uint8Array([4, 4, 4]));

      const stored = await cache.put({
        filePath: tempFile,
        filename: 'none.mp4',
        mediaType: 'video/mp4',
        url: 'https://example.com/none',
      });
      expect(stored).not.toBeNull();
      if (!stored) {
        return;
      }

      await writeFile(stored.filePath, new Uint8Array([4, 4, 4, 4, 4]));
      const cached = await cache.get({ url: 'https://example.com/none' });
      expect(cached).not.toBeNull();
      expect(cached?.sizeBytes).toBe(5);

      const indexRaw = await readFile(join(cacheDir, 'index.json'), 'utf8');
      expect(indexRaw).toContain('"sizeBytes":5');
    } finally {
      await rm(cacheDir, { force: true, recursive: true });
    }
  });

  it('recovers from a corrupted index', async () => {
    const cacheDir = await makeTempDir('gist-media-cache-');
    try {
      await writeFile(join(cacheDir, 'index.json'), '{nope');
      const cache = await createMediaCache({
        maxBytes: 1024 * 1024,
        path: cacheDir,
        ttlMs: 60_000,
        verify: 'size',
      });
      const tempFile = join(cacheDir, 'recover.bin');
      await writeFile(tempFile, new Uint8Array([6, 6, 6]));

      const stored = await cache.put({
        filePath: tempFile,
        filename: 'recover.mp4',
        mediaType: 'video/mp4',
        url: 'https://example.com/recover',
      });
      expect(stored).not.toBeNull();
      const cached = await cache.get({ url: 'https://example.com/recover' });
      expect(cached?.filePath).toBe(stored?.filePath);
    } finally {
      await rm(cacheDir, { force: true, recursive: true });
    }
  });
});
