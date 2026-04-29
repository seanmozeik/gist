import { describe, expect, it, vi } from 'vitest';

import {
  getNativeInputGuardError,
  updateNativeInputArmedTabs,
  withNativeInputArmedTab,
} from '../apps/chrome-extension/src/automation/native-input-guard';

describe('chrome native input guard', () => {
  it('arms and disarms tabs only for extension-page messages', () => {
    const armedTabs = new Set<number>();

    expect(
      updateNativeInputArmedTabs({ armedTabs, enabled: true, senderHasTab: true, tabId: 7 }),
    ).toBe(false);
    expect(armedTabs.has(7)).toBe(false);

    expect(
      updateNativeInputArmedTabs({ armedTabs, enabled: true, senderHasTab: false, tabId: 7 }),
    ).toBe(true);
    expect(armedTabs.has(7)).toBe(true);

    expect(
      updateNativeInputArmedTabs({ armedTabs, enabled: false, senderHasTab: false, tabId: 7 }),
    ).toBe(true);
    expect(armedTabs.has(7)).toBe(false);
  });

  it('rejects missing or unarmed sender tabs', () => {
    const armedTabs = new Set<number>([3]);

    expect(getNativeInputGuardError({ armedTabs, senderTabId: undefined })).toBe(
      'Missing sender tab',
    );
    expect(getNativeInputGuardError({ armedTabs, senderTabId: 4 })).toBe(
      'Native input not armed for this tab',
    );
    expect(getNativeInputGuardError({ armedTabs, senderTabId: 3 })).toBeNull();
  });

  it('arms before execution and disarms after success', async () => {
    const sendMessage = vi.fn(async () => {});
    const run = vi.fn(async () => 'ok');

    await expect(
      withNativeInputArmedTab({ enabled: true, run, sendMessage, tabId: 9 }),
    ).resolves.toBe('ok');

    expect(sendMessage.mock.calls).toEqual([
      [{ enabled: true, tabId: 9, type: 'automation:native-input-arm' }],
      [{ enabled: false, tabId: 9, type: 'automation:native-input-arm' }],
    ]);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('disarms even when execution fails', async () => {
    const sendMessage = vi.fn(async () => {});
    const run = vi.fn(async () => {
      throw new Error('boom');
    });

    await expect(
      withNativeInputArmedTab({ enabled: true, run, sendMessage, tabId: 11 }),
    ).rejects.toThrow('boom');

    expect(sendMessage.mock.calls).toEqual([
      [{ enabled: true, tabId: 11, type: 'automation:native-input-arm' }],
      [{ enabled: false, tabId: 11, type: 'automation:native-input-arm' }],
    ]);
  });
});
