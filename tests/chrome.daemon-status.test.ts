import { describe, expect, it } from 'vitest';

import {
  createDaemonStatusTracker,
  isTransientDaemonState,
} from '../apps/chrome-extension/src/lib/daemon-status.js';

describe('chrome/daemon-status', () => {
  it('keeps the last ready state during active runs on timeout', () => {
    const tracker = createDaemonStatusTracker({ transientGraceMs: 10 });

    expect(tracker.resolve({ authed: true, ok: true }, { now: 1000 })).toEqual({
      authed: true,
      ok: true,
    });

    expect(
      tracker.resolve(
        { authed: false, error: 'Timed out', ok: false },
        { keepReady: true, now: 50_000 },
      ),
    ).toEqual({ authed: true, ok: true });
  });

  it('keeps the last ready state briefly after a transient probe failure', () => {
    const tracker = createDaemonStatusTracker({ transientGraceMs: 5000 });

    tracker.resolve({ authed: true, ok: true }, { now: 1000 });

    expect(
      tracker.resolve({ authed: false, error: 'Timed out', ok: false }, { now: 5500 }),
    ).toEqual({ authed: true, ok: true });
  });

  it('surfaces transient failures after the grace window expires', () => {
    const tracker = createDaemonStatusTracker({ transientGraceMs: 5000 });

    tracker.resolve({ authed: true, ok: true }, { now: 1000 });

    expect(
      tracker.resolve({ authed: false, error: 'Timed out', ok: false }, { now: 7000 }),
    ).toEqual({ authed: false, error: 'Timed out', ok: false });
  });

  it('treats successful non-health daemon calls as ready', () => {
    const tracker = createDaemonStatusTracker({ transientGraceMs: 5000 });

    tracker.markReady(1000);

    expect(
      tracker.resolve({ authed: false, error: 'Timed out', ok: false }, { now: 4000 }),
    ).toEqual({ authed: true, ok: true });
  });

  it('surfaces non-transient auth failures immediately', () => {
    const tracker = createDaemonStatusTracker({ transientGraceMs: 60_000 });

    tracker.resolve({ authed: true, ok: true }, { now: 1000 });

    expect(
      tracker.resolve({ authed: false, error: '401 Unauthorized', ok: true }, { now: 2000 }),
    ).toEqual({ authed: false, error: '401 Unauthorized', ok: true });
  });

  it('detects transient daemon probe failures', () => {
    expect(isTransientDaemonState({ authed: false, error: 'Timed out', ok: false })).toBe(true);
    expect(
      isTransientDaemonState({
        authed: false,
        error: 'Failed to fetch (daemon unreachable or blocked by Chrome)',
        ok: false,
      }),
    ).toBe(true);
    expect(isTransientDaemonState({ authed: false, error: '401 Unauthorized', ok: true })).toBe(
      false,
    );
  });
});
