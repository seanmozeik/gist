import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { UiState } from '../apps/chrome-extension/src/entrypoints/sidepanel/types';

const setupViewMocks = vi.hoisted(() => ({
  installStepsHtml: vi.fn(
    ({
      token,
      headline,
      message,
      showTroubleshooting,
    }: {
      token: string;
      headline: string;
      message?: string;
      showTroubleshooting?: boolean;
    }) =>
      `headline=${headline};token=${token};message=${message ?? ''};troubleshooting=${
        showTroubleshooting ? 'yes' : 'no'
      }`,
  ),
  wireSetupButtons: vi.fn(),
}));

vi.mock('../apps/chrome-extension/src/entrypoints/sidepanel/setup-view', () => ({
  installStepsHtml: setupViewMocks.installStepsHtml,
  wireSetupButtons: setupViewMocks.wireSetupButtons,
}));

import {
  createSetupRuntime,
  friendlyFetchError,
} from '../apps/chrome-extension/src/entrypoints/sidepanel/setup-runtime';

function stubNavigator(value: Partial<Navigator> & { userAgentData?: { platform?: string } }) {
  vi.stubGlobal('navigator', value);
}

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function makeUiState(overrides?: Partial<UiState>): UiState {
  return {
    daemon: { authed: true, ok: true },
    media: null,
    panelOpen: true,
    settings: {
      autoGist: true,
      automationEnabled: false,
      chatEnabled: true,
      fontSize: 15,
      hoverSummaries: false,
      length: 'medium',
      lineHeight: 1.6,
      model: 'auto',
      slidesEnabled: true,
      slidesLayout: 'strip',
      slidesOcrEnabled: false,
      slidesParallel: false,
      tokenPresent: true,
    },
    stats: { pageWords: 10, videoDurationSeconds: null },
    status: 'Ready',
    tab: { id: 1, title: 'Example', url: 'https://example.com' },
    ...overrides,
  };
}

function makeSetupEl() {
  return {
    classList: { add: vi.fn(), remove: vi.fn() },
    innerHTML: '',
  } as unknown as HTMLDivElement;
}

describe('sidepanel setup runtime behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    stubNavigator({
      platform: 'MacIntel',
      userAgent: 'Mozilla/5.0',
      userAgentData: { platform: 'macOS' },
    } as Navigator & { userAgentData: { platform: string } });
  });

  it('formats failed fetch guidance with daemon troubleshooting help', () => {
    expect(friendlyFetchError(new Error('Failed to fetch'), 'Connect')).toContain(
      'daemon unreachable or blocked by Chrome',
    );
  });

  it('formats non-fetch errors directly', () => {
    expect(friendlyFetchError(new Error('boom'), 'Connect')).toBe('Connect: boom');
  });

  it('renders setup immediately when the token is missing', async () => {
    const setupEl = makeSetupEl();
    const ensureToken = vi.fn(async () => 'fresh-token');
    const loadToken = vi.fn(async () => 'unused-token');

    const runtime = createSetupRuntime({
      ensureToken,
      generateToken: vi.fn() as never,
      getStatusResetText: vi.fn(() => 'Ready'),
      headerSetStatus: vi.fn(),
      loadToken,
      patchSettings: vi.fn() as never,
      setupEl,
    });

    expect(
      runtime.maybeShowSetup(
        makeUiState({ settings: { ...makeUiState().settings, tokenPresent: false } }),
      ),
    ).toBe(true);

    await flushPromises();

    expect(ensureToken).toHaveBeenCalledOnce();
    expect(setupEl.classList.remove).toHaveBeenCalledWith('hidden');
    expect(setupViewMocks.installStepsHtml).toHaveBeenCalledWith(
      expect.objectContaining({ headline: 'Setup', token: 'fresh-token' }),
    );
    expect(setupViewMocks.wireSetupButtons).toHaveBeenCalledWith(
      expect.objectContaining({ platformKind: 'mac', setupEl, token: 'fresh-token' }),
    );
  });

  it('renders troubleshooting setup when the daemon is not reachable', async () => {
    const setupEl = makeSetupEl();
    const loadToken = vi.fn(async () => 'saved-token');

    const runtime = createSetupRuntime({
      ensureToken: vi.fn(async () => 'unused-token'),
      generateToken: vi.fn() as never,
      getStatusResetText: vi.fn(() => 'Ready'),
      headerSetStatus: vi.fn(),
      loadToken,
      patchSettings: vi.fn() as never,
      setupEl,
    });

    expect(runtime.maybeShowSetup(makeUiState({ daemon: { authed: false, ok: false } }))).toBe(
      true,
    );

    await flushPromises();

    expect(loadToken).toHaveBeenCalledOnce();
    expect(setupEl.classList.remove).toHaveBeenCalledWith('hidden');
    expect(setupEl.innerHTML).toContain('headline=Daemon not reachable');
    expect(setupEl.innerHTML).toContain('Check that the LaunchAgent is installed.');
    expect(setupViewMocks.installStepsHtml).toHaveBeenCalledWith(
      expect.objectContaining({
        headline: 'Daemon not reachable',
        showTroubleshooting: true,
        token: 'saved-token',
      }),
    );
  });

  it('hides setup when the daemon is healthy and authed', () => {
    const setupEl = makeSetupEl();

    const runtime = createSetupRuntime({
      ensureToken: vi.fn(async () => 'unused-token'),
      generateToken: vi.fn() as never,
      getStatusResetText: vi.fn(() => 'Ready'),
      headerSetStatus: vi.fn(),
      loadToken: vi.fn(async () => 'unused-token'),
      patchSettings: vi.fn() as never,
      setupEl,
    });

    expect(runtime.maybeShowSetup(makeUiState())).toBe(false);
    expect(setupEl.classList.add).toHaveBeenCalledWith('hidden');
  });
});
