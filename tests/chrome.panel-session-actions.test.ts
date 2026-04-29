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
    const summarizeActiveTab = vi.fn();

    handlePanelReady(
      {
        agentController: { abort: agentAbort } as AbortController,
        daemonRecovery: { clearPending },
        inflightUrl: 'y',
        lastSummarizedUrl: 'x',
        panelLastPingAt: 0,
        panelOpen: false,
        runController: { abort: runAbort } as AbortController,
        windowId: 1,
      } as never,
      { emitState, summarizeActiveTab },
    );

    expect(runAbort).toHaveBeenCalledTimes(1);
    expect(agentAbort).toHaveBeenCalledTimes(1);
    expect(clearPending).toHaveBeenCalledTimes(1);
    expect(emitState).toHaveBeenCalledTimes(1);
    expect(summarizeActiveTab).toHaveBeenCalledWith('panel-open');
  });

  it('clears cached extracts when the panel closes', () => {
    const clearPending = vi.fn();
    const clearCachedExtractsForWindow = vi.fn(async () => {
      /* empty */
    });

    handlePanelClosed(
      {
        agentController: null,
        daemonRecovery: { clearPending },
        inflightUrl: 'y',
        lastSummarizedUrl: 'x',
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

  it('persists auto summarize and reruns when enabled', async () => {
    const patchSettings = vi.fn(async () => {
      /* empty */
    });
    const emitState = vi.fn();
    const summarizeActiveTab = vi.fn();

    await handlePanelSetAuto({
      emitState,
      patchSettings: patchSettings as never,
      summarizeActiveTab,
      value: true,
    });

    expect(patchSettings).toHaveBeenCalledWith({ autoSummarize: true });
    expect(emitState).toHaveBeenCalledTimes(1);
    expect(summarizeActiveTab).toHaveBeenCalledWith('auto-enabled');
  });

  it('persists auto summarize without rerunning when disabled', async () => {
    const patchSettings = vi.fn(async () => {
      /* empty */
    });
    const emitState = vi.fn();
    const summarizeActiveTab = vi.fn();

    await handlePanelSetAuto({
      emitState,
      patchSettings: patchSettings as never,
      summarizeActiveTab,
      value: false,
    });

    expect(patchSettings).toHaveBeenCalledWith({ autoSummarize: false });
    expect(emitState).toHaveBeenCalledTimes(1);
    expect(summarizeActiveTab).not.toHaveBeenCalled();
  });

  it('skips rerun when the length setting is unchanged', async () => {
    const loadSettings = vi.fn(async () => ({ length: 'medium' }));
    const patchSettings = vi.fn(async () => {
      /* empty */
    });
    const emitState = vi.fn();
    const summarizeActiveTab = vi.fn();

    await handlePanelSetLength({
      emitState,
      loadSettings: loadSettings as never,
      patchSettings: patchSettings as never,
      summarizeActiveTab,
      value: 'medium',
    });

    expect(patchSettings).not.toHaveBeenCalled();
    expect(emitState).not.toHaveBeenCalled();
    expect(summarizeActiveTab).not.toHaveBeenCalled();
  });

  it('persists changed length and reruns', async () => {
    const loadSettings = vi.fn(async () => ({ length: 'short' }));
    const patchSettings = vi.fn(async () => {
      /* empty */
    });
    const emitState = vi.fn();
    const summarizeActiveTab = vi.fn();

    await handlePanelSetLength({
      emitState,
      loadSettings: loadSettings as never,
      patchSettings: patchSettings as never,
      summarizeActiveTab,
      value: 'long',
    });

    expect(patchSettings).toHaveBeenCalledWith({ length: 'long' });
    expect(emitState).toHaveBeenCalledTimes(1);
    expect(summarizeActiveTab).toHaveBeenCalledWith('length-change');
  });
});
