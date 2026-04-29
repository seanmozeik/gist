import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  loadLiteLlmCatalog,
  resolveLiteLlmMaxInputTokensForModelId,
  resolveLiteLlmMaxOutputTokensForModelId,
  resolveLiteLlmPricingForModelId,
} from '../src/pricing/litellm.js';

describe('LiteLLM pricing catalog', () => {
  it('resolves pricing for common gateway-style ids', () => {
    const catalog = {
      'claude-sonnet-4-5': { input_cost_per_token: 0.000_003, output_cost_per_token: 0.000_015 },
      'gemini-3-flash-preview': {
        input_cost_per_token: 0.000_000_1,
        output_cost_per_token: 0.000_000_2,
      },
      'gpt-5.2': { input_cost_per_token: 0.000_001_75, output_cost_per_token: 0.000_014 },
      'xai/grok-4-fast-non-reasoning': {
        input_cost_per_token: 0.000_000_2,
        output_cost_per_token: 0.000_000_5,
      },
    };

    expect(resolveLiteLlmPricingForModelId(catalog, 'openai/gpt-5.2')).toEqual({
      inputUsdPerToken: 0.000_001_75,
      outputUsdPerToken: 0.000_014,
    });
    expect(resolveLiteLlmPricingForModelId(catalog, 'anthropic/claude-sonnet-4-5')).toEqual({
      inputUsdPerToken: 0.000_003,
      outputUsdPerToken: 0.000_015,
    });
    expect(resolveLiteLlmPricingForModelId(catalog, 'google/gemini-3-flash-preview')).toEqual({
      inputUsdPerToken: 0.000_000_1,
      outputUsdPerToken: 0.000_000_2,
    });
    expect(resolveLiteLlmPricingForModelId(catalog, 'xai/grok-4-fast-non-reasoning')).toEqual({
      inputUsdPerToken: 0.000_000_2,
      outputUsdPerToken: 0.000_000_5,
    });

    const catalogNoPrefix = {
      'grok-4-fast-non-reasoning': {
        input_cost_per_token: 0.000_000_21,
        output_cost_per_token: 0.000_000_51,
      },
    };
    expect(
      resolveLiteLlmPricingForModelId(catalogNoPrefix, 'xai/grok-4-fast-non-reasoning'),
    ).toEqual({ inputUsdPerToken: 0.000_000_21, outputUsdPerToken: 0.000_000_51 });
  });

  it('returns null when token costs are missing', () => {
    const catalog = { 'gpt-5.2': { input_cost_per_token: 0.1 } };
    expect(resolveLiteLlmPricingForModelId(catalog, 'openai/gpt-5.2')).toBeNull();
  });

  it('treats 0/0 costs as unknown (not free)', () => {
    const catalog = {
      'grok-4-fast-non-reasoning': { input_cost_per_token: 0, output_cost_per_token: 0 },
    };
    expect(resolveLiteLlmPricingForModelId(catalog, 'xai/grok-4-fast-non-reasoning')).toBeNull();
  });

  it('resolves max output tokens for gateway-style ids', () => {
    const catalog = {
      'claude-opus-4-5': { max_tokens: 8192 },
      'gemini-3-flash-preview': { max_output_tokens: '32768' },
      'gpt-5.2': { max_output_tokens: 16_384 },
      'grok-4-fast-non-reasoning': { max_output_tokens: 4096 },
    };

    expect(resolveLiteLlmMaxOutputTokensForModelId(catalog, 'openai/gpt-5.2')).toBe(16_384);
    expect(resolveLiteLlmMaxOutputTokensForModelId(catalog, 'anthropic/claude-opus-4-5')).toBe(
      8192,
    );
    expect(resolveLiteLlmMaxOutputTokensForModelId(catalog, 'google/gemini-3-flash-preview')).toBe(
      32_768,
    );
    expect(resolveLiteLlmMaxOutputTokensForModelId(catalog, 'xai/grok-4-fast-non-reasoning')).toBe(
      4096,
    );
  });

  it('resolves max input tokens for gateway-style ids', () => {
    const catalog = {
      'claude-opus-4-5': { max_input_tokens: '200000' },
      'gemini-3-flash-preview': { max_input_tokens: 1_000_000 },
      'gpt-5.2': { max_input_tokens: 128_000 },
      'grok-4-fast-non-reasoning': { max_input_tokens: 131_072 },
    };

    expect(resolveLiteLlmMaxInputTokensForModelId(catalog, 'openai/gpt-5.2')).toBe(128_000);
    expect(resolveLiteLlmMaxInputTokensForModelId(catalog, 'anthropic/claude-opus-4-5')).toBe(
      200_000,
    );
    expect(resolveLiteLlmMaxInputTokensForModelId(catalog, 'google/gemini-3-flash-preview')).toBe(
      1_000_000,
    );
    expect(resolveLiteLlmMaxInputTokensForModelId(catalog, 'xai/grok-4-fast-non-reasoning')).toBe(
      131_072,
    );
  });

  it('does nothing without HOME (no cache, no network)', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('unexpected fetch');
    });

    const result = await loadLiteLlmCatalog({
      env: {},
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(result.source).toBe('none');
    expect(result.catalog).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it('honors TOKENTALLY_CACHE_DIR when set', async () => {
    const root = mkdtempSync(join(tmpdir(), 'summarize-litellm-'));
    const cacheDir = join(root, 'tokentally-cache');
    mkdirSync(cacheDir, { recursive: true });

    const catalogPath = join(cacheDir, 'litellm-model_prices_and_context_window.json');
    const metaPath = join(cacheDir, 'litellm-model_prices_and_context_window.meta.json');

    writeFileSync(
      catalogPath,
      JSON.stringify({ 'gpt-5.2': { input_cost_per_token: 0.1, output_cost_per_token: 0.2 } }),
      'utf8',
    );
    writeFileSync(metaPath, JSON.stringify({ fetchedAtMs: 1000 }), 'utf8');

    const fetchMock = vi.fn(async () => {
      throw new Error('unexpected fetch');
    });
    const result = await loadLiteLlmCatalog({
      env: { HOME: join(root, 'unused-home'), TOKENTALLY_CACHE_DIR: cacheDir },
      fetchImpl: fetchMock as unknown as typeof fetch,
      nowMs: 2000,
    });

    expect(result.source).toBe('cache');
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it('ignores empty TOKENTALLY_CACHE_DIR values', async () => {
    const root = mkdtempSync(join(tmpdir(), 'summarize-litellm-'));
    const cacheDir = join(root, '.summarize', 'cache');
    mkdirSync(cacheDir, { recursive: true });

    const catalogPath = join(cacheDir, 'litellm-model_prices_and_context_window.json');
    const metaPath = join(cacheDir, 'litellm-model_prices_and_context_window.meta.json');

    writeFileSync(
      catalogPath,
      JSON.stringify({ 'gpt-5.2': { input_cost_per_token: 0.1, output_cost_per_token: 0.2 } }),
      'utf8',
    );
    writeFileSync(metaPath, JSON.stringify({ fetchedAtMs: 1000 }), 'utf8');

    const fetchMock = vi.fn(async () => {
      throw new Error('unexpected fetch');
    });
    const result = await loadLiteLlmCatalog({
      env: { HOME: root, TOKENTALLY_CACHE_DIR: '   ' },
      fetchImpl: fetchMock as unknown as typeof fetch,
      nowMs: 2000,
    });

    expect(result.source).toBe('cache');
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it('loads from cache when fresh', async () => {
    const root = mkdtempSync(join(tmpdir(), 'summarize-litellm-'));
    const cacheDir = join(root, '.summarize', 'cache');
    mkdirSync(cacheDir, { recursive: true });

    const catalogPath = join(cacheDir, 'litellm-model_prices_and_context_window.json');
    const metaPath = join(cacheDir, 'litellm-model_prices_and_context_window.meta.json');

    writeFileSync(
      catalogPath,
      JSON.stringify({ 'gpt-5.2': { input_cost_per_token: 0.1, output_cost_per_token: 0.2 } }),
      'utf8',
    );
    writeFileSync(metaPath, JSON.stringify({ fetchedAtMs: 1000 }), 'utf8');

    const fetchMock = vi.fn(async () => Response.json({}, { status: 500 }));
    const result = await loadLiteLlmCatalog({
      env: { HOME: root },
      fetchImpl: fetchMock as unknown as typeof fetch,
      nowMs: 1000 + 1000,
    });
    expect(result.source).toBe('cache');
    expect(fetchMock).toHaveBeenCalledTimes(0);
    expect(resolveLiteLlmPricingForModelId(result.catalog ?? {}, 'openai/gpt-5.2')).toEqual({
      inputUsdPerToken: 0.1,
      outputUsdPerToken: 0.2,
    });
  });

  it('revalidates stale cache with 304', async () => {
    const root = mkdtempSync(join(tmpdir(), 'summarize-litellm-'));
    const cacheDir = join(root, '.summarize', 'cache');
    mkdirSync(cacheDir, { recursive: true });

    const catalogPath = join(cacheDir, 'litellm-model_prices_and_context_window.json');
    const metaPath = join(cacheDir, 'litellm-model_prices_and_context_window.meta.json');

    writeFileSync(
      catalogPath,
      JSON.stringify({ 'gpt-5.2': { input_cost_per_token: 0.1, output_cost_per_token: 0.2 } }),
      'utf8',
    );
    writeFileSync(metaPath, JSON.stringify({ etag: '"abc"', fetchedAtMs: 1 }), 'utf8');

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect((init?.headers as Record<string, string> | undefined)?.['if-none-match']).toBe(
        '"abc"',
      );
      return new Response(null, { headers: { etag: '"abc"' }, status: 304 });
    });

    const result = await loadLiteLlmCatalog({
      env: { HOME: root },
      fetchImpl: fetchMock as unknown as typeof fetch,
      nowMs: 1 + 8 * 24 * 60 * 60 * 1000,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.source).toBe('cache');
    expect(result.catalog).not.toBeNull();
  });

  it('downloads and caches when missing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'summarize-litellm-'));
    const fetchMock = vi.fn(async () =>
      Response.json(
        { 'gpt-5.2': { input_cost_per_token: 0.1, output_cost_per_token: 0.2 } },
        { headers: { etag: '"x"', 'last-modified': 'y' }, status: 200 },
      ),
    );

    const result = await loadLiteLlmCatalog({
      env: { HOME: root },
      fetchImpl: fetchMock as unknown as typeof fetch,
      nowMs: 123,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.source).toBe('network');

    const cached = await loadLiteLlmCatalog({
      env: { HOME: root },
      fetchImpl: vi.fn(async () => Response.json({}, { status: 500 })) as unknown as typeof fetch,
      nowMs: 123 + 1000,
    });
    expect(cached.source).toBe('cache');
    expect(resolveLiteLlmPricingForModelId(cached.catalog ?? {}, 'gpt-5.2')).toEqual({
      inputUsdPerToken: 0.1,
      outputUsdPerToken: 0.2,
    });
  });
});
