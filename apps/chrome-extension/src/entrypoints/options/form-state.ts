import { readPresetOrCustomValue, resolvePresetOrCustom } from '../../lib/combo';
import type { Settings } from '../../lib/settings';
import type { ColorMode, ColorScheme } from '../../lib/theme';
import type { createModelPresetsController } from './model-presets';

interface FormElements {
  tokenEl: HTMLInputElement;
  languagePresetEl: HTMLSelectElement;
  languageCustomEl: HTMLInputElement;
  promptOverrideEl: HTMLTextAreaElement;
  hoverPromptEl: HTMLTextAreaElement;
  autoCliOrderEl: HTMLInputElement;
  maxCharsEl: HTMLInputElement;
  requestModeEl: HTMLSelectElement;
  firecrawlModeEl: HTMLSelectElement;
  markdownModeEl: HTMLSelectElement;
  preprocessModeEl: HTMLSelectElement;
  youtubeModeEl: HTMLSelectElement;
  transcriberEl: HTMLSelectElement;
  timeoutEl: HTMLInputElement;
  retriesEl: HTMLInputElement;
  maxOutputTokensEl: HTMLInputElement;
  fontFamilyEl: HTMLInputElement;
  fontSizeEl: HTMLInputElement;
}

interface BooleanFormState {
  autoSummarize: boolean;
  hoverSummaries: boolean;
  chatEnabled: boolean;
  automationEnabled: boolean;
  slidesParallel: boolean;
  slidesOcrEnabled: boolean;
  summaryTimestamps: boolean;
  extendedLogging: boolean;
  autoCliFallback: boolean;
}

export function buildSavedOptionsSettings({
  current,
  defaults,
  elements,
  modelPresets,
  booleans,
  currentScheme,
  currentMode,
}: {
  current: Settings;
  defaults: Settings;
  elements: FormElements;
  modelPresets: ReturnType<typeof createModelPresetsController>;
  booleans: BooleanFormState;
  currentScheme: ColorScheme;
  currentMode: ColorMode;
}): Settings {
  return {
    autoCliFallback: booleans.autoCliFallback,
    autoCliOrder: elements.autoCliOrderEl.value || defaults.autoCliOrder,
    autoSummarize: booleans.autoSummarize,
    automationEnabled: booleans.automationEnabled,
    chatEnabled: booleans.chatEnabled,
    colorMode: currentMode || defaults.colorMode,
    colorScheme: currentScheme || defaults.colorScheme,
    extendedLogging: booleans.extendedLogging,
    firecrawlMode: elements.firecrawlModeEl.value || defaults.firecrawlMode,
    fontFamily: elements.fontFamilyEl.value || defaults.fontFamily,
    fontSize: Number(elements.fontSizeEl.value) || defaults.fontSize,
    hoverPrompt: elements.hoverPromptEl.value || defaults.hoverPrompt,
    hoverSummaries: booleans.hoverSummaries,
    language: readPresetOrCustomValue({
      presetValue: elements.languagePresetEl.value,
      customValue: elements.languageCustomEl.value,
      defaultValue: defaults.language,
    }),
    length: current.length,
    lineHeight: current.lineHeight,
    markdownMode: elements.markdownModeEl.value || defaults.markdownMode,
    maxChars: Number(elements.maxCharsEl.value) || defaults.maxChars,
    maxOutputTokens: elements.maxOutputTokensEl.value || defaults.maxOutputTokens,
    model: modelPresets.readCurrentValue(),
    preprocessMode: elements.preprocessModeEl.value || defaults.preprocessMode,
    promptOverride: elements.promptOverrideEl.value || defaults.promptOverride,
    requestMode: elements.requestModeEl.value || defaults.requestMode,
    retries: (() => {
      const raw = elements.retriesEl.value.trim();
      if (!raw) return defaults.retries;
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? parsed : defaults.retries;
    })(),
    slidesEnabled: current.slidesEnabled,
    slidesLayout: current.slidesLayout,
    slidesOcrEnabled: booleans.slidesOcrEnabled,
    slidesParallel: booleans.slidesParallel,
    summaryTimestamps: booleans.summaryTimestamps,
    timeout: elements.timeoutEl.value || defaults.timeout,
    token: elements.tokenEl.value || defaults.token,
    transcriber: elements.transcriberEl.value || defaults.transcriber,
    youtubeMode: elements.youtubeModeEl.value || defaults.youtubeMode,
  };
}

export function applyLoadedOptionsSettings({
  settings,
  defaults,
  languagePresets,
  elements,
}: {
  settings: Settings;
  defaults: Settings;
  languagePresets: string[];
  elements: FormElements;
}) {
  elements.tokenEl.value = settings.token;
  {
    const resolved = resolvePresetOrCustom({ presets: languagePresets, value: settings.language });
    elements.languagePresetEl.value = resolved.presetValue;
    elements.languageCustomEl.hidden = !resolved.isCustom;
    elements.languageCustomEl.value = resolved.customValue;
  }
  elements.promptOverrideEl.value = settings.promptOverride;
  elements.hoverPromptEl.value = settings.hoverPrompt || defaults.hoverPrompt;
  elements.autoCliOrderEl.value = settings.autoCliOrder;
  elements.maxCharsEl.value = String(settings.maxChars);
  elements.requestModeEl.value = settings.requestMode;
  elements.firecrawlModeEl.value = settings.firecrawlMode;
  elements.markdownModeEl.value = settings.markdownMode;
  elements.preprocessModeEl.value = settings.preprocessMode;
  elements.youtubeModeEl.value = settings.youtubeMode;
  elements.transcriberEl.value = settings.transcriber;
  elements.timeoutEl.value = settings.timeout;
  elements.retriesEl.value = typeof settings.retries === 'number' ? String(settings.retries) : '';
  elements.maxOutputTokensEl.value = settings.maxOutputTokens;
  elements.fontFamilyEl.value = settings.fontFamily;
  elements.fontSizeEl.value = String(settings.fontSize);

  return {
    booleans: {
      autoCliFallback: settings.autoCliFallback,
      autoSummarize: settings.autoSummarize,
      automationEnabled: settings.automationEnabled,
      chatEnabled: settings.chatEnabled,
      extendedLogging: settings.extendedLogging,
      hoverSummaries: settings.hoverSummaries,
      slidesOcrEnabled: settings.slidesOcrEnabled,
      slidesParallel: settings.slidesParallel,
      summaryTimestamps: settings.summaryTimestamps,
    },
    colorMode: settings.colorMode,
    colorScheme: settings.colorScheme,
  };
}
