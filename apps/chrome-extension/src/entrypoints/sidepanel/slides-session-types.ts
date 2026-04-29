import type { SseSlidesData } from '../../lib/runtime-contracts';
import type { SlideTextMode } from './slides-state';

export type SlideSummarySource = 'summary' | 'slides' | null;

export type SlideLike = SseSlidesData['slides'][number];

export interface SlidesSessionRawState {
  summaryMarkdown: string;
  summarySource: SlideSummarySource;
  textMode: SlideTextMode;
  transcriptTimedText: string | null;
}

export interface SlidesSessionDerivedState {
  descriptions: Map<number, string>;
  summaryByIndex: Map<number, string>;
  titleByIndex: Map<number, string>;
  textMode: SlideTextMode;
  textToggleVisible: boolean;
  transcriptAvailable: boolean;
  ocrAvailable: boolean;
}

export interface SlidesSessionState { raw: SlidesSessionRawState; derived: SlidesSessionDerivedState }

export interface SlidesSessionSummaryOpts {
  preserveIfEmpty?: boolean;
  source?: Exclude<SlideSummarySource, null>;
}

export interface SlidesSessionSnapshot {
  raw: SlidesSessionRawState;
  derived: SlidesSessionDerivedState;
}
