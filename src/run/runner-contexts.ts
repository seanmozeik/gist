import type { CacheState } from '../cache.js';
import type { MediaCache } from '../content/index.js';
import { createAssetSummaryContext, type SummarizeAssetArgs } from './flows/asset/summary.js';
import { summarizeAsset as summarizeAssetFlow } from './flows/asset/summary.js';
import { createUrlFlowContext, type UrlFlowContext } from './flows/url/types.js';

type SummarizeMediaFile = typeof import('./flows/asset/media.js').summarizeMediaFile;

export function createRunnerFlowContexts(options: {
  summarizeMediaFileImpl: SummarizeMediaFile;
  cacheState: CacheState;
  mediaCache: MediaCache | null;
  io: UrlFlowContext['io'];
  flags: UrlFlowContext['flags'];
  model: UrlFlowContext['model'];
  setTranscriptionCost: UrlFlowContext['hooks']['setTranscriptionCost'];
  writeViaFooter: UrlFlowContext['hooks']['writeViaFooter'];
  clearProgressForStdout: UrlFlowContext['hooks']['clearProgressForStdout'];
  restoreProgressAfterStdout: UrlFlowContext['hooks']['restoreProgressAfterStdout'];
  setClearProgressBeforeStdout: UrlFlowContext['hooks']['setClearProgressBeforeStdout'];
  clearProgressIfCurrent: UrlFlowContext['hooks']['clearProgressIfCurrent'];
  buildReport: UrlFlowContext['hooks']['buildReport'];
  estimateCostUsd: UrlFlowContext['hooks']['estimateCostUsd'];
}) {
  const {
    summarizeMediaFileImpl,
    cacheState,
    mediaCache,
    io,
    flags,
    model,
    setTranscriptionCost,
    writeViaFooter,
    clearProgressForStdout,
    restoreProgressAfterStdout,
    setClearProgressBeforeStdout,
    clearProgressIfCurrent,
    buildReport,
    estimateCostUsd,
  } = options;

  const assetSummaryContext = createAssetSummaryContext({
    apiStatus: {
      anthropicConfigured: model.apiStatus.anthropicConfigured,
      apiKey: model.apiStatus.apiKey,
      apifyToken: model.apiStatus.apifyToken,
      assemblyaiApiKey: model.apiStatus.assemblyaiApiKey,
      firecrawlConfigured: model.apiStatus.firecrawlConfigured,
      googleConfigured: model.apiStatus.googleConfigured,
      nvidiaApiKey: model.apiStatus.nvidiaApiKey,
      nvidiaBaseUrl: model.apiStatus.nvidiaBaseUrl,
      openaiApiKey: model.apiStatus.openaiApiKey,
      openrouterApiKey: model.apiStatus.openrouterApiKey,
      providerBaseUrls: model.apiStatus.providerBaseUrls,
      xaiApiKey: model.apiStatus.xaiApiKey,
      zaiApiKey: model.apiStatus.zaiApiKey,
      zaiBaseUrl: model.apiStatus.zaiBaseUrl,
    },
    cache: { cache: cacheState, mediaCache },
    hooks: {
      buildReport,
      clearProgressForStdout,
      estimateCostUsd,
      restoreProgressAfterStdout,
      writeViaFooter,
    },
    io: {
      env: io.env,
      envForRun: io.envForRun,
      execFileImpl: io.execFileImpl,
      stderr: io.stderr,
      stdout: io.stdout,
      trackedFetch: io.fetch,
    },
    model: {
      allowAutoCliFallback: model.allowAutoCliFallback,
      cliAvailability: model.cliAvailability,
      configForModelSelection: model.configForModelSelection,
      desiredOutputTokens: model.desiredOutputTokens,
      envForAuto: model.envForAuto,
      fixedModelSpec: model.fixedModelSpec,
      getLiteLlmCatalog: model.getLiteLlmCatalog,
      isFallbackModel: model.isFallbackModel,
      isImplicitAutoSelection: model.isImplicitAutoSelection,
      isNamedModelSelection: model.isNamedModelSelection,
      llmCalls: model.llmCalls,
      requestedModel: model.requestedModel,
      requestedModelInput: model.requestedModelInput,
      requestedModelLabel: model.requestedModelLabel,
      summaryEngine: model.summaryEngine,
      wantsFreeNamedModel: model.wantsFreeNamedModel,
    },
    output: {
      json: flags.json,
      metricsDetailed: flags.metricsDetailed,
      metricsEnabled: flags.metricsEnabled,
      plain: flags.plain,
      runStartedAtMs: flags.runStartedAtMs,
      shouldComputeReport: flags.shouldComputeReport,
      streamingEnabled: flags.streamingEnabled,
      verbose: flags.verbose,
      verboseColor: flags.verboseColor,
    },
    summary: {
      extractMode: flags.extractMode,
      forceSummary: flags.forceSummary,
      format: flags.format,
      languageInstruction: flags.languageInstruction,
      lengthArg: flags.lengthArg,
      lengthInstruction: flags.lengthInstruction,
      maxOutputTokensArg: flags.maxOutputTokensArg,
      outputLanguage: flags.outputLanguage,
      preprocessMode: flags.preprocessMode,
      promptOverride: flags.promptOverride,
      summaryCacheBypass: flags.summaryCacheBypass,
      timeoutMs: flags.timeoutMs,
      videoMode: flags.videoMode,
    },
  });

  const summarizeAsset = (args: SummarizeAssetArgs) =>
    summarizeAssetFlow(assetSummaryContext, args);
  const summarizeMediaFile = (args: Parameters<SummarizeMediaFile>[1]) =>
    summarizeMediaFileImpl(assetSummaryContext, args);

  return {
    assetInputContext: {
      clearProgressIfCurrent,
      env: assetSummaryContext.env,
      envForRun: assetSummaryContext.envForRun,
      progressEnabled: flags.progressEnabled,
      setClearProgressBeforeStdout,
      stderr: assetSummaryContext.stderr,
      summarizeAsset,
      summarizeMediaFile,
      timeoutMs: flags.timeoutMs,
      trackedFetch: io.fetch,
    },
    summarizeAsset,
    urlFlowContext: createUrlFlowContext({
      io,
      flags,
      model,
      cache: cacheState,
      mediaCache,
      runtimeHooks: {
        setTranscriptionCost,
        summarizeAsset,
        writeViaFooter,
        clearProgressForStdout,
        restoreProgressAfterStdout,
        setClearProgressBeforeStdout,
        clearProgressIfCurrent,
        buildReport,
        estimateCostUsd,
      },
    }),
  };
}
