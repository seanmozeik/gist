import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import type { CacheStore } from '../src/cache';
import { gistMediaFile } from '../src/run/flows/asset/media';
import type { AssetSummaryContext } from '../src/run/flows/asset/summary';

const createLinkPreviewClient = vi.hoisted(() => vi.fn());

vi.mock('../src/content/index.js', () => ({ createLinkPreviewClient }));

function makeContext(overrides: Partial<AssetSummaryContext>): AssetSummaryContext {
  const stderr = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  return {
    apiStatus: {
      anthropicConfigured: false,
      apiKey: null,
      apifyToken: null,
      firecrawlConfigured: false,
      googleConfigured: false,
      openrouterApiKey: null,
      providerBaseUrls: { anthropic: null, google: null, openai: null, xai: null },
      xaiApiKey: null,
      zaiApiKey: null,
      zaiBaseUrl: '',
    },
    cache: { maxBytes: 0, mode: 'default', path: null, store: null, ttlMs: 0 },
    env: { OPENAI_API_KEY: 'test-key' },
    forceSummary: false,
    mediaCache: null,
    stderr,
    summaryCacheBypass: false,
    timeoutMs: 1234,
    trackedFetch: vi.fn(),
    verbose: false,
    verboseColor: false,
    ...overrides,
  } as AssetSummaryContext;
}

describe('gistMediaFile options', () => {
  it('passes timeout/cacheMode and bypasses transcript cache when cache is disabled', async () => {
    createLinkPreviewClient.mockReset();
    const root = mkdtempSync(join(tmpdir(), 'gist-media-options-bypass-'));
    const audioPath = join(root, 'audio.mp3');
    writeFileSync(audioPath, Buffer.from([0xff, 0xfb, 0x10, 0x00]));

    let capturedClientOptions: { transcriptCache?: unknown | null } | null = null;
    let capturedFetchOptions: { cacheMode?: string; timeoutMs?: number } | null = null;

    createLinkPreviewClient.mockImplementation((options: unknown) => {
      capturedClientOptions = options;
      return {
        fetchLinkContent: async (_url: string, optionsArg: unknown) => {
          capturedFetchOptions = optionsArg;
          throw new Error('boom');
        },
      };
    });

    const ctx = makeContext({
      cache: {
        maxBytes: 0,
        mode: 'bypass',
        path: null,
        store: { transcriptCache: {} } as CacheStore,
        ttlMs: 0,
      },
      timeoutMs: 3456,
    });

    await expect(
      gistMediaFile(ctx, {
        attachment: {
          bytes: new Uint8Array(),
          filename: 'audio.mp3',
          kind: 'file',
          mediaType: 'audio/mpeg',
        },
        sourceKind: 'file',
        sourceLabel: audioPath,
      }),
    ).rejects.toThrow(/Transcription failed/);

    expect(capturedClientOptions?.transcriptCache ?? null).toBeNull();
    expect(capturedFetchOptions?.cacheMode).toBe('bypass');
    expect(capturedFetchOptions?.timeoutMs).toBe(3456);
  });

  it('uses transcript cache and default cache mode when enabled', async () => {
    createLinkPreviewClient.mockReset();
    const root = mkdtempSync(join(tmpdir(), 'gist-media-options-default-'));
    const audioPath = join(root, 'audio.mp3');
    writeFileSync(audioPath, Buffer.from([0xff, 0xfb, 0x10, 0x00]));

    let capturedClientOptions: { transcriptCache?: unknown | null } | null = null;
    let capturedFetchOptions: { cacheMode?: string; timeoutMs?: number } | null = null;

    const transcriptCache = {};

    createLinkPreviewClient.mockImplementation((options: unknown) => {
      capturedClientOptions = options;
      return {
        fetchLinkContent: async (_url: string, optionsArg: unknown) => {
          capturedFetchOptions = optionsArg;
          throw new Error('boom');
        },
      };
    });

    const ctx = makeContext({
      cache: {
        maxBytes: 0,
        mode: 'default',
        path: null,
        store: { transcriptCache } as CacheStore,
        ttlMs: 0,
      },
      timeoutMs: 5678,
    });

    await expect(
      gistMediaFile(ctx, {
        attachment: {
          bytes: new Uint8Array(),
          filename: 'audio.mp3',
          kind: 'file',
          mediaType: 'audio/mpeg',
        },
        sourceKind: 'file',
        sourceLabel: audioPath,
      }),
    ).rejects.toThrow(/Transcription failed/);

    expect(capturedClientOptions?.transcriptCache).toBe(transcriptCache);
    expect(capturedFetchOptions?.cacheMode).toBe('default');
    expect(capturedFetchOptions?.timeoutMs).toBe(5678);
  });
});
