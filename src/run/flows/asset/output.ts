import type { RunMetricsReport } from '../../../costs';
import { renderMarkdown as renderFrappeMarkdown } from '../../../tty/frappe';
import type { AssetAttachment } from '../../attachments';
import { buildExtractFinishLabel, writeFinishLine } from '../../finish-line';
import { prepareMarkdownForTerminal } from '../../markdown';
import { isRichTty, markdownRenderWidth } from '../../terminal';
import type { AssetExtractResult } from './extract';

export async function outputExtractedAsset({
  io,
  flags,
  hooks,
  url,
  sourceLabel,
  attachment,
  extracted,
  apiStatus,
}: {
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
  url: string;
  sourceLabel: string;
  attachment: AssetAttachment;
  extracted: AssetExtractResult;
  apiStatus: {
    openrouterApiKey: string | null;
    ytDlpPath: string | null;
    ytDlpCookiesFromBrowser: string | null;
    localBaseUrl: string | null;
  };
}): Promise<void> {
  hooks.clearProgressForStdout();
  const finishLabel = buildExtractFinishLabel({
    extracted: { diagnostics: extracted.diagnostics },
    format: flags.format,
    hasMarkdownLlmCall: false,
    markdownMode: 'off',
  });

  if (flags.json) {
    const finishReport = flags.shouldComputeReport ? await hooks.buildReport() : null;
    const payload = {
      env: { hasOpenRouterKey: Boolean(apiStatus.openrouterApiKey) },
      extracted: {
        content: extracted.content,
        filename: attachment.filename,
        kind: 'asset' as const,
        mediaType: attachment.mediaType,
        source: sourceLabel,
      },
      input: {
        format: flags.format,
        kind: 'asset-url' as const,
        preprocess: flags.preprocessMode,
        timeoutMs: flags.timeoutMs,
        url,
      },
      llm: null,
      metrics: flags.metricsEnabled ? finishReport : null,
      prompt: null,
      summary: null,
    };
    io.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    hooks.restoreProgressAfterStdout?.();
    if (flags.metricsEnabled && finishReport) {
      const costUsd = await hooks.estimateCostUsd();
      writeFinishLine({
        color: flags.verboseColor,
        costUsd,
        detailed: flags.metricsDetailed,
        elapsedMs: Date.now() - flags.runStartedAtMs,
        env: io.envForRun,
        extraParts: null,
        label: finishLabel,
        model: null,
        report: finishReport,
        stderr: io.stderr,
      });
    }
    return;
  }

  const rendered =
    flags.format === 'markdown' && !flags.plain && isRichTty(io.stdout)
      ? renderFrappeMarkdown(
          prepareMarkdownForTerminal(extracted.content),
          markdownRenderWidth(io.stdout, io.env),
        )
      : extracted.content;

  if (flags.format === 'markdown' && !flags.plain && isRichTty(io.stdout)) {
    io.stdout.write(`\n${rendered.replace(/^\n+/, '')}`);
  } else {
    io.stdout.write(rendered);
  }
  if (!rendered.endsWith('\n')) {
    io.stdout.write('\n');
  }
  hooks.restoreProgressAfterStdout?.();

  const report = flags.shouldComputeReport ? await hooks.buildReport() : null;
  if (flags.metricsEnabled && report) {
    const costUsd = await hooks.estimateCostUsd();
    writeFinishLine({
      color: flags.verboseColor,
      costUsd,
      detailed: flags.metricsDetailed,
      elapsedMs: Date.now() - flags.runStartedAtMs,
      env: io.envForRun,
      extraParts: null,
      label: finishLabel,
      model: null,
      report,
      stderr: io.stderr,
    });
  }
}
