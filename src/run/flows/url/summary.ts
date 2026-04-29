import { render as renderMarkdownAnsi } from 'markdansi';

import type { ExtractedLinkContent } from '../../../content/index.js';
import type { RunMetricsReport } from '../../../costs.js';
import { buildExtractFinishLabel, writeFinishLine } from '../../finish-line.js';
import { writeVerbose } from '../../logging.js';
import { prepareMarkdownForTerminal } from '../../markdown.js';
import { isRichTty, markdownRenderWidth, supportsColor } from '../../terminal.js';
import type { UrlExtractionUi } from './extract.js';
import { buildFinishExtras, pickModelForFinishLine } from './summary-finish.js';
import { buildUrlJsonEnv, buildUrlJsonInput } from './summary-json.js';
import { buildUrlPrompt as buildSummaryPrompt } from './summary-prompt.js';
import { resolveUrlSummaryExecution } from './summary-resolution.js';
import { buildSummaryTimestampLimitInstruction } from './summary-timestamps.js';
import type { UrlFlowContext } from './types.js';

async function writeUrlJsonOutput({
  ctx,
  url,
  extracted,
  effectiveMarkdownMode,
  prompt,
  summary,
  llm,
}: {
  ctx: UrlFlowContext;
  url: string;
  extracted: ExtractedLinkContent;
  effectiveMarkdownMode: 'off' | 'auto' | 'llm' | 'readability';
  prompt: string;
  summary: string | null;
  llm: {
    provider: string;
    model: string;
    maxCompletionTokens: number | null;
    strategy: 'single';
  } | null;
}): Promise<RunMetricsReport | null> {
  const { io, flags, model, hooks } = ctx;
  hooks.clearProgressForStdout();
  const finishReport = flags.shouldComputeReport ? await hooks.buildReport() : null;
  const payload = {
    env: buildUrlJsonEnv(model.apiStatus),
    extracted,
    input: {
      ...buildUrlJsonInput({
        effectiveMarkdownMode,
        flags,
        modelLabel: model.requestedModelLabel,
        url,
      }),
    },
    llm,
    metrics: flags.metricsEnabled ? finishReport : null,
    prompt,
    summary,
  };
  io.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  hooks.restoreProgressAfterStdout?.();
  return finishReport;
}

async function writeUrlMetricsFinishLine({
  ctx,
  extracted,
  report,
  transcriptionCostLabel,
  label,
  elapsedLabel,
  model,
  clearProgress,
}: {
  ctx: UrlFlowContext;
  extracted: ExtractedLinkContent;
  report: RunMetricsReport | null;
  transcriptionCostLabel: string | null;
  label: string | null;
  elapsedLabel?: string | null;
  model: string | null;
  clearProgress?: boolean;
}) {
  const { io, flags, hooks } = ctx;
  if (!flags.metricsEnabled || !report) {
    return;
  }
  if (clearProgress) {
    hooks.clearProgressForStdout();
  }
  writeFinishLine({
    color: flags.verboseColor,
    costUsd: null,
    detailed: flags.metricsDetailed,
    elapsedLabel: elapsedLabel ?? null,
    elapsedMs: Date.now() - flags.runStartedAtMs,
    env: io.envForRun,
    extraParts: buildFinishExtras({
      extracted,
      metricsDetailed: flags.metricsDetailed,
      transcriptionCostLabel,
    }),
    label,
    model,
    report,
    stderr: io.stderr,
  });
}

export function buildUrlPrompt({
  extracted,
  outputLanguage,
  lengthArg,
  promptOverride,
  lengthInstruction,
  languageInstruction,
}: {
  extracted: ExtractedLinkContent;
  outputLanguage: UrlFlowContext['flags']['outputLanguage'];
  lengthArg: UrlFlowContext['flags']['lengthArg'];
  promptOverride?: string | null;
  lengthInstruction?: string | null;
  languageInstruction?: string | null;
}): string {
  return buildSummaryPrompt({
    buildSummaryTimestampLimitInstruction,
    extracted,
    languageInstruction,
    lengthArg,
    lengthInstruction,
    outputLanguage,
    promptOverride,
    slides: null,
  });
}

async function outputSummaryFromExtractedContent({
  ctx,
  url,
  extracted,
  extractionUi,
  prompt,
  effectiveMarkdownMode,
  transcriptionCostLabel,
  footerLabel,
  verboseMessage,
}: {
  ctx: UrlFlowContext;
  url: string;
  extracted: ExtractedLinkContent;
  extractionUi: UrlExtractionUi;
  prompt: string;
  effectiveMarkdownMode: 'off' | 'auto' | 'llm' | 'readability';
  transcriptionCostLabel: string | null;
  footerLabel?: string | null;
  verboseMessage?: string | null;
}) {
  const { io, flags, model, hooks } = ctx;

  hooks.clearProgressForStdout();
  const finishModel = pickModelForFinishLine(model.llmCalls, null);

  if (flags.json) {
    const finishReport = await writeUrlJsonOutput({
      ctx,
      effectiveMarkdownMode,
      extracted,
      llm: null,
      prompt,
      summary: extracted.content,
      url,
    });
    await writeUrlMetricsFinishLine({
      clearProgress: true,
      ctx,
      extracted,
      label: extractionUi.finishSourceLabel,
      model: finishModel,
      report: finishReport,
      transcriptionCostLabel,
    });
    return;
  }

  io.stdout.write(`${extracted.content}\n`);
  hooks.restoreProgressAfterStdout?.();
  if (extractionUi.footerParts.length > 0) {
    const footer = footerLabel
      ? [...extractionUi.footerParts, footerLabel]
      : extractionUi.footerParts;
    hooks.writeViaFooter(footer);
  }
  if (verboseMessage && flags.verbose) {
    writeVerbose(io.stderr, flags.verbose, verboseMessage, flags.verboseColor, io.envForRun);
  }
}

export async function outputExtractedUrl({
  ctx,
  url,
  extracted,
  extractionUi,
  prompt,
  effectiveMarkdownMode,
  transcriptionCostLabel,
}: {
  ctx: UrlFlowContext;
  url: string;
  extracted: ExtractedLinkContent;
  extractionUi: UrlExtractionUi;
  prompt: string;
  effectiveMarkdownMode: 'off' | 'auto' | 'llm' | 'readability';
  transcriptionCostLabel: string | null;
}) {
  const { io, flags, model, hooks } = ctx;

  hooks.clearProgressForStdout();
  const finishLabel = buildExtractFinishLabel({
    extracted: { diagnostics: extracted.diagnostics },
    format: flags.format,
    hasMarkdownLlmCall: model.llmCalls.some((call) => true),
    markdownMode: effectiveMarkdownMode,
  });
  const finishModel = pickModelForFinishLine(model.llmCalls, null);

  if (flags.json) {
    const finishReport = await writeUrlJsonOutput({
      ctx,
      effectiveMarkdownMode,
      extracted,
      llm: null,
      prompt,
      summary: null,
      url,
    });
    await writeUrlMetricsFinishLine({
      ctx,
      extracted,
      label: finishLabel,
      model: finishModel,
      report: finishReport,
      transcriptionCostLabel,
    });
    return;
  }

  const extractCandidate =
    flags.transcriptTimestamps &&
    extracted.transcriptTimedText &&
    extracted.transcriptSource &&
    extracted.content.toLowerCase().startsWith('transcript:')
      ? `Transcript:\n${extracted.transcriptTimedText}`
      : extracted.content;

  const renderedExtract =
    flags.format === 'markdown' && !flags.plain && isRichTty(io.stdout)
      ? renderMarkdownAnsi(prepareMarkdownForTerminal(extractCandidate), {
          color: supportsColor(io.stdout, io.envForRun),
          hyperlinks: true,
          width: markdownRenderWidth(io.stdout, io.env),
          wrap: true,
        })
      : extractCandidate;

  if (flags.format === 'markdown' && !flags.plain && isRichTty(io.stdout)) {
    io.stdout.write(`\n${renderedExtract.replace(/^\n+/, '')}`);
  } else {
    io.stdout.write(renderedExtract);
  }
  if (!renderedExtract.endsWith('\n')) {
    io.stdout.write('\n');
  }
  hooks.restoreProgressAfterStdout?.();
  hooks.writeViaFooter(extractionUi.footerParts);
  const report = flags.shouldComputeReport ? await hooks.buildReport() : null;
  await writeUrlMetricsFinishLine({
    clearProgress: true,
    ctx,
    extracted,
    label: finishLabel,
    model: finishModel,
    report,
    transcriptionCostLabel,
  });
}

export async function summarizeExtractedUrl({
  ctx,
  url,
  extracted,
  extractionUi,
  prompt,
  effectiveMarkdownMode,
  transcriptionCostLabel,
  onModelChosen,
}: {
  ctx: UrlFlowContext;
  url: string;
  extracted: ExtractedLinkContent;
  extractionUi: UrlExtractionUi;
  prompt: string;
  effectiveMarkdownMode: 'off' | 'auto' | 'llm' | 'readability';
  transcriptionCostLabel: string | null;
  onModelChosen?: ((modelId: string) => void) | null;
}) {
  const { io, flags, model, cache: cacheState, hooks } = ctx;
  const resolution = await resolveUrlSummaryExecution({
    ctx,
    extracted,
    onModelChosen,
    prompt,
    url,
  });

  if (resolution.kind === 'use-extracted') {
    await outputSummaryFromExtractedContent({
      ctx,
      effectiveMarkdownMode,
      extracted,
      extractionUi,
      footerLabel: resolution.footerLabel,
      prompt,
      transcriptionCostLabel,
      url,
      verboseMessage: resolution.verboseMessage,
    });
    return;
  }
  const {
    normalizedSummary,
    summaryAlreadyPrinted,
    summaryFromCache,
    usedAttempt,
    modelMeta,
    maxOutputTokensForCall,
  } = resolution;

  if (flags.json) {
    const finishReport = await writeUrlJsonOutput({
      ctx,
      effectiveMarkdownMode,
      extracted,
      llm: {
        maxCompletionTokens: maxOutputTokensForCall,
        model: usedAttempt.userModelId,
        provider: modelMeta.provider,
        strategy: 'single',
      },
      prompt,
      summary: normalizedSummary,
      url,
    });
    await writeUrlMetricsFinishLine({
      ctx,
      elapsedLabel: summaryFromCache ? 'Cached' : null,
      extracted,
      label: extractionUi.finishSourceLabel,
      model: usedAttempt.userModelId,
      report: finishReport,
      transcriptionCostLabel,
    });
    return;
  }

  if (!summaryAlreadyPrinted) {
    hooks.clearProgressForStdout();
    const rendered =
      !flags.plain && isRichTty(io.stdout)
        ? renderMarkdownAnsi(prepareMarkdownForTerminal(normalizedSummary), {
            color: supportsColor(io.stdout, io.envForRun),
            hyperlinks: true,
            width: markdownRenderWidth(io.stdout, io.env),
            wrap: true,
          })
        : normalizedSummary;

    if (!flags.plain && isRichTty(io.stdout)) {
      io.stdout.write(`\n${rendered.replace(/^\n+/, '')}`);
    } else {
      if (isRichTty(io.stdout)) {
        io.stdout.write('\n');
      }
      io.stdout.write(rendered.replace(/^\n+/, ''));
    }
    if (!rendered.endsWith('\n')) {
      io.stdout.write('\n');
    }
    hooks.restoreProgressAfterStdout?.();
  }

  const report = flags.shouldComputeReport ? await hooks.buildReport() : null;
  await writeUrlMetricsFinishLine({
    ctx,
    elapsedLabel: summaryFromCache ? 'Cached' : null,
    extracted,
    label: extractionUi.finishSourceLabel,
    model: modelMeta.canonical,
    report,
    transcriptionCostLabel,
  });
}
