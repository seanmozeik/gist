import { Writable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import type { AssetSummaryContext } from '../src/run/flows/asset/summary';

const statSync = vi.fn();

vi.mock('node:fs', () => ({ statSync }));

const createLinkPreviewClient = vi.fn();

vi.mock('../src/content/index.js', () => ({ createLinkPreviewClient }));

function makeContext(): AssetSummaryContext {
  const stdout = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  const stderr = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });

  return {
    allowAutoCliFallback: false,
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
    buildReport: vi.fn(),
    cache: { maxBytes: 0, mode: 'default', path: null, store: null, ttlMs: 0 },
    clearProgressForStdout: vi.fn(),
    cliAvailability: {},
    configForModelSelection: null,
    desiredOutputTokens: null,
    env: {
      GIST_WHISPER_CPP_BINARY: '/usr/bin/whisper-cli',
      OPENAI_API_KEY: 'test-key',
      YT_DLP_PATH: 'yt-dlp',
    },
    envForAuto: {},
    envForRun: {},
    estimateCostUsd: vi.fn(),
    execFileImpl: vi.fn() as unknown as AssetSummaryContext['execFileImpl'],
    extractMode: false,
    fixedModelSpec: null,
    forceSummary: false,
    format: 'text',
    getLiteLlmCatalog: vi.fn(),
    isFallbackModel: false,
    isImplicitAutoSelection: false,
    isNamedModelSelection: false,
    json: false,
    languageInstruction: null,
    lengthArg: { kind: 'preset', preset: 'short' },
    lengthInstruction: null,
    llmCalls: [],
    maxOutputTokensArg: null,
    mediaCache: null,
    metricsDetailed: false,
    metricsEnabled: false,
    outputLanguage: { kind: 'auto' },
    plain: false,
    preprocessMode: 'auto',
    promptOverride: null,
    requestedModel: { kind: 'auto' },
    requestedModelInput: 'auto',
    requestedModelLabel: 'auto',
    restoreProgressAfterStdout: null,
    runStartedAtMs: 0,
    shouldComputeReport: false,
    stderr,
    stdout,
    streamingEnabled: false,
    summaryCacheBypass: false,
    summaryEngine: {} as AssetSummaryContext['summaryEngine'],
    timeoutMs: 1000,
    trackedFetch: vi.fn() as unknown as typeof fetch,
    verbose: false,
    verboseColor: false,
    videoMode: 'auto',
    wantsFreeNamedModel: false,
    writeViaFooter: vi.fn(),
  };
}

describe('gistMediaFile size limits', () => {
  it('rejects local media larger than 2GB', async () => {
    const hugeSize = 2 * 1024 * 1024 * 1024 + 1;
    statSync.mockReturnValue({ mtimeMs: 123, size: hugeSize });

    const { gistMediaFile } = await import('../src/run/flows/asset/media.js');
    const ctx = makeContext();

    await expect(
      gistMediaFile(ctx, {
        attachment: {
          bytes: new Uint8Array(),
          filename: 'huge.mp3',
          kind: 'file',
          mediaType: 'audio/mpeg',
        },
        sourceKind: 'file',
        sourceLabel: '/tmp/huge.mp3',
      }),
    ).rejects.toThrow(/2 GB/);
  });
});
