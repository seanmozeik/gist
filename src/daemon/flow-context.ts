import { Writable } from 'node:stream';

import type { CacheState } from '../cache.js';
import type { SummarizeConfig } from '../config.js';
import type {
  ExtractedLinkContent,
  LinkPreviewProgressEvent,
  MediaCache,
} from '../content/index.js';
import type { ExecFileFn } from '../markitdown.js';
import type { FixedModelSpec } from '../model-spec.js';
import { execFileTracked } from '../processes.js';
import {
  createAssetSummaryContext,
  type SummarizeAssetArgs,
  summarizeAsset as summarizeAssetFlow,
} from '../run/flows/asset/summary.js';
import { createUrlFlowContext, type UrlFlowContext } from '../run/flows/url/types.js';
import { resolveRunContextState } from '../run/run-context.js';
import { createRunMetrics } from '../run/run-metrics.js';
import { resolveModelSelection } from '../run/run-models.js';
import { resolveDesiredOutputTokens } from '../run/run-output.js';
import {
  buildPromptLengthInstruction,
  type RunOverrides,
  resolveOutputLanguageSetting,
  resolveSummaryLength,
} from '../run/run-settings.js';
import { createSummaryEngine } from '../run/summary-engine.js';
import type { SlideImage, SlideSettings, SlideSourceKind } from '../slides/index.js';

interface TextSink { writeChunk: (text: string) => void }

function createWritableFromTextSink(sink: TextSink): NodeJS.WritableStream {
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      const text =
        typeof chunk === 'string' ? chunk : (Buffer.isBuffer(chunk) ? chunk.toString('utf8') : '');
      if (text) {sink.writeChunk(text);}
      callback();
    },
  });
  (stream as unknown as { isTTY?: boolean }).isTTY = false;
  return stream;
}

function applyAutoCliFallbackOverrides(
  config: SummarizeConfig | null,
  overrides: RunOverrides,
): SummarizeConfig | null {
  const hasOverride = overrides.autoCliFallbackEnabled !== null || overrides.autoCliOrder !== null;
  if (!hasOverride) {return config;}
  const current = config ?? {};
  const currentCli = current.cli ?? {};
  const currentAutoFallback = currentCli.autoFallback ?? currentCli.magicAuto ?? {};
  return {
    ...current,
    cli: {
      ...currentCli,
      autoFallback: {
        ...currentAutoFallback,
        ...(typeof overrides.autoCliFallbackEnabled === 'boolean'
          ? { enabled: overrides.autoCliFallbackEnabled }
          : {}),
        ...(Array.isArray(overrides.autoCliOrder) ? { order: overrides.autoCliOrder } : {}),
      },
    },
  };
}

export interface DaemonUrlFlowContextArgs {
  env: Record<string, string | undefined>;
  fetchImpl: typeof fetch;
  cache: CacheState;
  mediaCache?: MediaCache | null;
  modelOverride: string | null;
  promptOverride: string | null;
  lengthRaw: unknown;
  languageRaw: unknown;
  maxExtractCharacters: number | null;
  format?: 'text' | 'markdown';
  overrides?: RunOverrides | null;
  extractOnly?: boolean;
  slides?: SlideSettings | null;
  hooks?: {
    onModelChosen?: ((modelId: string) => void) | null;
    onExtracted?: ((extracted: ExtractedLinkContent) => void) | null;
    onSlidesExtracted?:
      | ((
          slides: Awaited<ReturnType<typeof import('../slides/index.js').extractSlidesForSource>>,
        ) => void)
      | null;
    onSlidesProgress?: ((text: string) => void) | null;
    onSlidesDone?: ((result: { ok: boolean; error?: string | null }) => void) | null;
    onSlideChunk?: (chunk: {
      slide: SlideImage;
      meta: {
        slidesDir: string;
        sourceUrl: string;
        sourceId: string;
        sourceKind: SlideSourceKind;
        ocrAvailable: boolean;
      };
    }) => void;
    onLinkPreviewProgress?: ((event: LinkPreviewProgressEvent) => void) | null;
    onSummaryCached?: ((cached: boolean) => void) | null;
  } | null;
  runStartedAtMs: number;
  stdoutSink: TextSink;
}

export function createDaemonUrlFlowContext(args: DaemonUrlFlowContextArgs): UrlFlowContext {
  const {
    env,
    fetchImpl,
    cache,
    mediaCache = null,
    modelOverride,
    promptOverride,
    lengthRaw,
    languageRaw,
    maxExtractCharacters,
    format,
    overrides,
    extractOnly,
    slides,
    hooks,
    runStartedAtMs,
    stdoutSink,
  } = args;

  const envForRun: Record<string, string | undefined> = { ...env };

  const languageExplicitlySet = typeof languageRaw === 'string' && Boolean(languageRaw.trim());

  const resolvedOverrides: RunOverrides = overrides ?? {
    autoCliFallbackEnabled: null,
    autoCliOrder: null,
    firecrawlMode: null,
    forceSummary: null,
    markdownMode: null,
    maxOutputTokensArg: null,
    preprocessMode: null,
    retries: null,
    timeoutMs: null,
    transcriber: null,
    transcriptTimestamps: null,
    videoMode: null,
    youtubeMode: null,
  };
  if (resolvedOverrides.transcriber) {
    envForRun.SUMMARIZE_TRANSCRIBER = resolvedOverrides.transcriber;
  }
  const videoModeOverride = resolvedOverrides.videoMode;
  const resolvedFormat = format === 'markdown' ? 'markdown' : 'text';

  const {
    config,
    configPath,
    outputLanguage: outputLanguageFromConfig,
    openaiWhisperUsdPerMinute,
    videoMode,
    cliConfigForRun,
    configForCli,
    openaiUseChatCompletions,
    configModelLabel,
    apiKey,
    openrouterApiKey,
    openrouterConfigured,
    groqApiKey,
    assemblyaiApiKey,
    openaiApiKey,
    xaiApiKey,
    googleApiKey,
    anthropicApiKey,
    zaiApiKey,
    zaiBaseUrl,
    nvidiaApiKey,
    nvidiaBaseUrl,
    providerBaseUrls,
    firecrawlApiKey,
    firecrawlConfigured,
    googleConfigured,
    anthropicConfigured,
    cliAvailability,
    envForAuto,
    apifyToken,
    ytDlpPath,
    ytDlpCookiesFromBrowser,
    falApiKey,
  } = resolveRunContextState({
    cliFlagPresent: false,
    cliProviderArg: null,
    env: envForRun,
    envForRun,
    languageExplicitlySet,
    programOpts: { videoMode: videoModeOverride ?? 'auto' },
    videoModeExplicitlySet: videoModeOverride != null,
  });
  const configForCliWithMagic = applyAutoCliFallbackOverrides(configForCli, resolvedOverrides);
  const allowAutoCliFallback = resolvedOverrides.autoCliFallbackEnabled === true;
  const { lengthArg } = resolveSummaryLength(lengthRaw, config?.output?.length ?? 'xl');

  const {
    requestedModel,
    requestedModelInput,
    requestedModelLabel,
    isNamedModelSelection,
    isImplicitAutoSelection,
    wantsFreeNamedModel,
    configForModelSelection,
    isFallbackModel,
  } = resolveModelSelection({
    config,
    configForCli: configForCliWithMagic,
    configPath,
    envForRun,
    explicitModelArg: modelOverride?.trim() ? modelOverride.trim() : null,
  });

  const fixedModelSpec: FixedModelSpec | null =
    requestedModel.kind === 'fixed' ? requestedModel : null;
  const {maxOutputTokensArg} = resolvedOverrides;
  const desiredOutputTokens = resolveDesiredOutputTokens({ lengthArg, maxOutputTokensArg });

  const metrics = createRunMetrics({ env: envForRun, fetchImpl, maxOutputTokensArg });

  const stdout = createWritableFromTextSink(stdoutSink);
  const {stderr} = process;

  const timeoutMs = resolvedOverrides.timeoutMs ?? 120_000;
  const retries = resolvedOverrides.retries ?? 1;
  const firecrawlMode = resolvedOverrides.firecrawlMode ?? 'off';
  const markdownMode =
    resolvedOverrides.markdownMode ?? (resolvedFormat === 'markdown' ? 'readability' : 'off');
  const preprocessMode = resolvedOverrides.preprocessMode ?? 'auto';
  const youtubeMode = resolvedOverrides.youtubeMode ?? 'auto';

  const summaryEngine = createSummaryEngine({
    apiKeys: { anthropicApiKey, googleApiKey, openaiApiKey: apiKey, openrouterApiKey, xaiApiKey },
    clearProgressForStdout: () => {},
    cliAvailability,
    cliConfigForRun: cliConfigForRun ?? null,
    env: envForRun,
    envForRun,
    execFileImpl: execFileTracked as unknown as ExecFileFn,
    keyFlags: { anthropicConfigured, googleConfigured, openrouterConfigured },
    llmCalls: metrics.llmCalls,
    nvidia: { apiKey: nvidiaApiKey, baseUrl: nvidiaBaseUrl },
    openaiUseChatCompletions,
    plain: true,
    providerBaseUrls,
    resolveMaxInputTokensForCall: metrics.resolveMaxInputTokensForCall,
    resolveMaxOutputTokensForCall: metrics.resolveMaxOutputTokensForCall,
    retries,
    stderr,
    stdout,
    streamingEnabled: true,
    streamingOutputMode: 'delta',
    timeoutMs,
    trackedFetch: metrics.trackedFetch,
    verbose: false,
    verboseColor: false,
    zai: { apiKey: zaiApiKey, baseUrl: zaiBaseUrl },
  });

  const outputLanguage = resolveOutputLanguageSetting({
    fallback: outputLanguageFromConfig,
    raw: languageRaw,
  });

  const lengthInstruction = promptOverride ? buildPromptLengthInstruction(lengthArg) : null;
  const languageInstruction =
    promptOverride && outputLanguage.kind === 'fixed'
      ? `Output should be ${outputLanguage.label}.`
      : null;

  const assetSummaryContext = createAssetSummaryContext({
    apiStatus: {
      anthropicConfigured,
      apiKey,
      apifyToken,
      assemblyaiApiKey,
      firecrawlConfigured,
      googleConfigured,
      nvidiaApiKey,
      nvidiaBaseUrl,
      openaiApiKey,
      openrouterApiKey,
      providerBaseUrls,
      xaiApiKey,
      zaiApiKey,
      zaiBaseUrl,
    },
    cache: { cache, mediaCache },
    hooks: {
      buildReport: metrics.buildReport,
      clearProgressForStdout: () => {},
      estimateCostUsd: metrics.estimateCostUsd,
      restoreProgressAfterStdout: undefined,
      writeViaFooter: () => {},
    },
    io: {
      env: envForRun,
      envForRun,
      execFileImpl: execFileTracked as unknown as ExecFileFn,
      stderr,
      stdout,
      trackedFetch: metrics.trackedFetch,
    },
    model: {
      allowAutoCliFallback,
      cliAvailability,
      configForModelSelection,
      desiredOutputTokens,
      envForAuto,
      fixedModelSpec,
      getLiteLlmCatalog: metrics.getLiteLlmCatalog,
      isFallbackModel,
      isImplicitAutoSelection,
      isNamedModelSelection,
      llmCalls: metrics.llmCalls,
      requestedModel,
      requestedModelInput,
      requestedModelLabel,
      summaryEngine,
      wantsFreeNamedModel,
    },
    output: {
      json: false,
      metricsDetailed: false,
      metricsEnabled: false,
      plain: true,
      runStartedAtMs,
      shouldComputeReport: false,
      streamingEnabled: true,
      verbose: false,
      verboseColor: false,
    },
    summary: {
      extractMode: extractOnly ?? false,
      forceSummary: resolvedOverrides.forceSummary ?? false,
      format: 'text',
      languageInstruction,
      lengthArg,
      lengthInstruction,
      maxOutputTokensArg,
      outputLanguage,
      preprocessMode,
      promptOverride,
      summaryCacheBypass: false,
      timeoutMs,
      videoMode,
    },
  });

  const ctx: UrlFlowContext = createUrlFlowContext({
    cache,
    eventHooks: hooks ?? undefined,
    flags: {
      configModelLabel,
      configPath,
      extractMode: extractOnly ?? false,
      firecrawlMode,
      forceSummary: resolvedOverrides.forceSummary ?? false,
      format: resolvedFormat,
      json: false,
      languageInstruction,
      lengthArg,
      lengthInstruction,
      markdownMode,
      maxExtractCharacters,
      maxOutputTokensArg,
      metricsDetailed: false,
      metricsEnabled: false,
      outputLanguage,
      plain: true,
      preprocessMode,
      progressEnabled: false,
      promptOverride,
      retries,
      runStartedAtMs,
      shouldComputeReport: false,
      slides: slides ?? null,
      slidesDebug: false,
      slidesOutput: false,
      streamMode: 'on',
      streamingEnabled: true,
      summaryCacheBypass: false,
      timeoutMs,
      transcriptTimestamps: resolvedOverrides.transcriptTimestamps ?? false,
      verbose: false,
      verboseColor: false,
      videoMode,
      youtubeMode,
    },
    io: {
      env: envForRun,
      envForRun,
      execFileImpl: execFileTracked as unknown as ExecFileFn,
      fetch: metrics.trackedFetch,
      stderr,
      stdout,
    },
    mediaCache,
    model: {
      allowAutoCliFallback,
      apiStatus: {
        anthropicApiKey,
        anthropicConfigured,
        apiKey,
        apifyToken,
        assemblyaiApiKey,
        falApiKey,
        firecrawlApiKey,
        firecrawlConfigured,
        googleApiKey,
        googleConfigured,
        groqApiKey,
        nvidiaApiKey,
        nvidiaBaseUrl,
        openaiApiKey,
        openrouterApiKey,
        openrouterConfigured,
        providerBaseUrls,
        xaiApiKey,
        ytDlpCookiesFromBrowser,
        ytDlpPath,
        zaiApiKey,
        zaiBaseUrl,
      },
      cliAvailability,
      configForModelSelection,
      desiredOutputTokens,
      envForAuto,
      fixedModelSpec,
      getLiteLlmCatalog: metrics.getLiteLlmCatalog,
      isFallbackModel,
      isImplicitAutoSelection,
      isNamedModelSelection,
      llmCalls: metrics.llmCalls,
      openaiUseChatCompletions,
      openaiWhisperUsdPerMinute,
      requestedModel,
      requestedModelInput,
      requestedModelLabel,
      summaryEngine,
      wantsFreeNamedModel,
    },
    runtimeHooks: {
      buildReport: metrics.buildReport,
      clearProgressForStdout: () => {},
      clearProgressIfCurrent: () => {},
      estimateCostUsd: metrics.estimateCostUsd,
      restoreProgressAfterStdout: undefined,
      setClearProgressBeforeStdout: () => {},
      setTranscriptionCost: metrics.setTranscriptionCost,
      summarizeAsset: (assetArgs: SummarizeAssetArgs) =>
        summarizeAssetFlow(assetSummaryContext, assetArgs),
      writeViaFooter: () => {},
    },
  });

  return ctx;
}
