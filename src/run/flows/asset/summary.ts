import { countTokens } from 'gpt-tokenizer';
import { render as renderMarkdownAnsi } from 'markdansi';

import { buildSummaryCacheKey, type CacheState } from '../../../cache';
import { buildLanguageKey, buildLengthKey } from '../../../cache-keys';
import type { CliProvider, GistConfig } from '../../../config';
import type { MediaCache } from '../../../content/index';
import type { LlmCall, RunMetricsReport } from '../../../costs';
import type { OutputLanguage } from '../../../language';
import { formatOutputLanguageForJson } from '../../../language';
import { parseGatewayStyleModelId } from '../../../llm/model-id';
import type { Prompt } from '../../../llm/prompt';
import type { ExecFileFn } from '../../../markitdown';
import type { FixedModelSpec, RequestedModel } from '../../../model-spec';
import { SUMMARY_LENGTH_TARGET_CHARACTERS, SUMMARY_SYSTEM_PROMPT } from '../../../prompts/index';
import type { SummaryLength } from '../../../shared/contracts';
import { type AssetAttachment, isUnsupportedAttachmentError } from '../../attachments';
import {
  readLastSuccessfulCliProvider,
  writeLastSuccessfulCliProvider,
} from '../../cli-fallback-state.js';
import { writeFinishLine } from '../../finish-line';
import { resolveTargetCharacters } from '../../format';
import { writeVerbose } from '../../logging';
import { prepareMarkdownForTerminal } from '../../markdown';
import { runModelAttempts } from '../../model-attempts';
import { buildOpenRouterNoAllowedProvidersMessage } from '../../openrouter';
import type { createSummaryEngine } from '../../summary-engine';
import { isRichTty, markdownRenderWidth, supportsColor } from '../../terminal';
import type { ModelAttempt } from '../../types';
import { prepareAssetPrompt } from './preprocess';
import { buildAssetCliContext, buildAssetModelAttempts } from './summary-attempts';

const buildModelMetaFromAttempt = (attempt: ModelAttempt) => {
  if (attempt.transport === 'cli') {
    return { canonical: attempt.userModelId, provider: 'cli' as const };
  }
  const parsed = parseGatewayStyleModelId(attempt.llmModelId ?? attempt.userModelId);
  const canonical = attempt.userModelId.toLowerCase().startsWith('openrouter/')
    ? attempt.userModelId
    : parsed.canonical;
  return { canonical, provider: parsed.provider };
};

function shouldBypassShortContentSummary({
  ctx,
  textContent,
}: {
  ctx: Pick<AssetSummaryContext, 'forceSummary' | 'lengthArg' | 'maxOutputTokensArg' | 'json'>;
  textContent: { content: string } | null;
}): boolean {
  if (ctx.forceSummary) {
    return false;
  }
  if (!textContent?.content) {
    return false;
  }
  const targetCharacters = resolveTargetCharacters(ctx.lengthArg, SUMMARY_LENGTH_TARGET_CHARACTERS);
  if (!Number.isFinite(targetCharacters) || targetCharacters <= 0) {
    return false;
  }
  if (textContent.content.length > targetCharacters) {
    return false;
  }
  if (!ctx.json && typeof ctx.maxOutputTokensArg === 'number') {
    const tokenCount = countTokens(textContent.content);
    if (tokenCount > ctx.maxOutputTokensArg) {
      return false;
    }
  }
  return true;
}

async function outputBypassedAssetSummary({
  ctx,
  args,
  promptText,
  summaryText,
  assetFooterParts,
  footerLabel,
}: {
  ctx: AssetSummaryContext;
  args: GistAssetArgs;
  promptText: string;
  summaryText: string;
  assetFooterParts: string[];
  footerLabel: string;
}) {
  const summary = summaryText.trimEnd();
  const extracted = {
    filename: args.attachment.filename,
    kind: 'asset' as const,
    mediaType: args.attachment.mediaType,
    source: args.sourceLabel,
  };

  if (ctx.json) {
    ctx.clearProgressForStdout();
    const finishReport = ctx.shouldComputeReport ? await ctx.buildReport() : null;
    const input =
      args.sourceKind === 'file'
        ? {
            filePath: args.sourceLabel,
            kind: 'file',
            language: formatOutputLanguageForJson(ctx.outputLanguage),
            length:
              ctx.lengthArg.kind === 'preset'
                ? { kind: 'preset', preset: ctx.lengthArg.preset }
                : { kind: 'chars', maxCharacters: ctx.lengthArg.maxCharacters },
            maxOutputTokens: ctx.maxOutputTokensArg,
            model: ctx.requestedModelLabel,
            timeoutMs: ctx.timeoutMs,
          }
        : {
            kind: 'asset-url',
            language: formatOutputLanguageForJson(ctx.outputLanguage),
            length:
              ctx.lengthArg.kind === 'preset'
                ? { kind: 'preset', preset: ctx.lengthArg.preset }
                : { kind: 'chars', maxCharacters: ctx.lengthArg.maxCharacters },
            maxOutputTokens: ctx.maxOutputTokensArg,
            model: ctx.requestedModelLabel,
            timeoutMs: ctx.timeoutMs,
            url: args.sourceLabel,
          };
    const payload = {
      env: { hasOpenRouterKey: Boolean(ctx.apiStatus.openrouterApiKey) },
      extracted,
      input,
      llm: null,
      metrics: ctx.metricsEnabled ? finishReport : null,
      prompt: promptText,
      summary,
    };
    ctx.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    ctx.restoreProgressAfterStdout?.();
    if (ctx.metricsEnabled && finishReport) {
      const costUsd: number | null = null;
      writeFinishLine({
        color: ctx.verboseColor,
        costUsd,
        detailed: ctx.metricsDetailed,
        elapsedLabel: null,
        elapsedMs: Date.now() - ctx.runStartedAtMs,
        env: ctx.envForRun,
        extraParts: null,
        model: null,
        report: finishReport,
        stderr: ctx.stderr,
      });
    }
    return;
  }

  ctx.clearProgressForStdout();
  const rendered =
    !ctx.plain && isRichTty(ctx.stdout)
      ? renderMarkdownAnsi(prepareMarkdownForTerminal(summary), {
          color: supportsColor(ctx.stdout, ctx.envForRun),
          hyperlinks: true,
          width: markdownRenderWidth(ctx.stdout, ctx.env),
          wrap: true,
        })
      : summary;

  if (!ctx.plain && isRichTty(ctx.stdout)) {
    ctx.stdout.write(`\n${rendered.replace(/^\n+/, '')}`);
  } else {
    if (isRichTty(ctx.stdout)) {
      ctx.stdout.write('\n');
    }
    ctx.stdout.write(rendered.replace(/^\n+/, ''));
  }
  if (!rendered.endsWith('\n')) {
    ctx.stdout.write('\n');
  }
  ctx.restoreProgressAfterStdout?.();
  if (assetFooterParts.length > 0) {
    ctx.writeViaFooter([...assetFooterParts, footerLabel]);
  }

  const report = ctx.shouldComputeReport ? await ctx.buildReport() : null;
  if (ctx.metricsEnabled && report) {
    const costUsd: number | null = null;
    writeFinishLine({
      color: ctx.verboseColor,
      costUsd,
      detailed: ctx.metricsDetailed,
      elapsedLabel: null,
      elapsedMs: Date.now() - ctx.runStartedAtMs,
      env: ctx.envForRun,
      extraParts: null,
      model: null,
      report,
      stderr: ctx.stderr,
    });
  }
}

export interface AssetSummaryContext {
  env: Record<string, string | undefined>;
  envForRun: Record<string, string | undefined>;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  execFileImpl: ExecFileFn;
  timeoutMs: number;
  preprocessMode: 'off' | 'auto' | 'always';
  format: 'text' | 'markdown';
  extractMode: boolean;
  lengthArg: { kind: 'preset'; preset: SummaryLength } | { kind: 'chars'; maxCharacters: number };
  forceSummary: boolean;
  outputLanguage: OutputLanguage;
  videoMode: 'auto' | 'transcript' | 'understand';
  fixedModelSpec: FixedModelSpec | null;
  promptOverride?: string | null;
  lengthInstruction?: string | null;
  languageInstruction?: string | null;
  isFallbackModel: boolean;
  isImplicitAutoSelection: boolean;
  allowAutoCliFallback: boolean;
  desiredOutputTokens: number | null;
  envForAuto: Record<string, string | undefined>;
  configForModelSelection: GistConfig | null;
  cliAvailability: Partial<Record<CliProvider, boolean>>;
  requestedModel: RequestedModel;
  requestedModelInput: string;
  requestedModelLabel: string;
  isNamedModelSelection: boolean;
  maxOutputTokensArg: number | null;
  json: boolean;
  metricsEnabled: boolean;
  metricsDetailed: boolean;
  shouldComputeReport: boolean;
  runStartedAtMs: number;
  verbose: boolean;
  verboseColor: boolean;
  streamingEnabled: boolean;
  plain: boolean;
  summaryEngine: ReturnType<typeof createSummaryEngine>;
  trackedFetch: typeof fetch;
  writeViaFooter: (parts: string[]) => void;
  clearProgressForStdout: () => void;
  restoreProgressAfterStdout?: (() => void) | null;
  buildReport: () => Promise<RunMetricsReport>;
  llmCalls: LlmCall[];
  cache: CacheState;
  summaryCacheBypass: boolean;
  mediaCache: MediaCache | null;
  apiStatus: {
    openrouterApiKey: string | null;
    ytDlpPath: string | null;
    ytDlpCookiesFromBrowser: string | null;
    localBaseUrl: string | null;
  };
}

export interface AssetSummaryContextInput {
  io: Pick<
    AssetSummaryContext,
    'env' | 'envForRun' | 'stdout' | 'stderr' | 'execFileImpl' | 'trackedFetch'
  >;
  summary: Pick<
    AssetSummaryContext,
    | 'timeoutMs'
    | 'preprocessMode'
    | 'format'
    | 'extractMode'
    | 'lengthArg'
    | 'forceSummary'
    | 'outputLanguage'
    | 'videoMode'
    | 'promptOverride'
    | 'lengthInstruction'
    | 'languageInstruction'
    | 'maxOutputTokensArg'
    | 'summaryCacheBypass'
  >;
  model: Pick<
    AssetSummaryContext,
    | 'fixedModelSpec'
    | 'isFallbackModel'
    | 'isImplicitAutoSelection'
    | 'allowAutoCliFallback'
    | 'desiredOutputTokens'
    | 'envForAuto'
    | 'configForModelSelection'
    | 'cliAvailability'
    | 'requestedModel'
    | 'requestedModelInput'
    | 'requestedModelLabel'
    | 'isNamedModelSelection'
    | 'summaryEngine'
    | 'llmCalls'
  >;
  output: Pick<
    AssetSummaryContext,
    | 'json'
    | 'metricsEnabled'
    | 'metricsDetailed'
    | 'shouldComputeReport'
    | 'runStartedAtMs'
    | 'verbose'
    | 'verboseColor'
    | 'streamingEnabled'
    | 'plain'
  >;
  hooks: Pick<
    AssetSummaryContext,
    'writeViaFooter' | 'clearProgressForStdout' | 'restoreProgressAfterStdout' | 'buildReport'
  >;
  cache: Pick<AssetSummaryContext, 'cache' | 'mediaCache'>;
  apiStatus: AssetSummaryContext['apiStatus'];
}

export function createAssetSummaryContext(input: AssetSummaryContextInput): AssetSummaryContext {
  return {
    ...input.io,
    ...input.summary,
    ...input.model,
    ...input.output,
    ...input.hooks,
    ...input.cache,
    apiStatus: input.apiStatus,
  };
}

export interface GistAssetArgs {
  sourceKind: 'file' | 'asset-url';
  sourceLabel: string;
  attachment: AssetAttachment;
  onModelChosen?: ((modelId: string) => void) | null;
}

export async function gistAsset(ctx: AssetSummaryContext, args: GistAssetArgs) {
  const lastSuccessfulCliProvider = ctx.isFallbackModel
    ? await readLastSuccessfulCliProvider(ctx.envForRun)
    : null;

  const { promptText, attachments, assetFooterParts, textContent } = await prepareAssetPrompt({
    attachment: args.attachment,
    ctx: {
      env: ctx.env,
      envForRun: ctx.envForRun,
      execFileImpl: ctx.execFileImpl,
      fixedModelSpec: ctx.fixedModelSpec,
      format: ctx.format,
      languageInstruction: ctx.languageInstruction ?? null,
      lengthArg: ctx.lengthArg,
      lengthInstruction: ctx.lengthInstruction ?? null,
      localBaseUrl: ctx.apiStatus.localBaseUrl,
      outputLanguage: ctx.outputLanguage,
      preprocessMode: ctx.preprocessMode,
      promptOverride: ctx.promptOverride ?? null,
      timeoutMs: ctx.timeoutMs,
    },
  });
  const prompt: Prompt = {
    system: SUMMARY_SYSTEM_PROMPT,
    userText: promptText,
    ...(attachments.length > 0 ? { attachments } : {}),
  };

  const summaryLengthTarget =
    ctx.lengthArg.kind === 'preset'
      ? ctx.lengthArg.preset
      : { maxCharacters: ctx.lengthArg.maxCharacters };

  const promptTokensForAuto = attachments.length === 0 ? countTokens(prompt.userText) : null;
  const lowerMediaType = args.attachment.mediaType.toLowerCase();
  const kind = lowerMediaType.startsWith('video/')
    ? ('video' as const)
    : lowerMediaType.startsWith('image/')
      ? ('image' as const)
      : textContent
        ? ('text' as const)
        : ('file' as const);
  const requiresVideoUnderstanding = kind === 'video' && ctx.videoMode !== 'transcript';

  if (
    ctx.isFallbackModel &&
    !ctx.isNamedModelSelection &&
    shouldBypassShortContentSummary({ ctx, textContent })
  ) {
    await outputBypassedAssetSummary({
      args,
      assetFooterParts,
      ctx,
      footerLabel: 'short content',
      promptText,
      summaryText: textContent?.content ?? '',
    });
    return;
  }

  if (
    ctx.requestedModel.kind === 'auto' &&
    !ctx.isNamedModelSelection &&
    !ctx.forceSummary &&
    !ctx.json &&
    typeof ctx.maxOutputTokensArg === 'number' &&
    textContent &&
    countTokens(textContent.content) <= ctx.maxOutputTokensArg
  ) {
    ctx.clearProgressForStdout();
    ctx.stdout.write(`${textContent.content.trim()}\n`);
    ctx.restoreProgressAfterStdout?.();
    if (assetFooterParts.length > 0) {
      ctx.writeViaFooter([...assetFooterParts, 'no model']);
    }
    return;
  }

  const attempts: ModelAttempt[] = await buildAssetModelAttempts({
    ctx,
    kind,
    lastSuccessfulCliProvider,
    promptTokensForAuto,
    requiresVideoUnderstanding,
  });

  const cliContext = await buildAssetCliContext({
    args,
    attachmentsCount: attachments.length,
    attempts,
    ctx,
    summaryLengthTarget,
  });

  const cacheStore =
    ctx.cache.mode === 'default' && !ctx.summaryCacheBypass ? ctx.cache.store : null;
  // Simplified cache keys
  const contentHash = cacheStore
    ? `c:${promptText.slice(0, 500).replaceAll(/\s+/g, ' ').trim()}`
    : null;
  const promptHash = cacheStore ? `p:${promptText.replaceAll(/\s+/g, ' ').trim()}` : null;
  const lengthKey = buildLengthKey(ctx.lengthArg);
  const languageKey = buildLanguageKey(ctx.outputLanguage);
  const autoSelectionCacheModel = ctx.isFallbackModel
    ? `selection:${ctx.requestedModelInput.toLowerCase()}`
    : null;

  let summaryResult: Awaited<ReturnType<typeof ctx.summaryEngine.runSummaryAttempt>> | null = null;
  let usedAttempt: ModelAttempt | null = null;
  let summaryFromCache = false;
  let cacheChecked = false;

  if (cacheStore && contentHash && promptHash) {
    cacheChecked = true;
    if (autoSelectionCacheModel) {
      const key = buildSummaryCacheKey({
        contentHash,
        languageKey,
        lengthKey,
        model: autoSelectionCacheModel,
        promptHash,
      });
      const cachedRaw = cacheStore.getJson('summary', key);
      const cached = cachedRaw as { summary?: unknown; model?: unknown } | null;
      const cachedSummary =
        cached && typeof cached.summary === 'string' ? cached.summary.trim() : null;
      const cachedModelId = cached && typeof cached.model === 'string' ? cached.model.trim() : null;
      if (cachedSummary) {
        const cachedAttempt = cachedModelId
          ? (attempts.find((attempt) => attempt.userModelId === cachedModelId) ?? null)
          : null;
        const fallbackAttempt =
          attempts.find((attempt) => ctx.summaryEngine.envHasKeyFor(attempt.requiredEnv)) ??
          attempts[0] ??
          null;
        const matchedAttempt =
          cachedAttempt && ctx.summaryEngine.envHasKeyFor(cachedAttempt.requiredEnv)
            ? cachedAttempt
            : fallbackAttempt;
        if (matchedAttempt) {
          writeVerbose(
            ctx.stderr,
            ctx.verbose,
            'cache hit summary (auto selection)',
            ctx.verboseColor,
            ctx.envForRun,
          );
          args.onModelChosen?.(cachedModelId ?? matchedAttempt.userModelId);
          summaryResult = {
            maxOutputTokensForCall: null,
            modelMeta: buildModelMetaFromAttempt(matchedAttempt),
            summary: cachedSummary,
            summaryAlreadyPrinted: false,
          };
          usedAttempt = matchedAttempt;
          summaryFromCache = true;
        }
      }
    }
    if (!summaryFromCache) {
      for (const attempt of attempts) {
        if (!ctx.summaryEngine.envHasKeyFor(attempt.requiredEnv)) {
          continue;
        }
        const key = buildSummaryCacheKey({
          contentHash,
          languageKey,
          lengthKey,
          model: attempt.userModelId,
          promptHash,
        });
        const cached = cacheStore.getText('summary', key);
        if (!cached) {
          continue;
        }
        writeVerbose(ctx.stderr, ctx.verbose, 'cache hit summary', ctx.verboseColor, ctx.envForRun);
        args.onModelChosen?.(attempt.userModelId);
        summaryResult = {
          maxOutputTokensForCall: null,
          modelMeta: buildModelMetaFromAttempt(attempt),
          summary: cached,
          summaryAlreadyPrinted: false,
        };
        usedAttempt = attempt;
        summaryFromCache = true;
        break;
      }
    }
  }
  if (cacheChecked && !summaryFromCache) {
    writeVerbose(ctx.stderr, ctx.verbose, 'cache miss summary', ctx.verboseColor, ctx.envForRun);
  }

  let lastError: unknown = null;
  let missingRequiredEnvs = new Set<ModelAttempt['requiredEnv']>();
  let sawOpenRouterNoAllowedProviders = false;

  if (!summaryResult || !usedAttempt) {
    const attemptOutcome = await runModelAttempts({
      attempts,
      envHasKeyFor: ctx.summaryEngine.envHasKeyFor,
      formatMissingModelError: ctx.summaryEngine.formatMissingModelError,
      isFallbackModel: ctx.isFallbackModel,
      isNamedModelSelection: ctx.isNamedModelSelection,
      onAutoFailure: (attempt, error) => {
        writeVerbose(
          ctx.stderr,
          ctx.verbose,
          `auto failed ${attempt.userModelId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
          ctx.verboseColor,
          ctx.envForRun,
        );
      },
      onAutoSkip: (attempt) => {
        writeVerbose(
          ctx.stderr,
          ctx.verbose,
          `auto skip ${attempt.userModelId}: missing ${attempt.requiredEnv}`,
          ctx.verboseColor,
          ctx.envForRun,
        );
      },
      onFixedModelError: (attempt, error) => {
        if (isUnsupportedAttachmentError(error)) {
          throw new Error(
            `Model ${attempt.userModelId} does not support attaching files of type ${args.attachment.mediaType}. Try a different --model.`,
            { cause: error },
          );
        }
        throw error;
      },
      runAttempt: (attempt) =>
        ctx.summaryEngine.runSummaryAttempt({
          allowStreaming: ctx.streamingEnabled,
          attempt,
          cli: cliContext,
          onModelChosen: args.onModelChosen ?? null,
          prompt,
        }),
    });
    summaryResult = attemptOutcome.result;
    ({ usedAttempt } = attemptOutcome);
    ({ lastError } = attemptOutcome);
    ({ missingRequiredEnvs } = attemptOutcome);
    ({ sawOpenRouterNoAllowedProviders } = attemptOutcome);
  }

  if (!summaryResult || !usedAttempt) {
    const withFreeTip = (message: string) =>
      ctx.isNamedModelSelection && ctx.requestedModelInput.toLowerCase() === 'free'
        ? `${message}\nTip: run "gist refresh-free" to refresh the free model candidates (writes ~/.gist/config.json).`
        : message;

    if (ctx.isNamedModelSelection) {
      if (lastError === null && missingRequiredEnvs.size > 0) {
        throw new Error(
          withFreeTip(
            `Missing ${[...missingRequiredEnvs].toSorted().join(', ')} for --model ${ctx.requestedModelInput}.`,
          ),
        );
      }
      if (lastError instanceof Error) {
        if (sawOpenRouterNoAllowedProviders) {
          const message = await buildOpenRouterNoAllowedProvidersMessage({
            attempts,
            fetchImpl: ctx.trackedFetch,
            timeoutMs: ctx.timeoutMs,
          });
          throw new Error(withFreeTip(message), { cause: lastError });
        }
        throw new Error(withFreeTip(lastError.message), { cause: lastError });
      }
      throw new Error(withFreeTip(`No model available for --model ${ctx.requestedModelInput}`));
    }
    if (textContent) {
      ctx.clearProgressForStdout();
      ctx.stdout.write(`${textContent.content.trim()}\n`);
      ctx.restoreProgressAfterStdout?.();
      if (assetFooterParts.length > 0) {
        ctx.writeViaFooter([...assetFooterParts, 'no model']);
      }
      return;
    }
    if (lastError instanceof Error) {
      throw lastError;
    }
    throw new Error('No model available for this input');
  }

  if (!summaryFromCache && cacheStore && contentHash && promptHash) {
    const perModelKey = buildSummaryCacheKey({
      contentHash,
      languageKey,
      lengthKey,
      model: usedAttempt.userModelId,
      promptHash,
    });
    cacheStore.setText('summary', perModelKey, summaryResult.summary, ctx.cache.ttlMs);
    writeVerbose(ctx.stderr, ctx.verbose, 'cache write summary', ctx.verboseColor, ctx.envForRun);
    if (autoSelectionCacheModel) {
      const selectionKey = buildSummaryCacheKey({
        contentHash,
        languageKey,
        lengthKey,
        model: autoSelectionCacheModel,
        promptHash,
      });
      cacheStore.setJson(
        'summary',
        selectionKey,
        { model: usedAttempt.userModelId, summary: summaryResult.summary },
        ctx.cache.ttlMs,
      );
      writeVerbose(
        ctx.stderr,
        ctx.verbose,
        'cache write summary (auto selection)',
        ctx.verboseColor,
        ctx.envForRun,
      );
    }
  }
  if (
    !summaryFromCache &&
    ctx.isFallbackModel &&
    usedAttempt.transport === 'cli' &&
    usedAttempt.cliProvider
  ) {
    await writeLastSuccessfulCliProvider({ env: ctx.envForRun, provider: usedAttempt.cliProvider });
  }

  const { summary, summaryAlreadyPrinted, modelMeta, maxOutputTokensForCall } = summaryResult;

  const extracted = {
    filename: args.attachment.filename,
    kind: 'asset' as const,
    mediaType: args.attachment.mediaType,
    source: args.sourceLabel,
  };

  if (ctx.json) {
    ctx.clearProgressForStdout();
    const finishReport = ctx.shouldComputeReport ? await ctx.buildReport() : null;
    const input: {
      kind: 'file' | 'asset-url';
      filePath?: string;
      url?: string;
      timeoutMs: number;
      length: { kind: 'preset'; preset: string } | { kind: 'chars'; maxCharacters: number };
      maxOutputTokens: number | null;
      model: string;
      language: ReturnType<typeof formatOutputLanguageForJson>;
    } =
      args.sourceKind === 'file'
        ? {
            filePath: args.sourceLabel,
            kind: 'file',
            language: formatOutputLanguageForJson(ctx.outputLanguage),
            length:
              ctx.lengthArg.kind === 'preset'
                ? { kind: 'preset', preset: ctx.lengthArg.preset }
                : { kind: 'chars', maxCharacters: ctx.lengthArg.maxCharacters },
            maxOutputTokens: ctx.maxOutputTokensArg,
            model: ctx.requestedModelLabel,
            timeoutMs: ctx.timeoutMs,
          }
        : {
            kind: 'asset-url',
            language: formatOutputLanguageForJson(ctx.outputLanguage),
            length:
              ctx.lengthArg.kind === 'preset'
                ? { kind: 'preset', preset: ctx.lengthArg.preset }
                : { kind: 'chars', maxCharacters: ctx.lengthArg.maxCharacters },
            maxOutputTokens: ctx.maxOutputTokensArg,
            model: ctx.requestedModelLabel,
            timeoutMs: ctx.timeoutMs,
            url: args.sourceLabel,
          };
    const payload = {
      env: { hasOpenRouterKey: Boolean(ctx.apiStatus.openrouterApiKey) },
      extracted,
      input,
      llm: {
        maxCompletionTokens: maxOutputTokensForCall,
        model: usedAttempt.userModelId,
        provider: modelMeta.provider,
        strategy: 'single' as const,
      },
      metrics: ctx.metricsEnabled ? finishReport : null,
      prompt: promptText,
      summary,
    };
    ctx.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    ctx.restoreProgressAfterStdout?.();
    if (ctx.metricsEnabled && finishReport) {
      writeFinishLine({
        color: ctx.verboseColor,
        costUsd: null,
        detailed: ctx.metricsDetailed,
        elapsedLabel: summaryFromCache ? 'Cached' : null,
        elapsedMs: Date.now() - ctx.runStartedAtMs,
        env: ctx.envForRun,
        extraParts: null,
        model: usedAttempt.userModelId,
        report: finishReport,
        stderr: ctx.stderr,
      });
    }
    return;
  }

  if (!summaryAlreadyPrinted) {
    ctx.clearProgressForStdout();
    const rendered =
      !ctx.plain && isRichTty(ctx.stdout)
        ? renderMarkdownAnsi(prepareMarkdownForTerminal(summary), {
            color: supportsColor(ctx.stdout, ctx.envForRun),
            hyperlinks: true,
            width: markdownRenderWidth(ctx.stdout, ctx.env),
            wrap: true,
          })
        : summary;

    if (!ctx.plain && isRichTty(ctx.stdout)) {
      ctx.stdout.write(`\n${rendered.replace(/^\n+/, '')}`);
    } else {
      if (isRichTty(ctx.stdout)) {
        ctx.stdout.write('\n');
      }
      ctx.stdout.write(rendered.replace(/^\n+/, ''));
    }
    if (!rendered.endsWith('\n')) {
      ctx.stdout.write('\n');
    }
    ctx.restoreProgressAfterStdout?.();
  }

  ctx.writeViaFooter([...assetFooterParts, `model ${usedAttempt.userModelId}`]);

  const report = ctx.shouldComputeReport ? await ctx.buildReport() : null;
  if (ctx.metricsEnabled && report) {
    writeFinishLine({
      color: ctx.verboseColor,
      costUsd: null,
      detailed: ctx.metricsDetailed,
      elapsedLabel: summaryFromCache ? 'Cached' : null,
      elapsedMs: Date.now() - ctx.runStartedAtMs,
      env: ctx.envForRun,
      extraParts: null,
      model: usedAttempt.userModelId,
      report,
      stderr: ctx.stderr,
    });
  }
}
