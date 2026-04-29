import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  canSpawnCommand,
  hasUvxCli,
  parseBooleanEnv,
  parseCliProviderArg,
  parseCliUserModelId,
  resolveCliAvailability,
  resolveExecutableInPath,
} from '../src/run/env.js';

const makeBin = (name: string) => {
  const dir = mkdtempSync(join(tmpdir(), 'summarize-run-env-'));
  const file = join(dir, name);
  writeFileSync(file, '#!/bin/sh\nexit 0\n');
  chmodSync(file, 0o755);
  return { dir, file };
};

describe('run/env', () => {
  it('resolves executables in PATH and absolute paths', () => {
    const uvx = makeBin('uvx');

    expect(resolveExecutableInPath('uvx', { PATH: uvx.dir })).toBe(uvx.file);
    expect(resolveExecutableInPath(uvx.file, { PATH: '' })).toBe(uvx.file);
    expect(resolveExecutableInPath('missing', { PATH: uvx.dir })).toBeNull();
    expect(resolveExecutableInPath('', { PATH: uvx.dir })).toBeNull();
  });

  it('detects uvx from either UVX_PATH or PATH', () => {
    const uvx = makeBin('uvx');
    expect(hasUvxCli({ UVX_PATH: '/custom/uvx' })).toBe(true);
    expect(hasUvxCli({ PATH: uvx.dir })).toBe(true);
    expect(hasUvxCli({ PATH: '' })).toBe(false);
  });

  it('probes runnable commands by spawning them', async () => {
    await expect(
      canSpawnCommand({
        args: ['--version'],
        command: process.execPath,
        env: process.env as Record<string, string | undefined>,
      }),
    ).resolves.toBe(true);
    await expect(
      canSpawnCommand({
        args: ['--help'],
        command: 'definitely-missing-summarize-binary',
        env: process.env as Record<string, string | undefined>,
      }),
    ).resolves.toBe(false);
  });

  it('parses cli model ids and provider args', () => {
    expect(parseCliUserModelId('cli/codex/gpt-5.2')).toEqual({
      model: 'gpt-5.2',
      provider: 'codex',
    });
    expect(parseCliUserModelId('cli/gemini')).toEqual({ model: null, provider: 'gemini' });
    expect(parseCliUserModelId('cli/openclaw/main')).toEqual({
      model: 'main',
      provider: 'openclaw',
    });
    expect(parseCliUserModelId('cli/opencode/openai/gpt-5.4')).toEqual({
      model: 'openai/gpt-5.4',
      provider: 'opencode',
    });
    expect(parseCliProviderArg('  AGENT ')).toBe('agent');
    expect(parseCliProviderArg(' openclaw ')).toBe('openclaw');
    expect(parseCliProviderArg(' opencode ')).toBe('opencode');
  });

  it('detects OpenCode availability from PATH and respects cli.enabled', () => {
    const opencode = makeBin('opencode');
    const pathEnv = [opencode.dir].join(delimiter);

    expect(resolveCliAvailability({ config: null, env: { PATH: pathEnv } }).opencode).toBe(true);
    expect(
      resolveCliAvailability({ config: { cli: { enabled: ['claude'] } }, env: { PATH: pathEnv } })
        .opencode,
    ).toBe(false);
  });

  it('rejects invalid cli providers and model ids', () => {
    expect(() => parseCliProviderArg('nope')).toThrow(/Unsupported --cli/);
    expect(() => parseCliUserModelId('cli/nope/test')).toThrow(/Invalid CLI model id/);
  });

  it('parses boolean environment values', () => {
    expect(parseBooleanEnv(' true ')).toBe(true);
    expect(parseBooleanEnv('OFF')).toBe(false);
    expect(parseBooleanEnv('')).toBeNull();
    expect(parseBooleanEnv()).toBeNull();
    expect(parseBooleanEnv('maybe')).toBeNull();
  });
});
