import { Writable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  attachRichHelp: vi.fn(),
  buildDaemonHelp: vi.fn(() => 'DAEMON_HELP'),
  buildProgram: vi.fn(() => ({ configureOutput: vi.fn(), outputHelp: vi.fn() })),
  buildRefreshFreeHelp: vi.fn(() => 'REFRESH_FREE_HELP'),
  handleDaemonRequest: vi.fn(async () => false),
  refreshFree: vi.fn(async () => {}),
}));

vi.mock('../src/refresh-free.js', () => ({ refreshFree: mocks.refreshFree }));

vi.mock('../src/daemon/cli.js', () => ({ handleDaemonRequest: mocks.handleDaemonRequest }));

vi.mock('../src/run/help.js', () => ({
  attachRichHelp: mocks.attachRichHelp,
  buildDaemonHelp: mocks.buildDaemonHelp,
  buildProgram: mocks.buildProgram,
  buildRefreshFreeHelp: mocks.buildRefreshFreeHelp,
}));

import {
  handleDaemonCliRequest,
  handleHelpRequest,
  handleRefreshFreeRequest,
} from '../src/run/cli-preflight.js';

function collectStream() {
  let text = '';
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      text += chunk.toString();
      callback();
    },
  });
  return { getText: () => text, stream };
}

describe('run/cli-preflight', () => {
  it('handleHelpRequest: returns false when not help', () => {
    const stdout = collectStream();
    const stderr = collectStream();
    expect(
      handleHelpRequest({
        envForRun: {},
        normalizedArgv: ['summarize', '--help'],
        stderr: stderr.stream,
        stdout: stdout.stream,
      }),
    ).toBe(false);
  });

  it('handleHelpRequest: prints refresh-free help', () => {
    const stdout = collectStream();
    const stderr = collectStream();
    expect(
      handleHelpRequest({
        envForRun: {},
        normalizedArgv: ['help', 'refresh-free'],
        stderr: stderr.stream,
        stdout: stdout.stream,
      }),
    ).toBe(true);
    expect(stdout.getText()).toContain('REFRESH_FREE_HELP');
    expect(stderr.getText()).toBe('');
  });

  it('handleHelpRequest: prints daemon help', () => {
    const stdout = collectStream();
    const stderr = collectStream();
    expect(
      handleHelpRequest({
        envForRun: {},
        normalizedArgv: ['help', 'daemon'],
        stderr: stderr.stream,
        stdout: stdout.stream,
      }),
    ).toBe(true);
    expect(stdout.getText()).toContain('DAEMON_HELP');
    expect(stderr.getText()).toBe('');
  });

  it('handleHelpRequest: falls back to commander help', () => {
    mocks.attachRichHelp.mockClear();
    mocks.buildProgram.mockClear();

    const stdout = collectStream();
    const stderr = collectStream();
    expect(
      handleHelpRequest({
        envForRun: { FOO: 'bar' },
        normalizedArgv: ['help'],
        stderr: stderr.stream,
        stdout: stdout.stream,
      }),
    ).toBe(true);

    expect(mocks.buildProgram).toHaveBeenCalledTimes(1);
    expect(mocks.attachRichHelp).toHaveBeenCalledTimes(1);
  });

  it('handleRefreshFreeRequest: returns false when not refresh-free', async () => {
    const stdout = collectStream();
    const stderr = collectStream();
    await expect(
      handleRefreshFreeRequest({
        envForRun: {},
        fetchImpl: fetch,
        normalizedArgv: ['help'],
        stderr: stderr.stream,
        stdout: stdout.stream,
      }),
    ).resolves.toBe(false);
  });

  it('handleRefreshFreeRequest: prints help', async () => {
    const stdout = collectStream();
    const stderr = collectStream();
    await expect(
      handleRefreshFreeRequest({
        envForRun: {},
        fetchImpl: fetch,
        normalizedArgv: ['refresh-free', '--help'],
        stderr: stderr.stream,
        stdout: stdout.stream,
      }),
    ).resolves.toBe(true);
    expect(stdout.getText()).toContain('REFRESH_FREE_HELP');
    expect(stderr.getText()).toBe('');
  });

  it('handleRefreshFreeRequest: validates numeric args', async () => {
    const stdout = collectStream();
    const stderr = collectStream();
    await expect(
      handleRefreshFreeRequest({
        envForRun: {},
        fetchImpl: fetch,
        normalizedArgv: ['refresh-free', '--runs=-1'],
        stderr: stderr.stream,
        stdout: stdout.stream,
      }),
    ).rejects.toThrow('--runs must be >= 0');
  });

  it('handleRefreshFreeRequest: calls refreshFree with parsed options', async () => {
    mocks.refreshFree.mockClear();

    const stdout = collectStream();
    const stderr = collectStream();
    await expect(
      handleRefreshFreeRequest({
        envForRun: { OPENROUTER_API_KEY: 'x' },
        fetchImpl: fetch,
        normalizedArgv: [
          'refresh-free',
          '--runs=3',
          '--smart',
          '2',
          '--min-params',
          '27b',
          '--max-age-days=90',
          '--set-default',
          '--verbose',
        ],
        stderr: stderr.stream,
        stdout: stdout.stream,
      }),
    ).resolves.toBe(true);

    expect(mocks.refreshFree).toHaveBeenCalledTimes(1);
    expect(mocks.refreshFree.mock.calls[0]?.[0]).toMatchObject({
      options: {
        concurrency: 4,
        maxAgeDays: 90,
        maxCandidates: 10,
        minParamB: 27,
        runs: 3,
        setDefault: true,
        smart: 2,
        timeoutMs: 10_000,
      },
      verbose: true,
    });
  });

  it('handleDaemonCliRequest: forwards to daemon handler', async () => {
    mocks.handleDaemonRequest.mockResolvedValueOnce(true);
    const stdout = collectStream();
    const stderr = collectStream();
    await expect(
      handleDaemonCliRequest({
        envForRun: {},
        fetchImpl: fetch,
        normalizedArgv: ['daemon', 'status'],
        stderr: stderr.stream,
        stdout: stdout.stream,
      }),
    ).resolves.toBe(true);
  });
});
