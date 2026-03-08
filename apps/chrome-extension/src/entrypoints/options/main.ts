import { defaultSettings, loadSettings, saveSettings } from "../../lib/settings";
import { applyTheme, type ColorMode, type ColorScheme } from "../../lib/theme";
import { bindOptionsInputs } from "./bindings";
import { createDaemonStatusChecker } from "./daemon-status";
import { getOptionsElements } from "./elements";
import { applyLoadedOptionsSettings, buildSavedOptionsSettings } from "./form-state";
import { createLogsViewer } from "./logs-viewer";
import { createModelPresetsController } from "./model-presets";
import { createOptionsSaveRuntime } from "./persistence";
import { mountOptionsPickers } from "./pickers";
import { createProcessesViewer } from "./processes-viewer";
import { createSkillsController } from "./skills-controller";
import {
  applyBuildInfo,
  copyTokenToClipboard,
  createAutomationPermissionsController,
  createStatusController,
} from "./support";
import { createOptionsTabs } from "./tab-controller";
import { createBooleanToggleController } from "./toggles";

declare const __SUMMARIZE_GIT_HASH__: string;
declare const __SUMMARIZE_VERSION__: string;

const {
  formEl,
  statusEl,
  tokenEl,
  tokenCopyBtn,
  modelPresetEl,
  modelCustomEl,
  languagePresetEl,
  languageCustomEl,
  promptOverrideEl,
  autoToggleRoot,
  maxCharsEl,
  hoverPromptEl,
  hoverPromptResetBtn,
  chatToggleRoot,
  automationToggleRoot,
  automationPermissionsBtn,
  userScriptsNoticeEl,
  skillsExportBtn,
  skillsImportBtn,
  skillsSearchEl,
  skillsListEl,
  skillsEmptyEl,
  skillsConflictsEl,
  hoverSummariesToggleRoot,
  summaryTimestampsToggleRoot,
  slidesParallelToggleRoot,
  slidesOcrToggleRoot,
  extendedLoggingToggleRoot,
  autoCliFallbackToggleRoot,
  autoCliOrderEl,
  requestModeEl,
  firecrawlModeEl,
  markdownModeEl,
  preprocessModeEl,
  youtubeModeEl,
  transcriberEl,
  timeoutEl,
  retriesEl,
  maxOutputTokensEl,
  pickersRoot,
  fontFamilyEl,
  fontSizeEl,
  buildInfoEl,
  daemonStatusEl,
  logsSourceEl,
  logsTailEl,
  logsRefreshBtn,
  logsAutoEl,
  logsOutputEl,
  logsRawEl,
  logsTableEl,
  logsParsedEl,
  logsMetaEl,
  processesRefreshBtn,
  processesAutoEl,
  processesShowCompletedEl,
  processesLimitEl,
  processesStreamEl,
  processesTailEl,
  processesMetaEl,
  processesTableEl,
  processesLogsTitleEl,
  processesLogsCopyBtn,
  processesLogsOutputEl,
  tabsRoot,
  tabButtons,
  tabPanels,
  logsLevelInputs,
} = getOptionsElements();

const tabStorageKey = "summarize:options-tab";

let autoValue = defaultSettings.autoSummarize;
let chatEnabledValue = defaultSettings.chatEnabled;
let automationEnabledValue = defaultSettings.automationEnabled;
let hoverSummariesValue = defaultSettings.hoverSummaries;
let summaryTimestampsValue = defaultSettings.summaryTimestamps;
let slidesParallelValue = defaultSettings.slidesParallel;
let slidesOcrEnabledValue = defaultSettings.slidesOcrEnabled;
let extendedLoggingValue = defaultSettings.extendedLogging;
let autoCliFallbackValue = defaultSettings.autoCliFallback;

let isInitializing = true;

const logsViewer = createLogsViewer({
  elements: {
    sourceEl: logsSourceEl,
    tailEl: logsTailEl,
    refreshBtn: logsRefreshBtn,
    autoEl: logsAutoEl,
    outputEl: logsOutputEl,
    rawEl: logsRawEl,
    tableEl: logsTableEl,
    parsedEl: logsParsedEl,
    metaEl: logsMetaEl,
    levelInputs: logsLevelInputs,
  },
  getToken: () => tokenEl.value.trim(),
  isActive: () => resolveActiveTab() === "logs",
});

const processesViewer = createProcessesViewer({
  elements: {
    refreshBtn: processesRefreshBtn,
    autoEl: processesAutoEl,
    showCompletedEl: processesShowCompletedEl,
    limitEl: processesLimitEl,
    streamEl: processesStreamEl,
    tailEl: processesTailEl,
    metaEl: processesMetaEl,
    tableEl: processesTableEl,
    logsTitleEl: processesLogsTitleEl,
    logsCopyBtn: processesLogsCopyBtn,
    logsOutputEl: processesLogsOutputEl,
  },
  getToken: () => tokenEl.value.trim(),
  isActive: () => resolveActiveTab() === "processes",
});

const { resolveActiveTab } = createOptionsTabs({
  root: tabsRoot,
  buttons: tabButtons,
  panels: tabPanels,
  storageKey: tabStorageKey,
  onLogsActiveChange: (active) => {
    if (active) {
      logsViewer.handleTabActivated();
    } else {
      logsViewer.handleTabDeactivated();
    }
  },
  onProcessesActiveChange: (active) => {
    if (active) {
      processesViewer.handleTabActivated();
    } else {
      processesViewer.handleTabDeactivated();
    }
  },
});

const { setStatus, flashStatus } = createStatusController(statusEl);

const skillsController = createSkillsController({
  elements: {
    searchEl: skillsSearchEl,
    listEl: skillsListEl,
    emptyEl: skillsEmptyEl,
    conflictsEl: skillsConflictsEl,
    exportBtn: skillsExportBtn,
    importBtn: skillsImportBtn,
  },
  setStatus,
  flashStatus,
});
const settingsElements = {
  tokenEl,
  languagePresetEl,
  languageCustomEl,
  promptOverrideEl,
  hoverPromptEl,
  autoCliOrderEl,
  maxCharsEl,
  requestModeEl,
  firecrawlModeEl,
  markdownModeEl,
  preprocessModeEl,
  youtubeModeEl,
  transcriberEl,
  timeoutEl,
  retriesEl,
  maxOutputTokensEl,
  fontFamilyEl,
  fontSizeEl,
};

const { saveNow, scheduleAutoSave } = createOptionsSaveRuntime({
  isInitializing: () => isInitializing,
  setStatus,
  flashStatus,
  persist: async () => {
    const current = await loadSettings();
    await saveSettings(
      buildSavedOptionsSettings({
        current,
        defaults: defaultSettings,
        elements: settingsElements,
        modelPresets,
        booleans: {
          autoSummarize: autoValue,
          hoverSummaries: hoverSummariesValue,
          chatEnabled: chatEnabledValue,
          automationEnabled: automationEnabledValue,
          slidesParallel: slidesParallelValue,
          slidesOcrEnabled: slidesOcrEnabledValue,
          summaryTimestamps: summaryTimestampsValue,
          extendedLogging: extendedLoggingValue,
          autoCliFallback: autoCliFallbackValue,
        },
        currentScheme,
        currentMode,
      }),
    );
  },
});

const resolveExtensionVersion = () => {
  const injected =
    typeof __SUMMARIZE_VERSION__ === "string" && __SUMMARIZE_VERSION__ ? __SUMMARIZE_VERSION__ : "";
  return injected || chrome?.runtime?.getManifest?.().version || "";
};

const { checkDaemonStatus } = createDaemonStatusChecker({
  statusEl: daemonStatusEl,
  getExtensionVersion: resolveExtensionVersion,
});

const modelPresets = createModelPresetsController({
  presetEl: modelPresetEl,
  customEl: modelCustomEl,
  defaultValue: defaultSettings.model,
});

const languagePresets = [
  "auto",
  "en",
  "de",
  "es",
  "fr",
  "it",
  "pt",
  "nl",
  "sv",
  "no",
  "da",
  "fi",
  "pl",
  "cs",
  "tr",
  "ru",
  "uk",
  "ar",
  "hi",
  "ja",
  "ko",
  "zh-cn",
  "zh-tw",
];

let currentScheme: ColorScheme = defaultSettings.colorScheme;
let currentMode: ColorMode = defaultSettings.colorMode;

const pickerHandlers = {
  onSchemeChange: (value: ColorScheme) => {
    currentScheme = value;
    applyTheme({ scheme: currentScheme, mode: currentMode });
    scheduleAutoSave(200);
  },
  onModeChange: (value: ColorMode) => {
    currentMode = value;
    applyTheme({ scheme: currentScheme, mode: currentMode });
    scheduleAutoSave(200);
  },
};

const pickers = mountOptionsPickers(pickersRoot, {
  scheme: currentScheme,
  mode: currentMode,
  ...pickerHandlers,
});

const autoToggle = createBooleanToggleController({
  root: autoToggleRoot,
  id: "options-auto",
  label: "Auto-summarize when panel is open",
  getValue: () => autoValue,
  setValue: (checked) => {
    autoValue = checked;
  },
  scheduleAutoSave,
});

const chatToggle = createBooleanToggleController({
  root: chatToggleRoot,
  id: "options-chat",
  label: "Enable Chat mode in the side panel",
  getValue: () => chatEnabledValue,
  setValue: (checked) => {
    chatEnabledValue = checked;
  },
  scheduleAutoSave,
});

const automationPermissions = createAutomationPermissionsController({
  automationPermissionsBtn,
  userScriptsNoticeEl,
  getAutomationEnabled: () => automationEnabledValue,
  flashStatus,
});

const automationToggle = createBooleanToggleController({
  root: automationToggleRoot,
  id: "options-automation",
  label: "Enable website automation",
  getValue: () => automationEnabledValue,
  setValue: (checked) => {
    automationEnabledValue = checked;
  },
  scheduleAutoSave,
  afterChange: automationPermissions.updateUi,
});

automationPermissionsBtn.addEventListener("click", () => {
  void automationPermissions.requestPermissions();
});
skillsController.bind();

const hoverSummariesToggle = createBooleanToggleController({
  root: hoverSummariesToggleRoot,
  id: "options-hover-summaries",
  label: "Hover summaries (experimental)",
  getValue: () => hoverSummariesValue,
  setValue: (checked) => {
    hoverSummariesValue = checked;
  },
  scheduleAutoSave,
});

const summaryTimestampsToggle = createBooleanToggleController({
  root: summaryTimestampsToggleRoot,
  id: "options-summary-timestamps",
  label: "Summary timestamps (media only)",
  getValue: () => summaryTimestampsValue,
  setValue: (checked) => {
    summaryTimestampsValue = checked;
  },
  scheduleAutoSave,
});

const slidesParallelToggle = createBooleanToggleController({
  root: slidesParallelToggleRoot,
  id: "options-slides-parallel",
  label: "Show summary first (parallel slides)",
  getValue: () => slidesParallelValue,
  setValue: (checked) => {
    slidesParallelValue = checked;
  },
  scheduleAutoSave,
});

const slidesOcrToggle = createBooleanToggleController({
  root: slidesOcrToggleRoot,
  id: "options-slides-ocr",
  label: "Enable OCR slide text",
  getValue: () => slidesOcrEnabledValue,
  setValue: (checked) => {
    slidesOcrEnabledValue = checked;
  },
  scheduleAutoSave,
});

const extendedLoggingToggle = createBooleanToggleController({
  root: extendedLoggingToggleRoot,
  id: "options-extended-logging",
  label: "Extended logging (send full input/output to daemon logs)",
  getValue: () => extendedLoggingValue,
  setValue: (checked) => {
    extendedLoggingValue = checked;
  },
  scheduleAutoSave,
});

const autoCliFallbackToggle = createBooleanToggleController({
  root: autoCliFallbackToggleRoot,
  id: "options-auto-cli-fallback",
  label: "Auto CLI fallback for Auto model",
  getValue: () => autoCliFallbackValue,
  setValue: (checked) => {
    autoCliFallbackValue = checked;
  },
  scheduleAutoSave,
});

async function load() {
  const s = await loadSettings();
  void checkDaemonStatus(s.token);
  await modelPresets.refreshPresets(s.token);
  modelPresets.setValue(s.model);
  const loadedState = applyLoadedOptionsSettings({
    settings: s,
    defaults: defaultSettings,
    languagePresets,
    elements: settingsElements,
  });
  autoValue = loadedState.booleans.autoSummarize;
  chatEnabledValue = loadedState.booleans.chatEnabled;
  automationEnabledValue = loadedState.booleans.automationEnabled;
  hoverSummariesValue = loadedState.booleans.hoverSummaries;
  summaryTimestampsValue = loadedState.booleans.summaryTimestamps;
  slidesParallelValue = loadedState.booleans.slidesParallel;
  slidesOcrEnabledValue = loadedState.booleans.slidesOcrEnabled;
  extendedLoggingValue = loadedState.booleans.extendedLogging;
  autoCliFallbackValue = loadedState.booleans.autoCliFallback;
  autoToggle.render();
  chatToggle.render();
  automationToggle.render();
  hoverSummariesToggle.render();
  summaryTimestampsToggle.render();
  slidesParallelToggle.render();
  slidesOcrToggle.render();
  extendedLoggingToggle.render();
  autoCliFallbackToggle.render();
  currentScheme = loadedState.colorScheme;
  currentMode = loadedState.colorMode;
  pickers.update({ scheme: currentScheme, mode: currentMode, ...pickerHandlers });
  applyTheme({ scheme: s.colorScheme, mode: s.colorMode });
  await skillsController.load();
  await automationPermissions.updateUi();
  if (resolveActiveTab() === "logs") {
    logsViewer.handleTokenChanged();
  }
  if (resolveActiveTab() === "processes") {
    processesViewer.handleTokenChanged();
  }
  isInitializing = false;
}

const copyToken = () => copyTokenToClipboard({ tokenEl, flashStatus });

const refreshModelsIfStale = () => {
  modelPresets.refreshIfStale(tokenEl.value);
};

bindOptionsInputs({
  elements: {
    formEl,
    tokenEl,
    tokenCopyBtn,
    modelPresetEl,
    modelCustomEl,
    languagePresetEl,
    languageCustomEl,
    promptOverrideEl,
    hoverPromptEl,
    hoverPromptResetBtn,
    maxCharsEl,
    requestModeEl,
    firecrawlModeEl,
    markdownModeEl,
    preprocessModeEl,
    youtubeModeEl,
    transcriberEl,
    timeoutEl,
    retriesEl,
    maxOutputTokensEl,
    autoCliOrderEl,
    fontFamilyEl,
    fontSizeEl,
    logsSourceEl,
    logsTailEl,
    logsParsedEl,
    logsAutoEl,
    logsLevelInputs,
  },
  scheduleAutoSave,
  saveNow,
  checkDaemonStatus,
  modelPresets,
  logsViewer,
  processesViewer,
  copyToken,
  refreshModelsIfStale,
  defaultHoverPrompt: defaultSettings.hoverPrompt,
});

applyBuildInfo(buildInfoEl, {
  injectedVersion:
    typeof __SUMMARIZE_VERSION__ === "string" && __SUMMARIZE_VERSION__ ? __SUMMARIZE_VERSION__ : "",
  manifestVersion: chrome?.runtime?.getManifest?.().version ?? "",
  gitHash: typeof __SUMMARIZE_GIT_HASH__ === "string" ? __SUMMARIZE_GIT_HASH__ : "",
});
void load();
