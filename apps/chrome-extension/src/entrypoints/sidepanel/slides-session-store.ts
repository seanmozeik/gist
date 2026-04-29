import type { SlidesLayout } from '../../lib/settings';
import type { RunStart } from './types';

type InputMode = 'page' | 'video';

export interface SlidesSessionState {
  slidesEnabled: boolean;
  slidesParallel: boolean;
  slidesOcrEnabled: boolean;
  inputMode: InputMode;
  inputModeOverride: InputMode | null;
  mediaAvailable: boolean;
  summarizeVideoLabel: string;
  summarizePageWords: number | null;
  summarizeVideoDurationSeconds: number | null;
  slidesBusy: boolean;
  slidesExpanded: boolean;
  slidesLayout: SlidesLayout;
  slidesContextRequestId: number;
  slidesContextPending: boolean;
  slidesContextUrl: string | null;
  slidesSeededSourceId: string | null;
  slidesAppliedRunId: string | null;
  pendingRunForPlannedSlides: RunStart | null;
}

export function createSlidesSessionStore(options: {
  slidesEnabled: boolean;
  slidesParallel: boolean;
  slidesOcrEnabled: boolean;
  slidesLayout: SlidesLayout;
}) {
  const state: SlidesSessionState = {
    inputMode: 'page',
    inputModeOverride: null,
    mediaAvailable: false,
    pendingRunForPlannedSlides: null,
    slidesAppliedRunId: null,
    slidesBusy: false,
    slidesContextPending: false,
    slidesContextRequestId: 0,
    slidesContextUrl: null,
    slidesEnabled: options.slidesEnabled,
    slidesExpanded: true,
    slidesLayout: options.slidesLayout,
    slidesOcrEnabled: options.slidesOcrEnabled,
    slidesParallel: options.slidesParallel,
    slidesSeededSourceId: null,
    summarizePageWords: null,
    summarizeVideoDurationSeconds: null,
    summarizeVideoLabel: 'Video',
  };

  return {
    nextSlidesContextRequestId(): number {
      state.slidesContextRequestId += 1;
      return state.slidesContextRequestId;
    },
    resolveInputMode(): InputMode {
      return state.inputModeOverride ?? state.inputMode;
    },
    state,
  };
}
