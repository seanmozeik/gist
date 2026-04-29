import { Writable } from 'node:stream';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ prepareAssetPrompt: vi.fn(), runModelAttempts: vi.fn() }));

vi.mock('../src/run/flows/asset/preprocess.js', () => ({
  prepareAssetPrompt: mocks.prepareAssetPrompt,
}));
vi.mock('../src/run/model-attempts.js', () => ({ runModelAttempts: mocks.runModelAttempts }));

import { summarizeAsset } from '../src/run/flows/asset/summary.js';

const collectStream = () => {
  let text = '';
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      text += chunk.toString();
      callback();
    },
  });
  return { getText: () => text, stream };
};

const createContext = (overrides: Partial<Parameters<typeof summarizeAsset>[0]> = {}) => {
  const stdout = collectStream();
  const stderr = collectStream();
  const writeViaFooter = vi.fn();
  const ctx = {
    allowAutoCliFallback: false,
    apiStatus: {
      anthropicConfigured: false,
      apiKey: null,
      apifyToken: null,
      firecrawlConfigured: false,
      googleConfigured: false,
      nvidiaApiKey: null,
      nvidiaBaseUrl: '',
      openrouterApiKey: null,
      providerBaseUrls: { anthropic: null, google: null, nvidia: null, openai: null, xai: null },
      xaiApiKey: null,
      zaiApiKey: null,
      zaiBaseUrl: '',
    },
    buildReport: async () => ({ calls: 0, durationMs: 0, tokens: 0 }),
    cache: { mode: 'default', store: null },
    clearProgressForStdout: vi.fn(),
    cliAvailability: {},
    configForModelSelection: null,
    desiredOutputTokens: null,
    env: {},
    envForAuto: {},
    envForRun: {},
    estimateCostUsd: async () => null,
    execFileImpl: async () => ({ ok: true, stderr: '', stdout: '' }),
    extractMode: false,
    fixedModelSpec: null,
    forceSummary: false,
    format: 'text' as const,
    getLiteLlmCatalog: async () => ({ catalog: [] }),
    isFallbackModel: true,
    isImplicitAutoSelection: true,
    isNamedModelSelection: false,
    json: false,
    languageInstruction: null,
    lengthArg: { kind: 'preset' as const, preset: 'xl' as const },
    lengthInstruction: null,
    llmCalls: [],
    maxOutputTokensArg: null,
    metricsDetailed: false,
    metricsEnabled: false,
    outputLanguage: { kind: 'auto' as const },
    plain: true,
    preprocessMode: 'off' as const,
    promptOverride: null,
    requestedModel: { kind: 'auto' as const },
    requestedModelInput: 'auto',
    requestedModelLabel: 'auto',
    restoreProgressAfterStdout: vi.fn(),
    runStartedAtMs: Date.now(),
    shouldComputeReport: false,
    stderr: stderr.stream,
    stdout: stdout.stream,
    streamingEnabled: false,
    summaryEngine: { applyOpenAiGatewayOverrides: (attempt) => attempt } as Parameters<
      typeof summarizeAsset
    >[0]['summaryEngine'],
    timeoutMs: 1000,
    trackedFetch: globalThis.fetch.bind(globalThis),
    verbose: false,
    verboseColor: false,
    videoMode: 'auto' as const,
    wantsFreeNamedModel: false,
    writeViaFooter,
  };
  return { ctx: { ...ctx, ...overrides }, stderr, stdout, writeViaFooter };
};

describe('asset summary early branches', () => {
  beforeEach(() => {
    mocks.prepareAssetPrompt.mockReset();
    mocks.runModelAttempts.mockReset();
  });

  it('bypasses short content for auto models', async () => {
    mocks.prepareAssetPrompt.mockResolvedValue({
      assetFooterParts: [],
      attachments: [],
      promptText: 'Prompt',
      textContent: { content: 'Short text.' },
    });

    const { ctx, stdout, writeViaFooter } = createContext();

    await summarizeAsset(ctx, {
      attachment: {
        bytes: new Uint8Array([1]),
        filename: 'note.txt',
        kind: 'file',
        mediaType: 'text/plain',
      },
      sourceKind: 'file',
      sourceLabel: '/tmp/note.txt',
    });

    expect(stdout.getText()).toContain('Short text.');
    expect(writeViaFooter).not.toHaveBeenCalled();
  });

  it('bypasses short content for video attachments', async () => {
    mocks.prepareAssetPrompt.mockResolvedValue({
      assetFooterParts: [],
      attachments: [],
      promptText: 'Prompt',
      textContent: { content: 'Video snippet.' },
    });

    const { ctx, stdout } = createContext({ videoMode: 'auto' });

    await summarizeAsset(ctx, {
      attachment: {
        bytes: new Uint8Array([1]),
        filename: 'clip.mp4',
        kind: 'file',
        mediaType: 'video/mp4',
      },
      sourceKind: 'file',
      sourceLabel: '/tmp/clip.mp4',
    });

    expect(stdout.getText()).toContain('Video snippet.');
  });

  it('bypasses short content for image attachments', async () => {
    mocks.prepareAssetPrompt.mockResolvedValue({
      assetFooterParts: [],
      attachments: [],
      promptText: 'Prompt',
      textContent: { content: 'Image snippet.' },
    });

    const { ctx, stdout } = createContext();

    await summarizeAsset(ctx, {
      attachment: {
        bytes: new Uint8Array([1]),
        filename: 'image.png',
        kind: 'file',
        mediaType: 'image/png',
      },
      sourceKind: 'file',
      sourceLabel: '/tmp/image.png',
    });

    expect(stdout.getText()).toContain('Image snippet.');
  });

  it('skips the model when content fits max output tokens', async () => {
    mocks.prepareAssetPrompt.mockResolvedValue({
      assetFooterParts: ['mock'],
      attachments: [],
      promptText: 'Prompt',
      textContent: { content: 'Hello world' },
    });

    const { ctx, stdout, writeViaFooter } = createContext({
      lengthArg: { kind: 'chars', maxCharacters: 5 },
      maxOutputTokensArg: 500,
    });

    await summarizeAsset(ctx, {
      attachment: {
        bytes: new Uint8Array([1]),
        filename: 'note.txt',
        kind: 'file',
        mediaType: 'text/plain',
      },
      sourceKind: 'file',
      sourceLabel: '/tmp/note.txt',
    });

    expect(stdout.getText()).toContain('Hello world');
    expect(writeViaFooter).toHaveBeenCalledWith(['mock', 'no model']);
  });

  it('renders JSON for asset URLs when model attempts succeed', async () => {
    mocks.prepareAssetPrompt.mockResolvedValue({
      assetFooterParts: [],
      attachments: [],
      promptText: 'Prompt',
      textContent: null,
    });
    mocks.runModelAttempts.mockResolvedValue({
      lastError: null,
      missingRequiredEnvs: new Set(),
      result: {
        maxOutputTokensForCall: null,
        modelMeta: { canonical: 'openai/gpt-5.2', provider: 'openai' },
        summary: 'Model summary.',
        summaryAlreadyPrinted: false,
      },
      sawOpenRouterNoAllowedProviders: false,
      usedAttempt: {
        forceOpenRouter: false,
        llmModelId: 'gpt-5.2',
        openrouterProviders: null,
        requiredEnv: 'OPENAI_API_KEY',
        transport: 'native',
        userModelId: 'openai/gpt-5.2',
      },
    });

    const { ctx, stdout } = createContext({ json: true });

    await summarizeAsset(ctx, {
      attachment: {
        bytes: new Uint8Array([1]),
        filename: 'video.mp4',
        kind: 'file',
        mediaType: 'application/octet-stream',
      },
      sourceKind: 'asset-url',
      sourceLabel: 'https://example.com/video.mp4',
    });

    const payload = JSON.parse(stdout.getText()) as {
      input: { kind: string };
      summary?: string;
      llm?: { provider?: string };
    };
    expect(payload.input.kind).toBe('asset-url');
    expect(payload.summary).toBe('Model summary.');
    expect(payload.llm?.provider).toBe('openai');
  });

  it('writes JSON when short content is bypassed', async () => {
    mocks.prepareAssetPrompt.mockResolvedValue({
      assetFooterParts: [],
      attachments: [],
      promptText: 'Prompt',
      textContent: { content: 'Short text.' },
    });

    const { ctx, stdout } = createContext({ json: true });

    await summarizeAsset(ctx, {
      attachment: {
        bytes: new Uint8Array([1]),
        filename: 'note.txt',
        kind: 'file',
        mediaType: 'text/plain',
      },
      sourceKind: 'file',
      sourceLabel: '/tmp/note.txt',
    });

    const payload = JSON.parse(stdout.getText()) as { summary?: string; llm?: unknown };
    expect(payload.summary).toContain('Short text.');
    expect(payload.llm).toBeNull();
  });

  it('adds via footer when short content includes asset footer parts', async () => {
    mocks.prepareAssetPrompt.mockResolvedValue({
      assetFooterParts: ['mock'],
      attachments: [],
      promptText: 'Prompt',
      textContent: { content: 'Short text.' },
    });

    const { ctx, stdout, writeViaFooter } = createContext();

    await summarizeAsset(ctx, {
      attachment: {
        bytes: new Uint8Array([1]),
        filename: 'note.txt',
        kind: 'file',
        mediaType: 'text/plain',
      },
      sourceKind: 'file',
      sourceLabel: '/tmp/note.txt',
    });

    expect(stdout.getText()).toContain('Short text.');
    expect(writeViaFooter).toHaveBeenCalledWith(['mock', 'short content']);
  });

  it('renders short content with TTY markdown when plain is off', async () => {
    mocks.prepareAssetPrompt.mockResolvedValue({
      assetFooterParts: [],
      attachments: [],
      promptText: 'Prompt',
      textContent: { content: '# Heading' },
    });

    const { ctx } = createContext({ plain: false });
    const out = collectStream();
    (out.stream as unknown as { isTTY?: boolean }).isTTY = true;
    ctx.stdout = out.stream;

    await summarizeAsset(ctx, {
      attachment: {
        bytes: new Uint8Array([1]),
        filename: 'note.txt',
        kind: 'file',
        mediaType: 'text/plain',
      },
      sourceKind: 'file',
      sourceLabel: '/tmp/note.txt',
    });

    expect(out.getText()).toContain('Heading');
  });

  it('emits metrics finish line when enabled', async () => {
    mocks.prepareAssetPrompt.mockResolvedValue({
      assetFooterParts: [],
      attachments: [],
      promptText: 'Prompt',
      textContent: { content: 'Short text.' },
    });

    const { ctx, stderr } = createContext({
      buildReport: async () => ({
        llm: [],
        services: { apify: { requests: 0 }, firecrawl: { requests: 0 } },
      }),
      estimateCostUsd: async () => 0,
      metricsEnabled: true,
      shouldComputeReport: true,
    });

    await summarizeAsset(ctx, {
      attachment: {
        bytes: new Uint8Array([1]),
        filename: 'note.txt',
        kind: 'file',
        mediaType: 'text/plain',
      },
      sourceKind: 'file',
      sourceLabel: '/tmp/note.txt',
    });

    expect(stderr.getText().length).toBeGreaterThan(0);
  });

  it('falls back to content when model attempts fail', async () => {
    mocks.prepareAssetPrompt.mockResolvedValue({
      assetFooterParts: [],
      attachments: [],
      promptText: 'Prompt',
      textContent: { content: 'Fallback content.' },
    });
    mocks.runModelAttempts.mockResolvedValue({
      lastError: null,
      missingRequiredEnvs: new Set(),
      result: null,
      sawOpenRouterNoAllowedProviders: false,
      usedAttempt: null,
    });

    const { ctx, stdout } = createContext({ forceSummary: true });

    await summarizeAsset(ctx, {
      attachment: {
        bytes: new Uint8Array([1]),
        filename: 'note.txt',
        kind: 'file',
        mediaType: 'text/plain',
      },
      sourceKind: 'file',
      sourceLabel: '/tmp/note.txt',
    });

    expect(stdout.getText()).toContain('Fallback content.');
  });
});
