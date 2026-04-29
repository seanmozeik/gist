import type { PanelPhase } from './types';

interface SummaryEmptyStateInput {
  tabTitle: string | null;
  tabUrl: string | null;
  autoSummarize: boolean;
  phase: PanelPhase;
  hasSlides: boolean;
}

export interface SummaryEmptyState { label: string; message: string; detail: string | null }

export function buildSummaryEmptyState(input: SummaryEmptyStateInput): SummaryEmptyState | null {
  if (input.hasSlides) {return null;}

  const subject = input.tabTitle?.trim() || input.tabUrl?.trim() || 'this page';
  if (!input.tabUrl) {
    return { detail: null, label: 'No page', message: 'Open a page to summarize.' };
  }

  if (input.phase === 'connecting' || input.phase === 'streaming' || input.autoSummarize) {
    return { detail: subject, label: 'Loading', message: 'Preparing summary' };
  }

  return { detail: subject, label: 'Ready', message: 'Click Summarize to start.' };
}
