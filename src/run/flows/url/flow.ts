import {
  createThemeRenderer,
  resolveThemeNameFromSources,
  resolveTrueColor,
} from '../../../tty/theme.js';
import { UVX_TIP } from '../../constants';
import { hasUvxCli } from '../../env';
import {
  estimateWhisperTranscriptionCostUsd,
  formatOptionalNumber,
  formatOptionalString,
  formatUSD,
} from '../../format.js';
import { writeVerbose } from '../../logging';
import { deriveExtractionUi, logExtractionDiagnostics } from './extract';
import { createUrlExtractionSession } from './extraction-session';
import { createUrlFlowProgress } from './flow-progress';
import { createMarkdownConverters } from './markdown';
import { buildUrlPrompt, outputExtractedUrl, gistExtractedUrl } from './summary';
import type { UrlFlowContext } from './types';
import { handleVideoOnlyExtractedContent } from './video-only';

export async function runUrlFlow({
  ctx,
  url,
  isYoutubeUrl,
}: {
  ctx: UrlFlowContext;
  url: string;
  isYoutubeUrl: boolean;
}): Promise<void> {
  if (!url) {
    throw new Error('Only HTTP and HTTPS URLs can be gisted');
  }

  const { io, flags, model, hooks } = ctx;
  const theme = createThemeRenderer({
    enabled: flags.verboseColor,
    themeName: resolveThemeNameFromSources({ env: io.envForRun.GIST_THEME }),
    trueColor: resolveTrueColor(io.envForRun),
  });

  const markdown = createMarkdownConverters(ctx, { isYoutubeUrl });

  writeVerbose(
    io.stderr,
    flags.verbose,
    `config url=${url} timeoutMs=${flags.timeoutMs} youtube=${flags.youtubeMode} length=${
      flags.lengthArg.kind === 'preset'
        ? flags.lengthArg.preset
        : `${flags.lengthArg.maxCharacters} chars`
    } maxOutputTokens=${formatOptionalNumber(flags.maxOutputTokensArg)} retries=${flags.retries} json=${flags.json} extract=${flags.extractMode} format=${flags.format} preprocess=${flags.preprocessMode} markdownMode=${flags.markdownMode} model=${model.requestedModelLabel} videoMode=${flags.videoMode} timestamps=${flags.transcriptTimestamps ? 'on' : 'off'} stream=${flags.streamingEnabled ? 'on' : 'off'} plain=${flags.plain}`,
    flags.verboseColor,
    io.envForRun,
  );
  writeVerbose(
    io.stderr,
    flags.verbose,
    `configFile path=${formatOptionalString(flags.configPath)} model=${formatOptionalString(
      flags.configModelLabel,
    )}`,
    flags.verboseColor,
    io.envForRun,
  );
  writeVerbose(
    io.stderr,
    flags.verbose,
    `env openrouterKey=${model.apiStatus.openrouterApiKey ? 'configured' : 'missing'}`,
    flags.verboseColor,
    io.envForRun,
  );
  writeVerbose(
    io.stderr,
    flags.verbose,
    `markdown htmlRequested=${markdown.markdownRequested} transcriptRequested=${markdown.transcriptMarkdownRequested} provider=${markdown.markdownProvider}`,
    flags.verboseColor,
    io.envForRun,
  );

  writeVerbose(io.stderr, flags.verbose, 'extract start', flags.verboseColor, io.envForRun);
  const {
    handleSigint,
    handleSigterm,
    hooks: progressHooks,
    pauseProgress,
    progressStatus,
    renderStatus,
    renderStatusWithMeta,
    spinner,
    stopProgress,
    styleDim,
    styleLabel,
    websiteProgress,
  } = createUrlFlowProgress({ ctx, theme });
  const flowCtx = progressHooks === hooks ? ctx : { ...ctx, hooks: progressHooks };
  const activeHooks = flowCtx.hooks;

  const extractionSession = createUrlExtractionSession({
    ctx: flowCtx,
    markdown: {
      convertHtmlToMarkdown: markdown.convertHtmlToMarkdown,
      effectiveMarkdownMode: markdown.effectiveMarkdownMode,
      markdownRequested: markdown.markdownRequested,
    },
    onProgress:
      websiteProgress || activeHooks.onLinkPreviewProgress
        ? (event) => {
            websiteProgress?.onProgress(event);
            activeHooks.onLinkPreviewProgress?.(event);
          }
        : null,
  });

  const pauseProgressLine = pauseProgress;
  activeHooks.setClearProgressBeforeStdout(pauseProgressLine);
  try {
    let extracted = await extractionSession.fetchInitialExtract(url);
    let extractionUi = deriveExtractionUi(extracted);

    const formatSummaryProgress = (modelId?: string | null) => {
      const dim = (value: string) => theme.dim(value);
      const accent = (value: string) => theme.accent(value);
      const sentLabel = `${dim('sent ')}${extractionUi.contentSizeLabel}${extractionUi.viaSourceLabel}`;
      const modelLabel = modelId ? `${dim('model: ')}${accent(modelId)}` : '';
      const meta = modelLabel ? `${sentLabel}${dim(', ')}${modelLabel}` : sentLabel;
      return `${styleLabel('Gisting')} ${dim('(')}${meta}${dim(')')}${dim('…')}`;
    };

    const updateSummaryProgress = () => {
      if (!flags.progressEnabled) {
        return;
      }
      websiteProgress?.stop?.();
      progressStatus.setSummary(
        flags.extractMode
          ? `${styleLabel('Extracted')}${styleDim(
              ` (${extractionUi.contentSizeLabel}${extractionUi.viaSourceLabel})`,
            )}`
          : formatSummaryProgress(),
        flags.extractMode ? null : 'Gisting',
      );
    };

    updateSummaryProgress();
    logExtractionDiagnostics({
      env: io.envForRun,
      extracted,
      stderr: io.stderr,
      verbose: flags.verbose,
      verboseColor: flags.verboseColor,
    });
    const transcriptCacheStatus = extracted.diagnostics?.transcript?.cacheStatus;
    if (transcriptCacheStatus && transcriptCacheStatus !== 'unknown') {
      writeVerbose(
        io.stderr,
        flags.verbose,
        `cache ${transcriptCacheStatus} transcript`,
        flags.verboseColor,
        io.envForRun,
      );
    }

    if (
      flags.extractMode &&
      markdown.markdownRequested &&
      flags.preprocessMode !== 'off' &&
      markdown.effectiveMarkdownMode === 'auto' &&
      !extracted.diagnostics.markdown.used &&
      !hasUvxCli(io.env)
    ) {
      io.stderr.write(`${UVX_TIP}\n`);
    }

    const videoOnlyResult = await handleVideoOnlyExtractedContent({
      accent: theme.accent,
      ctx,
      extracted,
      extractionUi,
      fetchWithCache: (targetUrl) => extractionSession.fetchWithCache(targetUrl),
      isYoutubeUrl,
      renderStatus,
      renderStatusWithMeta,
      spinner,
      styleDim,
      updateSummaryProgress,
    });
    if (videoOnlyResult.handled) {
      return;
    }
    ({ extracted } = videoOnlyResult);
    ({ extractionUi } = videoOnlyResult);
    updateSummaryProgress();

    activeHooks.onExtracted?.(extracted);

    const prompt = buildUrlPrompt({
      extracted,
      languageInstruction: flags.languageInstruction ?? null,
      lengthArg: flags.lengthArg,
      lengthInstruction: flags.lengthInstruction ?? null,
      outputLanguage: flags.outputLanguage,
      promptOverride: flags.promptOverride ?? null,
    });

    // Whisper transcription costs need to be folded into the finish line totals.
    const transcriptionCostUsd = estimateWhisperTranscriptionCostUsd({
      mediaDurationSeconds: extracted.mediaDurationSeconds,
      openaiWhisperUsdPerMinute: model.openaiWhisperUsdPerMinute,
      transcriptSource: extracted.transcriptSource,
      transcriptionProvider: extracted.transcriptionProvider,
    });
    const transcriptionCostLabel =
      typeof transcriptionCostUsd === 'number' ? `txcost=${formatUSD(transcriptionCostUsd)}` : null;
    activeHooks.setTranscriptionCost(transcriptionCostUsd, transcriptionCostLabel);

    if (flags.extractMode) {
      // Apply transcript→markdown conversion if requested
      let extractedForOutput = extracted;
      if (markdown.transcriptMarkdownRequested && markdown.convertTranscriptToMarkdown) {
        if (flags.progressEnabled) {
          spinner.setText(renderStatus('Converting transcript to markdown'));
        }
        const markdownContent = await markdown.convertTranscriptToMarkdown({
          outputLanguage: flags.outputLanguage,
          source: extracted.siteName,
          timeoutMs: flags.timeoutMs,
          title: extracted.title,
          transcript: extracted.content,
        });
        extractedForOutput = {
          ...extracted,
          content: markdownContent,
          diagnostics: {
            ...extracted.diagnostics,
            markdown: {
              ...extracted.diagnostics.markdown,
              notes: 'transcript',
              provider: 'llm',
              requested: true,
              used: true,
            },
          },
        };
        extractionUi = deriveExtractionUi(extractedForOutput);
      }
      await outputExtractedUrl({
        ctx,
        effectiveMarkdownMode: markdown.effectiveMarkdownMode,
        extracted: extractedForOutput,
        extractionUi,
        prompt,
        transcriptionCostLabel,
        url,
      });
      return;
    }

    const onModelChosen = (modelId: string) => {
      activeHooks.onModelChosen?.(modelId);
      if (!flags.progressEnabled) {
        return;
      }
      progressStatus.setSummary(formatSummaryProgress(modelId), 'Gisting');
    };

    await gistExtractedUrl({
      ctx: flowCtx,
      effectiveMarkdownMode: markdown.effectiveMarkdownMode,
      extracted,
      extractionUi,
      onModelChosen,
      prompt,
      transcriptionCostLabel,
      url,
    });
  } finally {
    if (flags.progressEnabled) {
      process.off('SIGINT', handleSigint);
      process.off('SIGTERM', handleSigterm);
    }
    activeHooks.clearProgressIfCurrent(pauseProgressLine);
    stopProgress();
  }
}
