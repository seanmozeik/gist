import { Writable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { startSpinner } from '../src/tty/spinner.js';

const { oraMock } = vi.hoisted(() => ({ oraMock: vi.fn() }));

vi.mock('ora', () => ({ default: oraMock }));

const stream = new Writable({
  write(_chunk, _encoding, callback) {
    callback();
  },
});

describe('tty spinner', () => {
  it('returns no-op handlers when disabled', () => {
    oraMock.mockReset();

    const spinner = startSpinner({ enabled: false, stream, text: 'Loading' });
    spinner.stop();
    spinner.clear();
    spinner.stopAndClear();
    spinner.setText('Next');

    expect(oraMock).not.toHaveBeenCalled();
  });

  it('does not stop when already stopped', () => {
    oraMock.mockReset();
    const stopSpy = vi.fn();
    oraMock.mockImplementationOnce(() => ({
      clear: vi.fn(),
      isSpinning: false,
      start() {
        return this;
      },
      stop: stopSpy,
      text: 'Loading',
    }));

    const spinner = startSpinner({ enabled: true, stream, text: 'Loading' });
    spinner.stop();

    expect(stopSpy).not.toHaveBeenCalled();
  });

  it('pauses, resumes, and clears when enabled', () => {
    oraMock.mockReset();
    const stopSpy = vi.fn();
    const clearSpy = vi.fn();
    const startSpy = vi.fn(function startSpy(this: { isSpinning: boolean }) {
      this.isSpinning = true;
      return this;
    });
    const renderSpy = vi.fn();
    const spinnerState = {
      clear: clearSpy,
      isSpinning: true,
      render: renderSpy,
      start: startSpy,
      stop: stopSpy,
      text: 'Loading',
    };
    oraMock.mockImplementationOnce(() => spinnerState);

    let writes = '';
    const writable = new Writable({
      write(chunk, _encoding, callback) {
        writes += chunk.toString();
        callback();
      },
    });

    const spinner = startSpinner({ enabled: true, stream: writable, text: 'Loading' });
    spinner.pause();
    spinner.setText('Paused');
    spinner.pause();
    spinner.resume();
    spinner.stopAndClear();
    spinner.clear();

    expect(stopSpy).toHaveBeenCalled();
    expect(clearSpy).toHaveBeenCalled();
    expect(startSpy).toHaveBeenCalled();
    expect(renderSpy).not.toHaveBeenCalled();
    expect(writes).toContain('\u001B[2K');
  });

  it('ignores empty/ansi-only and duplicate text updates', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    oraMock.mockReset();
    const renderSpy = vi.fn();
    const spinnerState = {
      clear: vi.fn(),
      isSpinning: true,
      render: renderSpy,
      start() {
        return this;
      },
      stop: vi.fn(),
      text: 'Loading',
    };
    oraMock.mockImplementationOnce(() => spinnerState);

    const spinner = startSpinner({ enabled: true, stream, text: 'Loading' });
    spinner.setText('   ');
    spinner.setText('\u001B[36m\u001B[0m');
    spinner.setText('Loading');
    spinner.setText('Next');
    vi.setSystemTime(1050);
    spinner.setText('Later');
    vi.setSystemTime(1100);
    spinner.setText('Latest');

    expect(renderSpy).toHaveBeenCalledTimes(2);
    expect(spinnerState.text).toBe('Latest');
    vi.useRealTimers();
  });

  it('can refresh the current line after external terminal writes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    oraMock.mockReset();
    const renderSpy = vi.fn();
    const spinnerState = {
      clear: vi.fn(),
      isSpinning: true,
      render: renderSpy,
      start() {
        return this;
      },
      stop: vi.fn(),
      text: 'Loading',
    };
    oraMock.mockImplementationOnce(() => spinnerState);

    const spinner = startSpinner({ enabled: true, stream, text: 'Loading' });
    spinner.refresh();
    vi.setSystemTime(1050);
    spinner.refresh();
    vi.setSystemTime(1100);
    spinner.refresh();

    expect(renderSpy).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
