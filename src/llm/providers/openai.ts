import type { Context } from '@mariozechner/pi-ai';
import { completeSimple } from '@mariozechner/pi-ai';

import { isOpenRouterBaseUrl, normalizeBaseUrl } from '../../index.js';
import type { Attachment } from '../attachments.js';
import { createUnsupportedFunctionalityError } from '../errors.js';
import { toOpenAiServiceTierParam, type ModelRequestOptions } from '../model-options.js';
import type { LlmTokenUsage } from '../types.js';
import { normalizeOpenAiUsage, normalizeTokenUsage } from '../usage.js';
import { resolveOpenAiModel } from './models.js';
import { bytesToBase64 } from './shared.js';
import type { OpenAiClientConfig } from './types.js';

export interface OpenAiClientConfigInput {
  apiKeys: { openaiApiKey: string | null; openrouterApiKey: string | null };
  forceOpenRouter?: boolean;
  openaiBaseUrlOverride?: string | null;
  forceChatCompletions?: boolean;
  requestOptions?: ModelRequestOptions;
}

interface OpenAiTextCompletionResult {
  text: string;
  usage: LlmTokenUsage | null;
  resolvedModelId?: string;
}

function isGitHubModelsBaseUrl(baseUrl: string | undefined): boolean {
  if (!baseUrl) {
    return false;
  }
  try {
    return new URL(baseUrl).host === 'models.github.ai';
  } catch {
    return false;
  }
}

function isApiOpenAiBaseUrl(baseUrl: string | undefined): boolean {
  if (!baseUrl) {
    return true;
  }
  try {
    return new URL(baseUrl).host === 'api.openai.com';
  } catch {
    return false;
  }
}

export function resolveOpenAiClientConfig({
  apiKeys,
  forceOpenRouter,
  openaiBaseUrlOverride,
  forceChatCompletions,
  requestOptions,
}: OpenAiClientConfigInput): OpenAiClientConfig {
  const baseUrlRaw =
    openaiBaseUrlOverride ??
    (typeof process !== 'undefined' ? process.env.OPENAI_BASE_URL : undefined);
  const baseUrl = normalizeBaseUrl(baseUrlRaw);
  const isOpenRouterViaBaseUrl = baseUrl ? isOpenRouterBaseUrl(baseUrl) : false;
  const hasOpenRouterKey = apiKeys.openrouterApiKey != null;
  const hasOpenAiKey = apiKeys.openaiApiKey != null;
  const isOpenRouter =
    Boolean(forceOpenRouter) ??
    isOpenRouterViaBaseUrl ??
    (hasOpenRouterKey && !baseUrl && !hasOpenAiKey);

  const apiKey = isOpenRouter
    ? (apiKeys.openrouterApiKey ?? apiKeys.openaiApiKey)
    : apiKeys.openaiApiKey;
  if (!apiKey) {
    throw new Error(
      isOpenRouter
        ? 'Missing OPENROUTER_API_KEY (or OPENAI_API_KEY) for OpenRouter'
        : 'Missing OPENAI_API_KEY for openai/... model',
    );
  }

  const baseURL = forceOpenRouter
    ? 'https://openrouter.ai/api/v1'
    : (baseUrl ?? (isOpenRouter ? 'https://openrouter.ai/api/v1' : undefined));

  const isCustomBaseURL = (() => {
    if (!baseURL) {
      return false;
    }
    try {
      const url = new URL(baseURL);
      return url.host !== 'api.openai.com' && url.host !== 'openrouter.ai';
    } catch {
      return false;
    }
  })();

  const useChatCompletions = Boolean(forceChatCompletions) ?? isOpenRouter ?? isCustomBaseURL;
  return {
    apiKey,
    baseURL: baseURL ?? undefined,
    isOpenRouter,
    useChatCompletions,
    ...(requestOptions ? { requestOptions } : {}),
  };
}

function resolveOpenAiResponsesUrl(baseUrl: string): URL {
  const url = new URL(baseUrl);
  const path = url.pathname.replace(/\/$/, '');
  if (path.endsWith('/responses')) {
    url.pathname = path;
    return url;
  }
  if (path.endsWith('/v1')) {
    url.pathname = `${path}/responses`;
    return url;
  }
  url.pathname = `${path}/v1/responses`;
  return url;
}

function resolveOpenAiChatCompletionsUrl(baseUrl: string): URL {
  const url = new URL(baseUrl);
  const path = url.pathname.replace(/\/$/, '');
  if (url.host === 'models.github.ai') {
    if (path.endsWith('/chat/completions')) {
      url.pathname = path;
      return url;
    }
    url.pathname = `${path}/chat/completions`;
    return url;
  }
  if (path.endsWith('/chat/completions')) {
    url.pathname = path;
    return url;
  }
  if (path.endsWith('/v1')) {
    url.pathname = `${path}/chat/completions`;
    return url;
  }
  url.pathname = `${path}/v1/chat/completions`;
  return url;
}

function stripOpenAiProviderPrefix(modelId: string): string {
  return modelId.trim().replace(/^openai\//i, '');
}

function isOpenAiResponsesTextModelId(modelId: string): boolean {
  const normalized = stripOpenAiProviderPrefix(modelId).toLowerCase();
  return normalized.startsWith('gpt-5') && normalized !== 'gpt-5-chat';
}

function buildOpenAiResponsesRequestOptions(
  requestOptions: ModelRequestOptions | undefined,
): Record<string, unknown> {
  if (!requestOptions) {
    return {};
  }
  const serviceTier = toOpenAiServiceTierParam(requestOptions.serviceTier);
  return {
    ...(serviceTier ? { service_tier: serviceTier } : {}),
    ...(requestOptions.reasoningEffort
      ? { reasoning: { effort: requestOptions.reasoningEffort } }
      : {}),
    ...(requestOptions.textVerbosity ? { text: { verbosity: requestOptions.textVerbosity } } : {}),
  };
}

function buildOpenAiChatRequestOptions(
  requestOptions: ModelRequestOptions | undefined,
): Record<string, unknown> {
  if (!requestOptions) {
    return {};
  }
  const serviceTier = toOpenAiServiceTierParam(requestOptions.serviceTier);
  return {
    ...(serviceTier ? { service_tier: serviceTier } : {}),
    ...(requestOptions.reasoningEffort ? { reasoning_effort: requestOptions.reasoningEffort } : {}),
    ...(requestOptions.textVerbosity ? { verbosity: requestOptions.textVerbosity } : {}),
  };
}

function resolveGitHubModelsCompatFallbackModelId(modelId: string): string | null {
  const normalized = modelId.trim().toLowerCase();
  if (!normalized.startsWith('openai/gpt-5') || normalized === 'openai/gpt-5-chat') {
    return null;
  }
  return 'openai/gpt-5-chat';
}

function shouldRetryGitHubModelsCompat(error: unknown): boolean {
  const statusCode =
    typeof (error as { statusCode?: unknown })?.statusCode === 'number'
      ? Number((error as { statusCode?: unknown }).statusCode)
      : null;
  return statusCode === 400 || statusCode === 404 || statusCode === 500 || statusCode === 502;
}

function extractOpenAiResponseText(payload: {
  output_text?: unknown;
  output?: { content?: { text?: string }[] }[];
}): string {
  if (typeof payload.output_text === 'string') {
    return payload.output_text.trim();
  }
  const output = Array.isArray(payload.output) ? payload.output : [];
  const text = output
    .flatMap((item) => (Array.isArray(item.content) ? item.content : []))
    .map((block) => (typeof block.text === 'string' ? block.text : ''))
    .join('')
    .trim();
  return text;
}

function extractChatCompletionText(payload: {
  choices?: { message?: { content?: unknown } }[];
}): string {
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const content = choices[0]?.message?.content;
  if (typeof content === 'string') {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .map((part) => {
      if (!part || typeof part !== 'object') {
        return '';
      }
      const record = part as Record<string, unknown>;
      return typeof record.text === 'string' ? record.text : '';
    })
    .join('')
    .trim();
}

function contextToChatCompletionMessages(context: Context): { role: string; content: string }[] {
  const messages: { role: string; content: string }[] = [];
  const systemPrompt = context.systemPrompt?.trim();
  if (systemPrompt) {
    messages.push({ content: systemPrompt, role: 'system' });
  }
  for (const message of context.messages) {
    const content =
      typeof message.content === 'string'
        ? message.content.trim()
        : (Array.isArray(message.content)
          ? message.content
              .map((part) => (part.type === 'text' ? part.text : ''))
              .join('')
              .trim()
          : '');
    if (!content) {
      continue;
    }
    messages.push({ content, role: message.role });
  }
  return messages;
}

function contextToResponsesInput(
  context: Context,
): { role: string; content: { type: 'input_text'; text: string }[] }[] {
  return contextToChatCompletionMessages({
    messages: context.messages,
    systemPrompt: undefined,
  }).map((message) => ({
    content: [{ text: message.content, type: 'input_text' }],
    role: message.role,
  }));
}

function buildOpenAiRequestHeaders(openaiConfig: OpenAiClientConfig): Record<string, string> {
  return {
    authorization: `Bearer ${openaiConfig.apiKey}`,
    'content-type': 'application/json',
    ...(openaiConfig.isOpenRouter
      ? { 'HTTP-Referer': 'https://github.com/steipete/summarize', 'X-Title': 'summarize' }
      : {}),
    ...openaiConfig.extraHeaders,
  };
}

function createOpenAiHttpError({
  baseUrl,
  status,
  bodyText,
}: {
  baseUrl: string;
  status: number;
  bodyText: string;
}): Error {
  const message =
    isGitHubModelsBaseUrl(baseUrl) && status === 429
      ? 'GitHub Models rate limit exceeded (429). Try again later or use another model/token.'
      : `OpenAI API error (${status}).`;
  const error = new Error(message);
  (error as { statusCode?: number }).statusCode = status;
  (error as { responseBody?: string }).responseBody = bodyText;
  return error;
}

async function completeOpenAiChatText({
  modelId,
  openaiConfig,
  context,
  temperature,
  maxOutputTokens,
  signal,
  fetchImpl,
}: {
  modelId: string;
  openaiConfig: OpenAiClientConfig;
  context: Context;
  temperature?: number;
  maxOutputTokens?: number;
  signal: AbortSignal;
  fetchImpl: typeof fetch;
}): Promise<OpenAiTextCompletionResult> {
  const baseUrl = openaiConfig.baseURL ?? 'https://api.openai.com/v1';
  const response = await fetchImpl(String(resolveOpenAiChatCompletionsUrl(baseUrl)), {
    body: JSON.stringify({
      messages: contextToChatCompletionMessages(context),
      model: modelId,
      ...buildOpenAiChatRequestOptions(openaiConfig.requestOptions),
      ...(typeof maxOutputTokens === 'number' ? { max_tokens: maxOutputTokens } : {}),
      ...(typeof temperature === 'number' ? { temperature } : {}),
    }),
    headers: buildOpenAiRequestHeaders(openaiConfig),
    method: 'POST',
    signal,
  });

  const bodyText = await response.text();
  if (!response.ok) {
    throw createOpenAiHttpError({ baseUrl, bodyText, status: response.status });
  }

  const data = JSON.parse(bodyText) as {
    choices?: { message?: { content?: unknown } }[];
    usage?: unknown;
  };
  const text = extractChatCompletionText(data);
  if (!text) {
    throw new Error(`LLM returned an empty summary (model openai/${modelId}).`);
  }
  return { resolvedModelId: modelId, text, usage: normalizeOpenAiUsage(data.usage) };
}

async function completeOpenAiResponsesText({
  modelId,
  openaiConfig,
  context,
  temperature,
  maxOutputTokens,
  signal,
  fetchImpl,
}: {
  modelId: string;
  openaiConfig: OpenAiClientConfig;
  context: Context;
  temperature?: number;
  maxOutputTokens?: number;
  signal: AbortSignal;
  fetchImpl: typeof fetch;
}): Promise<OpenAiTextCompletionResult> {
  const baseUrl = openaiConfig.baseURL ?? 'https://api.openai.com/v1';
  const response = await fetchImpl(String(resolveOpenAiResponsesUrl(baseUrl)), {
    body: JSON.stringify({
      input: contextToResponsesInput(context),
      model: modelId,
      ...(context.systemPrompt?.trim() ? { instructions: context.systemPrompt.trim() } : {}),
      ...buildOpenAiResponsesRequestOptions(openaiConfig.requestOptions),
      ...(typeof maxOutputTokens === 'number' ? { max_output_tokens: maxOutputTokens } : {}),
      ...(typeof temperature === 'number' ? { temperature } : {}),
    }),
    headers: buildOpenAiRequestHeaders(openaiConfig),
    method: 'POST',
    signal,
  });

  const bodyText = await response.text();
  if (!response.ok) {
    throw createOpenAiHttpError({ baseUrl, bodyText, status: response.status });
  }

  const data = JSON.parse(bodyText) as {
    output_text?: unknown;
    output?: { content?: { text?: string }[] }[];
    usage?: unknown;
  };
  const text = extractOpenAiResponseText(data);
  if (!text) {
    throw new Error(`LLM returned an empty summary (model openai/${modelId}).`);
  }
  return { resolvedModelId: modelId, text, usage: normalizeOpenAiUsage(data.usage) };
}

async function completeGitHubModelsText({
  modelId,
  openaiConfig,
  context,
  temperature,
  maxOutputTokens,
  signal,
  fetchImpl,
}: {
  modelId: string;
  openaiConfig: OpenAiClientConfig;
  context: Context;
  temperature?: number;
  maxOutputTokens?: number;
  signal: AbortSignal;
  fetchImpl: typeof fetch;
}): Promise<OpenAiTextCompletionResult> {
  try {
    return await completeOpenAiChatText({
      context,
      fetchImpl,
      maxOutputTokens,
      modelId,
      openaiConfig,
      signal,
      temperature,
    });
  } catch (error) {
    const fallbackModelId = resolveGitHubModelsCompatFallbackModelId(modelId);
    if (!fallbackModelId || !shouldRetryGitHubModelsCompat(error)) {
      throw error;
    }
    return completeOpenAiChatText({
      context,
      fetchImpl,
      maxOutputTokens,
      modelId: fallbackModelId,
      openaiConfig,
      signal,
      temperature,
    });
  }
}

export async function completeOpenAiText({
  modelId,
  openaiConfig,
  context,
  temperature,
  maxOutputTokens,
  signal,
  fetchImpl = globalThis.fetch.bind(globalThis),
}: {
  modelId: string;
  openaiConfig: OpenAiClientConfig;
  context: Context;
  temperature?: number;
  maxOutputTokens?: number;
  signal: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<OpenAiTextCompletionResult> {
  if (isGitHubModelsBaseUrl(openaiConfig.baseURL)) {
    return completeGitHubModelsText({
      context,
      fetchImpl,
      maxOutputTokens,
      modelId,
      openaiConfig,
      signal,
      temperature,
    });
  }
  if (
    openaiConfig.useChatCompletions &&
    openaiConfig.requestOptions &&
    !openaiConfig.isOpenRouter &&
    isApiOpenAiBaseUrl(openaiConfig.baseURL)
  ) {
    return completeOpenAiChatText({
      context,
      fetchImpl,
      maxOutputTokens,
      modelId,
      openaiConfig,
      signal,
      temperature,
    });
  }
  if (openaiConfig.isOpenRouter && isOpenAiResponsesTextModelId(modelId)) {
    return completeOpenAiChatText({
      context,
      fetchImpl,
      maxOutputTokens,
      modelId,
      openaiConfig,
      signal,
      temperature,
    });
  }
  if (
    !openaiConfig.isOpenRouter &&
    isApiOpenAiBaseUrl(openaiConfig.baseURL) &&
    isOpenAiResponsesTextModelId(modelId)
  ) {
    return completeOpenAiResponsesText({
      context,
      fetchImpl,
      maxOutputTokens,
      modelId,
      openaiConfig,
      signal,
      temperature,
    });
  }
  const model = resolveOpenAiModel({ context, modelId, openaiConfig });
  const result = await completeSimple(model, context, {
    ...(typeof temperature === 'number' ? { temperature } : {}),
    ...(typeof maxOutputTokens === 'number' ? { maxTokens: maxOutputTokens } : {}),
    apiKey: openaiConfig.apiKey,
    signal,
  });
  const text = result.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('')
    .trim();
  if (!text) {
    throw new Error(`LLM returned an empty summary (model openai/${modelId}).`);
  }
  return { text, usage: normalizeTokenUsage(result.usage) };
}

export async function completeOpenAiDocument({
  modelId,
  openaiConfig,
  promptText,
  document,
  maxOutputTokens,
  temperature,
  timeoutMs,
  fetchImpl,
}: {
  modelId: string;
  openaiConfig: OpenAiClientConfig;
  promptText: string;
  document: Attachment;
  maxOutputTokens?: number;
  temperature?: number;
  timeoutMs: number;
  fetchImpl: typeof fetch;
}): Promise<{ text: string; usage: LlmTokenUsage | null }> {
  if (document.kind !== 'document') {
    throw new Error('Internal error: expected a document attachment for OpenAI.');
  }
  if (openaiConfig.isOpenRouter) {
    throw createUnsupportedFunctionalityError(
      'OpenRouter does not support PDF attachments for openai/... models',
    );
  }
  const baseUrl = openaiConfig.baseURL ?? 'https://api.openai.com/v1';
  const { host } = new URL(baseUrl);
  if (host !== 'api.openai.com') {
    throw createUnsupportedFunctionalityError(
      `Document attachments require api.openai.com; got ${host}`,
    );
  }

  const url = resolveOpenAiResponsesUrl(baseUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  const filename = document.filename?.trim() ?? 'document.pdf';
  const payload = {
    input: [
      {
        content: [
          {
            type: 'input_file',
            filename,
            file_data: `data:${document.mediaType};base64,${bytesToBase64(document.bytes)}`,
          },
          { type: 'input_text', text: promptText },
        ],
        role: 'user',
      },
    ],
    model: modelId,
    ...buildOpenAiResponsesRequestOptions(openaiConfig.requestOptions),
    ...(typeof maxOutputTokens === 'number' ? { max_output_tokens: maxOutputTokens } : {}),
    ...(typeof temperature === 'number' ? { temperature } : {}),
  };

  try {
    const response = await fetchImpl(String(url), {
      body: JSON.stringify(payload),
      headers: {
        authorization: `Bearer ${openaiConfig.apiKey}`,
        'content-type': 'application/json',
      },
      method: 'POST',
      signal: controller.signal,
    });

    const bodyText = await response.text();
    if (!response.ok) {
      throw createOpenAiHttpError({ baseUrl, bodyText, status: response.status });
    }

    const data = JSON.parse(bodyText) as {
      output_text?: unknown;
      output?: { content?: { text?: string }[] }[];
      usage?: unknown;
    };
    const text = extractOpenAiResponseText(data);
    if (!text) {
      throw new Error(`LLM returned an empty summary (model openai/${modelId}).`);
    }
    return { text, usage: normalizeOpenAiUsage(data.usage) };
  } finally {
    clearTimeout(timeout);
  }
}
