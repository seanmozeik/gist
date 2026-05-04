import type { Command } from 'commander';

import type { CacheState } from '../cache';
import type { ExecFileFn } from '../markitdown';
import type { FixedModelSpec } from '../model-spec';
import {
  createThemeRenderer,
  resolveThemeNameFromSources,
  resolveTrueColor,
} from '../tty/theme.js';
import { createCacheStateFromConfig } from './cache-state';
import { parseCliProviderArg } from './env';
import { isPdfExtension, isTranscribableExtension } from './flows/asset/input';
import { gistMediaFile as gistMediaFileImpl } from './flows/asset/media';
import { createMediaCacheFromConfig } from './media-cache-state';
import { createProgressGate } from './progress';
import { resolveRunContextState } from './run-context';
import { resolveRunInput } from './run-input';
import { createRunMetrics } from './run-metrics';
import { resolveModelSelection } from './run-models';
import { resolveDesiredOutputTokens } from './run-output';
import { buildPromptLengthInstruction, resolveSummaryLength } from './run-settings';
import { resolveStreamSettings } from './run-stream';
import { createRunnerFlowContexts } from './runner-contexts';
import { executeRunnerInput } from './runner-execution';
import { resolveRunnerFlags } from './runner-flags';
import { createSummaryEngine } from './summary-engine';
import { isRichTty, supportsColor } from './terminal';

export interface RunnerPlan {
  cacheState: CacheState;
  execute: () => Promise<void>;
}

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
  const { normalizedArgv, program, env, envForRun, execFileImpl, stdin, stdout, stderr } = options;
  let { promptOverride } = options;
  const programOpts = program.opts();

  const cliFlagPresent = normalizedArgv.some((arg) => arg === '--cli' || arg.startsWith('--cli='));
  let cliProviderArgRaw = typeof programOpts.cli === 'string' ? programOpts.cli : null;
  const inputResolution = resolveRunInput({ cliFlagPresent, cliProviderArgRaw, program, stdout });
  ({ cliProviderArgRaw } = inputResolution);
  const { inputTarget } = inputResolution;
  const { url } = inputResolution;

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
    streamMode,
    plain,
    verbose,
    maxExtractCharacters,
    isYoutubeUrl,
    format,
    youtubeMode: requestedYoutubeMode,
    youtubeModeExplicitlySet,
    lengthArg: requestedLengthArg,
    maxOutputTokensArg,
    timeoutMs,
    retries,
    preprocessMode,
    markdownMode,
    metricsEnabled,
    metricsDetailed,
    shouldComputeReport,
    markdownModeExplicitlySet,
  } = resolveRunnerFlags({
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
    : cliFlagPresent
      ? 'auto'
      : modelArg;

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
    openrouterApiKey,
    ytDlpPath,
    ytDlpCookiesFromBrowser,
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
  const youtubeMode = youtubeModeExplicitlySet
    ? requestedYoutubeMode
    : (config?.media?.youtubeMode ?? requestedYoutubeMode);

  const themeName = resolveThemeNameFromSources({
    cli: (programOpts as { theme?: unknown }).theme,
    config: config?.ui?.theme,
    env: envForRun.GIST_THEME,
  });
  envForRun.GIST_THEME = themeName;
  if (!promptOverride && typeof config?.prompt === 'string' && config.prompt.trim().length > 0) {
    promptOverride = config.prompt.trim();
  }
  const lengthArg = lengthExplicitlySet
    ? requestedLengthArg
    : resolveSummaryLength(config?.output?.length).lengthArg;

  const transcriptTimestamps = Boolean(programOpts.timestamps);

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

  const metrics = createRunMetrics({ maxOutputTokensArg });
  const {
    llmCalls,
    trackedFetch,
    buildReport,
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
    apiKeys: { openrouterApiKey },
    clearProgressForStdout,
    cliAvailability,
    cliConfigForRun: cliConfigForRun ?? null,
    env,
    envForRun,
    execFileImpl,
    llmCalls,
    localBaseUrl: envForRun.GIST_LOCAL_BASE_URL?.trim() ?? config?.local?.baseUrl ?? null,
    openaiRequestOptions,
    openaiRequestOptionsOverride,
    openaiUseChatCompletions,
    plain,
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
  });

  const writeViaFooter = (parts: string[]) => {
    if (json || extractMode) {
      return;
    }
    const filtered = parts.map((part) => part.trim()).filter(Boolean);
    if (filtered.length === 0) {
      return;
    }
    clearProgressForStdout();
    stderr.write(`${themeForStderr.dim(`via ${filtered.join(', ')}`)}\n`);
    restoreProgressAfterStdout?.();
  };

  const { gistAsset, assetInputContext, urlFlowContext } = createRunnerFlowContexts({
    buildReport,
    cacheState,
    clearProgressForStdout,
    clearProgressIfCurrent,
    estimateCostUsd: metrics.estimateCostUsd,
    flags: {
      configModelLabel,
      configPath,
      extractMode,
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
    gistMediaFileImpl,
    io: { env, envForRun, execFileImpl, fetch: trackedFetch, stderr, stdout },
    mediaCache,
    model: {
      allowAutoCliFallback: false,
      apiStatus: {
        localBaseUrl: envForRun.GIST_LOCAL_BASE_URL?.trim() ?? config?.local?.baseUrl ?? null,
        openrouterApiKey,
        ytDlpCookiesFromBrowser,
        ytDlpPath,
      },
      cliAvailability,
      configForModelSelection,
      desiredOutputTokens,
      envForAuto,
      fixedModelSpec,
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
    },
    restoreProgressAfterStdout,
    setClearProgressBeforeStdout,
    setTranscriptionCost,
    writeViaFooter,
  });

  return {
    cacheState,
    execute: async () => {
      await executeRunnerInput({
        extractAssetContext: { env, envForRun, execFileImpl, preprocessMode, timeoutMs },
        extractMode,
        gistAsset,
        handleFileInputContext: assetInputContext,
        inputTarget,
        isYoutubeUrl,
        outputExtractedAssetContext: {
          apiStatus: {
            localBaseUrl: null,
            openrouterApiKey,
            ytDlpCookiesFromBrowser: null,
            ytDlpPath: null,
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
            estimateCostUsd: metrics.estimateCostUsd,
            restoreProgressAfterStdout,
          },
          io: { env, envForRun, stderr, stdout },
        },
        progressEnabled,
        renderSpinnerStatus,
        renderSpinnerStatusWithModel,

        runUrlFlowContext: urlFlowContext,
        stdin: stdin ?? process.stdin,
        url,
        withUrlAssetContext: assetInputContext,
      });
    },
  };
}
