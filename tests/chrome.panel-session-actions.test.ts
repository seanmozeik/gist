import { describe, expect, it, vi } from 'vitest';

import {
  handlePanelClosed,
  handlePanelReady,
  handlePanelSetAuto,
  handlePanelSetLength,
} from '../apps/chrome-extension/src/entrypoints/background/panel-session-actions.js';

describe('chrome panel session actions', () => {
  it('resets and restarts work when the panel opens', () => {
    const runAbort = vi.fn();
    const agentAbort = vi.fn();
    const clearPending = vi.fn();
    const emitState = vi.fn();
    const gistActiveTab = vi.fn();

    handlePanelReady(
      {
        agentController: { abort: agentAbort } as AbortController,
        daemonRecovery: { clearPending },
        inflightUrl: 'y',
        lastGistedUrl: 'x',
        panelLastPingAt: 0,
        panelOpen: false,
        runController: { abort: runAbort } as AbortController,
        windowId: 1,
      } as never,
      { emitState, gistActiveTab },
    );

    expect(runAbort).toHaveBeenCalledTimes(1);
    expect(agentAbort).toHaveBeenCalledTimes(1);
    expect(clearPending).toHaveBeenCalledTimes(1);
    expect(emitState).toHaveBeenCalledTimes(1);
    expect(gistActiveTab).toHaveBeenCalledWith('panel-open');
  });

  it('clears cached extracts when the panel closes', () => {
    const clearPending = vi.fn();
    const clearCachedExtractsForWindow = vi.fn(async () => {
      /* Empty */
    });

    handlePanelClosed(
      {
        agentController: null,
        daemonRecovery: { clearPending },
        inflightUrl: 'y',
        lastGistedUrl: 'x',
        panelLastPingAt: 1,
        panelOpen: true,
        runController: null,
        windowId: 2,
      } as never,
      { clearCachedExtractsForWindow },
    );

    expect(clearPending).toHaveBeenCalledTimes(1);
    expect(clearCachedExtractsForWindow).toHaveBeenCalledWith(2);
  });

  it('persists auto gist and reruns when enabled', async () => {
    const patchSettings = vi.fn(async () => {
      /* Empty */
    });
    const emitState = vi.fn();
    const gistActiveTab = vi.fn();

    await handlePanelSetAuto({
      emitState,
      gistActiveTab,
      patchSettings: patchSettings as never,
      value: true,
    });

    expect(patchSettings).toHaveBeenCalledWith({ autoGist: true });
    expect(emitState).toHaveBeenCalledTimes(1);
    expect(gistActiveTab).toHaveBeenCalledWith('auto-enabled');
  });

  it('persists auto gist without rerunning when disabled', async () => {
    const patchSettings = vi.fn(async () => {
      /* Empty */
    });
    const emitState = vi.fn();
    const gistActiveTab = vi.fn();

    await handlePanelSetAuto({
      emitState,
      gistActiveTab,
      patchSettings: patchSettings as never,
      value: false,
    });

    expect(patchSettings).toHaveBeenCalledWith({ autoGist: false });
    expect(emitState).toHaveBeenCalledTimes(1);
    expect(gistActiveTab).not.toHaveBeenCalled();
  });

  it('skips rerun when the length setting is unchanged', async () => {
    const loadSettings = vi.fn(async () => ({ length: 'medium' }));
    const patchSettings = vi.fn(async () => {
      /* Empty */
    });
    const emitState = vi.fn();
    const gistActiveTab = vi.fn();

    await handlePanelSetLength({
      emitState,
      gistActiveTab,
      loadSettings: loadSettings as never,
      patchSettings: patchSettings as never,
      value: 'medium',
    });

    expect(patchSettings).not.toHaveBeenCalled();
    expect(emitState).not.toHaveBeenCalled();
    expect(gistActiveTab).not.toHaveBeenCalled();
  });

  it('persists changed length and reruns', async () => {
    const loadSettings = vi.fn(async () => ({ length: 'short' }));
    const patchSettings = vi.fn(async () => {
      /* Empty */
    });
    const emitState = vi.fn();
    const gistActiveTab = vi.fn();

    await handlePanelSetLength({
      emitState,
      gistActiveTab,
      loadSettings: loadSettings as never,
      patchSettings: patchSettings as never,
      value: 'long',
    });

    expect(patchSettings).toHaveBeenCalledWith({ length: 'long' });
    expect(emitState).toHaveBeenCalledTimes(1);
    expect(gistActiveTab).toHaveBeenCalledWith('length-change');
  });
});
