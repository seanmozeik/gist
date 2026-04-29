import { resolveGitHubModelsApiKey } from '../../../llm/github-models.js';
import { createHtmlToMarkdownConverter } from '../../../llm/html-to-markdown.js';
import { parseGatewayStyleModelId } from '../../../llm/model-id.js';
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
  forceChatCompletions?: boolean;
  requestOptions?: ModelAttempt['requestOptions'];
  requiredEnv?: ModelAttempt['requiredEnv'];
}

export interface MarkdownConverters {
  markdownRequested: boolean;
  transcriptMarkdownRequested: boolean;
  effectiveMarkdownMode: 'off' | 'auto' | 'llm' | 'readability';
  markdownProvider:
    | 'none'
    | 'xai'
    | 'openai'
    | 'google'
    | 'anthropic'
    | 'zai'
    | 'nvidia'
    | 'github-copilot';
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
    if (!markdownRequested && !transcriptMarkdownRequested) {return null;}

    // Prefer the explicitly chosen model when it is a native provider (keeps behavior stable).
    if (
      ctx.model.requestedModel.kind === 'fixed' &&
      ctx.model.requestedModel.transport === 'native'
    ) {
      if (ctx.model.fixedModelSpec?.requiredEnv === 'Z_AI_API_KEY') {
        return {
          forceChatCompletions: true,
          forceOpenRouter: false,
          llmModelId: ctx.model.requestedModel.llmModelId,
          openaiApiKeyOverride: ctx.model.apiStatus.zaiApiKey,
          openaiBaseUrlOverride: ctx.model.apiStatus.zaiBaseUrl,
          requestOptions: ctx.model.requestedModel.requestOptions,
          requiredEnv: ctx.model.fixedModelSpec.requiredEnv,
        };
      }
      if (ctx.model.fixedModelSpec?.requiredEnv === 'NVIDIA_API_KEY') {
        return {
          forceChatCompletions: true,
          forceOpenRouter: false,
          llmModelId: ctx.model.requestedModel.llmModelId,
          openaiApiKeyOverride: ctx.model.apiStatus.nvidiaApiKey,
          openaiBaseUrlOverride: ctx.model.apiStatus.nvidiaBaseUrl,
          requestOptions: ctx.model.requestedModel.requestOptions,
          requiredEnv: ctx.model.fixedModelSpec.requiredEnv,
        };
      }
      if (ctx.model.fixedModelSpec?.requiredEnv === 'GITHUB_TOKEN') {
        return {
          forceChatCompletions: true,
          forceOpenRouter: false,
          llmModelId: ctx.model.requestedModel.llmModelId,
          openaiApiKeyOverride: resolveGitHubModelsApiKey(ctx.io.envForRun),
          openaiBaseUrlOverride: ctx.model.fixedModelSpec.openaiBaseUrlOverride ?? null,
          requestOptions: ctx.model.requestedModel.requestOptions,
          requiredEnv: ctx.model.fixedModelSpec.requiredEnv,
        };
      }
      return {
        forceChatCompletions: ctx.model.openaiUseChatCompletions,
        forceOpenRouter: false,
        llmModelId: ctx.model.requestedModel.llmModelId,
        requestOptions: ctx.model.requestedModel.requestOptions,
        requiredEnv: ctx.model.fixedModelSpec?.requiredEnv,
      };
    }

    // Otherwise pick a safe, broadly-capable default for HTML→Markdown conversion.
    if (ctx.model.apiStatus.googleConfigured) {
      return {
        forceOpenRouter: false,
        llmModelId: 'google/gemini-3-flash',
        requiredEnv: 'GEMINI_API_KEY',
      };
    }
    if (ctx.model.apiStatus.apiKey) {
      return {
        forceChatCompletions: ctx.model.openaiUseChatCompletions,
        forceOpenRouter: false,
        llmModelId: 'openai/gpt-5-mini',
        requiredEnv: 'OPENAI_API_KEY',
      };
    }
    if (ctx.model.apiStatus.openrouterConfigured) {
      return {
        forceOpenRouter: true,
        llmModelId: 'openai/openai/gpt-5-mini',
        requiredEnv: 'OPENROUTER_API_KEY',
      };
    }
    if (ctx.model.apiStatus.anthropicConfigured) {
      return {
        forceOpenRouter: false,
        llmModelId: 'anthropic/claude-sonnet-4-5',
        requiredEnv: 'ANTHROPIC_API_KEY',
      };
    }
    if (ctx.model.apiStatus.xaiApiKey) {
      return {
        forceOpenRouter: false,
        llmModelId: 'xai/grok-4-fast-non-reasoning',
        requiredEnv: 'XAI_API_KEY',
      };
    }

    return null;
  })();

  const markdownProvider = (() => {
    if (!markdownModel) {return 'none' as const;}
    const parsed = parseGatewayStyleModelId(markdownModel.llmModelId);
    return parsed.provider;
  })();

  const hasKeyForMarkdownModel = (() => {
    if (!markdownModel) {return false;}
    if (markdownModel.forceOpenRouter) {return ctx.model.apiStatus.openrouterConfigured;}
    if (markdownModel.requiredEnv === 'Z_AI_API_KEY') {return Boolean(ctx.model.apiStatus.zaiApiKey);}
    if (markdownModel.requiredEnv === 'NVIDIA_API_KEY')
      {return Boolean(ctx.model.apiStatus.nvidiaApiKey);}
    if (markdownModel.requiredEnv === 'GITHUB_TOKEN')
      {return Boolean(resolveGitHubModelsApiKey(ctx.io.envForRun));}
    if (markdownModel.openaiApiKeyOverride) {return true;}
    const parsed = parseGatewayStyleModelId(markdownModel.llmModelId);
    return parsed.provider === 'xai'
      ? Boolean(ctx.model.apiStatus.xaiApiKey)
      : parsed.provider === 'google'
        ? ctx.model.apiStatus.googleConfigured
        : parsed.provider === 'anthropic'
          ? ctx.model.apiStatus.anthropicConfigured
          : parsed.provider === 'zai'
            ? Boolean(ctx.model.apiStatus.zaiApiKey)
            : parsed.provider === 'nvidia'
              ? Boolean(ctx.model.apiStatus.nvidiaApiKey)
              : Boolean(ctx.model.apiStatus.apiKey);
  })();

  if (
    (markdownRequested || transcriptMarkdownRequested) &&
    effectiveMarkdownMode === 'llm' &&
    !hasKeyForMarkdownModel
  ) {
    const required = (() => {
      if (markdownModel?.forceOpenRouter) {return 'OPENROUTER_API_KEY';}
      if (markdownModel?.requiredEnv === 'Z_AI_API_KEY') {return 'Z_AI_API_KEY';}
      if (markdownModel?.requiredEnv === 'NVIDIA_API_KEY') {return 'NVIDIA_API_KEY';}
      if (markdownModel?.requiredEnv === 'GITHUB_TOKEN') {return 'GITHUB_TOKEN (or GH_TOKEN)';}
      if (markdownModel) {
        const parsed = parseGatewayStyleModelId(markdownModel.llmModelId);
        return parsed.provider === 'xai'
          ? 'XAI_API_KEY'
          : parsed.provider === 'google'
            ? 'GEMINI_API_KEY (or GOOGLE_GENERATIVE_AI_API_KEY / GOOGLE_API_KEY)'
            : parsed.provider === 'anthropic'
              ? 'ANTHROPIC_API_KEY'
              : parsed.provider === 'zai'
                ? 'Z_AI_API_KEY'
                : parsed.provider === 'nvidia'
                  ? 'NVIDIA_API_KEY'
                  : parsed.provider === 'github-copilot'
                    ? 'GITHUB_TOKEN (or GH_TOKEN)'
                    : 'OPENAI_API_KEY';
      }
      return 'GEMINI_API_KEY (or GOOGLE_GENERATIVE_AI_API_KEY / GOOGLE_API_KEY)';
    })();
    throw new Error(`--markdown-mode llm requires ${required}`);
  }

  const llmHtmlToMarkdown =
    markdownRequested &&
    markdownModel !== null &&
    (effectiveMarkdownMode === 'llm' || markdownProvider !== 'none')
      ? createHtmlToMarkdownConverter({
          anthropicApiKey: ctx.model.apiStatus.anthropicApiKey,
          anthropicBaseUrlOverride: ctx.model.apiStatus.providerBaseUrls.anthropic,
          fetchImpl: ctx.io.fetch,
          forceChatCompletions:
            markdownModel.forceChatCompletions ??
            (ctx.model.openaiUseChatCompletions && markdownProvider === 'openai'),
          forceOpenRouter: markdownModel.forceOpenRouter,
          googleApiKey: ctx.model.apiStatus.googleApiKey,
          googleBaseUrlOverride: ctx.model.apiStatus.providerBaseUrls.google,
          modelId: markdownModel.llmModelId,
          onRetry: createRetryLogger({
            stderr: ctx.io.stderr,
            verbose: ctx.flags.verbose,
            color: ctx.flags.verboseColor,
            modelId: markdownModel.llmModelId,
            env: ctx.io.envForRun,
          }),
          onUsage: ({ model: usedModel, provider, usage }) => {
            ctx.model.llmCalls.push({ provider, model: usedModel, usage, purpose: 'markdown' });
          },
          openaiApiKey: markdownModel.openaiApiKeyOverride ?? ctx.model.apiStatus.apiKey,
          openaiBaseUrlOverride:
            markdownModel.openaiBaseUrlOverride ?? ctx.model.apiStatus.providerBaseUrls.openai,
          openrouterApiKey: ctx.model.apiStatus.openrouterApiKey,
          requestOptions: mergeModelRequestOptions(
            ctx.model.openaiRequestOptions,
            markdownModel.requestOptions,
            ctx.model.openaiRequestOptionsOverride,
          ),
          retries: ctx.flags.retries,
          xaiApiKey: ctx.model.apiStatus.xaiApiKey,
          xaiBaseUrlOverride: ctx.model.apiStatus.providerBaseUrls.xai,
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
          void args.url;
          void args.title;
          void args.siteName;
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
            return  markitdownHtmlToMarkdown(args);
          }
          throw new Error(
            'No HTML→Markdown converter configured (install uvx/markitdown or use --markdown-mode llm)',
          );
        }

        if (llmHtmlToMarkdown) {
          try {
            return await llmHtmlToMarkdown(args);
          } catch (error) {
            if (!markitdownHtmlToMarkdown) {throw error;}
            return  markitdownHtmlToMarkdown(args);
          }
        }

        if (markitdownHtmlToMarkdown) {
          return  markitdownHtmlToMarkdown(args);
        }

        throw new Error('No HTML→Markdown converter configured');
      }
    : null;

  // Transcript→Markdown converter (only for YouTube with --markdown-mode llm)
  const convertTranscriptToMarkdown: ConvertTranscriptToMarkdown | null =
    transcriptMarkdownRequested && markdownModel !== null
      ? createTranscriptToMarkdownConverter({
          anthropicApiKey: ctx.model.apiStatus.anthropicApiKey,
          anthropicBaseUrlOverride: ctx.model.apiStatus.providerBaseUrls.anthropic,
          fetchImpl: ctx.io.fetch,
          forceChatCompletions:
            markdownModel.forceChatCompletions ??
            (ctx.model.openaiUseChatCompletions && markdownProvider === 'openai'),
          forceOpenRouter: markdownModel.forceOpenRouter,
          googleApiKey: ctx.model.apiStatus.googleApiKey,
          googleBaseUrlOverride: ctx.model.apiStatus.providerBaseUrls.google,
          modelId: markdownModel.llmModelId,
          onRetry: createRetryLogger({
            stderr: ctx.io.stderr,
            verbose: ctx.flags.verbose,
            color: ctx.flags.verboseColor,
            modelId: markdownModel.llmModelId,
            env: ctx.io.envForRun,
          }),
          onUsage: ({ model: usedModel, provider, usage }) => {
            ctx.model.llmCalls.push({ provider, model: usedModel, usage, purpose: 'markdown' });
          },
          openaiApiKey: markdownModel.openaiApiKeyOverride ?? ctx.model.apiStatus.apiKey,
          openaiBaseUrlOverride:
            markdownModel.openaiBaseUrlOverride ?? ctx.model.apiStatus.providerBaseUrls.openai,
          openrouterApiKey: ctx.model.apiStatus.openrouterApiKey,
          requestOptions: mergeModelRequestOptions(
            ctx.model.openaiRequestOptions,
            markdownModel.requestOptions,
            ctx.model.openaiRequestOptionsOverride,
          ),
          retries: ctx.flags.retries,
          xaiApiKey: ctx.model.apiStatus.xaiApiKey,
          xaiBaseUrlOverride: ctx.model.apiStatus.providerBaseUrls.xai,
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
