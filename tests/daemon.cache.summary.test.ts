import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { createCacheStore } from '../src/cache';
import { streamSummaryForVisiblePage } from '../src/daemon/gist';
import { makeAssistantMessage, makeTextDeltaStream } from './helpers/pi-ai-mock';

const mocks = vi.hoisted(() => ({
  getModel: vi.fn(() => {
    throw new Error('no model');
  }),
  streamSimple: vi.fn(),
}));

vi.mock('@mariozechner/pi-ai', () => ({
  getModel: mocks.getModel,
  streamSimple: mocks.streamSimple,
}));

describe('daemon summary cache', () => {
  it('reuses cached summary for visible page requests', async () => {
    mocks.streamSimple.mockImplementation(() =>
      makeTextDeltaStream(
        ['### Overview\n- Cached summary.\n'],
        makeAssistantMessage({
          text: '### Overview\n- Cached summary.\n',
          usage: { input: 1, output: 1, totalTokens: 2 },
        }),
      ),
    );
    mocks.streamSimple.mockClear();

    const root = mkdtempSync(join(tmpdir(), 'gist-daemon-cache-'));
    const gistDir = join(root, '.gist');
    const cacheDir = join(gistDir, 'cache');
    mkdirSync(cacheDir, { recursive: true });

    writeFileSync(
      join(cacheDir, 'litellm-model_prices_and_context_window.json'),
      JSON.stringify({ 'gpt-5.2': { max_input_tokens: 999_999 } }),
      'utf8',
    );
    writeFileSync(
      join(cacheDir, 'litellm-model_prices_and_context_window.meta.json'),
      JSON.stringify({ fetchedAtMs: Date.now() }),
      'utf8',
    );

    const globalFetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('unexpected LiteLLM catalog fetch');
    });

    const cachePath = join(gistDir, 'cache.sqlite');
    const store = await createCacheStore({ maxBytes: 1024 * 1024, path: cachePath });
    const cacheState = {
      maxBytes: 1024 * 1024,
      mode: 'default' as const,
      path: cachePath,
      store,
      ttlMs: 30 * 24 * 60 * 60 * 1000,
    };

    const runOnce = async () => {
      let out = '';
      const sink = {
        onModelChosen: () => {
          /* Empty */
        },
        writeChunk: (text: string) => {
          out += text;
        },
      };

      const result = await streamSummaryForVisiblePage({
        cache: cacheState,
        env: { HOME: root, OPENAI_API_KEY: 'test' },
        fetchImpl: globalThis.fetch.bind(globalThis),
        input: {
          text: 'Content',
          title: 'Hello',
          truncated: false,
          url: 'https://example.com/article',
        },
        languageRaw: 'auto',
        lengthRaw: 'xl',
        modelOverride: 'openai/gpt-5.2',
        promptOverride: null,
        sink,
      });

      return { metrics: result.metrics, out };
    };

    const first = await runOnce();
    expect(mocks.streamSimple).toHaveBeenCalledTimes(1);

    const second = await runOnce();
    expect(mocks.streamSimple).toHaveBeenCalledTimes(1);
    expect(second.out).toBe(first.out);
    expect(second.metrics.summary.split(' · ')[0]).toBe('Cached');

    store.close();
    globalFetchSpy.mockRestore();
  });
});
