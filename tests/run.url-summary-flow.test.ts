import { Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import type { CacheStore } from '../src/cache.js';
import type { ExtractedLinkContent } from '../src/content/index.js';
import { parseRequestedModelId } from '../src/model-spec.js';
import { gistExtractedUrl } from '../src/run/flows/url/summary.js';
import type { UrlFlowContext } from '../src/run/flows/url/types.js';

function collectStream() {
  let text = '';
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      text += chunk.toString();
      callback();
    },
  });
  return { getText: () => text, stream };
}

const extracted: ExtractedLinkContent = {
  content: 'Transcript:\n[0:00] hello',
  description: null,
  diagnostics: {
    firecrawl: { attempted: false, cacheMode: 'bypass', cacheStatus: 'unknown', used: false },
    markdown: { provider: null, requested: false, used: false },
    strategy: 'html',
    transcript: {
      attemptedProviders: ['captionTracks'],
      cacheMode: 'bypass',
      cacheStatus: 'unknown',
      provider: 'captionTracks',
      textProvided: true,
    },
  },
  isVideoOnly: false,
  mediaDurationSeconds: 1173,
  siteName: 'YouTube',
  title: 'After Babylon 5',
  totalCharacters: 100,
  transcriptCharacters: 80,
  transcriptLines: 2,
  transcriptMetadata: null,
  transcriptSegments: [
    { endMs: 4000, startMs: 0, text: 'hello' },
    { endMs: 775_000, startMs: 772_000, text: 'final line' },
  ],
  transcriptSource: 'captionTracks',
  transcriptTimedText: '[0:00] hello\n[12:54] midpoint\n[19:32] final line',
  transcriptWordCount: 18,
  transcriptionProvider: null,
  truncated: false,
  url: 'https://www.youtube.com/watch?v=9pUWFJgBc5Q',
  video: { kind: 'youtube', url: 'https://www.youtube.com/watch?v=9pUWFJgBc5Q' },
  wordCount: 20,
};

describe('gistExtractedUrl timestamp guard', () => {
  it('disables streaming and strips impossible key moments before output and cache', async () => {
    const stdout = collectStream();
    const stderr = collectStream();
    const writes = { json: [] as unknown[], text: [] as string[] };
    const fixedModel = parseRequestedModelId('openai/gpt-5.2');
    if (fixedModel.kind !== 'fixed' || fixedModel.transport !== 'native') {
      throw new Error('expected fixed native model');
    }

    let allowStreamingSeen: boolean | null = null;
    const cacheStore: CacheStore = {
      clear: () => {
        /* Empty */
      },
      close: () => {
        /* Empty */
      },
      getJson: () => null,
      getText: () => null,
      setJson: (_kind, _key, value) => {
        writes.json.push(value);
      },
      setText: (_kind, _key, value) => {
        writes.text.push(value);
      },
      transcriptCache: {
        get: () => null,
        set: () => {
          /* Empty */
        },
      },
    };

    const ctx: UrlFlowContext = {
      cache: { maxBytes: 1_000_000, mode: 'default', path: null, store: cacheStore, ttlMs: 60_000 },
      flags: {
        configModelLabel: null,
        configPath: null,
        extractMode: false,
        firecrawlMode: 'off',
        forceSummary: false,
        format: 'text',
        json: true,
        languageInstruction: null,
        lengthArg: { kind: 'preset', preset: 'medium' },
        lengthInstruction: null,
        markdownMode: 'off',
        maxOutputTokensArg: null,
        metricsDetailed: false,
        metricsEnabled: false,
        outputLanguage: { kind: 'auto' },
        plain: true,
        preprocessMode: 'auto',
        progressEnabled: false,
        promptOverride: null,
        retries: 1,
        runStartedAtMs: Date.now(),
        shouldComputeReport: false,
        slides: null,
        slidesDebug: false,
        slidesOutput: false,
        streamMode: 'on',
        streamingEnabled: true,
        summaryCacheBypass: false,
        timeoutMs: 2000,
        transcriptTimestamps: true,
        verbose: false,
        verboseColor: false,
        videoMode: 'transcript',
        youtubeMode: 'auto',
      },
      hooks: {
        buildReport: async () => ({ calls: 0, durationMs: 0, tokens: 0 }),
        clearProgressForStdout: () => {
          /* Empty */
        },
        clearProgressIfCurrent: () => {
          /* Empty */
        },
        estimateCostUsd: async () => null,
        gistAsset: async () => {
          /* Empty */
        },
        onExtracted: null,
        onLinkPreviewProgress: null,
        onModelChosen: null,
        onSlidesDone: null,
        onSlidesExtracted: null,
        onSlidesProgress: null,
        onSummaryCached: null,
        restoreProgressAfterStdout: null,
        setClearProgressBeforeStdout: () => {
          /* Empty */
        },
        setTranscriptionCost: () => {
          /* Empty */
        },
        writeViaFooter: () => {
          /* Empty */
        },
      },
      io: {
        env: {},
        envForRun: {},
        execFileImpl: ((_file, _args, _options, callback) =>
          callback(null, '', '')) as unknown as UrlFlowContext['io']['execFileImpl'],
        fetch: globalThis.fetch.bind(globalThis),
        stderr: stderr.stream,
        stdout: stdout.stream,
      },
      mediaCache: null,
      model: {
        allowAutoCliFallback: false,
        apiStatus: {
          anthropicApiKey: null,
          anthropicConfigured: false,
          apiKey: 'key',
          apifyToken: null,
          assemblyaiApiKey: null,
          falApiKey: null,
          firecrawlApiKey: null,
          firecrawlConfigured: false,
          googleApiKey: null,
          googleConfigured: false,
          groqApiKey: null,
          nvidiaApiKey: null,
          nvidiaBaseUrl: '',
          openaiApiKey: null,
          openrouterApiKey: null,
          openrouterConfigured: false,
          providerBaseUrls: {
            anthropic: null,
            google: null,
            nvidia: null,
            openai: null,
            xai: null,
          },
          xaiApiKey: null,
          ytDlpCookiesFromBrowser: null,
          ytDlpPath: null,
          zaiApiKey: null,
          zaiBaseUrl: '',
        },
        cliAvailability: {},
        configForModelSelection: null,
        desiredOutputTokens: null,
        envForAuto: {},
        fixedModelSpec: fixedModel,
        getLiteLlmCatalog: async () => ({ catalog: [] }),
        isFallbackModel: false,
        isImplicitAutoSelection: false,
        isNamedModelSelection: true,
        llmCalls: [],
        openaiUseChatCompletions: false,
        openaiWhisperUsdPerMinute: 0,
        requestedModel: fixedModel,
        requestedModelInput: 'openai/gpt-5.2',
        requestedModelLabel: 'openai/gpt-5.2',
        summaryEngine: {
          applyOpenAiGatewayOverrides: (attempt) => attempt,
          envHasKeyFor: () => true,
          formatMissingModelError: () => 'missing',
          runSummaryAttempt: async ({ allowStreaming }) => {
            allowStreamingSeen = allowStreaming;
            return {
              maxOutputTokensForCall: null,
              modelMeta: { canonical: 'openai/gpt-5.2', provider: 'openai' },
              summary: [
                'Summary paragraph.',
                '',
                'Key moments',
                '[00:00] Setup',
                '[12:54] Midpoint',
                '[33:10] Impossible ending',
              ].join('\n'),
              summaryAlreadyPrinted: false,
            };
          },
        } as UrlFlowContext['model']['summaryEngine'],
        wantsFreeNamedModel: false,
      },
    };

    await gistExtractedUrl({
      ctx,
      effectiveMarkdownMode: 'off',
      extracted,
      extractionUi: {
        contentSizeLabel: '1 KB',
        finishSourceLabel: 'YouTube',
        footerParts: [],
        viaSourceLabel: '',
      },
      onModelChosen: null,
      prompt: 'Prompt',
      transcriptionCostLabel: null,
      url: extracted.url,
    });

    const payload = JSON.parse(stdout.getText()) as { summary: string };
    expect(allowStreamingSeen).toBe(false);
    expect(payload.summary).toContain('[12:54] Midpoint');
    expect(payload.summary).not.toContain('[33:10]');
    expect(writes.text[0]).toContain('[12:54] Midpoint');
    expect(writes.text[0]).not.toContain('[33:10]');
    expect(stderr.getText()).toBe('');
  });
});
