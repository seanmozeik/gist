import { loadLocalAsset, type InputTarget } from '../content/asset';
import type { RunMetricsReport } from '../costs';
import type { ExecFileFn } from '../markitdown';
import { startSpinner } from '../tty/spinner';
import type { AssetAttachment } from './attachments';
import { MAX_PDF_EXTRACT_BYTES } from './constants';
import { extractAssetContent } from './flows/asset/extract';
import type { AssetExtractContext } from './flows/asset/extract';
import { handleFileInput, isPdfExtension, withUrlAsset } from './flows/asset/input';
import { outputExtractedAsset } from './flows/asset/output';
import type { GistAssetArgs } from './flows/asset/summary';
import { runUrlFlow } from './flows/url/flow';
import { createTempFileFromStdin } from './stdin-temp-file';

export async function executeRunnerInput(options: {
  inputTarget: InputTarget;
  stdin: NodeJS.ReadableStream;
  handleFileInputContext: unknown;
  url: string | null;
  isYoutubeUrl: boolean;
  withUrlAssetContext: unknown;
  extractMode: boolean;
  progressEnabled: boolean;
  renderSpinnerStatus: (label: string, detail?: string) => string;
  renderSpinnerStatusWithModel: (label: string, modelId: string) => string;
  extractAssetContext: AssetExtractContext & { execFileImpl: ExecFileFn };
  outputExtractedAssetContext: {
    io: {
      env: Record<string, string | undefined>;
      envForRun: Record<string, string | undefined>;
      stdout: NodeJS.WritableStream;
      stderr: NodeJS.WritableStream;
    };
    flags: {
      timeoutMs: number;
      preprocessMode: 'off' | 'auto' | 'always';
      format: 'text' | 'markdown';
      plain: boolean;
      json: boolean;
      metricsEnabled: boolean;
      metricsDetailed: boolean;
      shouldComputeReport: boolean;
      runStartedAtMs: number;
      verboseColor: boolean;
    };
    hooks: {
      clearProgressForStdout: () => void;
      restoreProgressAfterStdout?: (() => void) | null;
      buildReport: () => Promise<RunMetricsReport>;
      estimateCostUsd: () => Promise<number | null>;
    };
    apiStatus: {
      openrouterApiKey: string | null;
      ytDlpPath: string | null;
      ytDlpCookiesFromBrowser: string | null;
      localBaseUrl: string | null;
    };
  };
  gistAsset: (args: GistAssetArgs) => Promise<void>;
  runUrlFlowContext: unknown;
}) {
  const {
    inputTarget,
    stdin,
    handleFileInputContext,
    url,
    isYoutubeUrl,
    withUrlAssetContext,
    extractMode,
    progressEnabled,
    renderSpinnerStatus,
    renderSpinnerStatusWithModel,
    extractAssetContext,
    outputExtractedAssetContext,
    gistAsset,
    runUrlFlowContext,
  } = options;

  if (inputTarget.kind === 'stdin') {
    const stdinTempFile = await createTempFileFromStdin({ stream: stdin });
    try {
      const stdinInputTarget = { filePath: stdinTempFile.filePath, kind: 'file' as const };
      if (await handleFileInput(handleFileInputContext as never, stdinInputTarget)) {
        return;
      }
      throw new Error('Failed to process stdin input');
    } finally {
      await stdinTempFile.cleanup();
    }
  }

  // Handle --extract for local PDF files (markitdown path, no LLM needed)
  if (extractMode && inputTarget.kind === 'file' && isPdfExtension(inputTarget.filePath)) {
    const spinner = startSpinner({
      color: undefined,
      enabled: progressEnabled,
      stream: outputExtractedAssetContext.io.stderr,
      text: renderSpinnerStatus('Loading file'),
    });
    try {
      const loaded = await loadLocalAsset({
        filePath: inputTarget.filePath,
        maxBytes: MAX_PDF_EXTRACT_BYTES,
      });
      if (progressEnabled) {
        spinner.setText(renderSpinnerStatus('Extracting text'));
      }
      const extracted = await extractAssetContent({
        attachment: loaded.attachment,
        ctx: extractAssetContext,
      });
      spinner.stopAndClear();
      await outputExtractedAsset({
        ...outputExtractedAssetContext,
        attachment: loaded.attachment,
        extracted,
        sourceLabel: loaded.sourceLabel,
        url: inputTarget.filePath,
      });
    } catch (error) {
      spinner.stopAndClear();
      throw error;
    }
    return;
  }

  if (await handleFileInput(handleFileInputContext as never, inputTarget)) {
    return;
  }

  if (
    url &&
    (await withUrlAsset(
      withUrlAssetContext as never,
      url,
      isYoutubeUrl,
      async ({
        loaded,
        spinner,
      }: {
        loaded: { attachment: AssetAttachment; sourceLabel: string };
        spinner: { setText: (text: string) => void };
      }) => {
        if (extractMode) {
          if (progressEnabled) {
            spinner.setText(renderSpinnerStatus('Extracting text'));
          }
          const extracted = await extractAssetContent({
            attachment: loaded.attachment,
            ctx: extractAssetContext,
          });
          await outputExtractedAsset({
            ...outputExtractedAssetContext,
            attachment: loaded.attachment,
            extracted,
            sourceLabel: loaded.sourceLabel,
            url,
          });
          return;
        }

        if (progressEnabled) {
          spinner.setText(renderSpinnerStatus('Gisting'));
        }
        await gistAsset({
          attachment: loaded.attachment,
          onModelChosen: (modelId) => {
            if (!progressEnabled) {
              return;
            }
            spinner.setText(renderSpinnerStatusWithModel('Gisting', modelId));
          },
          sourceKind: 'asset-url',
          sourceLabel: loaded.sourceLabel,
        });
      },
    ))
  ) {
    return;
  }

  if (!url) {
    throw new Error('Only HTTP and HTTPS URLs can be gisted');
  }

  await runUrlFlow({ ctx: runUrlFlowContext as never, isYoutubeUrl, url });
}
