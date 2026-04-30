import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { streamChatResponse } from '../src/daemon/chat.js';
import { runCliModel } from '../src/llm/cli.js';
import { streamTextWithContext } from '../src/llm/generate-text.js';
import { buildAutoModelAttempts } from '../src/model-auto.js';

vi.mock('../src/llm/cli.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/llm/cli.js')>();
  return {
    ...actual,
    runCliModel: vi.fn(async () => ({ costUsd: null, text: 'cli hello', usage: null })),
  };
});

vi.mock('../src/llm/generate-text.js', () => {
  return {
    streamTextWithContext: vi.fn(async () => ({
      canonicalModelId: 'openai/gpt-5-mini',
      lastError: () => null,
      provider: 'openai',
      textStream: (async function* textStream() {
        yield 'hello';
      })(),
      usage: Promise.resolve({ completionTokens: 1, promptTokens: 1, totalTokens: 2 }),
    })),
  };
});

vi.mock('../src/model-auto.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/model-auto.js')>();
  return { ...actual, buildAutoModelAttempts: vi.fn() };
});

beforeEach(() => {
  vi.mocked(streamTextWithContext).mockClear();
  vi.mocked(buildAutoModelAttempts).mockReset();
  vi.mocked(runCliModel).mockReset();
  vi.mocked(runCliModel).mockResolvedValue({ costUsd: null, text: 'cli hello', usage: null });
});

describe('daemon/chat', () => {
  it('uses native model ids when fixed model override is provided', async () => {
    const home = mkdtempSync(join(tmpdir(), 'gist-daemon-chat-'));
    const events: { event: string }[] = [];
    const meta: { model?: string | null }[] = [];

    await streamChatResponse({
      emitMeta: (patch) => meta.push(patch),
      env: { HOME: home, OPENAI_API_KEY: 'sk-openai' },
      fetchImpl: fetch,
      messages: [{ content: 'Hi', role: 'user' }],
      modelOverride: 'openai/gpt-5-mini',
      pageContent: 'Hello world',
      pageTitle: 'Example',
      pageUrl: 'https://example.com',
      pushToSession: (evt) => events.push(evt),
      session: {
        id: 's1',
        lastMeta: { inputSummary: null, model: null, modelLabel: null, summaryFromCache: null },
      },
    });

    const { calls } = (streamTextWithContext as unknown as { mock: { calls: unknown[][] } }).mock;
    expect(calls.length).toBe(1);
    const args = calls[0]?.[0] as { modelId: string; forceOpenRouter?: boolean };
    expect(args.modelId).toBe('openai/gpt-5-mini');
    expect(args.forceOpenRouter).toBe(false);
    expect(meta[0]?.model).toBe('openai/gpt-5-mini');
    expect(events.some((evt) => evt.event === 'metrics')).toBe(true);
  });

  it('honors openai.useChatCompletions for fixed sidepanel chat models', async () => {
    const home = mkdtempSync(join(tmpdir(), 'gist-daemon-chat-openai-chat-'));

    await streamChatResponse({
      configForCli: { openai: { useChatCompletions: true } },
      emitMeta: () => {
        /* Empty */
      },
      env: { HOME: home, OPENAI_API_KEY: 'sk-openai' },
      fetchImpl: fetch,
      messages: [{ content: 'Hi', role: 'user' }],
      modelOverride: 'openai/gpt-4.1',
      pageContent: 'Hello world',
      pageTitle: 'Example',
      pageUrl: 'https://example.com',
      pushToSession: () => {
        /* Empty */
      },
      session: {
        id: 's-openai-chat',
        lastMeta: { inputSummary: null, model: null, modelLabel: null, summaryFromCache: null },
      },
    });

    const { calls } = (streamTextWithContext as unknown as { mock: { calls: unknown[][] } }).mock;
    const args = calls[0]?.[0] as { forceChatCompletions?: boolean };
    expect(args.forceChatCompletions).toBe(true);
  });

  it('routes github-copilot overrides through the GitHub Models gateway', async () => {
    const home = mkdtempSync(join(tmpdir(), 'gist-daemon-chat-github-models-'));
    const meta: { model?: string | null }[] = [];

    await streamChatResponse({
      emitMeta: (patch) => meta.push(patch),
      env: { GITHUB_TOKEN: 'gh-token', HOME: home },
      fetchImpl: fetch,
      messages: [{ content: 'Hi', role: 'user' }],
      modelOverride: 'github-copilot/gpt-5.4',
      pageContent: 'Hello world',
      pageTitle: 'Example',
      pageUrl: 'https://example.com',
      pushToSession: () => {
        /* Empty */
      },
      session: {
        id: 's-gh',
        lastMeta: { inputSummary: null, model: null, modelLabel: null, summaryFromCache: null },
      },
    });

    const { calls } = (streamTextWithContext as unknown as { mock: { calls: unknown[][] } }).mock;
    const args = calls.at(-1)?.[0] as {
      modelId: string;
      openaiBaseUrlOverride?: string | null;
      forceChatCompletions?: boolean;
      apiKeys?: { openaiApiKey?: string | null };
    };
    expect(args.modelId).toBe('github-copilot/openai/gpt-5.4');
    expect(args.openaiBaseUrlOverride).toBe('https://models.github.ai/inference');
    expect(args.forceChatCompletions).toBe(true);
    expect(args.apiKeys?.openaiApiKey).toBe('gh-token');
    expect(meta[0]?.model).toBe('github-copilot/openai/gpt-5.4');
  });

  it('runs fixed CLI model overrides through the CLI transport', async () => {
    const home = mkdtempSync(join(tmpdir(), 'gist-daemon-chat-cli-fixed-'));
    const events: { event: string; data?: unknown }[] = [];
    const meta: { model?: string | null }[] = [];

    await streamChatResponse({
      emitMeta: (patch) => meta.push(patch),
      env: { HOME: home },
      fetchImpl: fetch,
      messages: [{ content: 'Hi', role: 'user' }],
      modelOverride: 'cli/codex/gpt-5.2',
      pageContent: 'Hello world',
      pageTitle: 'Example',
      pageUrl: 'https://example.com',
      pushToSession: (evt) => events.push(evt),
      session: {
        id: 's-cli-fixed',
        lastMeta: { inputSummary: null, model: null, modelLabel: null, summaryFromCache: null },
      },
    });

    expect(runCliModel).toHaveBeenCalledWith(
      expect.objectContaining({ allowTools: false, model: 'gpt-5.2', provider: 'codex' }),
    );
    const args = vi.mocked(runCliModel).mock.calls[0]?.[0] as { prompt: string };
    expect(args.prompt).toContain('You are Gist Chat.');
    expect(args.prompt).toContain('User: Hi');
    expect(vi.mocked(streamTextWithContext).mock.calls.length).toBe(0);
    expect(meta[0]?.model).toBe('cli/codex/gpt-5.2');
    expect(events).toEqual([{ data: 'cli hello', event: 'content' }, { event: 'metrics' }]);
  });

  it('resolves configured OpenCode models before emitting chat metadata', async () => {
    const home = mkdtempSync(join(tmpdir(), 'gist-daemon-chat-opencode-fixed-'));
    const meta: { model?: string | null }[] = [];

    await streamChatResponse({
      configForCli: { cli: { opencode: { model: 'openai/gpt-5.4' } } },
      emitMeta: (patch) => meta.push(patch),
      env: { HOME: home },
      fetchImpl: fetch,
      messages: [{ content: 'Hi', role: 'user' }],
      modelOverride: 'cli/opencode',
      pageContent: 'Hello world',
      pageTitle: 'Example',
      pageUrl: 'https://example.com',
      pushToSession: () => {
        /* Empty */
      },
      session: {
        id: 's-opencode-fixed',
        lastMeta: { inputSummary: null, model: null, modelLabel: null, summaryFromCache: null },
      },
    });

    expect(runCliModel).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'openai/gpt-5.4', provider: 'opencode' }),
    );
    expect(meta[0]?.model).toBe('cli/opencode/openai/gpt-5.4');
  });

  it('routes openrouter overrides through openrouter transport', async () => {
    const home = mkdtempSync(join(tmpdir(), 'gist-daemon-chat-openrouter-'));
    const meta: { model?: string | null }[] = [];

    await streamChatResponse({
      emitMeta: (patch) => meta.push(patch),
      env: { HOME: home, OPENROUTER_API_KEY: 'test' },
      fetchImpl: fetch,
      messages: [{ content: 'Hi', role: 'user' }],
      modelOverride: 'openrouter/anthropic/claude-sonnet-4-5',
      pageContent: 'Hello world',
      pageTitle: null,
      pageUrl: 'https://example.com',
      pushToSession: () => {
        /* Empty */
      },
      session: {
        id: 's2',
        lastMeta: { inputSummary: null, model: null, modelLabel: null, summaryFromCache: null },
      },
    });

    const { calls } = (streamTextWithContext as unknown as { mock: { calls: unknown[][] } }).mock;
    const args = calls.at(-1)?.[0] as { modelId: string; forceOpenRouter?: boolean };
    expect(args.modelId).toBe('openai/anthropic/claude-sonnet-4-5');
    expect(args.forceOpenRouter).toBe(true);
    expect(meta[0]?.model).toBe('openrouter/anthropic/claude-sonnet-4-5');
  });

  it('uses auto model attempts without forcing openrouter', async () => {
    const home = mkdtempSync(join(tmpdir(), 'gist-daemon-chat-auto-'));
    const meta: { model?: string | null }[] = [];

    const attempts = [
      {
        debug: 'test',
        forceOpenRouter: false,
        llmModelId: 'openai/gpt-5-mini',
        openrouterProviders: null,
        requiredEnv: 'OPENAI_API_KEY' as const,
        transport: 'native' as const,
        userModelId: 'openai/gpt-5-mini',
      },
    ];

    vi.mocked(buildAutoModelAttempts).mockReturnValue(attempts);

    await streamChatResponse({
      emitMeta: (patch) => meta.push(patch),
      env: { HOME: home, OPENAI_API_KEY: 'sk-openai' },
      fetchImpl: fetch,
      messages: [{ content: 'Hi', role: 'user' }],
      modelOverride: null,
      pageContent: 'Hello world',
      pageTitle: null,
      pageUrl: 'https://example.com',
      pushToSession: () => {
        /* Empty */
      },
      session: {
        id: 's3',
        lastMeta: { inputSummary: null, model: null, modelLabel: null, summaryFromCache: null },
      },
    });

    const { calls } = (streamTextWithContext as unknown as { mock: { calls: unknown[][] } }).mock;
    const args = calls.at(-1)?.[0] as { modelId: string; forceOpenRouter?: boolean };
    expect(args.modelId).toBe('openai/gpt-5-mini');
    expect(args.forceOpenRouter).toBe(false);
    expect(meta[0]?.model).toBe('openai/gpt-5-mini');
  });

  it('honors openai.useChatCompletions for auto-selected sidepanel chat models', async () => {
    const home = mkdtempSync(join(tmpdir(), 'gist-daemon-chat-auto-openai-chat-'));

    vi.mocked(buildAutoModelAttempts).mockReturnValue([
      {
        debug: 'test',
        forceOpenRouter: false,
        llmModelId: 'openai/gpt-5-mini',
        openrouterProviders: null,
        requiredEnv: 'OPENAI_API_KEY' as const,
        transport: 'native' as const,
        userModelId: 'openai/gpt-5-mini',
      },
    ]);

    await streamChatResponse({
      configForCli: { openai: { useChatCompletions: true } },
      emitMeta: () => {
        /* Empty */
      },
      env: { HOME: home, OPENAI_API_KEY: 'sk-openai' },
      fetchImpl: fetch,
      messages: [{ content: 'Hi', role: 'user' }],
      modelOverride: null,
      pageContent: 'Hello world',
      pageTitle: null,
      pageUrl: 'https://example.com',
      pushToSession: () => {
        /* Empty */
      },
      session: {
        id: 's-auto-openai-chat',
        lastMeta: { inputSummary: null, model: null, modelLabel: null, summaryFromCache: null },
      },
    });

    const { calls } = (streamTextWithContext as unknown as { mock: { calls: unknown[][] } }).mock;
    const args = calls.at(-1)?.[0] as { forceChatCompletions?: boolean };
    expect(args.forceChatCompletions).toBe(true);
  });

  it('accepts legacy OpenRouter env mapping for auto attempts', async () => {
    const home = mkdtempSync(join(tmpdir(), 'gist-daemon-chat-auto-openrouter-'));
    const meta: { model?: string | null }[] = [];

    const attempts = [
      {
        debug: 'test',
        forceOpenRouter: true,
        llmModelId: 'openai/openai/gpt-5-mini',
        openrouterProviders: null,
        requiredEnv: 'OPENROUTER_API_KEY' as const,
        transport: 'openrouter' as const,
        userModelId: 'openrouter/openai/gpt-5-mini',
      },
    ];

    vi.mocked(buildAutoModelAttempts).mockReturnValue(attempts);

    await streamChatResponse({
      emitMeta: (patch) => meta.push(patch),
      env: {
        HOME: home,
        OPENAI_API_KEY: 'sk-openrouter-via-openai',
        OPENAI_BASE_URL: 'https://openrouter.ai/api/v1',
      },
      fetchImpl: fetch,
      messages: [{ content: 'Hi', role: 'user' }],
      modelOverride: null,
      pageContent: 'Hello world',
      pageTitle: null,
      pageUrl: 'https://example.com',
      pushToSession: () => {
        /* Empty */
      },
      session: {
        id: 's4',
        lastMeta: { inputSummary: null, model: null, modelLabel: null, summaryFromCache: null },
      },
    });

    const { calls } = (streamTextWithContext as unknown as { mock: { calls: unknown[][] } }).mock;
    const args = calls.at(-1)?.[0] as { modelId: string; forceOpenRouter?: boolean };
    expect(args.modelId).toBe('openai/openai/gpt-5-mini');
    expect(args.forceOpenRouter).toBe(true);
    expect(meta[0]?.model).toBe('openrouter/openai/gpt-5-mini');
  });

  it('falls back to CLI auto attempts when no API-key model is available', async () => {
    const home = mkdtempSync(join(tmpdir(), 'gist-daemon-chat-cli-auto-'));
    const meta: { model?: string | null }[] = [];
    const events: { event: string; data?: unknown }[] = [];

    vi.mocked(buildAutoModelAttempts).mockReturnValue([
      {
        debug: 'cli fallback',
        forceOpenRouter: false,
        llmModelId: null,
        openrouterProviders: null,
        requiredEnv: 'CLI_CODEX' as const,
        transport: 'cli' as const,
        userModelId: 'cli/codex/gpt-5.2',
      },
    ]);

    await streamChatResponse({
      emitMeta: (patch) => meta.push(patch),
      env: { HOME: home },
      fetchImpl: fetch,
      messages: [{ content: 'Hi', role: 'user' }],
      modelOverride: null,
      pageContent: 'Hello world',
      pageTitle: null,
      pageUrl: 'https://example.com',
      pushToSession: (evt) => events.push(evt),
      session: {
        id: 's-cli-auto',
        lastMeta: { inputSummary: null, model: null, modelLabel: null, summaryFromCache: null },
      },
    });

    expect(runCliModel).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-5.2', provider: 'codex' }),
    );
    expect(vi.mocked(streamTextWithContext).mock.calls.length).toBe(0);
    expect(meta[0]?.model).toBe('cli/codex/gpt-5.2');
    expect(events).toEqual([{ data: 'cli hello', event: 'content' }, { event: 'metrics' }]);
  });
});
