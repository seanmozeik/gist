import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AssistantMessage, Tool } from '@mariozechner/pi-ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { completeAgentResponse } from '../src/daemon/agent.js';
import { runCliModel } from '../src/llm/cli.js';
import * as modelAuto from '../src/model-auto.js';

const { mockCompleteSimple, mockGetModel } = vi.hoisted(() => ({
  mockCompleteSimple: vi.fn(),
  mockGetModel: vi.fn(),
}));

vi.mock('../src/llm/cli.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/llm/cli.js')>();
  return {
    ...actual,
    runCliModel: vi.fn(async () => ({ costUsd: null, text: 'cli agent', usage: null })),
  };
});

vi.mock('@mariozechner/pi-ai', () => {
  return { completeSimple: mockCompleteSimple, getModel: mockGetModel };
});

const buildAssistant = (provider: string, model: string): AssistantMessage => ({
  api: 'openai-completions',
  content: [{ text: 'ok', type: 'text' }],
  model,
  provider,
  role: 'assistant',
  stopReason: 'stop',
  timestamp: Date.now(),
  usage: {
    cacheRead: 0,
    cacheWrite: 0,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
    input: 0,
    output: 0,
    totalTokens: 0,
  },
});

const makeModel = (provider: string, modelId: string) => ({
  api: 'openai-completions' as const,
  baseUrl: 'https://example.com',
  contextWindow: 8192,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
  id: modelId,
  input: ['text'],
  maxTokens: 2048,
  name: modelId,
  provider,
  reasoning: false,
});

const makeTempHome = () => mkdtempSync(join(tmpdir(), 'gist-daemon-agent-'));

const writeHomeConfig = (home: string, config: unknown) => {
  const configDir = join(home, '.gist');
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, 'config.json'), JSON.stringify(config, null, 2), 'utf8');
};

const makeFakeCliBin = (binary: string) => {
  const dir = mkdtempSync(join(tmpdir(), `gist-daemon-cli-${binary}-`));
  const file = join(dir, binary);
  writeFileSync(file, '#!/bin/sh\nexit 0\n');
  chmodSync(file, 0o755);
  return { dir, file };
};

beforeEach(() => {
  mockCompleteSimple.mockReset();
  mockGetModel.mockReset();
  vi.mocked(runCliModel).mockReset();
  vi.mocked(runCliModel).mockResolvedValue({ costUsd: null, text: 'cli agent', usage: null });
  mockGetModel.mockImplementation((provider: string, modelId: string) =>
    makeModel(provider, modelId),
  );
  mockCompleteSimple.mockImplementation(async (model: { provider: string; id: string }) =>
    buildAssistant(model.provider, model.id),
  );
});

describe('daemon/agent', () => {
  it('passes openrouter api key to pi-ai when using openrouter models', async () => {
    const home = makeTempHome();
    await completeAgentResponse({
      automationEnabled: false,
      env: { HOME: home, OPENROUTER_API_KEY: 'or-key' },
      messages: [{ content: 'Hi', role: 'user' }],
      modelOverride: 'openrouter/openai/gpt-5-mini',
      pageContent: 'Hello world',
      pageTitle: 'Example',
      pageUrl: 'https://example.com',
      tools: [],
    });

    const options = mockCompleteSimple.mock.calls[0]?.[2] as { apiKey?: string };
    expect(options.apiKey).toBe('or-key');
  });

  it('passes openai api key to pi-ai for openai models', async () => {
    const home = makeTempHome();
    await completeAgentResponse({
      automationEnabled: false,
      env: { HOME: home, OPENAI_API_KEY: 'sk-openai' },
      messages: [{ content: 'Hi', role: 'user' }],
      modelOverride: 'openai/gpt-5-mini',
      pageContent: 'Hello world',
      pageTitle: null,
      pageUrl: 'https://example.com',
      tools: [],
    });

    const options = mockCompleteSimple.mock.calls[0]?.[2] as { apiKey?: string };
    expect(options.apiKey).toBe('sk-openai');
  });

  it('falls back to a synthetic model for unknown custom models when a base url is configured', async () => {
    const home = makeTempHome();
    mockGetModel.mockReturnValueOnce();

    await completeAgentResponse({
      automationEnabled: false,
      env: { HOME: home, OPENAI_API_KEY: 'sk-openai', OPENAI_BASE_URL: 'http://127.0.0.1:1234/v1' },
      messages: [{ content: 'Hi', role: 'user' }],
      modelOverride: 'openai/my-custom-model',
      pageContent: 'Hello world',
      pageTitle: null,
      pageUrl: 'https://example.com',
      tools: [],
    });

    const model = mockCompleteSimple.mock.calls[0]?.[0] as {
      id: string;
      provider: string;
      api: string;
      baseUrl?: string;
    };
    const options = mockCompleteSimple.mock.calls[0]?.[2] as { apiKey?: string };
    expect(model.id).toBe('my-custom-model');
    expect(model.provider).toBe('openai');
    expect(model.api).toBe('openai-completions');
    expect(model.baseUrl).toBe('http://127.0.0.1:1234/v1');
    expect(options.apiKey).toBe('sk-openai');
  });

  it('uses chat completions for known openai models when OPENAI_BASE_URL is custom', async () => {
    const home = makeTempHome();

    await completeAgentResponse({
      automationEnabled: false,
      env: { HOME: home, OPENAI_API_KEY: 'sk-openai', OPENAI_BASE_URL: 'http://127.0.0.1:1234/v1' },
      messages: [{ content: 'Hi', role: 'user' }],
      modelOverride: 'openai/gpt-5-mini',
      pageContent: 'Hello world',
      pageTitle: null,
      pageUrl: 'https://example.com',
      tools: [],
    });

    const model = mockCompleteSimple.mock.calls[0]?.[0] as { api: string; baseUrl?: string };
    expect(model.baseUrl).toBe('http://127.0.0.1:1234/v1');
    expect(model.api).toBe('openai-completions');
  });

  it('uses chat completions for known openai models when config enables them', async () => {
    const home = makeTempHome();
    writeHomeConfig(home, {
      model: { id: 'openai/gpt-5-mini' },
      openai: { useChatCompletions: true },
    });

    await completeAgentResponse({
      automationEnabled: false,
      env: { HOME: home, OPENAI_API_KEY: 'sk-openai' },
      messages: [{ content: 'Hi', role: 'user' }],
      modelOverride: 'openai/gpt-5-mini',
      pageContent: 'Hello world',
      pageTitle: null,
      pageUrl: 'https://example.com',
      tools: [],
    });

    const model = mockCompleteSimple.mock.calls[0]?.[0] as { api: string };
    expect(model.api).toBe('openai-completions');
  });

  it('throws a helpful error when openrouter key is missing', async () => {
    const home = makeTempHome();
    await expect(
      completeAgentResponse({
        automationEnabled: false,
        env: { HOME: home },
        messages: [{ content: 'Hi', role: 'user' }],
        modelOverride: 'openrouter/openai/gpt-5-mini',
        pageContent: 'Hello world',
        pageTitle: null,
        pageUrl: 'https://example.com',
        tools: [],
      }),
    ).rejects.toThrow(/Missing OPENROUTER_API_KEY/);
  });

  it('includes gist tool definitions when automation is enabled', async () => {
    const home = makeTempHome();
    await completeAgentResponse({
      automationEnabled: true,
      env: { HOME: home, OPENAI_API_KEY: 'sk-openai' },
      messages: [{ content: 'Hi', role: 'user' }],
      modelOverride: 'openai/gpt-5-mini',
      pageContent: 'Hello world',
      pageTitle: null,
      pageUrl: 'https://example.com',
      tools: ['gist'],
    });

    const context = mockCompleteSimple.mock.calls[0]?.[1] as { tools?: Tool[] };
    expect(context.tools?.some((tool) => tool.name === 'gist')).toBe(true);
  });

  it('exposes artifacts tool definitions when automation is enabled', async () => {
    const home = makeTempHome();
    await completeAgentResponse({
      automationEnabled: true,
      env: { HOME: home, OPENAI_API_KEY: 'sk-openai' },
      messages: [{ content: 'Hi', role: 'user' }],
      modelOverride: 'openai/gpt-5-mini',
      pageContent: 'Hello world',
      pageTitle: null,
      pageUrl: 'https://example.com',
      tools: ['artifacts'],
    });

    const context = mockCompleteSimple.mock.calls[0]?.[1] as { tools?: Tool[] };
    const artifacts = context.tools?.find((tool) => tool.name === 'artifacts');
    expect(artifacts).toBeTruthy();
    const properties = (artifacts?.parameters as { properties?: Record<string, unknown> })
      ?.properties;
    const content = properties?.content as { type?: unknown; description?: string } | undefined;
    expect(content?.type).toBe('string');
    expect(content?.description).toMatch(/serialized JSON as a string/i);
  });

  it('navigate tool exposes listTabs and switchToTab parameters', async () => {
    const home = makeTempHome();
    await completeAgentResponse({
      automationEnabled: true,
      env: { HOME: home, OPENAI_API_KEY: 'sk-openai' },
      messages: [{ content: 'Hi', role: 'user' }],
      modelOverride: 'openai/gpt-5-mini',
      pageContent: 'Hello world',
      pageTitle: null,
      pageUrl: 'https://example.com',
      tools: ['navigate'],
    });

    const context = mockCompleteSimple.mock.calls[0]?.[1] as { tools?: Tool[] };
    const navigate = context.tools?.find((tool) => tool.name === 'navigate');
    const properties = (navigate?.parameters as { properties?: Record<string, unknown> })
      ?.properties;
    expect(properties && 'listTabs' in properties).toBe(true);
    expect(properties && 'switchToTab' in properties).toBe(true);
  });

  it('accepts legacy OpenRouter env mapping for auto fallback attempts', async () => {
    const home = makeTempHome();
    const autoSpy = vi
      .spyOn(modelAuto, 'buildAutoModelAttempts')
      .mockReturnValue([
        {
          debug: 'test',
          forceOpenRouter: true,
          llmModelId: 'openai/openai/gpt-5-mini',
          openrouterProviders: null,
          requiredEnv: 'OPENROUTER_API_KEY',
          transport: 'openrouter',
          userModelId: 'openrouter/openai/gpt-5-mini',
        },
      ]);

    try {
      await completeAgentResponse({
        automationEnabled: false,
        env: {
          HOME: home,
          OPENAI_API_KEY: 'sk-openrouter-via-openai',
          OPENAI_BASE_URL: 'https://openrouter.ai/api/v1',
        },
        messages: [{ content: 'Hi', role: 'user' }],
        modelOverride: null,
        pageContent: 'Hello world',
        pageTitle: null,
        pageUrl: 'https://example.com',
        tools: [],
      });

      const options = mockCompleteSimple.mock.calls[0]?.[2] as { apiKey?: string };
      expect(options.apiKey).toBe('sk-openrouter-via-openai');
    } finally {
      autoSpy.mockRestore();
    }
  });

  it('runs fixed CLI agent models through the CLI transport', async () => {
    const home = makeTempHome();

    const assistant = await completeAgentResponse({
      automationEnabled: false,
      env: { HOME: home },
      messages: [{ content: 'Hi', role: 'user' }],
      modelOverride: 'cli/codex/gpt-5.2',
      pageContent: 'Hello world',
      pageTitle: 'Example',
      pageUrl: 'https://example.com',
      tools: [],
    });

    expect(runCliModel).toHaveBeenCalledWith(
      expect.objectContaining({ allowTools: false, model: 'gpt-5.2', provider: 'codex' }),
    );
    const args = vi.mocked(runCliModel).mock.calls[0]?.[0] as { prompt: string };
    expect(args.prompt).toContain('You are Gist Chat, not Claude.');
    expect(args.prompt).toContain('User: Hi');
    expect(mockCompleteSimple).not.toHaveBeenCalled();
    expect(assistant.content).toBe('cli agent');
  });

  it('falls back to CLI auto attempts when no API-key agent model is available', async () => {
    const home = makeTempHome();
    const fakeCodex = makeFakeCliBin('codex');
    const autoSpy = vi
      .spyOn(modelAuto, 'buildAutoModelAttempts')
      .mockReturnValue([
        {
          debug: 'cli fallback',
          forceOpenRouter: false,
          llmModelId: null,
          openrouterProviders: null,
          requiredEnv: 'CLI_CODEX',
          transport: 'cli',
          userModelId: 'cli/codex/gpt-5.2',
        },
      ]);

    try {
      const assistant = await completeAgentResponse({
        automationEnabled: false,
        env: { HOME: home, PATH: fakeCodex.dir },
        messages: [{ content: 'Hi', role: 'user' }],
        modelOverride: null,
        pageContent: 'Hello world',
        pageTitle: null,
        pageUrl: 'https://example.com',
        tools: [],
      });

      expect(runCliModel).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'gpt-5.2', provider: 'codex' }),
      );
      expect(mockCompleteSimple).not.toHaveBeenCalled();
      expect(assistant.content).toBe('cli agent');
    } finally {
      autoSpy.mockRestore();
    }
  });

  it('explains missing env and CLI availability when no auto agent model is usable', async () => {
    const home = makeTempHome();
    const autoSpy = vi.spyOn(modelAuto, 'buildAutoModelAttempts').mockReturnValue([
      {
        debug: 'google first',
        forceOpenRouter: false,
        llmModelId: 'google/gemini-3-flash',
        openrouterProviders: null,
        requiredEnv: 'GEMINI_API_KEY',
        transport: 'native',
        userModelId: 'google/gemini-3-flash',
      },
      {
        debug: 'cli fallback',
        forceOpenRouter: false,
        llmModelId: null,
        openrouterProviders: null,
        requiredEnv: 'CLI_CODEX',
        transport: 'cli',
        userModelId: 'cli/codex/gpt-5.2',
      },
    ]);

    try {
      await expect(
        completeAgentResponse({
          automationEnabled: false,
          env: { HOME: home, PATH: '' },
          messages: [{ content: 'Hi', role: 'user' }],
          modelOverride: null,
          pageContent: 'Hello world',
          pageTitle: null,
          pageUrl: 'https://example.com',
          tools: [],
        }),
      ).rejects.toThrow(
        /No model available for agent\..*Checked: google\/gemini-3-flash, cli\/codex\/gpt-5\.2\..*Missing env: GEMINI_API_KEY\..*CLI unavailable: codex\..*Restart or reinstall the daemon/i,
      );
    } finally {
      autoSpy.mockRestore();
    }
  });
});
