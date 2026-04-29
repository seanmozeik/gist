import { createHtmlToMarkdownConverter } from '../../../llm/html-to-markdown.js';
import { mergeModelRequestOptions } from '../../../llm/model-options.js';
import {
  type ConvertTranscriptToMarkdown,
  createTranscriptToMarkdownConverter,
} from '../../../llm/transcript-to-markdown.js';
import { convertToMarkdownWithMarkitdown } from '../../../markitdown.js';
import { hasUvxCli } from '../../env.js';
import { createRetryLogger } from '../../logging.js';
import type { ModelAttempt } from '../../types.js';
import type { UrlFlowContext } from './types.js';

export interface MarkdownModel {
  llmModelId: string;
  forceOpenRouter: boolean;
  openaiApiKeyOverride?: string | null;
  openaiBaseUrlOverride?: string | null;
  openrouterApiKey?: string | null;
  forceChatCompletions?: boolean;
  requestOptions?: ModelAttempt['requestOptions'];
  requiredEnv?: 'OPENROUTER_API_KEY' | null;
}

export interface MarkdownConverters {
  markdownRequested: boolean;
  transcriptMarkdownRequested: boolean;
  effectiveMarkdownMode: 'off' | 'auto' | 'llm' | 'readability';
  markdownProvider: 'none' | 'openrouter' | 'local';
  markdownModel: MarkdownModel | null;
  convertHtmlToMarkdown:
    | ((args: {
        url: string;
        html: string;
        title: string | null;
        siteName: string | null;
        timeoutMs: number;
      }) => Promise<string>)
    | null;
  convertTranscriptToMarkdown: ConvertTranscriptToMarkdown | null;
}

export function createMarkdownConverters(
  ctx: UrlFlowContext,
  options: { isYoutubeUrl: boolean },
): MarkdownConverters {
  // HTML markdown conversion (for non-YouTube URLs)
  const wantsHtmlMarkdown = ctx.flags.format === 'markdown' && !options.isYoutubeUrl;
  if (wantsHtmlMarkdown && ctx.flags.markdownMode === 'off') {
    throw new Error('--format md conflicts with --markdown-mode off (use --format text)');
  }

  // Transcript markdown conversion (for YouTube URLs, only when --markdown-mode llm is explicit)
  const wantsTranscriptMarkdown =
    ctx.flags.format === 'markdown' &&
    options.isYoutubeUrl &&
    ctx.flags.markdownMode === 'llm' &&
    !ctx.flags.transcriptTimestamps;

  const markdownRequested = wantsHtmlMarkdown;
  const transcriptMarkdownRequested = wantsTranscriptMarkdown;
  const effectiveMarkdownMode =
    markdownRequested || transcriptMarkdownRequested ? ctx.flags.markdownMode : 'off';

  const markdownModel: MarkdownModel | null = (() => {
    if (!markdownRequested && !transcriptMarkdownRequested) {
      return null;
    }

    // Prefer local sidecar if available
    if (ctx.model.apiStatus.localBaseUrl) {
      const modelId = ctx.model.fixedModelSpec?.llmModelId ?? 'local/default';
      return {
        forceChatCompletions: ctx.model.openaiUseChatCompletions,
        forceOpenRouter: false,
        llmModelId: modelId,
        openaiBaseUrlOverride: ctx.model.apiStatus.localBaseUrl,
        requiredEnv: 'OPENROUTER_API_KEY',
      };
    }

    // Fall back to OpenRouter
    if (ctx.model.apiStatus.openrouterApiKey) {
      const modelId =
        ctx.model.fixedModelSpec?.llmModelId ?? 'openrouter/meta/llama-3.1-8b-instruct';
      return {
        forceChatCompletions: ctx.model.openaiUseChatCompletions,
        forceOpenRouter: true,
        llmModelId: modelId,
        openrouterApiKey: ctx.model.apiStatus.openrouterApiKey,
        requiredEnv: 'OPENROUTER_API_KEY',
      };
    }

    return null;
  })();

  const markdownProvider = (() => {
    if (!markdownModel) {
      return 'none' as const;
    }
    if (markdownModel.forceOpenRouter) return 'openrouter' as const;
    if (ctx.model.apiStatus.localBaseUrl) return 'local' as const;
    return 'openrouter' as const;
  })();

  const hasKeyForMarkdownModel = (() => {
    if (!markdownModel) {
      return false;
    }
    if (markdownModel.forceOpenRouter) {
      return Boolean(ctx.model.apiStatus.openrouterApiKey);
    }
    if (markdownModel.openaiBaseUrlOverride) {
      return true;
    }
    return false;
  })();

  if (
    (markdownRequested || transcriptMarkdownRequested) &&
    effectiveMarkdownMode === 'llm' &&
    !hasKeyForMarkdownModel
  ) {
    const required = (() => {
      if (markdownModel?.forceOpenRouter) {
        return 'OPENROUTER_API_KEY';
      }
      if (markdownModel?.requiredEnv === 'OPENROUTER_API_KEY') {
        return 'OPENROUTER_API_KEY';
      }
      return 'SUMMARIZE_LOCAL_BASE_URL (local sidecar) or OPENROUTER_API_KEY';
    })();
    throw new Error(`--markdown-mode llm requires ${required}`);
  }

  const llmHtmlToMarkdown =
    markdownRequested &&
    markdownModel !== null &&
    (effectiveMarkdownMode === 'llm' || markdownProvider !== 'none')
      ? createHtmlToMarkdownConverter({
          fetchImpl: ctx.io.fetch,
          forceChatCompletions: markdownModel.forceChatCompletions ?? false,
          forceOpenRouter: markdownModel.forceOpenRouter,
          modelId: markdownModel.llmModelId,
          onRetry: createRetryLogger({
            color: ctx.flags.verboseColor,
            env: ctx.io.envForRun,
            modelId: markdownModel.llmModelId,
            stderr: ctx.io.stderr,
            verbose: ctx.flags.verbose,
          }),
          onUsage: ({ model: usedModel, provider, usage }) => {
            ctx.model.llmCalls.push({
              model: usedModel,
              provider,
              promptTokens: 0,
              completionTokens: 0,
              costUsd: null,
            });
          },
          openaiBaseUrlOverride: markdownModel.openaiBaseUrlOverride ?? null,
          openrouterApiKey: markdownModel.forceOpenRouter
            ? ctx.model.apiStatus.openrouterApiKey
            : null,
          requestOptions: mergeModelRequestOptions(
            ctx.model.openaiRequestOptions,
            markdownModel.requestOptions,
            ctx.model.openaiRequestOptionsOverride,
          ),
          retries: ctx.flags.retries,
        })
      : null;

  const markitdownHtmlToMarkdown =
    markdownRequested && ctx.flags.preprocessMode !== 'off' && hasUvxCli(ctx.io.env)
      ? async (args: {
          url: string;
          html: string;
          title: string | null;
          siteName: string | null;
          timeoutMs: number;
        }) => {
          undefined;
          undefined;
          undefined;
          return convertToMarkdownWithMarkitdown({
            bytes: new TextEncoder().encode(args.html),
            env: ctx.io.env,
            execFileImpl: ctx.io.execFileImpl,
            filenameHint: 'page.html',
            mediaTypeHint: 'text/html',
            timeoutMs: args.timeoutMs,
            uvxCommand: ctx.io.envForRun.UVX_PATH,
          });
        }
      : null;

  const convertHtmlToMarkdown = markdownRequested
    ? async (args: {
        url: string;
        html: string;
        title: string | null;
        siteName: string | null;
        timeoutMs: number;
      }) => {
        if (effectiveMarkdownMode === 'llm') {
          if (!llmHtmlToMarkdown) {
            throw new Error('No HTML→Markdown converter configured');
          }
          return llmHtmlToMarkdown(args);
        }

        if (ctx.flags.extractMode) {
          if (markitdownHtmlToMarkdown) {
            return markitdownHtmlToMarkdown(args);
          }
          throw new Error(
            'No HTML→Markdown converter configured (install uvx/markitdown or use --markdown-mode llm)',
          );
        }

        if (llmHtmlToMarkdown) {
          try {
            return await llmHtmlToMarkdown(args);
          } catch (error) {
            if (!markitdownHtmlToMarkdown) {
              throw error;
            }
            return markitdownHtmlToMarkdown(args);
          }
        }

        if (markitdownHtmlToMarkdown) {
          return markitdownHtmlToMarkdown(args);
        }

        throw new Error('No HTML→Markdown converter configured');
      }
    : null;

  // Transcript→Markdown converter (only for YouTube with --markdown-mode llm)
  const convertTranscriptToMarkdown: ConvertTranscriptToMarkdown | null =
    transcriptMarkdownRequested && markdownModel !== null
      ? createTranscriptToMarkdownConverter({
          fetchImpl: ctx.io.fetch,
          forceChatCompletions: markdownModel.forceChatCompletions ?? false,
          forceOpenRouter: markdownModel.forceOpenRouter,
          modelId: markdownModel.llmModelId,
          onRetry: createRetryLogger({
            color: ctx.flags.verboseColor,
            env: ctx.io.envForRun,
            modelId: markdownModel.llmModelId,
            stderr: ctx.io.stderr,
            verbose: ctx.flags.verbose,
          }),
          onUsage: ({ model: usedModel, provider, usage }) => {
            ctx.model.llmCalls.push({
              model: usedModel,
              provider,
              promptTokens: 0,
              completionTokens: 0,
              costUsd: null,
            });
          },
          openaiBaseUrlOverride: markdownModel.openaiBaseUrlOverride ?? null,
          openrouterApiKey: markdownModel.forceOpenRouter
            ? ctx.model.apiStatus.openrouterApiKey
            : null,
          requestOptions: mergeModelRequestOptions(
            ctx.model.openaiRequestOptions,
            markdownModel.requestOptions,
            ctx.model.openaiRequestOptionsOverride,
          ),
          retries: ctx.flags.retries,
        })
      : null;

  return {
    convertHtmlToMarkdown,
    convertTranscriptToMarkdown,
    effectiveMarkdownMode,
    markdownModel,
    markdownProvider,
    markdownRequested,
    transcriptMarkdownRequested,
  };
}
