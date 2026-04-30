import type { OscProgressController } from '../../../tty/osc-progress.js';
import { applySummaryText, createUrlProgressStatusState } from './progress-status-state.js';

export function createUrlProgressStatus({
  enabled,
  spinner,
  oscProgress,
}: {
  enabled: boolean;
  spinner: { setText: (text: string) => void; refresh?: () => void };
  oscProgress: OscProgressController;
}) {
  const state = createUrlProgressStatusState();

  const render = (text: string | null) => {
    if (!enabled || !text) {
      return;
    }
    spinner.setText(text);
  };
  const refresh = () => {
    if (!enabled) {
      return;
    }
    spinner.refresh?.();
  };

  return {
    getSummaryText() {
      return state.summaryText;
    },
    setSummary(text: string, oscLabel?: string | null) {
      render(applySummaryText(state, text).renderText);
      if (oscLabel) {
        oscProgress.setIndeterminate(oscLabel);
        refresh();
      }
    },
  };
}
