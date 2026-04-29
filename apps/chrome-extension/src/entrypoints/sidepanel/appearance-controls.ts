import { defaultSettings } from '../../lib/settings';
import { applyTheme } from '../../lib/theme';
import { mountCheckbox } from '../../ui/zag-checkbox';
import { mountSidepanelLengthPicker, mountSidepanelPickers } from './pickers';

export function createAppearanceControls(options: {
  autoToggleRoot: HTMLDivElement;
  pickersRoot: HTMLDivElement;
  lengthRoot: HTMLDivElement;
  patchSettings: typeof import('../../lib/settings').patchSettings;
  sendSetAuto: (checked: boolean) => void;
  sendSetLength: (value: string) => void;
  applyTypography: (fontFamily: string, fontSize: number, lineHeight: number) => void;
}) {
  let pickerSettings = {
    fontFamily: defaultSettings.fontFamily,
    length: defaultSettings.length,
    mode: defaultSettings.colorMode,
    scheme: defaultSettings.colorScheme,
  };

  let autoValue = false;

  const updateAutoToggle = () => {
    autoToggle.update({
      checked: autoValue,
      id: 'sidepanel-auto',
      label: 'Auto summarize',
      onCheckedChange: (checked) => {
        autoValue = checked;
        options.sendSetAuto(checked);
      },
    });
  };

  const pickerHandlers = {
    onFontChange: (value: string) => {
      void (async () => {
        const next = await options.patchSettings({ fontFamily: value });
        pickerSettings = { ...pickerSettings, fontFamily: next.fontFamily };
        options.applyTypography(next.fontFamily, next.fontSize, next.lineHeight);
      })();
    },
    onLengthChange: (value: string) => {
      pickerSettings = { ...pickerSettings, length: value };
      options.sendSetLength(value);
    },
    onModeChange: (value: string) => {
      void (async () => {
        const next = await options.patchSettings({ colorMode: value });
        pickerSettings = { ...pickerSettings, scheme: next.colorScheme, mode: next.colorMode };
        applyTheme({ scheme: next.colorScheme, mode: next.colorMode });
      })();
    },
    onSchemeChange: (value: string) => {
      void (async () => {
        const next = await options.patchSettings({ colorScheme: value });
        pickerSettings = { ...pickerSettings, scheme: next.colorScheme, mode: next.colorMode };
        applyTheme({ scheme: next.colorScheme, mode: next.colorMode });
      })();
    },
  };

  const pickers = mountSidepanelPickers(options.pickersRoot, {
    fontFamily: pickerSettings.fontFamily,
    mode: pickerSettings.mode,
    onFontChange: pickerHandlers.onFontChange,
    onModeChange: pickerHandlers.onModeChange,
    onSchemeChange: pickerHandlers.onSchemeChange,
    scheme: pickerSettings.scheme,
  });

  const lengthPicker = mountSidepanelLengthPicker(options.lengthRoot, {
    length: pickerSettings.length,
    onLengthChange: pickerHandlers.onLengthChange,
  });

  const autoToggle = mountCheckbox(options.autoToggleRoot, {
    checked: autoValue,
    id: 'sidepanel-auto',
    label: 'Auto summarize',
    onCheckedChange: (checked) => {
      autoValue = checked;
      options.sendSetAuto(checked);
    },
  });

  return {
    getFontFamily: () => pickerSettings.fontFamily,
    getLengthValue: () => pickerSettings.length,
    initializeFromSettings: (settings: {
      autoSummarize: boolean;
      colorScheme: string;
      colorMode: string;
      fontFamily: string;
      length: string;
      fontSize: number;
      lineHeight: number;
    }) => {
      autoValue = settings.autoSummarize;
      updateAutoToggle();
      pickerSettings = {
        scheme: settings.colorScheme,
        mode: settings.colorMode,
        fontFamily: settings.fontFamily,
        length: settings.length,
      };
      pickers.update({
        scheme: pickerSettings.scheme,
        mode: pickerSettings.mode,
        fontFamily: pickerSettings.fontFamily,
        onSchemeChange: pickerHandlers.onSchemeChange,
        onModeChange: pickerHandlers.onModeChange,
        onFontChange: pickerHandlers.onFontChange,
      });
      lengthPicker.update({
        length: pickerSettings.length,
        onLengthChange: pickerHandlers.onLengthChange,
      });
      options.applyTypography(settings.fontFamily, settings.fontSize, settings.lineHeight);
      applyTheme({ scheme: settings.colorScheme, mode: settings.colorMode });
    },
    setAutoValue: (checked: boolean) => {
      autoValue = checked;
      updateAutoToggle();
    },
    syncLengthFromState: (length: string) => {
      if (pickerSettings.length === length) return false;
      pickerSettings = { ...pickerSettings, length };
      lengthPicker.update({
        length: pickerSettings.length,
        onLengthChange: pickerHandlers.onLengthChange,
      });
      return true;
    },
  };
}
