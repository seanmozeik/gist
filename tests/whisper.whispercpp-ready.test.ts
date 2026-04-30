import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

type MockProc = EventEmitter & { stderr: EventEmitter & { setEncoding: () => void } };

vi.mock('node:child_process', () => {
  return {
    spawn: (_bin: string, args: string[]) => {
      const proc: MockProc = Object.assign(new EventEmitter(), {
        stderr: Object.assign(new EventEmitter(), {
          setEncoding: () => {
            /* Empty */
          },
        }),
      });

      // Validate we only use this mock for availability checks in these tests.
      if (!args.includes('--help')) {
        throw new Error(`Unexpected whisper-cli invocation in test: ${args.join(' ')}`);
      }

      process.nextTick(() => {
        const mode = (process.env.VITEST_WHISPER_SPAWN_MODE ?? 'ok').trim();
        if (mode === 'error') {
          proc.emit('error', new Error('spawn failed'));
          return;
        }
        proc.emit('close', mode === 'nonzero' ? 1 : 0);
      });

      return proc;
    },
  };
});

const ENV_KEYS = [
  'GIST_DISABLE_LOCAL_WHISPER_CPP',
  'GIST_WHISPER_CPP_BINARY',
  'GIST_WHISPER_CPP_MODEL_PATH',
  'VITEST_WHISPER_SPAWN_MODE',
  'HOME',
  'USERPROFILE',
];

function snapshotEnv(): Record<string, string | undefined> {
  return Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
}

function restoreEnv(snapshot: Record<string, string | undefined>) {
  for (const k of ENV_KEYS) {
    const v = snapshot[k];
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
}

describe('whisper.cpp readiness', () => {
  const envSnapshot = snapshotEnv();

  afterEach(() => {
    restoreEnv(envSnapshot);
  });

  it('returns false when local whisper.cpp is disabled', async () => {
    process.env.GIST_DISABLE_LOCAL_WHISPER_CPP = '1';
    process.env.VITEST_WHISPER_SPAWN_MODE = 'ok';

    const mod = await import('../src/transcription/whisper');
    expect(await mod.isWhisperCppReady()).toBe(false);
  });

  it('returns false when whisper-cli is not available (spawn error)', async () => {
    process.env.GIST_DISABLE_LOCAL_WHISPER_CPP = '0';
    process.env.VITEST_WHISPER_SPAWN_MODE = 'error';

    const mod = await import('../src/transcription/whisper');
    expect(await mod.isWhisperCppReady()).toBe(false);
  });

  it('returns false when whisper-cli exists but model is missing', async () => {
    process.env.GIST_DISABLE_LOCAL_WHISPER_CPP = '0';
    process.env.VITEST_WHISPER_SPAWN_MODE = 'ok';
    process.env.GIST_WHISPER_CPP_MODEL_PATH = join(tmpdir(), `missing-${Date.now()}.bin`);

    const mod = await import('../src/transcription/whisper');
    expect(await mod.isWhisperCppReady()).toBe(false);
  });

  it('returns true when whisper-cli exists and model path is valid', async () => {
    process.env.GIST_DISABLE_LOCAL_WHISPER_CPP = '0';
    process.env.VITEST_WHISPER_SPAWN_MODE = 'ok';

    const dir = mkdtempSync(join(tmpdir(), 'gist-whisper-test-'));
    const modelPath = join(dir, 'ggml-base.en.bin');
    writeFileSync(modelPath, 'x');
    process.env.GIST_WHISPER_CPP_MODEL_PATH = modelPath;

    const mod = await import('../src/transcription/whisper');
    expect(await mod.isWhisperCppReady()).toBe(true);
    expect(await mod.resolveWhisperCppModelNameForDisplay()).toBe('base');
  });

  it('supports fallback model discovery under ~/.gist/cache/whisper-cpp/models', async () => {
    process.env.GIST_DISABLE_LOCAL_WHISPER_CPP = '0';
    process.env.VITEST_WHISPER_SPAWN_MODE = 'ok';
    delete process.env.GIST_WHISPER_CPP_MODEL_PATH;

    const home = mkdtempSync(join(tmpdir(), 'gist-home-'));
    process.env.HOME = home;
    delete process.env.USERPROFILE;

    const modelPath = join(home, '.gist', 'cache', 'whisper-cpp', 'models', 'ggml-base.bin');
    mkdirSync(join(home, '.gist', 'cache', 'whisper-cpp', 'models'), { recursive: true });
    writeFileSync(modelPath, 'x');

    const mod = await import('../src/transcription/whisper');
    expect(await mod.isWhisperCppReady()).toBe(true);
    expect(await mod.resolveWhisperCppModelNameForDisplay()).toBe('base');
  });

  it('accepts explicit env overrides without reading process.env model settings', async () => {
    process.env.GIST_DISABLE_LOCAL_WHISPER_CPP = '0';
    process.env.VITEST_WHISPER_SPAWN_MODE = 'ok';
    delete process.env.GIST_WHISPER_CPP_MODEL_PATH;

    const dir = mkdtempSync(join(tmpdir(), 'gist-whisper-env-'));
    const modelPath = join(dir, 'ggml-base.en.bin');
    writeFileSync(modelPath, 'x');

    const env = { GIST_DISABLE_LOCAL_WHISPER_CPP: '0', GIST_WHISPER_CPP_MODEL_PATH: modelPath };

    const mod = await import('../src/transcription/whisper');
    expect(await mod.isWhisperCppReady(env)).toBe(true);
    expect(await mod.resolveWhisperCppModelNameForDisplay(env)).toBe('base');
  });
});
