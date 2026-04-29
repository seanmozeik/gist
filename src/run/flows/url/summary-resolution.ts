import { countTokens } from 'gpt-tokenizer';

import {
  buildLanguageKey,
  buildLengthKey,
  buildPromptContentHash,
  buildPromptHash,
  buildSummaryCacheKey,
} from '../../../cache.js';
import type { ExtractedLinkContent } from '../../../content/index.js';
import { isTwitterStatusUrl, isYouTubeUrl } from '../../../content/url.js';
import { resolveGitHubModelsApiKey } from '../../../llm/github-models.js';
import type { Prompt } from '../../../llm/prompt.js';
import { buildAutoModelAttempts } from '../../../model-auto.js';
import { SUMMARY_SYSTEM_PROMPT } from '../../../prompts/index.js';
import {
  readLastSuccessfulCliProvider,
  writeLastSuccessfulCliProvider,
} from '../../cli-fallback-state.js';
import { parseCliUserModelId } from '../../env.js';
import { writeVerbose } from '../../logging.js';
import { runModelAttempts } from '../../model-attempts.js';
import { buildOpenRouterNoAllowedProvidersMessage } from '../../openrouter.js';
import type { ModelAttempt } from '../../types.js';
import type { SlidesTerminalOutput } from './slides-output.js';
import { normalizeSummarySlideHeadings } from './slides-text.js';
import { buildModelMetaFromAttempt } from './summary-finish.js';
import { shouldBypassShortContentSummary } from './summary-prompt.js';
import {
  resolveSummaryTimestampUpperBound,
  sanitizeSummaryKeyMoments,
  shouldSanitizeSummaryKeyMoments,
} from './summary-timestamps.js';
import type { UrlFlowContext } from './types.js';

type SlidesResult = Awaited<
  ReturnType<typeof import('../../../slides/index.js').extractSlidesForSource>
>;

interface SummaryResolutionUseExtracted {
  kind: 'use-extracted';
  footerLabel: string;
  verboseMessage: string | null;
}

interface SummaryResolutionSummary {
  kind: 'summary';
  normalizedSummary: string;
  summaryAlreadyPrinted: boolean;
  summaryFromCache: boolean;
  usedAttempt: ModelAttempt;
  modelMeta: ReturnType<typeof buildModelMetaFromAttempt>;
  maxOutputTokensForCall: number | null;
}

export type UrlSummaryResolution = SummaryResolutionUseExtracted | SummaryResolutionSummary;

export async function resolveUrlSummaryExecution({
  ctx,
  url,
  extracted,
  prompt,
  onModelChosen,
  slides,
  slidesOutput,
}: {
  ctx: UrlFlowContext;
  url: string;
  extracted: ExtractedLinkContent;
  prompt: string;
  onModelChosen?: ((modelId: string) => void) | null;
  slides?: SlidesResult | null;
  slidesOutput?: SlidesTerminalOutput | null;
}): Promise<UrlSummaryResolution> {
  const { io, flags, model, cache: cacheState } = ctx;
  const lastSuccessfulCliProvider = model.isFallbackModel
    ? await readLastSuccessfulCliProvider(io.envForRun)
    : null;

  const promptPayload: Prompt = { system: SUMMARY_SYSTEM_PROMPT, userText: prompt };
  const promptTokens = countTokens(promptPayload.userText);
  const kindForAuto =
    extracted.siteName === 'YouTube' ? ('youtube' as const) : ('website' as const);
  const hasSlides = Boolean(slides && slides.slides.length > 0);
  const sanitizeKeyMoments = shouldSanitizeSummaryKeyMoments({ extracted, hasSlides });
  const timestampUpperBound = sanitizeKeyMoments
    ? resolveSummaryTimestampUpperBound(extracted)
    : null;

  const attempts: ModelAttempt[] = await (async () => {
    if (model.isFallbackModel) {
      const catalog = await model.getLiteLlmCatalog();
      const list = buildAutoModelAttempts({
        allowAutoCliFallback: model.allowAutoCliFallback,
        catalog,
        cliAvailability: model.cliAvailability,
        config: model.configForModelSelection,
        desiredOutputTokens: model.desiredOutputTokens,
        env: model.envForAuto,
        isImplicitAutoSelection: model.isImplicitAutoSelection,
        kind: kindForAuto,
        lastSuccessfulCliProvider,
        openrouterProvidersFromEnv: null,
        promptTokens,
        requiresVideoUnderstanding: false,
      });
      if (flags.verbose) {
        for (const attempt of list.slice(0, 8)) {
          writeVerbose(
            io.stderr,
            flags.verbose,
            `auto candidate ${attempt.debug}`,
            flags.verboseColor,
            io.envForRun,
          );
        }
      }
      return list.map((attempt) => {
        if (attempt.transport !== 'cli') {
          return model.summaryEngine.applyOpenAiGatewayOverrides(attempt);
        }
        const parsed = parseCliUserModelId(attempt.userModelId);
        return { ...attempt, cliModel: parsed.model, cliProvider: parsed.provider };
      });
    }
    /* V8 ignore next */
    if (!model.fixedModelSpec) {
      throw new Error('Internal error: missing fixed model spec');
    }
    if (model.fixedModelSpec.transport === 'cli') {
      return [
        {
          cliModel: model.fixedModelSpec.cliModel,
          cliProvider: model.fixedModelSpec.cliProvider,
          forceOpenRouter: false,
          llmModelId: null,
          openrouterProviders: null,
          requiredEnv: model.fixedModelSpec.requiredEnv,
          transport: 'cli',
          userModelId: model.fixedModelSpec.userModelId,
        },
      ];
    }
    const openaiOverrides =
      model.fixedModelSpec.requiredEnv === 'Z_AI_API_KEY'
        ? {
            forceChatCompletions: true,
            openaiApiKeyOverride: model.apiStatus.zaiApiKey,
            openaiBaseUrlOverride: model.apiStatus.zaiBaseUrl,
          }
        : model.fixedModelSpec.requiredEnv === 'NVIDIA_API_KEY'
          ? {
              forceChatCompletions: true,
              openaiApiKeyOverride: model.apiStatus.nvidiaApiKey,
              openaiBaseUrlOverride: model.apiStatus.nvidiaBaseUrl,
            }
          : model.fixedModelSpec.requiredEnv === 'GITHUB_TOKEN'
            ? {
                forceChatCompletions: true,
                openaiApiKeyOverride: resolveGitHubModelsApiKey(io.envForRun),
                openaiBaseUrlOverride: model.fixedModelSpec.openaiBaseUrlOverride ?? null,
              }
            : {};
    return [
      {
        forceOpenRouter: model.fixedModelSpec.forceOpenRouter,
        llmModelId: model.fixedModelSpec.llmModelId,
        openrouterProviders: model.fixedModelSpec.openrouterProviders,
        requiredEnv: model.fixedModelSpec.requiredEnv,
        transport: model.fixedModelSpec.transport === 'openrouter' ? 'openrouter' : 'native',
        userModelId: model.fixedModelSpec.userModelId,
        ...(model.fixedModelSpec.requestOptions
          ? { requestOptions: model.fixedModelSpec.requestOptions }
          : {}),
        ...openaiOverrides,
      },
    ];
  })();

  const cacheStore =
    cacheState.mode === 'default' && !flags.summaryCacheBypass ? cacheState.store : null;
  const contentHash = cacheStore
    ? buildPromptContentHash({ fallbackContent: extracted.content, prompt })
    : null;
  const promptHash = cacheStore ? buildPromptHash(prompt) : null;
  const lengthKey = buildLengthKey(flags.lengthArg);
  const languageKey = buildLanguageKey(flags.outputLanguage);
  const autoSelectionCacheModel = model.isFallbackModel
    ? `selection:${model.requestedModelInput.toLowerCase()}`
    : null;

  let summaryResult: Awaited<ReturnType<typeof model.summaryEngine.runSummaryAttempt>> | null =
    null;
  let usedAttempt: ModelAttempt | null = null;
  let summaryFromCache = false;
  let cacheChecked = false;

  const isTweet = extracted.siteName?.toLowerCase() === 'x' || isTwitterStatusUrl(extracted.url);
  const isYouTube = extracted.siteName === 'YouTube' || isYouTubeUrl(url);
  const hasMedia =
    Boolean(extracted.video) ||
    (extracted.transcriptSource != null && extracted.transcriptSource !== 'unavailable') ||
    (typeof extracted.mediaDurationSeconds === 'number' && extracted.mediaDurationSeconds > 0) ||
    
    extracted.isVideoOnly;
  const autoBypass = ctx.model.isFallbackModel && !ctx.model.isNamedModelSelection;
  const canBypassShortContent =
    (autoBypass || isTweet) &&
    !flags.slides &&
    !hasMedia &&
    flags.streamMode !== 'on' &&
    !isYouTube &&
    shouldBypassShortContentSummary({
      countTokens,
      extracted,
      forceSummary: flags.forceSummary,
      json: flags.json,
      lengthArg: flags.lengthArg,
      maxOutputTokensArg: flags.maxOutputTokensArg,
    });

  if (canBypassShortContent) {
    return {
      footerLabel: 'short content',
      kind: 'use-extracted',
      verboseMessage: 'short content: skipping summary',
    };
  }

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
      const cached = cacheStore.getJson<{ summary?: unknown; model?: unknown }>('summary', key);
      const cachedSummary =
        cached && typeof cached.summary === 'string' ? cached.summary.trim() : null;
      const cachedModelId = cached && typeof cached.model === 'string' ? cached.model.trim() : null;
      if (cachedSummary) {
        const cachedAttempt = cachedModelId
          ? (attempts.find((attempt) => attempt.userModelId === cachedModelId) ?? null)
          : null;
        const fallbackAttempt =
          attempts.find((attempt) => model.summaryEngine.envHasKeyFor(attempt.requiredEnv)) ??
          attempts[0] ??
          null;
        const matchedAttempt =
          cachedAttempt && model.summaryEngine.envHasKeyFor(cachedAttempt.requiredEnv)
            ? cachedAttempt
            : fallbackAttempt;
        if (matchedAttempt) {
          writeVerbose(
            io.stderr,
            flags.verbose,
            'cache hit summary (auto selection)',
            flags.verboseColor,
            io.envForRun,
          );
          onModelChosen?.(cachedModelId ?? matchedAttempt.userModelId);
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
        if (!model.summaryEngine.envHasKeyFor(attempt.requiredEnv)) {
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
        writeVerbose(
          io.stderr,
          flags.verbose,
          'cache hit summary',
          flags.verboseColor,
          io.envForRun,
        );
        onModelChosen?.(attempt.userModelId);
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
    writeVerbose(io.stderr, flags.verbose, 'cache miss summary', flags.verboseColor, io.envForRun);
  }
  ctx.hooks.onSummaryCached?.(summaryFromCache);

  let lastError: unknown = null;
  let missingRequiredEnvs = new Set<ModelAttempt['requiredEnv']>();
  let sawOpenRouterNoAllowedProviders = false;

  if (!summaryResult || !usedAttempt) {
    const attemptOutcome = await runModelAttempts({
      attempts,
      envHasKeyFor: model.summaryEngine.envHasKeyFor,
      formatMissingModelError: model.summaryEngine.formatMissingModelError,
      isFallbackModel: model.isFallbackModel,
      isNamedModelSelection: model.isNamedModelSelection,
      onAutoFailure: (attempt, error) => {
        writeVerbose(
          io.stderr,
          flags.verbose,
          `auto failed ${attempt.userModelId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
          flags.verboseColor,
          io.envForRun,
        );
      },
      onAutoSkip: (attempt) => {
        writeVerbose(
          io.stderr,
          flags.verbose,
          `auto skip ${attempt.userModelId}: missing ${attempt.requiredEnv}`,
          flags.verboseColor,
          io.envForRun,
        );
      },
      onFixedModelError: (_attempt, error) => {
        throw error;
      },
      runAttempt: (attempt) =>
        model.summaryEngine.runSummaryAttempt({
          allowStreaming: flags.streamingEnabled && !sanitizeKeyMoments,
          attempt,
          onModelChosen: onModelChosen ?? null,
          prompt: promptPayload,
          streamHandler: slidesOutput?.streamHandler ?? null,
        }),
    });
    summaryResult = attemptOutcome.result;
    ({ usedAttempt } = attemptOutcome);
    ({ lastError } = attemptOutcome);
    ({ missingRequiredEnvs } = attemptOutcome);
    ({ sawOpenRouterNoAllowedProviders } = attemptOutcome);
  }

  if (!summaryResult || !usedAttempt) {
    const withFreeTip = (message: string) => {
      if (!model.isNamedModelSelection || !model.wantsFreeNamedModel) {
        return message;
      }
      return (
        `${message}\n` +
        `Tip: run "summarize refresh-free" to refresh the free model candidates (writes ~/.summarize/config.json).`
      );
    };

    if (model.isNamedModelSelection) {
      if (lastError === null && missingRequiredEnvs.size > 0) {
        throw new Error(
          withFreeTip(
            `Missing ${[...missingRequiredEnvs].toSorted().join(', ')} for --model ${model.requestedModelInput}.`,
          ),
        );
      }
      if (lastError instanceof Error) {
        if (sawOpenRouterNoAllowedProviders) {
          const message = await buildOpenRouterNoAllowedProvidersMessage({
            attempts,
            fetchImpl: io.fetch,
            timeoutMs: flags.timeoutMs,
          });
          throw new Error(withFreeTip(message), { cause: lastError });
        }
        throw new Error(withFreeTip(lastError.message), { cause: lastError });
      }
      throw new Error(withFreeTip(`No model available for --model ${model.requestedModelInput}`));
    }
    return {
      footerLabel: 'no model',
      kind: 'use-extracted',
      verboseMessage:
        lastError instanceof Error ? `auto failed all models: ${lastError.message}` : null,
    };
  }

  const { summary, summaryAlreadyPrinted, modelMeta, maxOutputTokensForCall } = summaryResult;
  const normalizedSummaryBase =
    slides && slides.slides.length > 0 ? normalizeSummarySlideHeadings(summary) : summary;
  const normalizedSummary = sanitizeSummaryKeyMoments({
    markdown: normalizedSummaryBase,
    maxSeconds: timestampUpperBound,
  });

  if (!summaryFromCache && cacheStore && contentHash && promptHash) {
    const perModelKey = buildSummaryCacheKey({
      contentHash,
      languageKey,
      lengthKey,
      model: usedAttempt.userModelId,
      promptHash,
    });
    cacheStore.setText('summary', perModelKey, normalizedSummary, cacheState.ttlMs);
    writeVerbose(io.stderr, flags.verbose, 'cache write summary', flags.verboseColor, io.envForRun);
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
        { model: usedAttempt.userModelId, summary: normalizedSummary },
        cacheState.ttlMs,
      );
      writeVerbose(
        io.stderr,
        flags.verbose,
        'cache write summary (auto selection)',
        flags.verboseColor,
        io.envForRun,
      );
    }
  }
  if (
    !summaryFromCache &&
    model.isFallbackModel &&
    usedAttempt.transport === 'cli' &&
    usedAttempt.cliProvider
  ) {
    await writeLastSuccessfulCliProvider({ env: io.envForRun, provider: usedAttempt.cliProvider });
  }

  return {
    kind: 'summary',
    maxOutputTokensForCall,
    modelMeta,
    normalizedSummary,
    summaryAlreadyPrinted,
    summaryFromCache,
    usedAttempt,
  };
}
