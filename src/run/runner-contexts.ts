import type { CacheState } from '../cache';
import type { MediaCache } from '../content/index';
import { createAssetSummaryContext, type GistAssetArgs } from './flows/asset/summary';
import { gistAsset as gistAssetFlow } from './flows/asset/summary';
import { createUrlFlowContext, type UrlFlowContext } from './flows/url/types';

type GistMediaFile = typeof import('./flows/asset/media.js').gistMediaFile;

export function createRunnerFlowContexts(options: {
  gistMediaFileImpl: GistMediaFile;
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
    gistMediaFileImpl,
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
      localBaseUrl: model.apiStatus.localBaseUrl,
      openrouterApiKey: model.apiStatus.openrouterApiKey,
      ytDlpCookiesFromBrowser: model.apiStatus.ytDlpCookiesFromBrowser,
      ytDlpPath: model.apiStatus.ytDlpPath,
    },
    cache: { cache: cacheState, mediaCache },
    hooks: { buildReport, clearProgressForStdout, restoreProgressAfterStdout, writeViaFooter },
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
      isFallbackModel: model.isFallbackModel,
      isImplicitAutoSelection: model.isImplicitAutoSelection,
      isNamedModelSelection: model.isNamedModelSelection,
      llmCalls: model.llmCalls,
      requestedModel: model.requestedModel,
      requestedModelInput: model.requestedModelInput,
      requestedModelLabel: model.requestedModelLabel,
      summaryEngine: model.summaryEngine,
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

  const gistAsset = (args: GistAssetArgs) => gistAssetFlow(assetSummaryContext, args);
  const gistMediaFile = (args: Parameters<GistMediaFile>[1]) =>
    gistMediaFileImpl(assetSummaryContext, args);

  return {
    assetInputContext: {
      clearProgressIfCurrent,
      env: assetSummaryContext.env,
      envForRun: assetSummaryContext.envForRun,
      gistAsset,
      gistMediaFile,
      progressEnabled: flags.progressEnabled,
      setClearProgressBeforeStdout,
      stderr: assetSummaryContext.stderr,
      timeoutMs: flags.timeoutMs,
      trackedFetch: io.fetch,
    },
    gistAsset,
    urlFlowContext: createUrlFlowContext({
      cache: cacheState,
      flags,
      io,
      mediaCache,
      model,
      runtimeHooks: {
        buildReport,
        clearProgressForStdout,
        clearProgressIfCurrent,
        estimateCostUsd,
        gistAsset,
        restoreProgressAfterStdout,
        setClearProgressBeforeStdout,
        setTranscriptionCost,
        writeViaFooter,
      },
    }),
  };
}
