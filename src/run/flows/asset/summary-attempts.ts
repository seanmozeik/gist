import path from 'node:path';

import type { CliProvider } from '../../../config.js';
import { buildAutoModelAttempts } from '../../../model-auto.js';
import { buildPathSummaryPrompt } from '../../../prompts/index.js';
import { ensureCliAttachmentPath } from '../../attachments.js';
import { parseCliUserModelId } from '../../env.js';
import type { ModelAttempt } from '../../types.js';
import type { AssetSummaryContext, SummarizeAssetArgs } from './summary.js';

export async function buildAssetModelAttempts({
  ctx,
  kind,
  promptTokensForAuto,
  requiresVideoUnderstanding,
  lastSuccessfulCliProvider,
}: {
  ctx: AssetSummaryContext;
  kind: 'video' | 'image' | 'text' | 'file';
  promptTokensForAuto: number | null;
  requiresVideoUnderstanding: boolean;
  lastSuccessfulCliProvider: CliProvider | null;
}): Promise<ModelAttempt[]> {
  if (ctx.isFallbackModel) {
    const all = buildAutoModelAttempts({
      allowAutoCliFallback: ctx.allowAutoCliFallback,
      cliAvailability: ctx.cliAvailability,
      config: ctx.configForModelSelection,
      desiredOutputTokens: ctx.desiredOutputTokens,
      env: ctx.envForAuto,
      isImplicitAutoSelection: ctx.isImplicitAutoSelection,
      kind,
      lastSuccessfulCliProvider,
      openrouterProvidersFromEnv: null,
      promptTokens: promptTokensForAuto,
      requiresVideoUnderstanding,
    });
    return all.map((attempt) => {
      if (attempt.transport !== 'cli') {
        return ctx.summaryEngine.applyOpenAiGatewayOverrides(attempt);
      }
      const parsed = parseCliUserModelId(attempt.userModelId);
      return Object.assign(attempt, { cliModel: parsed.model, cliProvider: parsed.provider });
    });
  }

  /* V8 ignore next */
  if (!ctx.fixedModelSpec) {
    throw new Error('Internal error: missing fixed model spec');
  }
  if (ctx.fixedModelSpec.transport === 'cli') {
    return [
      {
        cliModel: ctx.fixedModelSpec.cliModel,
        cliProvider: ctx.fixedModelSpec.cliProvider,
        forceOpenRouter: false,
        llmModelId: null,
        openrouterProviders: null,
        requiredEnv: ctx.fixedModelSpec.requiredEnv,
        transport: 'cli',
        userModelId: ctx.fixedModelSpec.userModelId,
      },
    ];
  }
  return [
    {
      forceOpenRouter: ctx.fixedModelSpec.forceOpenRouter,
      llmModelId: ctx.fixedModelSpec.llmModelId,
      openrouterProviders: ctx.fixedModelSpec.openrouterProviders,
      requiredEnv: ctx.fixedModelSpec.requiredEnv,
      transport: ctx.fixedModelSpec.transport === 'openrouter' ? 'openrouter' : 'native',
      userModelId: ctx.fixedModelSpec.userModelId,
      ...(ctx.fixedModelSpec.requestOptions
        ? { requestOptions: ctx.fixedModelSpec.requestOptions }
        : {}),
    },
  ];
}

export async function buildAssetCliContext({
  ctx,
  args,
  attempts,
  attachmentsCount,
  summaryLengthTarget,
}: {
  ctx: AssetSummaryContext;
  args: SummarizeAssetArgs;
  attempts: ModelAttempt[];
  attachmentsCount: number;
  summaryLengthTarget:
    | import('../../../shared/contracts.js').SummaryLength
    | { maxCharacters: number };
}) {
  if (!attempts.some((attempt) => attempt.transport === 'cli')) {
    return null;
  }
  if (attachmentsCount === 0) {
    return null;
  }
  const needsPathPrompt = args.attachment.kind === 'image' || args.attachment.kind === 'file';
  if (!needsPathPrompt) {
    return null;
  }

  const filePath = await ensureCliAttachmentPath({
    attachment: args.attachment,
    sourceKind: args.sourceKind,
    sourceLabel: args.sourceLabel,
  });
  const dir = path.dirname(filePath);
  const extraArgsByProvider: Partial<Record<CliProvider, string[]>> = {
    codex: args.attachment.kind === 'image' ? ['-i', filePath] : undefined,
    gemini: ['--include-directories', dir],
  };

  return {
    allowTools: true,
    cwd: dir,
    extraArgsByProvider,
    promptOverride: buildPathSummaryPrompt({
      filePath,
      filename: args.attachment.filename,
      kindLabel: args.attachment.kind === 'image' ? 'image' : 'file',
      languageInstruction: ctx.languageInstruction ?? null,
      lengthInstruction: ctx.lengthInstruction ?? null,
      mediaType: args.attachment.mediaType,
      outputLanguage: ctx.outputLanguage,
      promptOverride: ctx.promptOverride ?? null,
      summaryLength: summaryLengthTarget,
    }),
  };
}
