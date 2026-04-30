export interface UrlProgressStatusState {
  summaryText: string | null;
}

export function createUrlProgressStatusState(): UrlProgressStatusState {
  return { summaryText: null };
}

export function applySummaryText(
  state: UrlProgressStatusState,
  text: string,
): { renderText: string | null } {
  state.summaryText = text;
  return { renderText: text };
}
