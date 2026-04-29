import type { Context, Message } from '@mariozechner/pi-ai';

import type { CliProvider, SummarizeConfig } from '../config.js';
import { runCliModel } from '../llm/cli.js';
import type { LlmApiKeys } from '../llm/generate-text.js';
import { streamTextWithContext } from '../llm/generate-text.js';
import { resolveGitHubModelsApiKey } from '../llm/github-models.js';
import { mergeModelRequestOptions } from '../llm/model-options.js';
import { buildAutoModelAttempts, envHasKey } from '../model-auto.js';
import { parseBooleanEnv, parseCliUserModelId } from '../run/env.js';
import { resolveEnvState } from '../run/run-env.js';
import { resolveModelSelection } from '../run/run-models.js';

interface ChatSession {
  id: string;
  lastMeta: {
    model: string | null;
    modelLabel: string | null;
    inputSummary: string | null;
    summaryFromCache: boolean | null;
  };
}

interface ChatEvent { event: string; data?: unknown }

const SYSTEM_PROMPT = `You are Summarize Chat.

You answer questions about the current page content. Keep responses concise and grounded in the page.`;

function resolveConfiguredCliModel(
  provider: CliProvider,
  configForCli: SummarizeConfig | null | undefined,
): string | null {
  const cli = configForCli?.cli;
  const raw =
    provider === 'claude'
      ? cli?.claude?.model
      : provider === 'codex'
        ? cli?.codex?.model
        : provider === 'gemini'
          ? cli?.gemini?.model
          : provider === 'agent'
            ? cli?.agent?.model
            : provider === 'openclaw'
              ? cli?.openclaw?.model
              : cli?.opencode?.model;
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
}

function normalizeMessages(messages: Message[]): Message[] {
  return messages.map((message) => ({ ...message, timestamp: message.timestamp ?? Date.now() }));
}

function buildContext({
  pageUrl,
  pageTitle,
  pageContent,
  messages,
}: {
  pageUrl: string;
  pageTitle: string | null;
  pageContent: string;
  messages: Message[];
}): Context {
  const header = pageTitle ? `${pageTitle} (${pageUrl})` : pageUrl;
  const systemPrompt = `${SYSTEM_PROMPT}\n\nPage:\n${header}\n\nContent:\n${pageContent}`;
  return { messages: normalizeMessages(messages), systemPrompt };
}

function flattenChatForCli({
  systemPrompt,
  messages,
}: {
  systemPrompt: string;
  messages: Message[];
}): string {
  const parts: string[] = [systemPrompt];
  for (const msg of messages) {
    const role = msg.role === 'user' ? 'User' : 'Assistant';
    const content = typeof msg.content === 'string' ? msg.content : '';
    if (content) {
      parts.push(`${role}: ${content}`);
    }
  }
  return parts.join('\n\n');
}

function resolveApiKeys(
  env: Record<string, string | undefined>,
  configForCli: SummarizeConfig | null,
): LlmApiKeys {
  const envState = resolveEnvState({ configForCli, env, envForRun: env });
  return {
    anthropicApiKey: envState.anthropicApiKey,
    googleApiKey: envState.googleApiKey,
    openaiApiKey: envState.apiKey ?? envState.openaiApiKey,
    openrouterApiKey: envState.openrouterApiKey,
    xaiApiKey: envState.xaiApiKey,
  };
}

function resolveOpenAiUseChatCompletions({
  env,
  configForCli,
}: {
  env: Record<string, string | undefined>;
  configForCli: SummarizeConfig | null;
}): boolean {
  const envValue = parseBooleanEnv(env.OPENAI_USE_CHAT_COMPLETIONS);
  if (envValue !== null) {return envValue;}
  return configForCli?.openai?.useChatCompletions === true;
}

export async function streamChatResponse({
  env,
  fetchImpl,
  configForCli = null,
  session: _session,
  pageUrl,
  pageTitle,
  pageContent,
  messages,
  modelOverride,
  pushToSession,
  emitMeta,
}: {
  env: Record<string, string | undefined>;
  fetchImpl: typeof fetch;
  configForCli?: SummarizeConfig | null;
  session: ChatSession;
  pageUrl: string;
  pageTitle: string | null;
  pageContent: string;
  messages: Message[];
  modelOverride: string | null;
  pushToSession: (event: ChatEvent) => void;
  emitMeta: (patch: Partial<ChatSession['lastMeta']>) => void;
}) {
  const apiKeys = resolveApiKeys(env, configForCli);
  const envState = resolveEnvState({ configForCli, env, envForRun: env });
  const openaiUseChatCompletions = resolveOpenAiUseChatCompletions({ configForCli, env });
  const openaiRequestOptions = mergeModelRequestOptions(configForCli?.openai);
  const context = buildContext({ messages, pageContent, pageTitle, pageUrl });

  const resolveModel = () => {
    if (modelOverride && modelOverride.trim().length > 0) {
      const { requestedModel: requested } = resolveModelSelection({
        config: configForCli ?? null,
        configForCli: configForCli ?? null,
        configPath: null,
        envForRun: env,
        explicitModelArg: modelOverride,
      });
      if (requested.kind === 'auto') {
        return null;
      }
      if (requested.transport === 'cli') {
        const cliModel =
          requested.cliModel ?? resolveConfiguredCliModel(requested.cliProvider, configForCli);
        return {
          cliModel,
          cliProvider: requested.cliProvider,
          forceOpenRouter: false,
          modelId: null,
          transport: 'cli' as const,
          userModelId: cliModel
            ? `cli/${requested.cliProvider}/${cliModel}`
            : requested.userModelId,
        };
      }
      if (requested.transport === 'openrouter') {
        return {
          forceChatCompletions: false,
          forceOpenRouter: requested.forceOpenRouter,
          modelId: requested.llmModelId,
          openaiApiKeyOverride: null,
          openaiBaseUrlOverride: null,
          transport: 'native' as const,
          userModelId: requested.userModelId,
        };
      }
      return {
        forceChatCompletions:
          Boolean(requested.forceChatCompletions) ||
          (requested.provider === 'openai' && openaiUseChatCompletions),
        forceOpenRouter: requested.forceOpenRouter,
        modelId: requested.llmModelId,
        openaiApiKeyOverride:
          requested.requiredEnv === 'Z_AI_API_KEY'
            ? envState.zaiApiKey
            : requested.requiredEnv === 'NVIDIA_API_KEY'
              ? envState.nvidiaApiKey
              : requested.requiredEnv === 'GITHUB_TOKEN'
                ? resolveGitHubModelsApiKey(env)
                : null,
        openaiBaseUrlOverride:
          requested.requiredEnv === 'Z_AI_API_KEY'
            ? envState.zaiBaseUrl
            : requested.requiredEnv === 'NVIDIA_API_KEY'
              ? envState.nvidiaBaseUrl
              : (requested.openaiBaseUrlOverride ?? null),
        requestOptions: requested.requestOptions,
        transport: 'native' as const,
        userModelId: requested.userModelId,
      };
    }
    return null;
  };

  const resolved = resolveModel();
  if (resolved) {
    emitMeta({ model: resolved.userModelId });
    if (resolved.transport === 'cli') {
      const prompt = flattenChatForCli({
        messages: context.messages,
        systemPrompt: context.systemPrompt ?? '',
      });
      const result = await runCliModel({
        allowTools: false,
        config: configForCli?.cli ?? null,
        env,
        model: resolved.cliModel ?? null,
        prompt,
        provider: resolved.cliProvider,
        timeoutMs: 120_000,
      });
      pushToSession({ data: result.text, event: 'content' });
      pushToSession({ event: 'metrics' });
      return;
    }
    const result = await streamTextWithContext({
      apiKeys: { ...apiKeys, openaiApiKey: resolved.openaiApiKeyOverride ?? apiKeys.openaiApiKey },
      context,
      fetchImpl,
      forceChatCompletions: resolved.forceChatCompletions,
      forceOpenRouter: resolved.forceOpenRouter,
      modelId: resolved.modelId,
      openaiBaseUrlOverride: resolved.openaiBaseUrlOverride,
      requestOptions: mergeModelRequestOptions(openaiRequestOptions, resolved.requestOptions),
      timeoutMs: 30_000,
    });
    for await (const chunk of result.textStream) {
      pushToSession({ data: chunk, event: 'content' });
    }
    pushToSession({ event: 'metrics' });
    return;
  }

  const attempts = buildAutoModelAttempts({
    catalog: null,
    cliAvailability: envState.cliAvailability,
    config: null,
    desiredOutputTokens: null,
    env: envState.envForAuto,
    kind: 'text',
    openrouterProvidersFromEnv: null,
    promptTokens: null,
    requiresVideoUnderstanding: false,
  });

  const apiAttempt = attempts.find(
    (entry) =>
      entry.transport !== 'cli' &&
      entry.llmModelId &&
      envHasKey(envState.envForAuto, entry.requiredEnv),
  );
  const cliAttempt = !apiAttempt ? attempts.find((entry) => entry.transport === 'cli') : null;
  const attempt = apiAttempt ?? cliAttempt;
  if (!attempt) {
    throw new Error('No model available for chat');
  }

  emitMeta({ model: attempt.userModelId });

  if (attempt.transport === 'cli') {
    const parsed = parseCliUserModelId(attempt.userModelId);
    const prompt = flattenChatForCli({
      messages: context.messages,
      systemPrompt: context.systemPrompt ?? '',
    });
    const result = await runCliModel({
      allowTools: false,
      config: configForCli?.cli ?? null,
      env,
      model: parsed.model,
      prompt,
      provider: parsed.provider,
      timeoutMs: 120_000,
    });
    pushToSession({ data: result.text, event: 'content' });
    pushToSession({ event: 'metrics' });
    void _session;
    return;
  }

  const result = await streamTextWithContext({
    apiKeys,
    context,
    fetchImpl,
    forceChatCompletions: attempt.requiredEnv === 'OPENAI_API_KEY' && openaiUseChatCompletions,
    forceOpenRouter: attempt.forceOpenRouter,
    modelId: attempt.llmModelId!,
    requestOptions: mergeModelRequestOptions(openaiRequestOptions, attempt.requestOptions),
    timeoutMs: 30_000,
  });
  for await (const chunk of result.textStream) {
    pushToSession({ data: chunk, event: 'content' });
  }
  pushToSession({ event: 'metrics' });
  void _session;
}
