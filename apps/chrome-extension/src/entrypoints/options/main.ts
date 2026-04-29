import { defaultSettings, loadSettings, saveSettings } from '../../lib/settings';
import { applyTheme, type ColorMode, type ColorScheme } from '../../lib/theme';
import { bindOptionsInputs } from './bindings';
import { createBooleanSettingsRuntime } from './boolean-settings';
import { languagePresets, optionsTabStorageKey } from './constants';
import { createDaemonStatusChecker } from './daemon-status';
import { getOptionsElements } from './elements';
import { applyLoadedOptionsSettings, buildSavedOptionsSettings } from './form-state';
import { createLogsViewer } from './logs-viewer';
import { createModelPresetsController } from './model-presets';
import { createOptionsSaveRuntime } from './persistence';
import { mountOptionsPickers } from './pickers';
import { createProcessesViewer } from './processes-viewer';
import { createSkillsController } from './skills-controller';
import {
  applyBuildInfo,
  copyTokenToClipboard,
  createAutomationPermissionsController,
  createStatusController,
} from './support';
import { createOptionsTabs } from './tab-controller';

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

let isInitializing = true;

const logsViewer = createLogsViewer({
  elements: {
    autoEl: logsAutoEl,
    levelInputs: logsLevelInputs,
    metaEl: logsMetaEl,
    outputEl: logsOutputEl,
    parsedEl: logsParsedEl,
    rawEl: logsRawEl,
    refreshBtn: logsRefreshBtn,
    sourceEl: logsSourceEl,
    tableEl: logsTableEl,
    tailEl: logsTailEl,
  },
  getToken: () => tokenEl.value.trim(),
  isActive: () => resolveActiveTab() === 'logs',
});

const processesViewer = createProcessesViewer({
  elements: {
    autoEl: processesAutoEl,
    limitEl: processesLimitEl,
    logsCopyBtn: processesLogsCopyBtn,
    logsOutputEl: processesLogsOutputEl,
    logsTitleEl: processesLogsTitleEl,
    metaEl: processesMetaEl,
    refreshBtn: processesRefreshBtn,
    showCompletedEl: processesShowCompletedEl,
    streamEl: processesStreamEl,
    tableEl: processesTableEl,
    tailEl: processesTailEl,
  },
  getToken: () => tokenEl.value.trim(),
  isActive: () => resolveActiveTab() === 'processes',
});

const { resolveActiveTab } = createOptionsTabs({
  buttons: tabButtons,
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
  panels: tabPanels,
  root: tabsRoot,
  storageKey: optionsTabStorageKey,
});

const { setStatus, flashStatus } = createStatusController(statusEl);
let booleanSettings: ReturnType<typeof createBooleanSettingsRuntime> | null = null;
const settingsElements = {
  autoCliOrderEl,
  firecrawlModeEl,
  fontFamilyEl,
  fontSizeEl,
  hoverPromptEl,
  languageCustomEl,
  languagePresetEl,
  markdownModeEl,
  maxCharsEl,
  maxOutputTokensEl,
  preprocessModeEl,
  promptOverrideEl,
  requestModeEl,
  retriesEl,
  timeoutEl,
  tokenEl,
  transcriberEl,
  youtubeModeEl,
};

const { saveNow, scheduleAutoSave } = createOptionsSaveRuntime({
  flashStatus,
  isInitializing: () => isInitializing,
  persist: async () => {
    const current = await loadSettings();
    await saveSettings(
      buildSavedOptionsSettings({
        current,
        defaults: defaultSettings,
        elements: settingsElements,
        modelPresets,
        booleans: booleanSettings?.getState() ?? {
          autoSummarize: defaultSettings.autoSummarize,
          chatEnabled: defaultSettings.chatEnabled,
          automationEnabled: defaultSettings.automationEnabled,
          hoverSummaries: defaultSettings.hoverSummaries,
          summaryTimestamps: defaultSettings.summaryTimestamps,
          slidesParallel: defaultSettings.slidesParallel,
          slidesOcrEnabled: defaultSettings.slidesOcrEnabled,
          extendedLogging: defaultSettings.extendedLogging,
          autoCliFallback: defaultSettings.autoCliFallback,
        },
        currentScheme,
        currentMode,
      }),
    );
  },
  setStatus,
});

booleanSettings = createBooleanSettingsRuntime({
  defaults: defaultSettings,
  onAutomationChanged: () => {
    void automationPermissions.updateUi();
  },
  roots: {
    autoCliFallbackToggleRoot,
    autoToggleRoot,
    automationToggleRoot,
    chatToggleRoot,
    extendedLoggingToggleRoot,
    hoverSummariesToggleRoot,
    slidesOcrToggleRoot,
    slidesParallelToggleRoot,
    summaryTimestampsToggleRoot,
  },
  scheduleAutoSave,
});

const skillsController = createSkillsController({
  elements: {
    conflictsEl: skillsConflictsEl,
    emptyEl: skillsEmptyEl,
    exportBtn: skillsExportBtn,
    importBtn: skillsImportBtn,
    listEl: skillsListEl,
    searchEl: skillsSearchEl,
  },
  flashStatus,
  setStatus,
});

const resolveExtensionVersion = () => {
  const injected =
    typeof __SUMMARIZE_VERSION__ === 'string' && __SUMMARIZE_VERSION__ ? __SUMMARIZE_VERSION__ : '';
  return injected || chrome?.runtime?.getManifest?.().version || '';
};

const { checkDaemonStatus } = createDaemonStatusChecker({
  getExtensionVersion: resolveExtensionVersion,
  statusEl: daemonStatusEl,
});

const modelPresets = createModelPresetsController({
  customEl: modelCustomEl,
  defaultValue: defaultSettings.model,
  presetEl: modelPresetEl,
});

let currentScheme: ColorScheme = defaultSettings.colorScheme;
let currentMode: ColorMode = defaultSettings.colorMode;

const pickerHandlers = {
  onModeChange: (value: ColorMode) => {
    currentMode = value;
    applyTheme({ scheme: currentScheme, mode: currentMode });
    scheduleAutoSave(200);
  },
  onSchemeChange: (value: ColorScheme) => {
    currentScheme = value;
    applyTheme({ scheme: currentScheme, mode: currentMode });
    scheduleAutoSave(200);
  },
};

const pickers = mountOptionsPickers(pickersRoot, {
  mode: currentMode,
  scheme: currentScheme,
  ...pickerHandlers,
});

const automationPermissions = createAutomationPermissionsController({
  automationPermissionsBtn,
  flashStatus,
  getAutomationEnabled: () => booleanSettings.getState().automationEnabled,
  userScriptsNoticeEl,
});

automationPermissionsBtn.addEventListener('click', () => {
  void automationPermissions.requestPermissions();
});
skillsController.bind();

async function load() {
  const s = await loadSettings();
  void checkDaemonStatus(s.token);
  await modelPresets.refreshPresets(s.token);
  modelPresets.setValue(s.model);
  const loadedState = applyLoadedOptionsSettings({
    defaults: defaultSettings,
    elements: settingsElements,
    languagePresets,
    settings: s,
  });
  booleanSettings.setState(loadedState.booleans);
  booleanSettings.render();
  currentScheme = loadedState.colorScheme;
  currentMode = loadedState.colorMode;
  pickers.update({ mode: currentMode, scheme: currentScheme, ...pickerHandlers });
  applyTheme({ mode: s.colorMode, scheme: s.colorScheme });
  await skillsController.load();
  await automationPermissions.updateUi();
  if (resolveActiveTab() === 'logs') {
    logsViewer.handleTokenChanged();
  }
  if (resolveActiveTab() === 'processes') {
    processesViewer.handleTokenChanged();
  }
  isInitializing = false;
}

const copyToken = () => copyTokenToClipboard({ flashStatus, tokenEl });

const refreshModelsIfStale = () => {
  modelPresets.refreshIfStale(tokenEl.value);
};

bindOptionsInputs({
  checkDaemonStatus,
  copyToken,
  defaultHoverPrompt: defaultSettings.hoverPrompt,
  elements: {
    autoCliOrderEl,
    firecrawlModeEl,
    fontFamilyEl,
    fontSizeEl,
    formEl,
    hoverPromptEl,
    hoverPromptResetBtn,
    languageCustomEl,
    languagePresetEl,
    logsAutoEl,
    logsLevelInputs,
    logsParsedEl,
    logsSourceEl,
    logsTailEl,
    markdownModeEl,
    maxCharsEl,
    maxOutputTokensEl,
    modelCustomEl,
    modelPresetEl,
    preprocessModeEl,
    promptOverrideEl,
    requestModeEl,
    retriesEl,
    timeoutEl,
    tokenCopyBtn,
    tokenEl,
    transcriberEl,
    youtubeModeEl,
  },
  logsViewer,
  modelPresets,
  processesViewer,
  refreshModelsIfStale,
  saveNow,
  scheduleAutoSave,
});

applyBuildInfo(buildInfoEl, {
  gitHash: typeof __SUMMARIZE_GIT_HASH__ === 'string' ? __SUMMARIZE_GIT_HASH__ : '',
  injectedVersion:
    typeof __SUMMARIZE_VERSION__ === 'string' && __SUMMARIZE_VERSION__ ? __SUMMARIZE_VERSION__ : '',
  manifestVersion: chrome?.runtime?.getManifest?.().version ?? '',
});
void load();
