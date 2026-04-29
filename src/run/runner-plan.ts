import type { Command } from 'commander';

import type { CacheState } from '../cache.js';
import type { ExecFileFn } from '../markitdown.js';
import type { FixedModelSpec } from '../model-spec.js';
import {
  createThemeRenderer,
  resolveThemeNameFromSources,
  resolveTrueColor,
} from '../tty/theme.js';
import { createCacheStateFromConfig } from './cache-state.js';
import { parseCliProviderArg } from './env.js';
import { isPdfExtension, isTranscribableExtension } from './flows/asset/input.js';
import { summarizeMediaFile as summarizeMediaFileImpl } from './flows/asset/media.js';
import { createMediaCacheFromConfig } from './media-cache-state.js';
import { createProgressGate } from './progress.js';
import { resolveRunContextState } from './run-context.js';
import { resolveRunInput } from './run-input.js';
import { createRunMetrics } from './run-metrics.js';
import { resolveModelSelection } from './run-models.js';
import { resolveDesiredOutputTokens } from './run-output.js';
import { buildPromptLengthInstruction, resolveSummaryLength } from './run-settings.js';
import { resolveStreamSettings } from './run-stream.js';
import { createRunnerFlowContexts } from './runner-contexts.js';
import { executeRunnerInput } from './runner-execution.js';
import { resolveRunnerFlags } from './runner-flags.js';
import { resolveRunnerSlidesSettings } from './runner-slides.js';
import { createSummaryEngine } from './summary-engine.js';
import { isRichTty, supportsColor } from './terminal.js';

export interface RunnerPlan { cacheState: CacheState; execute: () => Promise<void> }

export async function createRunnerPlan(options: {
  normalizedArgv: string[];
  program: Command;
  env: Record<string, string | undefined>;
  envForRun: Record<string, string | undefined>;
  fetchImpl: typeof fetch;
  execFileImpl: ExecFileFn;
  stdin?: NodeJS.ReadableStream;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  promptOverride: string | null;
}): Promise<RunnerPlan> {
  const {
    normalizedArgv,
    program,
    env,
    envForRun,
    fetchImpl,
    execFileImpl,
    stdin,
    stdout,
    stderr,
  } = options;
  let { promptOverride } = options;
  const programOpts = program.opts() as Record<string, unknown>;

  const cliFlagPresent = normalizedArgv.some((arg) => arg === '--cli' || arg.startsWith('--cli='));
  let cliProviderArgRaw = typeof programOpts.cli === 'string' ? programOpts.cli : null;
  const inputResolution = resolveRunInput({ cliFlagPresent, cliProviderArgRaw, program, stdout });
  ({ cliProviderArgRaw } = inputResolution);
  const {inputTarget} = inputResolution;
  const {url} = inputResolution;

  const runStartedAtMs = Date.now();
  const {
    videoModeExplicitlySet,
    lengthExplicitlySet,
    languageExplicitlySet,
    noCacheFlag,
    noMediaCacheFlag,
    extractMode,
    json,
    forceSummary,
    slidesDebug,
    streamMode,
    plain,
    verbose,
    maxExtractCharacters,
    isYoutubeUrl,
    format,
    youtubeMode,
    lengthArg: requestedLengthArg,
    maxOutputTokensArg,
    timeoutMs,
    retries,
    preprocessMode,
    requestedFirecrawlMode,
    markdownMode,
    metricsEnabled,
    metricsDetailed,
    shouldComputeReport,
    markdownModeExplicitlySet,
  } = resolveRunnerFlags({
    envForRun,
    normalizedArgv,
    programOpts,
    url: inputTarget.kind === 'url' ? inputTarget.url : url,
  });

  if (extractMode && lengthExplicitlySet && !json && isRichTty(stderr)) {
    stderr.write('Warning: --length is ignored with --extract (no summary is generated).\n');
  }

  const modelArg = typeof programOpts.model === 'string' ? programOpts.model : null;
  const cliProviderArg =
    typeof cliProviderArgRaw === 'string' && cliProviderArgRaw.trim().length > 0
      ? parseCliProviderArg(cliProviderArgRaw)
      : null;
  if (cliFlagPresent && modelArg) {
    throw new Error('Use either --model or --cli (not both).');
  }
  const explicitModelArg = cliProviderArg
    ? `cli/${cliProviderArg}`
    : (cliFlagPresent
      ? 'auto'
      : modelArg);

  const {
    config,
    configPath,
    outputLanguage,
    openaiWhisperUsdPerMinute,
    videoMode,
    cliConfigForRun,
    configForCli,
    openaiUseChatCompletions,
    openaiRequestOptions,
    openaiRequestOptionsOverride,
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
    apifyToken,
    ytDlpPath,
    ytDlpCookiesFromBrowser,
    falApiKey,
    cliAvailability,
    envForAuto,
  } = resolveRunContextState({
    cliFlagPresent,
    cliProviderArg,
    env,
    envForRun,
    languageExplicitlySet,
    programOpts,
    videoModeExplicitlySet,
  });

  const themeName = resolveThemeNameFromSources({
    cli: (programOpts as { theme?: unknown }).theme,
    config: config?.ui?.theme,
    env: envForRun.SUMMARIZE_THEME,
  });
  envForRun.SUMMARIZE_THEME = themeName;
  if (!promptOverride && typeof config?.prompt === 'string' && config.prompt.trim().length > 0) {
    promptOverride = config.prompt.trim();
  }
  const lengthArg = lengthExplicitlySet
    ? requestedLengthArg
    : resolveSummaryLength(config?.output?.length).lengthArg;

  const slidesSettings = resolveRunnerSlidesSettings({
    config,
    inputTarget,
    normalizedArgv,
    programOpts,
  });
  const transcriptTimestamps = Boolean(programOpts.timestamps) || Boolean(slidesSettings);

  const lengthInstruction = promptOverride ? buildPromptLengthInstruction(lengthArg) : null;
  const languageInstruction =
    promptOverride && outputLanguage.kind === 'fixed'
      ? `Output should be ${outputLanguage.label}.`
      : null;

  const transcriptNamespace = `yt:${youtubeMode}`;
  const cacheState = await createCacheStateFromConfig({
    config,
    envForRun,
    noCacheFlag,
    transcriptNamespace,
  });
  const mediaCache = await createMediaCacheFromConfig({ config, envForRun, noMediaCacheFlag });

  if (markdownModeExplicitlySet && format !== 'markdown') {
    throw new Error('--markdown-mode is only supported with --format md');
  }
  if (
    markdownModeExplicitlySet &&
    inputTarget.kind !== 'url' &&
    inputTarget.kind !== 'file' &&
    inputTarget.kind !== 'stdin'
  ) {
    throw new Error('--markdown-mode is only supported for URL, file, or stdin inputs');
  }
  if (
    markdownModeExplicitlySet &&
    (inputTarget.kind === 'file' || inputTarget.kind === 'stdin') &&
    markdownMode !== 'llm'
  ) {
    throw new Error(
      'Only --markdown-mode llm is supported for file/stdin inputs; other modes require a URL',
    );
  }

  const metrics = createRunMetrics({ env, fetchImpl, maxOutputTokensArg });
  const {
    llmCalls,
    trackedFetch,
    buildReport,
    estimateCostUsd,
    getLiteLlmCatalog,
    resolveMaxOutputTokensForCall,
    resolveMaxInputTokensForCall,
    setTranscriptionCost,
  } = metrics;

  const {
    requestedModel,
    requestedModelInput,
    requestedModelLabel,
    isNamedModelSelection,
    isImplicitAutoSelection,
    wantsFreeNamedModel,
    configForModelSelection,
    isFallbackModel,
  } = resolveModelSelection({ config, configForCli, configPath, envForRun, explicitModelArg });

  const verboseColor = supportsColor(stderr, envForRun);
  const themeForStderr = createThemeRenderer({
    enabled: verboseColor,
    themeName,
    trueColor: resolveTrueColor(envForRun),
  });
  const renderSpinnerStatus = (label: string, detail = '…') =>
    `${themeForStderr.label(label)}${themeForStderr.dim(detail)}`;
  const renderSpinnerStatusWithModel = (label: string, modelId: string) =>
    `${themeForStderr.label(label)}${themeForStderr.dim(' (model: ')}${themeForStderr.accent(
      modelId,
    )}${themeForStderr.dim(')…')}`;
  const { streamingEnabled } = resolveStreamSettings({ extractMode, json, stdout, streamMode });

  if (
    extractMode &&
    inputTarget.kind === 'file' &&
    !isTranscribableExtension(inputTarget.filePath) &&
    !isPdfExtension(inputTarget.filePath)
  ) {
    throw new Error(
      '--extract for local files is only supported for media files (MP3, MP4, WAV, etc.) and PDF files',
    );
  }
  if (extractMode && inputTarget.kind === 'stdin') {
    throw new Error('--extract is not supported for piped stdin input');
  }

  const progressEnabled = isRichTty(stderr) && !verbose && !json;
  const progressGate = createProgressGate();
  const {
    clearProgressForStdout,
    restoreProgressAfterStdout,
    setClearProgressBeforeStdout,
    clearProgressIfCurrent,
  } = progressGate;

  const fixedModelSpec: FixedModelSpec | null =
    requestedModel.kind === 'fixed' ? requestedModel : null;
  const desiredOutputTokens = resolveDesiredOutputTokens({ lengthArg, maxOutputTokensArg });

  const summaryEngine = createSummaryEngine({
    apiKeys: { anthropicApiKey, googleApiKey, openaiApiKey: apiKey, openrouterApiKey, xaiApiKey },
    clearProgressForStdout,
    cliAvailability,
    cliConfigForRun: cliConfigForRun ?? null,
    env,
    envForRun,
    execFileImpl,
    keyFlags: { anthropicConfigured, googleConfigured, openrouterConfigured },
    llmCalls,
    nvidia: { apiKey: nvidiaApiKey, baseUrl: nvidiaBaseUrl },
    openaiRequestOptions,
    openaiRequestOptionsOverride,
    openaiUseChatCompletions,
    plain,
    providerBaseUrls,
    resolveMaxInputTokensForCall,
    resolveMaxOutputTokensForCall,
    restoreProgressAfterStdout,
    retries,
    stderr,
    stdout,
    streamingEnabled,
    timeoutMs,
    trackedFetch,
    verbose,
    verboseColor,
    zai: { apiKey: zaiApiKey, baseUrl: zaiBaseUrl },
  });

  const writeViaFooter = (parts: string[]) => {
    if (json || extractMode) {return;}
    const filtered = parts.map((part) => part.trim()).filter(Boolean);
    if (filtered.length === 0) {return;}
    clearProgressForStdout();
    stderr.write(`${themeForStderr.dim(`via ${filtered.join(', ')}`)}\n`);
    restoreProgressAfterStdout?.();
  };

  const { summarizeAsset, assetInputContext, urlFlowContext } = createRunnerFlowContexts({
    buildReport,
    cacheState,
    clearProgressForStdout,
    clearProgressIfCurrent,
    estimateCostUsd,
    flags: {
      configModelLabel,
      configPath,
      extractMode,
      firecrawlMode: requestedFirecrawlMode,
      forceSummary,
      format,
      json,
      languageInstruction,
      lengthArg,
      lengthInstruction,
      markdownMode,
      maxExtractCharacters: extractMode ? maxExtractCharacters : null,
      maxOutputTokensArg,
      metricsDetailed,
      metricsEnabled,
      outputLanguage,
      plain,
      preprocessMode,
      progressEnabled,
      promptOverride,
      retries,
      runStartedAtMs,
      shouldComputeReport,
      slides: slidesSettings,
      slidesDebug,
      slidesOutput: true,
      streamMode,
      streamingEnabled,
      summaryCacheBypass: noCacheFlag,
      timeoutMs,
      transcriptTimestamps,
      verbose,
      verboseColor,
      videoMode,
      youtubeMode,
    },
    io: { env, envForRun, execFileImpl, fetch: trackedFetch, stderr, stdout },
    mediaCache,
    model: {
      allowAutoCliFallback: false,
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
      getLiteLlmCatalog,
      isFallbackModel,
      isImplicitAutoSelection,
      isNamedModelSelection,
      llmCalls,
      openaiRequestOptions,
      openaiRequestOptionsOverride,
      openaiUseChatCompletions,
      openaiWhisperUsdPerMinute,
      requestedModel,
      requestedModelInput,
      requestedModelLabel,
      summaryEngine,
      wantsFreeNamedModel,
    },
    restoreProgressAfterStdout,
    setClearProgressBeforeStdout,
    setTranscriptionCost,
    summarizeMediaFileImpl,
    writeViaFooter,
  });

  return {
    cacheState,
    execute: async () => {
      await executeRunnerInput({
        extractAssetContext: { env, envForRun, execFileImpl, preprocessMode, timeoutMs },
        extractMode,
        handleFileInputContext: assetInputContext,
        inputTarget,
        isYoutubeUrl,
        outputExtractedAssetContext: {
          apiStatus: {
            anthropicConfigured,
            apiKey,
            apifyToken,
            firecrawlConfigured,
            googleConfigured,
            openaiApiKey,
            openrouterApiKey,
            xaiApiKey,
          },
          flags: {
            format,
            json,
            metricsDetailed,
            metricsEnabled,
            plain,
            preprocessMode,
            runStartedAtMs,
            shouldComputeReport,
            timeoutMs,
            verboseColor,
          },
          hooks: {
            buildReport,
            clearProgressForStdout,
            estimateCostUsd,
            restoreProgressAfterStdout,
          },
          io: { env, envForRun, stderr, stdout },
        },
        progressEnabled,
        renderSpinnerStatus,
        renderSpinnerStatusWithModel,
        runUrlFlowContext: urlFlowContext,
        slidesEnabled: Boolean(slidesSettings),
        stdin: stdin ?? process.stdin,
        summarizeAsset,
        url,
        withUrlAssetContext: assetInputContext,
      });
    },
  };
}
