import { loadRemoteAsset } from '../../../content/asset';
import type { ExtractedLinkContent } from '../../../content/index';
import { assertAssetMediaTypeSupported } from '../../attachments';
import { writeVerbose } from '../../logging';
import { deriveExtractionUi, type UrlExtractionUi } from './extract';
import type { UrlFlowContext } from './types';

export type VideoOnlyResult =
  | { handled: true }
  | { handled: false; extracted: ExtractedLinkContent; extractionUi: UrlExtractionUi };

export async function handleVideoOnlyExtractedContent({
  ctx,
  extracted,
  extractionUi,
  isYoutubeUrl,
  fetchWithCache,
  renderStatus,
  renderStatusWithMeta,
  spinner,
  styleDim,
  updateSummaryProgress,
  accent,
}: {
  ctx: UrlFlowContext;
  extracted: ExtractedLinkContent;
  extractionUi: UrlExtractionUi;
  isYoutubeUrl: boolean;
  fetchWithCache: (url: string) => Promise<ExtractedLinkContent>;
  renderStatus: (label: string, detail?: string) => string;
  renderStatusWithMeta: (label: string, meta: string, suffix?: string) => string;
  spinner: { setText: (text: string) => void };
  styleDim: (text: string) => string;
  updateSummaryProgress: () => void;
  accent: (text: string) => string;
}): Promise<VideoOnlyResult> {
  const { io, flags, model, hooks } = ctx;
  if (isYoutubeUrl || !extracted.isVideoOnly || !extracted.video) {
    return { extracted, extractionUi, handled: false };
  }
  if (extracted.video.url.startsWith('file://')) {
    return { extracted, extractionUi, handled: false };
  }

  if (extracted.video.kind === 'youtube') {
    writeVerbose(
      io.stderr,
      flags.verbose,
      `video-only page detected; switching to YouTube URL ${extracted.video.url}`,
      flags.verboseColor,
      io.envForRun,
    );
    if (flags.progressEnabled) {
      spinner.setText(renderStatus('Video-only page', ': fetching YouTube transcript…'));
    }
    const nextExtracted = await fetchWithCache(extracted.video.url);
    return {
      extracted: nextExtracted,
      extractionUi: deriveExtractionUi(nextExtracted),
      handled: false,
    };
  }

  const wantsVideoUnderstanding = flags.videoMode === 'understand' || flags.videoMode === 'auto';
  const canVideoUnderstand =
    wantsVideoUnderstanding &&
    false &&
    (model.requestedModel.kind === 'auto' ||
      (model.fixedModelSpec?.transport === 'native' && false));

  if (!canVideoUnderstand) {
    return { extracted, extractionUi, handled: false };
  }

  hooks.onExtracted?.(extracted);
  if (flags.progressEnabled) {
    spinner.setText(renderStatus('Downloading video'));
  }
  const loadedVideo = await loadRemoteAsset({
    fetchImpl: io.fetch,
    timeoutMs: flags.timeoutMs,
    url: extracted.video.url,
  });
  assertAssetMediaTypeSupported({ attachment: loadedVideo.attachment, sizeLabel: null });

  let chosenModel: string | null = null;
  if (flags.progressEnabled) {
    spinner.setText(renderStatus('Gisting video'));
  }
  await hooks.gistAsset({
    attachment: loadedVideo.attachment,
    onModelChosen: (modelId) => {
      chosenModel = modelId;
      hooks.onModelChosen?.(modelId);
      if (flags.progressEnabled) {
        const meta = `${styleDim('(')}${styleDim('model: ')}${accent(modelId)}${styleDim(')')}`;
        spinner.setText(renderStatusWithMeta('Gisting video', meta));
      }
    },
    sourceKind: 'asset-url',
    sourceLabel: loadedVideo.sourceLabel,
  });
  hooks.writeViaFooter([
    ...extractionUi.footerParts,
    ...(chosenModel ? [`model ${chosenModel}`] : []),
  ]);
  updateSummaryProgress();
  return { handled: true };
}
