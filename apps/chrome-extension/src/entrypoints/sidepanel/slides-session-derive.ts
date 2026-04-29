import { parseTranscriptTimedText } from '../../lib/slides-text';
import type {
  SlideLike,
  SlidesSessionDerivedState,
  SlidesSessionRawState,
} from './slides-session-types';
import {
  buildSlideDescriptions,
  deriveSlideSummaries,
  resolveSlidesTextState,
  type SlideTextMode,
} from './slides-state';

export function buildEmptySlidesSessionDerivedState(): SlidesSessionDerivedState {
  return {
    descriptions: new Map(),
    ocrAvailable: false,
    summaryByIndex: new Map(),
    textMode: 'transcript',
    textToggleVisible: false,
    titleByIndex: new Map(),
    transcriptAvailable: false,
  };
}

export function deriveSlidesSessionState({
  raw,
  slides,
  lengthValue,
  slidesOcrEnabled,
}: {
  raw: SlidesSessionRawState;
  slides: SlideLike[];
  lengthValue: string;
  slidesOcrEnabled: boolean;
}): SlidesSessionDerivedState {
  const transcriptAvailable = parseTranscriptTimedText(raw.transcriptTimedText).length > 0;
  const nextTextState = resolveSlidesTextState({
    currentMode: raw.textMode,
    slides,
    slidesOcrEnabled,
    slidesTranscriptAvailable: transcriptAvailable,
  });
  const summaries =
    raw.summaryMarkdown.trim().length > 0
      ? deriveSlideSummaries({
          lengthValue,
          markdown: raw.summaryMarkdown,
          slides,
          transcriptTimedText: raw.transcriptTimedText,
        })
      : null;

  return {
    descriptions: buildSlideDescriptions({
      slides,
      slideSummaries: summaries?.summaries,
      transcriptTimedText: raw.transcriptTimedText,
      lengthValue,
      slidesTextMode: nextTextState.slidesTextMode,
      slidesOcrEnabled,
      slidesOcrAvailable: nextTextState.slidesOcrAvailable,
      slidesTranscriptAvailable: transcriptAvailable,
    }),
    ocrAvailable: nextTextState.slidesOcrAvailable,
    summaryByIndex: summaries?.summaries ?? new Map(),
    textMode: nextTextState.slidesTextMode,
    textToggleVisible: nextTextState.slidesTextToggleVisible,
    titleByIndex: summaries?.titles ?? new Map(),
    transcriptAvailable,
  };
}

export function canSetSlidesSessionTextMode(
  mode: SlideTextMode,
  derived: SlidesSessionDerivedState,
): boolean {
  if (mode !== 'ocr') {return true;}
  return derived.ocrAvailable;
}
