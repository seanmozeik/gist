import { countTokens } from 'gpt-tokenizer';
import { createMarkdownStreamer, render as renderMarkdownAnsi } from 'markdansi';

import type { CliProvider } from '../config.js';
import { isCliDisabled, runCliModel } from '../llm/cli.js';
import { streamTextWithModelId } from '../llm/generate-text.js';
import { resolveGitHubModelsApiKey } from '../llm/github-models.js';
import { parseGatewayStyleModelId } from '../llm/model-id.js';
import { mergeModelRequestOptions } from '../llm/model-options.js';
import type { ModelRequestOptions } from '../llm/model-options.js';
import type { Prompt } from '../llm/prompt.js';
import { formatCompactCount } from '../tty/format.js';
import { createRetryLogger, writeVerbose } from './logging.js';
import { prepareMarkdownForTerminalStreaming } from './markdown.js';
import { createStreamOutputGate, type StreamOutputMode } from './stream-output.js';
import {
  canStream,
  isGoogleStreamingUnsupportedError,
  isStreamingTimeoutError,
  mergeStreamingChunk,
} from './streaming.js';
import { resolveModelIdForLlmCall, summarizeWithModelId } from './summary-llm.js';
import { isRichTty, markdownRenderWidth, supportsColor } from './terminal.js';
import type { ModelAttempt, ModelMeta } from './types.js';

export interface SummaryEngineDeps {
  env: Record<string, string | undefined>;
  envForRun: Record<string, string | undefined>;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  execFileImpl: Parameters<typeof runCliModel>[0]['execFileImpl'];
  timeoutMs: number;
  retries: number;
  streamingEnabled: boolean;
  streamingOutputMode?: StreamOutputMode;
  plain: boolean;
  verbose: boolean;
  verboseColor: boolean;
  openaiUseChatCompletions: boolean;
  openaiRequestOptions?: ModelRequestOptions;
  openaiRequestOptionsOverride?: ModelRequestOptions;
  cliConfigForRun: Parameters<typeof runCliModel>[0]['config'];
  cliAvailability: Partial<Record<CliProvider, boolean>>;
  trackedFetch: typeof fetch;
  resolveMaxOutputTokensForCall: (modelId: string) => Promise<number | null>;
  resolveMaxInputTokensForCall: (modelId: string) => Promise<number | null>;
  llmCalls: Array<{
    provider:
      | 'xai'
      | 'openai'
      | 'google'
      | 'anthropic'
      | 'zai'
      | 'nvidia'
      | 'github-copilot'
      | 'cli';
    model: string;
    usage: Awaited<ReturnType<typeof summarizeWithModelId>>['usage'] | null;
    costUsd?: number | null;
    purpose: 'summary' | 'markdown';
  }>;
  clearProgressForStdout: () => void;
  restoreProgressAfterStdout?: (() => void) | null;
  apiKeys: {
    xaiApiKey: string | null;
    openaiApiKey: string | null;
    googleApiKey: string | null;
    anthropicApiKey: string | null;
    openrouterApiKey: string | null;
  };
  keyFlags: {
    googleConfigured: boolean;
    anthropicConfigured: boolean;
    openrouterConfigured: boolean;
  };
  zai: { apiKey: string | null; baseUrl: string };
  nvidia: { apiKey: string | null; baseUrl: string };
  providerBaseUrls: {
    openai: string | null;
    anthropic: string | null;
    google: string | null;
    xai: string | null;
  };
}

export interface SummaryStreamHandler {
  onChunk: (args: {
    streamed: string;
    prevStreamed: string;
    appended: string;
  }) => void | Promise<void>;
  onDone?: ((finalText: string) => void | Promise<void>) | null;
}

export function createSummaryEngine(deps: SummaryEngineDeps) {
  const applyOpenAiGatewayOverrides = (attempt: ModelAttempt): ModelAttempt => {
    const modelIdLower = attempt.userModelId.toLowerCase();
    if (modelIdLower.startsWith('zai/')) {
      return {
        ...attempt,
        forceChatCompletions: true,
        openaiApiKeyOverride: deps.zai.apiKey,
        openaiBaseUrlOverride: deps.zai.baseUrl,
      };
    }
    if (modelIdLower.startsWith('nvidia/')) {
      return {
        ...attempt,
        forceChatCompletions: true,
        openaiApiKeyOverride: deps.nvidia.apiKey,
        openaiBaseUrlOverride: deps.nvidia.baseUrl,
      };
    }
    if (modelIdLower.startsWith('github-copilot/')) {
      return {
        ...attempt,
        forceChatCompletions: true,
        openaiApiKeyOverride: resolveGitHubModelsApiKey(deps.envForRun),
        openaiBaseUrlOverride:
          attempt.openaiBaseUrlOverride ?? 'https://models.github.ai/inference',
      };
    }
    return attempt;
  };

  const envHasKeyFor = (requiredEnv: ModelAttempt['requiredEnv']) => {
    if (requiredEnv === 'CLI_CLAUDE') {
      return Boolean(deps.cliAvailability.claude);
    }
    if (requiredEnv === 'CLI_CODEX') {
      return Boolean(deps.cliAvailability.codex);
    }
    if (requiredEnv === 'CLI_GEMINI') {
      return Boolean(deps.cliAvailability.gemini);
    }
    if (requiredEnv === 'CLI_AGENT') {
      return Boolean(deps.cliAvailability.agent);
    }
    if (requiredEnv === 'CLI_OPENCLAW') {
      return Boolean(deps.cliAvailability.openclaw);
    }
    if (requiredEnv === 'CLI_OPENCODE') {
      return Boolean(deps.cliAvailability.opencode);
    }
    if (requiredEnv === 'GEMINI_API_KEY') {
      return deps.keyFlags.googleConfigured;
    }
    if (requiredEnv === 'OPENROUTER_API_KEY') {
      return deps.keyFlags.openrouterConfigured;
    }
    if (requiredEnv === 'OPENAI_API_KEY') {
      return Boolean(deps.apiKeys.openaiApiKey);
    }
    if (requiredEnv === 'GITHUB_TOKEN') {
      return Boolean(resolveGitHubModelsApiKey(deps.envForRun));
    }
    if (requiredEnv === 'NVIDIA_API_KEY') {
      return Boolean(deps.nvidia.apiKey);
    }
    if (requiredEnv === 'Z_AI_API_KEY') {
      return Boolean(deps.zai.apiKey);
    }
    if (requiredEnv === 'XAI_API_KEY') {
      return Boolean(deps.apiKeys.xaiApiKey);
    }
    return Boolean(deps.apiKeys.anthropicApiKey);
  };

  const formatMissingModelError = (attempt: ModelAttempt): string => {
    if (attempt.requiredEnv === 'CLI_CLAUDE') {
      return `Claude CLI not found for model ${attempt.userModelId}. Install Claude CLI or set CLAUDE_PATH.`;
    }
    if (attempt.requiredEnv === 'CLI_CODEX') {
      return `Codex CLI not found for model ${attempt.userModelId}. Install Codex CLI or set CODEX_PATH.`;
    }
    if (attempt.requiredEnv === 'CLI_GEMINI') {
      return `Gemini CLI not found for model ${attempt.userModelId}. Install Gemini CLI or set GEMINI_PATH.`;
    }
    if (attempt.requiredEnv === 'CLI_AGENT') {
      return `Cursor Agent CLI not found for model ${attempt.userModelId}. Install Cursor CLI or set AGENT_PATH.`;
    }
    if (attempt.requiredEnv === 'CLI_OPENCLAW') {
      return `OpenClaw CLI not found for model ${attempt.userModelId}. Install OpenClaw CLI or set OPENCLAW_PATH.`;
    }
    if (attempt.requiredEnv === 'CLI_OPENCODE') {
      return `OpenCode CLI not found for model ${attempt.userModelId}. Install OpenCode CLI or set OPENCODE_PATH.`;
    }
    return `Missing ${attempt.requiredEnv} for model ${attempt.userModelId}. Set the env var or choose a different --model.`;
  };

  const runSummaryAttempt = async ({
    attempt,
    prompt,
    allowStreaming,
    onModelChosen,
    cli,
    streamHandler,
  }: {
    attempt: ModelAttempt;
    prompt: Prompt;
    allowStreaming: boolean;
    onModelChosen?: ((modelId: string) => void) | null;
    cli?: {
      promptOverride?: string;
      allowTools?: boolean;
      cwd?: string;
      extraArgsByProvider?: Partial<Record<CliProvider, string[]>>;
    } | null;
    streamHandler?: SummaryStreamHandler | null;
  }): Promise<{
    summary: string;
    summaryAlreadyPrinted: boolean;
    modelMeta: ModelMeta;
    maxOutputTokensForCall: number | null;
  }> => {
    onModelChosen?.(attempt.userModelId);

    if (attempt.transport === 'cli') {
      const hasAttachments = (prompt.attachments?.length ?? 0) > 0;
      const cliPrompt = hasAttachments ? (cli?.promptOverride ?? null) : prompt.userText;
      if (!cliPrompt) {
        throw new Error('CLI models require a text prompt (no binary attachments).');
      }
      if (!attempt.cliProvider) {
        throw new Error(`Missing CLI provider for model ${attempt.userModelId}.`);
      }
      if (isCliDisabled(attempt.cliProvider, deps.cliConfigForRun)) {
        throw new Error(
          `CLI provider ${attempt.cliProvider} is disabled by cli.enabled. Update your config to enable it.`,
        );
      }
      const result = await runCliModel({
        allowTools: Boolean(cli?.allowTools),
        config: deps.cliConfigForRun ?? null,
        cwd: cli?.cwd,
        env: deps.env,
        execFileImpl: deps.execFileImpl,
        extraArgs: cli?.extraArgsByProvider?.[attempt.cliProvider],
        model: attempt.cliModel ?? null,
        prompt: cliPrompt,
        provider: attempt.cliProvider,
        timeoutMs: deps.timeoutMs,
      });
      const summary = result.text.trim();
      if (!summary) {throw new Error('CLI returned an empty summary');}
      if (result.usage || typeof result.costUsd === 'number') {
        deps.llmCalls.push({
          costUsd: result.costUsd ?? null,
          model: attempt.userModelId,
          provider: 'cli',
          purpose: 'summary',
          usage: result.usage ?? null,
        });
      }
      return {
        maxOutputTokensForCall: null,
        modelMeta: { canonical: attempt.userModelId, provider: 'cli' },
        summary,
        summaryAlreadyPrinted: false,
      };
    }

    if (!attempt.llmModelId) {
      throw new Error(`Missing model id for ${attempt.userModelId}.`);
    }
    const parsedModel = parseGatewayStyleModelId(attempt.llmModelId);
    const apiKeysForLlm = {
      anthropicApiKey: deps.keyFlags.anthropicConfigured ? deps.apiKeys.anthropicApiKey : null,
      googleApiKey: deps.keyFlags.googleConfigured ? deps.apiKeys.googleApiKey : null,
      openaiApiKey: attempt.openaiApiKeyOverride ?? deps.apiKeys.openaiApiKey,
      openrouterApiKey: deps.keyFlags.openrouterConfigured ? deps.apiKeys.openrouterApiKey : null,
      xaiApiKey: deps.apiKeys.xaiApiKey,
    };

    const modelResolution = await resolveModelIdForLlmCall({
      apiKeys: { googleApiKey: apiKeysForLlm.googleApiKey },
      fetchImpl: deps.trackedFetch,
      parsedModel,
      timeoutMs: deps.timeoutMs,
    });
    if (modelResolution.note && deps.verbose) {
      writeVerbose(
        deps.stderr,
        deps.verbose,
        modelResolution.note,
        deps.verboseColor,
        deps.envForRun,
      );
    }
    const parsedModelEffective = parseGatewayStyleModelId(modelResolution.modelId);
    const requestOptions = mergeModelRequestOptions(
      deps.openaiRequestOptions,
      attempt.requestOptions,
      deps.openaiRequestOptionsOverride,
    );
    const hasOpenAiRequestOptions =
      parsedModelEffective.provider === 'openai' && Boolean(requestOptions);
    const streamingEnabledForCall =
      allowStreaming &&
      deps.streamingEnabled &&
      !hasOpenAiRequestOptions &&
      !modelResolution.forceStreamOff &&
      canStream({
        prompt,
        provider: parsedModelEffective.provider,
        transport: attempt.transport === 'openrouter' ? 'openrouter' : 'native',
      });
    const forceChatCompletions =
      Boolean(attempt.forceChatCompletions) ||
      (deps.openaiUseChatCompletions && parsedModelEffective.provider === 'openai');

    const maxOutputTokensForCall = await deps.resolveMaxOutputTokensForCall(
      parsedModelEffective.canonical,
    );
    const maxInputTokensForCall = await deps.resolveMaxInputTokensForCall(
      parsedModelEffective.canonical,
    );
    if (
      typeof maxInputTokensForCall === 'number' &&
      Number.isFinite(maxInputTokensForCall) &&
      maxInputTokensForCall > 0 &&
      (prompt.attachments?.length ?? 0) === 0
    ) {
      const tokenCount = countTokens(prompt.userText);
      if (tokenCount > maxInputTokensForCall) {
        throw new Error(
          `Input token count (${formatCompactCount(tokenCount)}) exceeds model input limit (${formatCompactCount(maxInputTokensForCall)}). Tokenized with GPT tokenizer; prompt included.`,
        );
      }
    }

    if (!streamingEnabledForCall) {
      const result = await summarizeWithModelId({
        anthropicBaseUrlOverride: deps.providerBaseUrls.anthropic,
        apiKeys: apiKeysForLlm,
        fetchImpl: deps.trackedFetch,
        forceChatCompletions,
        forceOpenRouter: attempt.forceOpenRouter,
        googleBaseUrlOverride: deps.providerBaseUrls.google,
        maxOutputTokens: maxOutputTokensForCall ?? undefined,
        modelId: parsedModelEffective.canonical,
        onRetry: createRetryLogger({
          stderr: deps.stderr,
          verbose: deps.verbose,
          color: deps.verboseColor,
          modelId: parsedModelEffective.canonical,
          env: deps.envForRun,
        }),
        openaiBaseUrlOverride: attempt.openaiBaseUrlOverride ?? deps.providerBaseUrls.openai,
        prompt,
        requestOptions,
        retries: deps.retries,
        timeoutMs: deps.timeoutMs,
        xaiBaseUrlOverride: deps.providerBaseUrls.xai,
        zaiBaseUrlOverride: deps.zai.baseUrl,
      });
      deps.llmCalls.push({
        model: result.canonicalModelId,
        provider: result.provider,
        purpose: 'summary',
        usage: result.usage,
      });
      const summary = result.text.trim();
      if (!summary) {throw new Error('LLM returned an empty summary');}
      const displayCanonical = attempt.userModelId.toLowerCase().startsWith('openrouter/')
        ? attempt.userModelId
        : parsedModelEffective.canonical;
      return {
        maxOutputTokensForCall: maxOutputTokensForCall ?? null,
        modelMeta: { canonical: displayCanonical, provider: parsedModelEffective.provider },
        summary,
        summaryAlreadyPrinted: false,
      };
    }

    const shouldRenderMarkdownToAnsi = !deps.plain && isRichTty(deps.stdout);
    const hasStreamHandler = Boolean(streamHandler);
    const shouldStreamSummaryToStdout =
      streamingEnabledForCall && !shouldRenderMarkdownToAnsi && !hasStreamHandler;
    const shouldStreamRenderedMarkdownToStdout =
      streamingEnabledForCall && shouldRenderMarkdownToAnsi && !hasStreamHandler;

    let summaryAlreadyPrinted = false;
    let summary = '';
    let getLastStreamError: (() => unknown) | null = null;

    let streamResult: Awaited<ReturnType<typeof streamTextWithModelId>> | null = null;
    try {
      streamResult = await streamTextWithModelId({
        anthropicBaseUrlOverride: deps.providerBaseUrls.anthropic,
        apiKeys: apiKeysForLlm,
        fetchImpl: deps.trackedFetch,
        forceChatCompletions,
        forceOpenRouter: attempt.forceOpenRouter,
        googleBaseUrlOverride: deps.providerBaseUrls.google,
        maxOutputTokens: maxOutputTokensForCall ?? undefined,
        modelId: parsedModelEffective.canonical,
        openaiBaseUrlOverride: attempt.openaiBaseUrlOverride ?? deps.providerBaseUrls.openai,
        prompt,
        requestOptions,
        temperature: 0,
        timeoutMs: deps.timeoutMs,
        xaiBaseUrlOverride: deps.providerBaseUrls.xai,
      });
    } catch (error) {
      if (isStreamingTimeoutError(error)) {
        writeVerbose(
          deps.stderr,
          deps.verbose,
          `Streaming timed out for ${parsedModelEffective.canonical}; falling back to non-streaming.`,
          deps.verboseColor,
          deps.envForRun,
        );
        const result = await summarizeWithModelId({
          anthropicBaseUrlOverride: deps.providerBaseUrls.anthropic,
          apiKeys: apiKeysForLlm,
          fetchImpl: deps.trackedFetch,
          forceChatCompletions,
          forceOpenRouter: attempt.forceOpenRouter,
          googleBaseUrlOverride: deps.providerBaseUrls.google,
          maxOutputTokens: maxOutputTokensForCall ?? undefined,
          modelId: parsedModelEffective.canonical,
          onRetry: createRetryLogger({
            stderr: deps.stderr,
            verbose: deps.verbose,
            color: deps.verboseColor,
            modelId: parsedModelEffective.canonical,
            env: deps.envForRun,
          }),
          openaiBaseUrlOverride: attempt.openaiBaseUrlOverride ?? deps.providerBaseUrls.openai,
          prompt,
          requestOptions,
          retries: deps.retries,
          timeoutMs: deps.timeoutMs,
          xaiBaseUrlOverride: deps.providerBaseUrls.xai,
          zaiBaseUrlOverride: deps.zai.baseUrl,
        });
        deps.llmCalls.push({
          model: result.canonicalModelId,
          provider: result.provider,
          purpose: 'summary',
          usage: result.usage,
        });
        summary = result.text;
        streamResult = null;
      } else if (
        parsedModelEffective.provider === 'google' &&
        isGoogleStreamingUnsupportedError(error)
      ) {
        writeVerbose(
          deps.stderr,
          deps.verbose,
          `Google model ${parsedModelEffective.canonical} rejected streamGenerateContent; falling back to non-streaming.`,
          deps.verboseColor,
          deps.envForRun,
        );
        const result = await summarizeWithModelId({
          anthropicBaseUrlOverride: deps.providerBaseUrls.anthropic,
          apiKeys: apiKeysForLlm,
          fetchImpl: deps.trackedFetch,
          forceOpenRouter: attempt.forceOpenRouter,
          googleBaseUrlOverride: deps.providerBaseUrls.google,
          maxOutputTokens: maxOutputTokensForCall ?? undefined,
          modelId: parsedModelEffective.canonical,
          onRetry: createRetryLogger({
            stderr: deps.stderr,
            verbose: deps.verbose,
            color: deps.verboseColor,
            modelId: parsedModelEffective.canonical,
            env: deps.envForRun,
          }),
          openaiBaseUrlOverride: attempt.openaiBaseUrlOverride ?? deps.providerBaseUrls.openai,
          prompt,
          retries: deps.retries,
          timeoutMs: deps.timeoutMs,
          xaiBaseUrlOverride: deps.providerBaseUrls.xai,
          zaiBaseUrlOverride: deps.zai.baseUrl,
        });
        deps.llmCalls.push({
          model: result.canonicalModelId,
          provider: result.provider,
          purpose: 'summary',
          usage: result.usage,
        });
        summary = result.text;
        streamResult = null;
      } else {
        throw error;
      }
    }

    if (streamResult) {
      deps.clearProgressForStdout();
      deps.restoreProgressAfterStdout?.();
      getLastStreamError = streamResult.lastError;
      let streamed = '';
      let streamedRaw = '';
      const liveWidth = markdownRenderWidth(deps.stdout, deps.env);
      let wroteLeadingBlankLine = false;

      const streamer = shouldStreamRenderedMarkdownToStdout
        ? createMarkdownStreamer({
            render: (markdown) =>
              renderMarkdownAnsi(prepareMarkdownForTerminalStreaming(markdown), {
                color: supportsColor(deps.stdout, deps.envForRun),
                hyperlinks: true,
                width: liveWidth,
                wrap: true,
              }),
            spacing: 'single',
          })
        : null;

      const outputGate = shouldStreamSummaryToStdout
        ? createStreamOutputGate({
            clearProgressForStdout: deps.clearProgressForStdout,
            outputMode: deps.streamingOutputMode ?? 'line',
            restoreProgressAfterStdout: deps.restoreProgressAfterStdout ?? null,
            richTty: isRichTty(deps.stdout),
            stdout: deps.stdout,
          })
        : null;

      try {
        for await (const delta of streamResult.textStream) {
          const prevStreamed = streamed;
          const merged = mergeStreamingChunk(streamed, delta);
          streamed = merged.next;
          if (streamHandler) {
            await streamHandler.onChunk({
              appended: merged.appended,
              prevStreamed,
              streamed: merged.next,
            });
            continue;
          }
          if (shouldStreamSummaryToStdout && outputGate) {
            outputGate.handleChunk(streamed, prevStreamed);
            continue;
          }

          if (shouldStreamRenderedMarkdownToStdout && streamer) {
            const out = streamer.push(merged.appended);
            if (out) {
              deps.clearProgressForStdout();
              if (!wroteLeadingBlankLine) {
                deps.stdout.write(`\n${out.replace(/^\n+/, '')}`);
                wroteLeadingBlankLine = true;
              } else {
                deps.stdout.write(out);
              }
              deps.restoreProgressAfterStdout?.();
            }
          }
        }

        streamedRaw = streamed;
        const trimmed = streamed.trim();
        streamed = trimmed;
      } finally {
        if (streamHandler) {
          await streamHandler.onDone?.(streamedRaw || streamed);
          summaryAlreadyPrinted = true;
        } else if (shouldStreamRenderedMarkdownToStdout) {
          const out = streamer?.finish();
          if (out) {
            deps.clearProgressForStdout();
            if (!wroteLeadingBlankLine) {
              deps.stdout.write(`\n${out.replace(/^\n+/, '')}`);
              wroteLeadingBlankLine = true;
            } else {
              deps.stdout.write(out);
            }
            deps.restoreProgressAfterStdout?.();
          }
          summaryAlreadyPrinted = true;
        }
      }
      const usage = await streamResult.usage;
      deps.llmCalls.push({
        model: streamResult.canonicalModelId,
        provider: streamResult.provider,
        purpose: 'summary',
        usage,
      });
      summary = streamed;
      if (shouldStreamSummaryToStdout) {
        const finalText = streamedRaw || streamed;
        outputGate?.finalize(finalText);
        summaryAlreadyPrinted = true;
      }
    }

    summary = summary.trim();
    if (summary.length === 0) {
      const last = getLastStreamError?.();
      if (last instanceof Error) {
        throw new TypeError(last.message, { cause: last });
      }
      throw new Error('LLM returned an empty summary');
    }

    if (!streamResult && streamHandler) {
      const cleaned = summary.trim();
      await streamHandler.onChunk({ appended: cleaned, prevStreamed: '', streamed: cleaned });
      await streamHandler.onDone?.(cleaned);
      summaryAlreadyPrinted = true;
    }

    return {
      maxOutputTokensForCall: maxOutputTokensForCall ?? null,
      modelMeta: {
        canonical: attempt.userModelId.toLowerCase().startsWith('openrouter/')
          ? attempt.userModelId
          : parsedModelEffective.canonical,
        provider: parsedModelEffective.provider,
      },
      summary,
      summaryAlreadyPrinted,
    };
  };

  return { applyOpenAiGatewayOverrides, envHasKeyFor, formatMissingModelError, runSummaryAttempt };
}
