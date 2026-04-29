import type { SseSlidesData } from '../../lib/runtime-contracts';
import { parseTranscriptTimedText } from '../../lib/slides-text';
import {
  buildSlideDescriptions,
  deriveSlideSummaries,
  resolveSlidesTextState,
  type SlideTextMode,
} from './slides-state';

type SlideSummarySource = 'summary' | 'slides' | null;

export function createSlidesTextController(options: {
  getSlides: () => SseSlidesData['slides'] | null | undefined;
  getLengthValue: () => string;
  getSlidesOcrEnabled: () => boolean;
}) {
  let slidesTextMode: SlideTextMode = 'transcript';
  let slidesTextToggleVisible = false;
  let slidesTranscriptTimedText: string | null = null;
  let slidesTranscriptAvailable = false;
  let slidesOcrAvailable = false;
  let slideDescriptions = new Map<number, string>();
  let slideSummaryByIndex = new Map<number, string>();
  let slideTitleByIndex = new Map<number, string>();
  let slideSummarySource: SlideSummarySource = null;

  const getSlides = () => options.getSlides() ?? [];

  const rebuildDescriptions = () => {
    slideDescriptions = new Map();
    const slides = getSlides();
    if (slides.length === 0) {return;}
    slideDescriptions = buildSlideDescriptions({
      lengthValue: options.getLengthValue(),
      slideSummaries: slideSummaryByIndex,
      slides,
      slidesOcrAvailable,
      slidesOcrEnabled: options.getSlidesOcrEnabled(),
      slidesTextMode,
      slidesTranscriptAvailable,
      transcriptTimedText: slidesTranscriptTimedText,
    });
  };

  return {
    clearSummarySource() {
      slideSummarySource = null;
    },
    getDescriptionEntries: () => Array.from(slideDescriptions.entries()),
    getDescriptions: () => slideDescriptions,
    getOcrAvailable: () => slidesOcrAvailable,
    getSummaryEntries: () => Array.from(slideSummaryByIndex.entries()),
    getTextMode: () => slidesTextMode,
    getTextToggleVisible: () => slidesTextToggleVisible,
    getTitles: () => slideTitleByIndex,
    getTranscriptAvailable: () => slidesTranscriptAvailable,
    getTranscriptTimedText: () => slidesTranscriptTimedText,
    hasSummaryTitles: () => slideTitleByIndex.size > 0,
    rebuildDescriptions,
    reset() {
      slidesTextMode = 'transcript';
      slidesTextToggleVisible = false;
      slidesTranscriptTimedText = null;
      slidesTranscriptAvailable = false;
      slidesOcrAvailable = false;
      slideDescriptions = new Map();
      slideSummaryByIndex = new Map();
      slideTitleByIndex = new Map();
      slideSummarySource = null;
    },
    setTextMode(next: SlideTextMode) {
      if (next === slidesTextMode) return false;
      if (next === 'ocr' && !slidesOcrAvailable) return false;
      slidesTextMode = next;
      rebuildDescriptions();
      return true;
    },
    setTranscriptTimedText(value: string | null) {
      slidesTranscriptTimedText = value ?? null;
      slidesTranscriptAvailable = parseTranscriptTimedText(slidesTranscriptTimedText).length > 0;
    },
    syncTextState() {
      const nextState = resolveSlidesTextState({
        slides: getSlides(),
        slidesOcrEnabled: options.getSlidesOcrEnabled(),
        slidesTranscriptAvailable,
        currentMode: slidesTextMode,
      });
      slidesOcrAvailable = nextState.slidesOcrAvailable;
      slidesTextToggleVisible = nextState.slidesTextToggleVisible;
      slidesTextMode = nextState.slidesTextMode;
      rebuildDescriptions();
    },
    updateSummaryFromMarkdown(
      markdown: string,
      opts?: { preserveIfEmpty?: boolean; source?: Exclude<SlideSummarySource, null> },
    ) {
      const source = opts?.source ?? 'summary';
      if (source === 'summary' && slideSummarySource === 'slides') return false;
      const derived = deriveSlideSummaries({
        markdown,
        slides: getSlides(),
        transcriptTimedText: slidesTranscriptTimedText,
        lengthValue: options.getLengthValue(),
      });
      if (!derived) {
        if (opts?.preserveIfEmpty) return false;
        slideSummaryByIndex = new Map();
        slideTitleByIndex = new Map();
        if (source === 'slides') {
          slideSummarySource = null;
        } else if (!slideSummarySource) {
          slideSummarySource = 'summary';
        }
        rebuildDescriptions();
        return true;
      }
      slideSummaryByIndex = derived.summaries;
      slideTitleByIndex = derived.titles;
      slideSummarySource = source;
      rebuildDescriptions();
      return true;
    },
  };
}
