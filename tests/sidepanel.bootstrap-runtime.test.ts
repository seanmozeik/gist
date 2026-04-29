import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const bindingSpies = vi.hoisted(() => ({
  bindSettingsStorage: vi.fn(),
  bindSidepanelLifecycle: vi.fn(),
}));

vi.mock('../apps/chrome-extension/src/entrypoints/sidepanel/bindings', () => ({
  bindSettingsStorage: bindingSpies.bindSettingsStorage,
  bindSidepanelLifecycle: bindingSpies.bindSidepanelLifecycle,
}));

import { bootstrapSidepanel } from '../apps/chrome-extension/src/entrypoints/sidepanel/bootstrap-runtime';

describe('sidepanel bootstrap runtime', () => {
  beforeEach(() => {
    bindingSpies.bindSettingsStorage.mockReset();
    bindingSpies.bindSidepanelLifecycle.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('hydrates settings, binds lifecycle, and pings', async () => {
    const calls: string[] = [];
    const loadedSettings = {
      autoSummarize: true,
      automationEnabled: false,
      chatEnabled: false,
      fontFamily: 'IBM Plex Sans',
      fontSize: 16,
      lineHeight: 1.6,
      model: 'openai/gpt-5.4',
      slidesLayout: 'gallery',
      token: '',
    };

    bootstrapSidepanel({
      appearanceControls: {
        initializeFromSettings: (settings) => calls.push(`init:${settings.model}`),
        setAutoValue: (value) => calls.push(`appearance-auto:${value}`),
      },
      applyChatEnabled: () => calls.push('apply-chat'),
      applySlidesLayout: () => calls.push('apply-layout'),
      bindSettingsStorage: { getSettingsHydrated: () => true } as never,
      bindSidepanelLifecycle: { sendReady: () => {} } as never,
      clearPendingSettingsSnapshot: () => {
        calls.push('clear-pending');
      },
      ensurePanelPort: async () => {
        calls.push('ensure');
      },
      getPendingSettingsSnapshot: () => ({ chatEnabled: true }),
      hideAutomationNotice: () => calls.push('hide-automation'),
      loadSettings: async () => loadedSettings,
      renderMarkdownDisplay: () => calls.push('render'),
      scheduleAutoKick: () => calls.push('auto-kick'),
      sendPing: () => calls.push('ping'),
      sendReady: () => calls.push('ready'),
      setAutoValue: (value) => calls.push(`auto:${value}`),
      setAutomationEnabledValue: (value) => calls.push(`automation:${value}`),
      setChatEnabledValue: (value) => calls.push(`chat:${value}`),
      setDefaultModelPresets: () => calls.push('defaults'),
      setModelPlaceholderFromDiscovery: () => calls.push('placeholder'),
      setModelRefreshDisabled: (value) => calls.push(`model-disabled:${value}`),
      setModelValue: (value) => calls.push(`model:${value}`),
      setSettingsHydrated: (value) => {
        calls.push(`hydrated:${value}`);
      },
      setSlidesLayoutInputValue: (value) => calls.push(`layout-input:${value}`),
      setSlidesLayoutValue: (value) => calls.push(`layout:${value}`),
      toggleDrawerClosed: () => calls.push('drawer'),
      typographyController: {
        setCurrentFontSize: (value) => calls.push(`font:${value}`),
        setCurrentLineHeight: (value) => calls.push(`line:${value}`),
      },
      updateModelRowUI: () => calls.push('model-row'),
    });

    await vi.advanceTimersByTimeAsync(25_000);

    expect(bindingSpies.bindSettingsStorage).toHaveBeenCalledTimes(1);
    expect(bindingSpies.bindSidepanelLifecycle).toHaveBeenCalledTimes(1);
    expect(calls).toContain('hide-automation');
    expect(calls).toContain('model-disabled:true');
    expect(calls).toContain('chat:true');
    expect(calls).toContain('ready');
    expect(calls).toContain('ping');
  });

  it('uses loaded settings directly when there is no pending snapshot', async () => {
    const calls: string[] = [];

    bootstrapSidepanel({
      appearanceControls: {
        initializeFromSettings: (settings) => calls.push(`init:${settings.slidesLayout}`),
        setAutoValue: (value) => calls.push(`appearance-auto:${value}`),
      },
      applyChatEnabled: () => calls.push('apply-chat'),
      applySlidesLayout: () => calls.push('apply-layout'),
      bindSettingsStorage: { getSettingsHydrated: () => true } as never,
      bindSidepanelLifecycle: { sendReady: () => {} } as never,
      clearPendingSettingsSnapshot: () => {
        calls.push('clear-pending');
      },
      ensurePanelPort: async () => {
        calls.push('ensure');
      },
      getPendingSettingsSnapshot: () => null,
      hideAutomationNotice: () => calls.push('hide-automation'),
      loadSettings: async () => ({
        autoSummarize: false,
        chatEnabled: true,
        automationEnabled: true,
        slidesLayout: 'strip',
        fontSize: 14,
        lineHeight: 1.4,
        fontFamily: 'Skolar',
        model: 'openai/gpt-5.4',
        token: 'abc123',
      }),
      renderMarkdownDisplay: () => calls.push('render'),
      scheduleAutoKick: () => calls.push('auto-kick'),
      sendPing: () => calls.push('ping'),
      sendReady: () => calls.push('ready'),
      setAutoValue: (value) => calls.push(`auto:${value}`),
      setAutomationEnabledValue: (value) => calls.push(`automation:${value}`),
      setChatEnabledValue: (value) => calls.push(`chat:${value}`),
      setDefaultModelPresets: () => calls.push('defaults'),
      setModelPlaceholderFromDiscovery: () => calls.push('placeholder'),
      setModelRefreshDisabled: (value) => calls.push(`model-disabled:${value}`),
      setModelValue: (value) => calls.push(`model:${value}`),
      setSettingsHydrated: (value) => {
        calls.push(`hydrated:${value}`);
      },
      setSlidesLayoutInputValue: (value) => calls.push(`layout-input:${value}`),
      setSlidesLayoutValue: (value) => calls.push(`layout:${value}`),
      toggleDrawerClosed: () => calls.push('drawer'),
      typographyController: {
        setCurrentFontSize: (value) => calls.push(`font:${value}`),
        setCurrentLineHeight: (value) => calls.push(`line:${value}`),
      },
      updateModelRowUI: () => calls.push('model-row'),
    });

    await vi.advanceTimersByTimeAsync(25_000);

    expect(calls).not.toContain('hide-automation');
    expect(calls).toContain('model-disabled:false');
    expect(calls).toContain('chat:true');
    expect(calls).toContain('layout:strip');
  });
});
