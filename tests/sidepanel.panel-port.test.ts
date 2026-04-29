import { describe, expect, it, vi } from 'vitest';

import { createPanelPortRuntime } from '../apps/chrome-extension/src/entrypoints/sidepanel/panel-port.js';

function createMockPort() {
  const onMessageListeners: ((message: unknown) => void)[] = [];
  const onDisconnectListeners: (() => void)[] = [];
  return {
    disconnect() {
      for (const listener of onDisconnectListeners) {
        listener();
      }
    },
    emitMessage(message: unknown) {
      for (const listener of onMessageListeners) {
        listener(message);
      }
    },
    onDisconnect: {
      addListener(listener: () => void) {
        onDisconnectListeners.push(listener);
      },
    },
    onMessage: {
      addListener(listener: (message: unknown) => void) {
        onMessageListeners.push(listener);
      },
    },
    postMessage(message: unknown) {
      this.posted.push(message);
    },
    posted: [] as unknown[],
  } as unknown as chrome.runtime.Port & {
    posted: unknown[];
    emitMessage: (message: unknown) => void;
    disconnect: () => void;
  };
}

describe('sidepanel panel port runtime', () => {
  it('reuses the same connected port', async () => {
    const port = createMockPort();
    const connect = vi.fn(() => port);
    const runtime = createPanelPortRuntime({
      connect,
      getCurrentWindowId: async () => 17,
      onMessage: () => {
        /* empty */
      },
    });

    await runtime.ensure();
    await runtime.ensure();
    await runtime.send({ type: 'panel:ping' });

    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith('sidepanel:17');
    expect(port.posted).toEqual([{ type: 'panel:ping' }]);
  });

  it('forwards incoming messages and clears the debug port on disconnect', async () => {
    const port = createMockPort();
    const onMessage = vi.fn();
    const runtime = createPanelPortRuntime({
      connect: () => port,
      getCurrentWindowId: async () => 17,
      onMessage,
    });

    await runtime.ensure();
    expect(
      (globalThis as { __summarizePanelPort?: chrome.runtime.Port }).__summarizePanelPort,
    ).toBe(port);

    port.emitMessage({ status: 'ok', type: 'ui:status' });
    expect(onMessage).toHaveBeenCalledWith({ status: 'ok', type: 'ui:status' });

    port.disconnect();
    expect(
      (globalThis as { __summarizePanelPort?: chrome.runtime.Port }).__summarizePanelPort,
    ).toBeUndefined();
  });

  it('skips connecting when chrome has no current window id', async () => {
    const connect = vi.fn();
    const runtime = createPanelPortRuntime({
      connect,
      getCurrentWindowId: async () => null,
      onMessage: () => {
        /* empty */
      },
    });

    await runtime.send({ type: 'panel:ready' });
    expect(connect).not.toHaveBeenCalled();
  });

  it('ignores postMessage races while the port is reloading', async () => {
    const port = createMockPort();
    port.postMessage = vi.fn(() => {
      throw new Error('disconnected');
    });
    const runtime = createPanelPortRuntime({
      connect: () => port,
      getCurrentWindowId: async () => 17,
      onMessage: () => {
        /* empty */
      },
    });

    await expect(runtime.send({ type: 'panel:ready' })).resolves.toBeUndefined();
    expect(port.postMessage).toHaveBeenCalledWith({ type: 'panel:ready' });
  });
});
