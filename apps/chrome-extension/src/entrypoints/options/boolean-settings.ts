import type { defaultSettings } from '../../lib/settings';
import { createBooleanToggleController } from './toggles';

interface BooleanSettingsState {
  autoSummarize: boolean;
  chatEnabled: boolean;
  automationEnabled: boolean;
  hoverSummaries: boolean;
  summaryTimestamps: boolean;
  slidesParallel: boolean;
  slidesOcrEnabled: boolean;
  extendedLogging: boolean;
  autoCliFallback: boolean;
}

interface ToggleController { render: () => void }

export function createBooleanSettingsRuntime(options: {
  defaults: typeof defaultSettings;
  roots: {
    autoToggleRoot: HTMLElement;
    chatToggleRoot: HTMLElement;
    automationToggleRoot: HTMLElement;
    hoverSummariesToggleRoot: HTMLElement;
    summaryTimestampsToggleRoot: HTMLElement;
    slidesParallelToggleRoot: HTMLElement;
    slidesOcrToggleRoot: HTMLElement;
    extendedLoggingToggleRoot: HTMLElement;
    autoCliFallbackToggleRoot: HTMLElement;
  };
  scheduleAutoSave: (delayMs?: number) => void;
  onAutomationChanged?: () => void;
}) {
  const state: BooleanSettingsState = {
    autoCliFallback: options.defaults.autoCliFallback,
    autoSummarize: options.defaults.autoSummarize,
    automationEnabled: options.defaults.automationEnabled,
    chatEnabled: options.defaults.chatEnabled,
    extendedLogging: options.defaults.extendedLogging,
    hoverSummaries: options.defaults.hoverSummaries,
    slidesOcrEnabled: options.defaults.slidesOcrEnabled,
    slidesParallel: options.defaults.slidesParallel,
    summaryTimestamps: options.defaults.summaryTimestamps,
  };

  const toggles: ToggleController[] = [
    createBooleanToggleController({
      getValue: () => state.autoSummarize,
      id: 'options-auto',
      label: 'Auto-summarize when panel is open',
      root: options.roots.autoToggleRoot,
      scheduleAutoSave: options.scheduleAutoSave,
      setValue: (checked) => {
        state.autoSummarize = checked;
      },
    }),
    createBooleanToggleController({
      getValue: () => state.chatEnabled,
      id: 'options-chat',
      label: 'Enable Chat mode in the side panel',
      root: options.roots.chatToggleRoot,
      scheduleAutoSave: options.scheduleAutoSave,
      setValue: (checked) => {
        state.chatEnabled = checked;
      },
    }),
    createBooleanToggleController({
      afterChange: options.onAutomationChanged,
      getValue: () => state.automationEnabled,
      id: 'options-automation',
      label: 'Enable website automation',
      root: options.roots.automationToggleRoot,
      scheduleAutoSave: options.scheduleAutoSave,
      setValue: (checked) => {
        state.automationEnabled = checked;
      },
    }),
    createBooleanToggleController({
      getValue: () => state.hoverSummaries,
      id: 'options-hover-summaries',
      label: 'Hover summaries (experimental)',
      root: options.roots.hoverSummariesToggleRoot,
      scheduleAutoSave: options.scheduleAutoSave,
      setValue: (checked) => {
        state.hoverSummaries = checked;
      },
    }),
    createBooleanToggleController({
      getValue: () => state.summaryTimestamps,
      id: 'options-summary-timestamps',
      label: 'Summary timestamps (media only)',
      root: options.roots.summaryTimestampsToggleRoot,
      scheduleAutoSave: options.scheduleAutoSave,
      setValue: (checked) => {
        state.summaryTimestamps = checked;
      },
    }),
    createBooleanToggleController({
      getValue: () => state.slidesParallel,
      id: 'options-slides-parallel',
      label: 'Show summary first (parallel slides)',
      root: options.roots.slidesParallelToggleRoot,
      scheduleAutoSave: options.scheduleAutoSave,
      setValue: (checked) => {
        state.slidesParallel = checked;
      },
    }),
    createBooleanToggleController({
      getValue: () => state.slidesOcrEnabled,
      id: 'options-slides-ocr',
      label: 'Enable OCR slide text',
      root: options.roots.slidesOcrToggleRoot,
      scheduleAutoSave: options.scheduleAutoSave,
      setValue: (checked) => {
        state.slidesOcrEnabled = checked;
      },
    }),
    createBooleanToggleController({
      getValue: () => state.extendedLogging,
      id: 'options-extended-logging',
      label: 'Extended logging (send full input/output to daemon logs)',
      root: options.roots.extendedLoggingToggleRoot,
      scheduleAutoSave: options.scheduleAutoSave,
      setValue: (checked) => {
        state.extendedLogging = checked;
      },
    }),
    createBooleanToggleController({
      getValue: () => state.autoCliFallback,
      id: 'options-auto-cli-fallback',
      label: 'Auto CLI fallback for Auto model',
      root: options.roots.autoCliFallbackToggleRoot,
      scheduleAutoSave: options.scheduleAutoSave,
      setValue: (checked) => {
        state.autoCliFallback = checked;
      },
    }),
  ];

  return {
    getState: () => ({ ...state }),
    render: () => {
      for (const toggle of toggles) toggle.render();
    },
    setState: (next: Partial<BooleanSettingsState>) => {
      Object.assign(state, next);
    },
  };
}
