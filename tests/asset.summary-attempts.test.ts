import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  buildAutoModelAttempts: vi.fn(),
  buildPathSummaryPrompt: vi.fn(() => 'prompt'),
  ensureCliAttachmentPath: vi.fn(async () => '/tmp/assets/file.png'),
  parseCliUserModelId: vi.fn((value: string) => ({ model: value, provider: 'gemini' })),
}));

vi.mock('../src/model-auto.js', () => ({ buildAutoModelAttempts: mocks.buildAutoModelAttempts }));
vi.mock('../src/prompts/index.js', () => ({
  buildPathSummaryPrompt: mocks.buildPathSummaryPrompt,
}));
vi.mock('../src/run/attachments.js', () => ({
  ensureCliAttachmentPath: mocks.ensureCliAttachmentPath,
}));
vi.mock('../src/run/env.js', () => ({ parseCliUserModelId: mocks.parseCliUserModelId }));

import {
  buildAssetCliContext,
  buildAssetModelAttempts,
} from '../src/run/flows/asset/summary-attempts.js';

function createContext(overrides: Record<string, unknown> = {}) {
  return {
    allowAutoCliFallback: true,
    apiStatus: {
      nvidiaApiKey: 'nv-key',
      nvidiaBaseUrl: 'https://nvidia',
      zaiApiKey: 'zai-key',
      zaiBaseUrl: 'https://z.ai',
    },
    cliAvailability: { gemini: true },
    configForModelSelection: null,
    desiredOutputTokens: 800,
    envForAuto: { OPENAI_API_KEY: 'x' },
    fixedModelSpec: null,
    getLiteLlmCatalog: vi.fn(async () => ({ catalog: [] })),
    isFallbackModel: true,
    isImplicitAutoSelection: true,
    languageInstruction: null,
    lengthInstruction: null,
    outputLanguage: { kind: 'auto' },
    promptOverride: null,
    summaryEngine: {
      applyOpenAiGatewayOverrides: vi.fn((attempt) => ({ ...attempt, gatewayWrapped: true })),
    },
    ...overrides,
  };
}

describe('asset summary attempts', () => {
  it('maps fallback auto attempts for native and cli transports', async () => {
    mocks.buildAutoModelAttempts.mockReturnValueOnce([
      {
        forceOpenRouter: false,
        llmModelId: 'gpt-5.4',
        openrouterProviders: null,
        requiredEnv: 'OPENAI_API_KEY',
        transport: 'native',
        userModelId: 'openai/gpt-5.4',
      },
      {
        forceOpenRouter: false,
        llmModelId: null,
        openrouterProviders: null,
        requiredEnv: null,
        transport: 'cli',
        userModelId: 'gemini/gemini-3-flash',
      },
    ]);
    mocks.parseCliUserModelId.mockReturnValueOnce({ model: 'gemini-3-flash', provider: 'gemini' });

    const ctx = createContext();
    const attempts = await buildAssetModelAttempts({
      ctx: ctx as never,
      kind: 'file',
      lastSuccessfulCliProvider: 'gemini',
      promptTokensForAuto: 1200,
      requiresVideoUnderstanding: false,
    });

    expect(mocks.buildAutoModelAttempts).toHaveBeenCalled();
    expect(ctx.summaryEngine.applyOpenAiGatewayOverrides).toHaveBeenCalledTimes(1);
    expect(attempts[0]).toMatchObject({ gatewayWrapped: true, userModelId: 'openai/gpt-5.4' });
    expect(attempts[1]).toMatchObject({
      cliModel: 'gemini-3-flash',
      cliProvider: 'gemini',
      transport: 'cli',
    });
  });

  it('throws when a fixed spec is required but missing', async () => {
    await expect(
      buildAssetModelAttempts({
        ctx: createContext({ fixedModelSpec: null, isFallbackModel: false }) as never,
        kind: 'file',
        lastSuccessfulCliProvider: null,
        promptTokensForAuto: null,
        requiresVideoUnderstanding: false,
      }),
    ).rejects.toThrow('Internal error: missing fixed model spec');
  });

  it('returns fixed cli attempts directly', async () => {
    const attempts = await buildAssetModelAttempts({
      ctx: createContext({
        fixedModelSpec: {
          cliModel: 'gemini-3-flash',
          cliProvider: 'gemini',
          requiredEnv: 'GEMINI_API_KEY',
          transport: 'cli',
          userModelId: 'gemini/gemini-3-flash',
        },
        isFallbackModel: false,
      }) as never,
      kind: 'image',
      lastSuccessfulCliProvider: null,
      promptTokensForAuto: null,
      requiresVideoUnderstanding: false,
    });

    expect(attempts).toEqual([
      {
        cliModel: 'gemini-3-flash',
        cliProvider: 'gemini',
        forceOpenRouter: false,
        llmModelId: null,
        openrouterProviders: null,
        requiredEnv: 'GEMINI_API_KEY',
        transport: 'cli',
        userModelId: 'gemini/gemini-3-flash',
      },
    ]);
  });

  it('adds gateway overrides for fixed Z.ai and NVIDIA specs', async () => {
    const zaiAttempts = await buildAssetModelAttempts({
      ctx: createContext({
        fixedModelSpec: {
          forceOpenRouter: false,
          llmModelId: 'gpt-oss',
          openrouterProviders: null,
          requiredEnv: 'Z_AI_API_KEY',
          transport: 'native',
          userModelId: 'openai/gpt-oss',
        },
        isFallbackModel: false,
      }) as never,
      kind: 'file',
      lastSuccessfulCliProvider: null,
      promptTokensForAuto: null,
      requiresVideoUnderstanding: false,
    });
    expect(zaiAttempts[0]).toMatchObject({
      forceChatCompletions: true,
      openaiApiKeyOverride: 'zai-key',
      openaiBaseUrlOverride: 'https://z.ai',
    });

    const nvidiaAttempts = await buildAssetModelAttempts({
      ctx: createContext({
        fixedModelSpec: {
          forceOpenRouter: false,
          llmModelId: 'llama',
          openrouterProviders: null,
          requiredEnv: 'NVIDIA_API_KEY',
          transport: 'native',
          userModelId: 'openai/llama',
        },
        isFallbackModel: false,
      }) as never,
      kind: 'file',
      lastSuccessfulCliProvider: null,
      promptTokensForAuto: null,
      requiresVideoUnderstanding: false,
    });
    expect(nvidiaAttempts[0]).toMatchObject({
      forceChatCompletions: true,
      openaiApiKeyOverride: 'nv-key',
      openaiBaseUrlOverride: 'https://nvidia',
    });
  });

  it('returns null cli context when cli transport or attachments are not eligible', async () => {
    const ctx = createContext();
    const baseArgs = {
      attachment: {
        bytes: new Uint8Array([1]),
        filename: 'file.txt',
        kind: 'text',
        mediaType: 'text/plain',
      },
      sourceKind: 'file',
      sourceLabel: '/tmp/file.txt',
    };

    await expect(
      buildAssetCliContext({
        args: baseArgs as never,
        attachmentsCount: 1,
        attempts: [{ transport: 'native' }] as never,
        ctx: ctx as never,
        summaryLengthTarget: { maxCharacters: 500 },
      }),
    ).resolves.toBeNull();
    await expect(
      buildAssetCliContext({
        args: baseArgs as never,
        attachmentsCount: 0,
        attempts: [{ transport: 'cli' }] as never,
        ctx: ctx as never,
        summaryLengthTarget: { maxCharacters: 500 },
      }),
    ).resolves.toBeNull();
    await expect(
      buildAssetCliContext({
        args: baseArgs as never,
        attachmentsCount: 1,
        attempts: [{ transport: 'cli' }] as never,
        ctx: ctx as never,
        summaryLengthTarget: { maxCharacters: 500 },
      }),
    ).resolves.toBeNull();
  });

  it('builds image cli context with provider-specific extra args', async () => {
    const ctx = createContext({
      languageInstruction: 'German',
      lengthInstruction: 'Short',
      promptOverride: 'Override',
    });

    const result = await buildAssetCliContext({
      args: {
        attachment: {
          bytes: new Uint8Array([1]),
          filename: 'file.png',
          kind: 'image',
          mediaType: 'image/png',
        },
        sourceKind: 'file',
        sourceLabel: '/tmp/file.png',
      } as never,
      attachmentsCount: 1,
      attempts: [{ transport: 'cli' }] as never,
      ctx: ctx as never,
      summaryLengthTarget: { maxCharacters: 900 },
    });

    expect(mocks.ensureCliAttachmentPath).toHaveBeenCalled();
    expect(mocks.buildPathSummaryPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: '/tmp/assets/file.png',
        kindLabel: 'image',
        outputLanguage: { kind: 'auto' },
      }),
    );
    expect(result).toEqual({
      allowTools: true,
      cwd: '/tmp/assets',
      extraArgsByProvider: {
        codex: ['-i', '/tmp/assets/file.png'],
        gemini: ['--include-directories', '/tmp/assets'],
        opencode: ['--file', '/tmp/assets/file.png'],
      },
      promptOverride: 'prompt',
    });
  });

  it('omits codex image args for non-image file attachments', async () => {
    const result = await buildAssetCliContext({
      args: {
        attachment: {
          bytes: new Uint8Array([1]),
          filename: 'file.pdf',
          kind: 'file',
          mediaType: 'application/pdf',
        },
        sourceKind: 'file',
        sourceLabel: '/tmp/file.pdf',
      } as never,
      attachmentsCount: 1,
      attempts: [{ transport: 'cli' }] as never,
      ctx: createContext() as never,
      summaryLengthTarget: { maxCharacters: 900 },
    });

    expect(result?.extraArgsByProvider).toEqual({
      codex: undefined,
      gemini: ['--include-directories', '/tmp/assets'],
      opencode: ['--file', '/tmp/assets/file.png'],
    });
  });
});
