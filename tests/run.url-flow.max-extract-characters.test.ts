import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { CacheState } from '../src/cache.js';
import type { ExtractedLinkContent } from '../src/content/index.js';
import { createDaemonUrlFlowContext } from '../src/daemon/flow-context.js';
import { runUrlFlow } from '../src/run/flows/url/flow.js';

describe('runUrlFlow', () => {
  it('honors ctx.flags.maxExtractCharacters (for daemon/extension)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gist-url-flow-maxchars-'));
    const url = 'https://example.com/article';
    const content = `<!doctype html><html><head><title>Hello</title></head><body><article>${'word '.repeat(5000)}</article></body></html>`;

    const fetchImpl: typeof fetch = async (input) => {
      const requestUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (requestUrl !== url) {
        throw new Error(`unexpected fetch: ${requestUrl}`);
      }
      return new Response(content, {
        headers: { 'content-type': 'text/html; charset=utf-8' },
        status: 200,
      });
    };

    const cache: CacheState = { maxBytes: 0, mode: 'bypass', path: null, store: null, ttlMs: 0 };

    let extracted: ExtractedLinkContent | null = null;
    const ctx = createDaemonUrlFlowContext({
      cache,
      env: { HOME: root, OPENAI_API_KEY: 'test' },
      fetchImpl,
      hooks: {
        onExtracted: (value) => {
          extracted = value;
        },
      },
      languageRaw: 'auto',
      lengthRaw: 'xl',
      maxExtractCharacters: 9000,
      modelOverride: 'openai/gpt-5.2',
      promptOverride: null,
      runStartedAtMs: Date.now(),
      stdoutSink: {
        writeChunk: () => {
          /* Empty */
        },
      },
    });

    ctx.flags.extractMode = true;

    await runUrlFlow({ ctx, isYoutubeUrl: false, url });

    expect(extracted).not.toBeNull();
    expect(extracted?.content.length).toBeLessThanOrEqual(9000);
    expect(extracted?.truncated).toBe(true);
  }, 20_000);

  it('leaves extract-only uncapped when no max is provided', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gist-url-flow-maxchars-'));
    const url = 'https://example.com/long';
    const content = `<!doctype html><html><head><title>Long</title></head><body><article>${'lorem ipsum '.repeat(3000)}</article></body></html>`;

    const fetchImpl: typeof fetch = async (input) => {
      const requestUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (requestUrl !== url) {
        throw new Error(`unexpected fetch: ${requestUrl}`);
      }
      return new Response(content, {
        headers: { 'content-type': 'text/html; charset=utf-8' },
        status: 200,
      });
    };

    const cache: CacheState = { maxBytes: 0, mode: 'bypass', path: null, store: null, ttlMs: 0 };

    let extracted: ExtractedLinkContent | null = null;
    const ctx = createDaemonUrlFlowContext({
      cache,
      env: { HOME: root, OPENAI_API_KEY: 'test' },
      extractOnly: true,
      fetchImpl,
      hooks: {
        onExtracted: (value) => {
          extracted = value;
        },
      },
      languageRaw: 'auto',
      lengthRaw: 'xl',
      maxExtractCharacters: null,
      modelOverride: 'openai/gpt-5.2',
      promptOverride: null,
      runStartedAtMs: Date.now(),
      stdoutSink: {
        writeChunk: () => {
          /* Empty */
        },
      },
    });

    await runUrlFlow({ ctx, isYoutubeUrl: false, url });

    expect(extracted).not.toBeNull();
    expect(extracted?.truncated).toBe(false);
    expect(extracted?.content.length).toBeGreaterThan(20_000);
  }, 20_000);
});
