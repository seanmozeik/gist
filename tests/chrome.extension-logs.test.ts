import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installChromeStorage } from './helpers/chrome-storage';

const LOG_KEY = 'gist:extension-logs';

describe('chrome/extension-logs', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('returns not ok when no storage backend exists', async () => {
    installChromeStorage({}, 'none');
    const { logExtensionEvent, readExtensionLogs } =
      await import('../apps/chrome-extension/src/lib/extension-logs.js');

    logExtensionEvent({ event: 'ignored' });
    await vi.runAllTimersAsync();

    await expect(readExtensionLogs(10)).resolves.toEqual({
      lines: [],
      mtimeMs: null,
      ok: false,
      sizeBytes: 0,
      truncated: false,
    });
  });

  it('flushes queued lines, normalizes details, and reads a rounded tail', async () => {
    const storage: Record<string, unknown> = {};
    installChromeStorage(storage, 'session');
    const { logExtensionEvent, readExtensionLogs } =
      await import('../apps/chrome-extension/src/lib/extension-logs.js');

    logExtensionEvent({
      detail: {
        boom: new Error('boom'),
        count: 3,
        enabled: true,
        list: ['a'.repeat(150), 7, false, { nested: 'ok' }],
        nil: null,
        object: { nested: true },
        text: 'x'.repeat(305),
      },
      event: 'extract:start',
      scope: 'sidepanel',
    });
    await vi.runAllTimersAsync();

    const raw = storage[LOG_KEY];
    expect(Array.isArray(raw)).toBe(true);
    const line = (raw as string[])[0];
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed.event).toBe('extract:start');
    expect(parsed.scope).toBe('sidepanel');
    expect(parsed.count).toBe(3);
    expect(parsed.enabled).toBe(true);
    expect(parsed.nil).toBeUndefined();
    expect(parsed.boom).toBe('boom');
    expect(parsed.list).toEqual([`${'a'.repeat(120)}…`, '7', 'false', '{"nested":"ok"}']);
    expect(String(parsed.text).endsWith('…')).toBe(true);

    const result = await readExtensionLogs(1.2);
    expect(result.ok).toBe(true);
    expect(result.lines).toHaveLength(1);
    expect(result.truncated).toBe(false);
    expect(result.sizeBytes).toBe(line.length);
    expect(typeof result.mtimeMs).toBe('number');
  });

  it('falls back to local storage, flushes immediately at batch size, and trims stored history', async () => {
    const storage: Record<string, unknown> = {};
    installChromeStorage(storage, 'local');
    const { logExtensionEvent, readExtensionLogs } =
      await import('../apps/chrome-extension/src/lib/extension-logs.js');

    for (let index = 0; index < 4050; index += 1) {
      logExtensionEvent({ event: `e${index}` });
    }
    await vi.runAllTimersAsync();

    const lines = storage[LOG_KEY] as string[];
    expect(lines).toHaveLength(4000);
    expect(lines[0]).toContain('"event":"e50"');
    expect(lines.at(-1)).toContain('"event":"e4049"');

    const tail = await readExtensionLogs(6000);
    expect(tail.ok).toBe(true);
    expect(tail.lines).toHaveLength(4000);
    expect(tail.truncated).toBe(false);
  });

  it('caps oversized log lines and ignores invalid last-line timestamps', async () => {
    const storage: Record<string, unknown> = {};
    installChromeStorage(storage, 'session');
    const { logExtensionEvent, readExtensionLogs } =
      await import('../apps/chrome-extension/src/lib/extension-logs.js');

    logExtensionEvent({
      detail: Object.fromEntries(
        Array.from({ length: 30 }, (_, index) => [`k${index}`, 'y'.repeat(300)]),
      ),
      event: 'huge',
    });
    await vi.runAllTimersAsync();

    const stored = storage[LOG_KEY] as string[];
    expect(stored[0]).toContain('"detail":"truncated"');

    storage[LOG_KEY] = [...stored, 'not json'];
    const result = await readExtensionLogs(2);
    expect(result.lines).toEqual([stored[0], 'not json']);
    expect(result.mtimeMs).toBeNull();
  });
});
