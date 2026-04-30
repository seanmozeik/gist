import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { CacheState } from '../src/cache';
import { createDaemonUrlFlowContext } from '../src/daemon/flow-context';

describe('daemon/flow-context extractOnly', () => {
  it('sets extractMode when extractOnly is true', () => {
    const root = mkdtempSync(join(tmpdir(), 'gist-daemon-extract-only-'));
    const cache: CacheState = { maxBytes: 0, mode: 'bypass', path: null, store: null, ttlMs: 0 };

    const ctx = createDaemonUrlFlowContext({
      cache,
      env: { HOME: root, OPENAI_API_KEY: 'test' },
      extractOnly: true,
      fetchImpl: fetch,
      languageRaw: 'auto',
      lengthRaw: 'xl',
      maxExtractCharacters: 5000,
      modelOverride: 'openai/gpt-5-mini',
      promptOverride: null,
      runStartedAtMs: Date.now(),
      stdoutSink: {
        writeChunk: () => {
          /* Empty */
        },
      },
    });

    expect(ctx.flags.extractMode).toBe(true);
  });
});
