import type { ExtractedLinkContent } from '../../../content/index.js';
import type { SummaryLength } from '../../../shared/contracts.js';
import type { SlideExtractionResult, SlideImage, SlideSourceKind } from '../../../slides/index.js';
import {
  createThemeRenderer,
  resolveThemeNameFromSources,
  resolveTrueColor,
} from '../../../tty/theme.js';
import { createSlidesInlineRenderer } from '../../slides-render.js';
import type { StreamOutputMode } from '../../stream-output.js';
import type { SummaryStreamHandler } from '../../summary-engine.js';
import { isRichTty, supportsColor } from '../../terminal.js';
import {
  createInlineSlidesUnsupportedNotifier,
  createSlidesTerminalRenderer,
} from './slides-output-render.js';
import { createSlideOutputState } from './slides-output-state.js';
import { createSlidesSummaryStreamHandler } from './slides-output-stream.js';
export { createSlidesSummaryStreamHandler } from './slides-output-stream.js';

export interface SlidesTerminalOutput {
  onSlidesExtracted: (slides: SlideExtractionResult) => void;
  onSlidesDone: (result: { ok: boolean; error?: string | null }) => void;
  onSlideChunk: (chunk: {
    slide: SlideImage;
    meta: {
      slidesDir: string;
      sourceUrl: string;
      sourceId: string;
      sourceKind: SlideSourceKind;
      ocrAvailable: boolean;
    };
  }) => void;
  streamHandler: SummaryStreamHandler;
  renderFromText: (summary: string) => Promise<void>;
}

export function createSlidesTerminalOutput({
  io,
  flags,
  extracted,
  slides,
  enabled,
  outputMode,
  clearProgressForStdout,
  restoreProgressAfterStdout,
  onProgressText,
}: {
  io: {
    env: Record<string, string | undefined>;
    envForRun: Record<string, string | undefined>;
    stdout: NodeJS.WritableStream;
    stderr: NodeJS.WritableStream;
  };
  flags: {
    plain: boolean;
    lengthArg: { kind: 'preset'; preset: SummaryLength } | { kind: 'chars'; maxCharacters: number };
    slidesDebug?: boolean;
  };
  extracted: ExtractedLinkContent;
  slides: SlideExtractionResult | null | undefined;
  enabled: boolean;
  outputMode?: StreamOutputMode | null;
  clearProgressForStdout: () => void;
  restoreProgressAfterStdout?: (() => void) | null;
  onProgressText?: ((text: string) => void) | null;
}): SlidesTerminalOutput | null {
  if (!enabled) {return null;}
  const inlineRenderer = !flags.plain
    ? createSlidesInlineRenderer({ env: io.envForRun, mode: 'auto', stdout: io.stdout })
    : null;
  const inlineProtocol = inlineRenderer?.protocol ?? 'none';
  const inlineEnabled = inlineProtocol !== 'none';
  const inlineNoticeEnabled = !flags.plain && !inlineEnabled;
  const labelTheme = createThemeRenderer({
    enabled: supportsColor(io.stdout, io.envForRun) && !flags.plain,
    themeName: resolveThemeNameFromSources({ env: io.envForRun.SUMMARIZE_THEME }),
    trueColor: resolveTrueColor(io.envForRun),
  });

  const state = createSlideOutputState(slides);
  state.setMeta({ sourceUrl: extracted.url });
  const noteInlineUnsupported = createInlineSlidesUnsupportedNotifier({
    clearProgressForStdout,
    flags,
    inlineNoticeEnabled,
    io: { stderr: io.stderr },
    restoreProgressAfterStdout,
    richTty: isRichTty(io.stdout),
  });

  const onSlidesExtracted = (nextSlides: SlideExtractionResult) => {
    state.updateFromSlides(nextSlides);
    noteInlineUnsupported(nextSlides);
  };

  const onSlideChunk = (chunk: {
    slide: SlideImage;
    meta: { slidesDir: string; sourceUrl: string };
  }) => {
    state.setMeta({ slidesDir: chunk.meta?.slidesDir, sourceUrl: chunk.meta?.sourceUrl });
    state.updateSlideEntry(chunk.slide);
  };

  const onSlidesDone = (_result: { ok: boolean; error?: string | null }) => {
    state.markDone();
  };

  const renderSlide = createSlidesTerminalRenderer({
    clearProgressForStdout,
    flags,
    getOrder: () => state.getOrder(),
    getSlide: (index) => state.getSlide(index),
    getSourceUrl: () => state.getSourceUrl(),
    initialSlides: slides,
    inlineEnabled,
    inlineRenderer,
    io,
    labelTheme,
    onProgressText,
    restoreProgressAfterStdout,
    richTty: isRichTty(io.stdout) && !flags.plain,
    waitForSlide: (index) => state.waitForSlide(index),
  });

  const streamHandler: SummaryStreamHandler = createSlidesSummaryStreamHandler({
    clearProgressForStdout,
    debugWrite:
      io.envForRun.SUMMARIZE_DEBUG_SLIDE_MARKERS &&
      io.envForRun.SUMMARIZE_DEBUG_SLIDE_MARKERS !== '0'
        ? (text: string) => io.stderr.write(text)
        : null,
    env: io.env,
    envForRun: io.envForRun,
    getSlideIndexOrder: () => state.getOrder(),
    getSlideMeta: (index) => {
      const total = state.getOrder().length || (slides?.slides.length ?? 0);
      const slide = state.getSlide(index);
      const timestamp =
        typeof slide?.timestamp === 'number' && Number.isFinite(slide.timestamp)
          ? slide.timestamp
          : null;
      return { total, timestamp };
    },
    outputMode: outputMode ?? 'line',
    plain: flags.plain,
    renderSlide,
    restoreProgressAfterStdout,
    stdout: io.stdout,
  });

  const renderFromText = async (text: string) => {
    await streamHandler.onChunk({ appended: text, prevStreamed: '', streamed: text });
    await streamHandler.onDone?.(text);
  };

  return { onSlideChunk, onSlidesDone, onSlidesExtracted, renderFromText, streamHandler };
}
