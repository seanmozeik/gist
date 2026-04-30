import { beforeEach, describe, expect, it, vi } from 'vitest';

const extractAssetContent = vi.hoisted(() => vi.fn());
const handleFileInput = vi.hoisted(() => vi.fn());
const withUrlAsset = vi.hoisted(() => vi.fn());
const outputExtractedAsset = vi.hoisted(() => vi.fn());
const runUrlFlow = vi.hoisted(() => vi.fn());
const createTempFileFromStdin = vi.hoisted(() => vi.fn());

vi.mock('../src/run/flows/asset/extract', () => ({ extractAssetContent }));
vi.mock('../src/run/flows/asset/input', () => ({ handleFileInput, withUrlAsset }));
vi.mock('../src/run/flows/asset/output', () => ({ outputExtractedAsset }));
vi.mock('../src/run/flows/url/flow', () => ({ runUrlFlow }));
vi.mock('../src/run/stdin-temp-file', () => ({ createTempFileFromStdin }));

import { executeRunnerInput } from '../src/run/runner-execution';

function buildOptions(overrides?: Partial<Parameters<typeof executeRunnerInput>[0]>) {
  return {
    extractAssetContext: {
      env: {},
      envForRun: {},
      execFileImpl: vi.fn() as never,
      preprocessMode: 'auto' as const,
      timeoutMs: 1000,
    },
    extractMode: false,
    gistAsset: vi.fn(async ({ onModelChosen }) => {
      onModelChosen('openai/gpt-5.4');
    }),
    handleFileInputContext: {},
    inputTarget: { kind: 'url', url: 'https://example.com' } as never,
    isYoutubeUrl: false,
    outputExtractedAssetContext: {
      apiStatus: {
        anthropicConfigured: false,
        apiKey: null,
        apifyToken: null,
        firecrawlConfigured: false,
        googleConfigured: false,
        openrouterApiKey: null,
        xaiApiKey: null,
      },
      flags: {
        format: 'markdown' as const,
        json: false,
        metricsDetailed: false,
        metricsEnabled: false,
        plain: false,
        preprocessMode: 'auto' as const,
        runStartedAtMs: 0,
        shouldComputeReport: false,
        timeoutMs: 1000,
        verboseColor: false,
      },
      hooks: {
        buildReport: vi.fn(async () => ({}) as never),
        clearProgressForStdout: vi.fn(),
        estimateCostUsd: vi.fn(async () => 0),
        restoreProgressAfterStdout: null,
      },
      io: { env: {}, envForRun: {}, stderr: process.stderr, stdout: process.stdout },
    },
    progressEnabled: true,
    renderSpinnerStatus: (label: string) => label,
    renderSpinnerStatusWithModel: (label: string, modelId: string) => `${label}:${modelId}`,
    runUrlFlowContext: {},
    slidesEnabled: false,
    stdin: process.stdin,
    url: 'https://example.com',
    withUrlAssetContext: {},
    ...overrides,
  };
}

describe('runner execution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handles stdin via a temp file and cleans up', async () => {
    const cleanup = vi.fn(async () => {
      /* Empty */
    });
    createTempFileFromStdin.mockResolvedValue({ cleanup, filePath: '/tmp/stdin.txt' });
    handleFileInput.mockResolvedValueOnce(true);

    await executeRunnerInput(buildOptions({ inputTarget: { kind: 'stdin' } as never }));

    expect(handleFileInput).toHaveBeenCalledWith({}, { filePath: '/tmp/stdin.txt', kind: 'file' });
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('throws when stdin conversion still cannot be handled', async () => {
    const cleanup = vi.fn(async () => {
      /* Empty */
    });
    createTempFileFromStdin.mockResolvedValue({ cleanup, filePath: '/tmp/stdin.txt' });
    handleFileInput.mockResolvedValueOnce(false);

    await expect(
      executeRunnerInput(buildOptions({ inputTarget: { kind: 'stdin' } as never })),
    ).rejects.toThrow('Failed to process stdin input');
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('extracts asset urls through outputExtractedAsset', async () => {
    handleFileInput.mockResolvedValue(false);
    extractAssetContent.mockResolvedValue({ content: 'body', diagnostics: {} });
    withUrlAsset.mockImplementation(async (_ctx, _url, _isYoutube, fn) => {
      await fn({
        loaded: {
          attachment: { filename: 'index.html', kind: 'file', mediaType: 'text/html' },
          sourceLabel: 'Example',
        },
        spinner: { setText: vi.fn() },
      });
      return true;
    });

    await executeRunnerInput(buildOptions({ extractMode: true }));

    expect(extractAssetContent).toHaveBeenCalledTimes(1);
    expect(outputExtractedAsset).toHaveBeenCalledTimes(1);
    expect(runUrlFlow).not.toHaveBeenCalled();
  });

  it('gists asset urls and updates spinner with model name', async () => {
    const spinner = { setText: vi.fn() };
    handleFileInput.mockResolvedValue(false);
    withUrlAsset.mockImplementation(async (_ctx, _url, _isYoutube, fn) => {
      await fn({
        loaded: {
          attachment: { filename: 'index.html', kind: 'file', mediaType: 'text/html' },
          sourceLabel: 'Example',
        },
        spinner,
      });
      return true;
    });

    await executeRunnerInput(buildOptions());

    expect(spinner.setText).toHaveBeenCalledWith('Gisting');
    expect(spinner.setText).toHaveBeenCalledWith('Gisting:openai/gpt-5.4');
    expect(runUrlFlow).not.toHaveBeenCalled();
  });

  it('falls through to URL flow or throws for missing url', async () => {
    handleFileInput.mockResolvedValue(false);
    withUrlAsset.mockResolvedValue(false);

    await executeRunnerInput(buildOptions());
    expect(runUrlFlow).toHaveBeenCalledWith({
      ctx: {},
      isYoutubeUrl: false,
      url: 'https://example.com',
    });

    await expect(executeRunnerInput(buildOptions({ url: null }))).rejects.toThrow(
      'Only HTTP and HTTPS URLs can be gisted',
    );
  });

  it('routes local media files through URL flow when slides are enabled', async () => {
    await executeRunnerInput(
      buildOptions({
        inputTarget: { filePath: '/tmp/video.webm', kind: 'file' } as never,
        slidesEnabled: true,
        url: null,
      }),
    );

    expect(handleFileInput).not.toHaveBeenCalled();
    expect(runUrlFlow).toHaveBeenCalledWith({
      ctx: {},
      isYoutubeUrl: false,
      url: 'file:///tmp/video.webm',
    });
  });

  it('routes direct media URLs through URL flow when slides are enabled', async () => {
    await executeRunnerInput(
      buildOptions({
        inputTarget: { kind: 'url', url: 'https://cdn.example.com/video.mp4' } as never,
        slidesEnabled: true,
        url: 'https://cdn.example.com/video.mp4',
      }),
    );

    expect(withUrlAsset).not.toHaveBeenCalled();
    expect(runUrlFlow).toHaveBeenCalledWith({
      ctx: {},
      isYoutubeUrl: false,
      url: 'https://cdn.example.com/video.mp4',
    });
  });
});
