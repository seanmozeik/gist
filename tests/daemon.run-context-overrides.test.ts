import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { CacheState } from '../src/cache.js';
import { createDaemonUrlFlowContext } from '../src/daemon/flow-context.js';

function makeTempHome(): string {
  return mkdtempSync(join(tmpdir(), 'gist-daemon-home-'));
}

function writeConfig(home: string, config: Record<string, unknown>) {
  const configDir = join(home, '.gist');
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, 'config.json'), JSON.stringify(config), 'utf8');
}

describe('daemon/flow-context (overrides)', () => {
  const makeCacheState = (): CacheState => ({
    maxBytes: 0,
    mode: 'bypass',
    path: null,
    store: null,
    ttlMs: 0,
  });

  it('defaults to xl + auto language when unset', () => {
    const home = makeTempHome();
    const ctx = createDaemonUrlFlowContext({
      cache: makeCacheState(),
      env: { HOME: home },
      fetchImpl: fetch,
      languageRaw: '',
      lengthRaw: '',
      maxExtractCharacters: null,
      modelOverride: null,
      promptOverride: null,
      runStartedAtMs: Date.now(),
      stdoutSink: {
        writeChunk: () => {
          /* Empty */
        },
      },
    });

    expect(ctx.flags.lengthArg).toEqual({ kind: 'preset', preset: 'xl' });
    expect(ctx.flags.outputLanguage).toEqual({ kind: 'auto' });
  });

  it('accepts custom length and language overrides', () => {
    const home = makeTempHome();
    writeConfig(home, { output: { language: 'de' } });
    const ctx = createDaemonUrlFlowContext({
      cache: makeCacheState(),
      env: { HOME: home },
      fetchImpl: fetch,
      languageRaw: 'German',
      lengthRaw: '20k',
      maxExtractCharacters: null,
      modelOverride: null,
      promptOverride: null,
      runStartedAtMs: Date.now(),
      stdoutSink: {
        writeChunk: () => {
          /* Empty */
        },
      },
    });

    expect(ctx.flags.lengthArg).toEqual({ kind: 'chars', maxCharacters: 20_000 });
    expect(ctx.flags.outputLanguage.kind).toBe('fixed');
    expect(ctx.flags.outputLanguage.kind === 'fixed' ? ctx.flags.outputLanguage.tag : null).toBe(
      'de',
    );
  });

  it('uses config language when request is unset, then prefers request overrides', () => {
    const home = makeTempHome();
    writeConfig(home, { output: { language: 'de' } });
    const configCtx = createDaemonUrlFlowContext({
      cache: makeCacheState(),
      env: { HOME: home },
      fetchImpl: fetch,
      languageRaw: '',
      lengthRaw: 'xl',
      maxExtractCharacters: null,
      modelOverride: null,
      promptOverride: null,
      runStartedAtMs: Date.now(),
      stdoutSink: {
        writeChunk: () => {
          /* Empty */
        },
      },
    });
    expect(configCtx.flags.outputLanguage.kind).toBe('fixed');
    expect(
      configCtx.flags.outputLanguage.kind === 'fixed' ? configCtx.flags.outputLanguage.tag : null,
    ).toBe('de');

    const requestCtx = createDaemonUrlFlowContext({
      cache: makeCacheState(),
      env: { HOME: home },
      fetchImpl: fetch,
      languageRaw: 'English',
      lengthRaw: 'xl',
      maxExtractCharacters: null,
      modelOverride: null,
      promptOverride: null,
      runStartedAtMs: Date.now(),
      stdoutSink: {
        writeChunk: () => {
          /* Empty */
        },
      },
    });
    expect(requestCtx.flags.outputLanguage.kind).toBe('fixed');
    expect(
      requestCtx.flags.outputLanguage.kind === 'fixed' ? requestCtx.flags.outputLanguage.tag : null,
    ).toBe('en');
  });

  it('uses config length when request length is unset, then prefers request overrides', () => {
    const home = makeTempHome();
    writeConfig(home, { output: { length: 'short' } });

    const configCtx = createDaemonUrlFlowContext({
      cache: makeCacheState(),
      env: { HOME: home },
      fetchImpl: fetch,
      languageRaw: 'auto',
      lengthRaw: '',
      maxExtractCharacters: null,
      modelOverride: null,
      promptOverride: null,
      runStartedAtMs: Date.now(),
      stdoutSink: {
        writeChunk: () => {
          /* Empty */
        },
      },
    });
    expect(configCtx.flags.lengthArg).toEqual({ kind: 'preset', preset: 'short' });

    const requestCtx = createDaemonUrlFlowContext({
      cache: makeCacheState(),
      env: { HOME: home },
      fetchImpl: fetch,
      languageRaw: 'auto',
      lengthRaw: '20k',
      maxExtractCharacters: null,
      modelOverride: null,
      promptOverride: null,
      runStartedAtMs: Date.now(),
      stdoutSink: {
        writeChunk: () => {
          /* Empty */
        },
      },
    });
    expect(requestCtx.flags.lengthArg).toEqual({ kind: 'chars', maxCharacters: 20_000 });
  });

  it('keeps config output defaults in prompt instructions when promptOverride is set', () => {
    const home = makeTempHome();
    writeConfig(home, { output: { language: 'de', length: 'short' } });

    const ctx = createDaemonUrlFlowContext({
      cache: makeCacheState(),
      env: { HOME: home },
      fetchImpl: fetch,
      languageRaw: '',
      lengthRaw: '',
      maxExtractCharacters: null,
      modelOverride: null,
      promptOverride: 'Explain for a kid.',
      runStartedAtMs: Date.now(),
      stdoutSink: {
        writeChunk: () => {
          /* Empty */
        },
      },
    });

    expect(ctx.flags.lengthInstruction).toContain('Target length: around 900 characters');
    expect(ctx.flags.languageInstruction).toBe('Output should be German.');
  });

  it('applies run overrides for daemon contexts', () => {
    const home = makeTempHome();
    const ctx = createDaemonUrlFlowContext({
      cache: makeCacheState(),
      env: { HOME: home },
      fetchImpl: fetch,
      languageRaw: 'auto',
      lengthRaw: 'xl',
      maxExtractCharacters: null,
      modelOverride: null,
      overrides: {
        autoCliFallbackEnabled: null,
        autoCliOrder: null,
        firecrawlMode: 'auto',
        forceSummary: null,
        markdownMode: 'llm',
        maxOutputTokensArg: 512,
        preprocessMode: 'always',
        retries: 2,
        timeoutMs: 45_000,
        transcriber: null,
        transcriptTimestamps: null,
        videoMode: 'transcript',
        youtubeMode: 'no-auto',
      },
      promptOverride: null,
      runStartedAtMs: Date.now(),
      stdoutSink: {
        writeChunk: () => {
          /* Empty */
        },
      },
    });

    expect(ctx.flags.firecrawlMode).toBe('auto');
    expect(ctx.flags.markdownMode).toBe('llm');
    expect(ctx.flags.preprocessMode).toBe('always');
    expect(ctx.flags.youtubeMode).toBe('no-auto');
    expect(ctx.flags.videoMode).toBe('transcript');
    expect(ctx.flags.timeoutMs).toBe(45_000);
    expect(ctx.flags.retries).toBe(2);
    expect(ctx.flags.maxOutputTokensArg).toBe(512);
  });

  it('defaults markdownMode to readability when format=markdown', () => {
    const home = makeTempHome();
    const ctx = createDaemonUrlFlowContext({
      cache: makeCacheState(),
      env: { HOME: home },
      fetchImpl: fetch,
      format: 'markdown',
      languageRaw: 'auto',
      lengthRaw: 'xl',
      maxExtractCharacters: null,
      modelOverride: null,
      promptOverride: null,
      runStartedAtMs: Date.now(),
      stdoutSink: {
        writeChunk: () => {
          /* Empty */
        },
      },
    });

    expect(ctx.flags.markdownMode).toBe('readability');
  });

  it('adjusts desired output tokens based on length', () => {
    const home = makeTempHome();
    const shortCtx = createDaemonUrlFlowContext({
      cache: makeCacheState(),
      env: { HOME: home },
      fetchImpl: fetch,
      languageRaw: 'auto',
      lengthRaw: 'short',
      maxExtractCharacters: null,
      modelOverride: null,
      promptOverride: null,
      runStartedAtMs: Date.now(),
      stdoutSink: {
        writeChunk: () => {
          /* Empty */
        },
      },
    });
    const xlCtx = createDaemonUrlFlowContext({
      cache: makeCacheState(),
      env: { HOME: home },
      fetchImpl: fetch,
      languageRaw: 'auto',
      lengthRaw: 'xl',
      maxExtractCharacters: null,
      modelOverride: null,
      promptOverride: null,
      runStartedAtMs: Date.now(),
      stdoutSink: {
        writeChunk: () => {
          /* Empty */
        },
      },
    });

    const shortTokens = shortCtx.model.desiredOutputTokens;
    const xlTokens = xlCtx.model.desiredOutputTokens;
    if (typeof shortTokens !== 'number' || typeof xlTokens !== 'number') {
      throw new TypeError('expected desiredOutputTokens to be a number');
    }
    expect(shortTokens).toBeLessThan(xlTokens);
  });
});
