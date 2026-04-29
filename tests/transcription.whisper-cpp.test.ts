import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

describe('transcription/whisper local whisper.cpp', () => {
  it('derives a compact whisper.cpp model name for display', async () => {
    const root = await mkdtemp(join(tmpdir(), 'summarize-whisper-cpp-model-name-'));
    const baseEn = join(root, 'ggml-base.en.bin');
    await writeFile(baseEn, new Uint8Array([1, 2, 3]));

    vi.resetModules();
    vi.stubEnv('SUMMARIZE_DISABLE_LOCAL_WHISPER_CPP', '0');
    vi.stubEnv('SUMMARIZE_WHISPER_CPP_MODEL_PATH', baseEn);

    const { resolveWhisperCppModelNameForDisplay } =
      await import('../packages/core/src/transcription/whisper.js');
    await expect(resolveWhisperCppModelNameForDisplay()).resolves.toBe('base');
  });

  it('prefers whisper.cpp when enabled and available (no API keys required)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'summarize-whisper-cpp-'));
    const modelPath = join(root, 'ggml-base.bin');
    await writeFile(modelPath, new Uint8Array([1, 2, 3]));

    vi.resetModules();
    vi.stubEnv('SUMMARIZE_DISABLE_LOCAL_WHISPER_CPP', '0');
    vi.stubEnv('SUMMARIZE_WHISPER_CPP_MODEL_PATH', modelPath);
    vi.stubEnv('SUMMARIZE_WHISPER_CPP_BINARY', 'whisper-cli');

    vi.doMock('node:child_process', () => ({
      spawn: (_cmd: string, args: string[]) => {
        if (_cmd !== 'whisper-cli') {
          throw new Error(`Unexpected spawn: ${_cmd}`);
        }

        const stderr = new EventEmitter();
        stderr.setEncoding = () => {
          /* empty */
        };

        const handlers = new Map<string, (value?: unknown) => void>();
        const proc = {
          on(event: string, handler: (value?: unknown) => void) {
            handlers.set(event, handler);
            return proc;
          },
          stderr,
        } as unknown;

        // Availability check: whisper-cli --help
        if (args.includes('--help')) {
          queueMicrotask(() => handlers.get('close')?.(0));
          return proc;
        }

        // Transcription run: create output file and close 0
        const outIdx = args.indexOf('--output-file');
        const base = outIdx !== -1 ? args[outIdx + 1] : null;
        if (!base || typeof base !== 'string') {
          throw new Error('missing --output-file arg');
        }
        undefined;
        return proc;
      },
    }));

    const { transcribeMediaWithWhisper } =
      await import('../packages/core/src/transcription/whisper.js');
    const result = await transcribeMediaWithWhisper({
      bytes: new Uint8Array([1, 2, 3]),
      falApiKey: null,
      filename: 'audio.mp3',
      groqApiKey: null,
      mediaType: 'audio/mpeg',
      openaiApiKey: null,
    });

    expect(result.text).toBe('hello from whisper.cpp');
    expect(result.provider).toBe('whisper.cpp');
    expect(result.error).toBeNull();
  });

  it.each([
    { mediaType: 'audio/mpeg' },
    { mediaType: 'audio/mp3' },
    { mediaType: 'audio/ogg' },
    { mediaType: 'audio/oga' },
    { mediaType: 'application/ogg' },
    { mediaType: 'audio/flac' },
    { mediaType: 'audio/wav' },
    { mediaType: 'audio/x-wav' },
  ])('treats $mediaType as whisper.cpp-supported input', async ({ mediaType }) => {
    const root = await mkdtemp(join(tmpdir(), 'summarize-whisper-cpp-supported-'));
    const modelPath = join(root, 'ggml-base.bin');
    await writeFile(modelPath, new Uint8Array([1, 2, 3]));

    vi.resetModules();
    vi.stubEnv('SUMMARIZE_DISABLE_LOCAL_WHISPER_CPP', '0');
    vi.stubEnv('SUMMARIZE_WHISPER_CPP_MODEL_PATH', modelPath);
    vi.stubEnv('SUMMARIZE_WHISPER_CPP_BINARY', 'whisper-cli');

    vi.doMock('node:child_process', () => ({
      spawn: (_cmd: string, args: string[]) => {
        if (_cmd !== 'whisper-cli') {
          throw new Error(`Unexpected spawn: ${_cmd}`);
        }

        const stderr = new EventEmitter();
        stderr.setEncoding = () => {
          /* empty */
        };

        const handlers = new Map<string, (value?: unknown) => void>();
        const proc = {
          on(event: string, handler: (value?: unknown) => void) {
            handlers.set(event, handler);
            return proc;
          },
          stderr,
        } as unknown;

        if (args.includes('--help')) {
          queueMicrotask(() => handlers.get('close')?.(0));
          return proc;
        }

        const outIdx = args.indexOf('--output-file');
        const base = outIdx !== -1 ? args[outIdx + 1] : null;
        if (!base || typeof base !== 'string') {
          throw new Error('missing --output-file arg');
        }
        undefined;
        return proc;
      },
    }));

    const { transcribeMediaWithWhisper } =
      await import('../packages/core/src/transcription/whisper.js');
    const result = await transcribeMediaWithWhisper({
      bytes: new Uint8Array([1, 2, 3]),
      falApiKey: null,
      filename: 'audio',
      groqApiKey: null,
      mediaType,
      openaiApiKey: null,
    });

    expect(result.provider).toBe('whisper.cpp');
    expect(result.text).toContain(`ok ${mediaType}`);
  });

  it('transcribes via transcribeMediaFileWithWhisper with whisper.cpp when enabled', async () => {
    const root = await mkdtemp(join(tmpdir(), 'summarize-whisper-cpp-file-'));
    const modelPath = join(root, 'ggml-base.bin');
    const audioPath = join(root, 'audio.mp3');
    await writeFile(modelPath, new Uint8Array([1, 2, 3]));
    await writeFile(audioPath, new Uint8Array([1, 2, 3]));

    vi.resetModules();
    vi.stubEnv('SUMMARIZE_DISABLE_LOCAL_WHISPER_CPP', '0');
    vi.stubEnv('SUMMARIZE_WHISPER_CPP_MODEL_PATH', modelPath);
    vi.stubEnv('SUMMARIZE_WHISPER_CPP_BINARY', 'whisper-cli');

    vi.doMock('node:child_process', () => ({
      spawn: (_cmd: string, args: string[]) => {
        if (_cmd !== 'whisper-cli') {
          throw new Error(`Unexpected spawn: ${_cmd}`);
        }

        const stderr = new EventEmitter();
        stderr.setEncoding = () => {
          /* empty */
        };

        const handlers = new Map<string, (value?: unknown) => void>();
        const proc = {
          on(event: string, handler: (value?: unknown) => void) {
            handlers.set(event, handler);
            return proc;
          },
          stderr,
        } as unknown;

        if (args.includes('--help')) {
          queueMicrotask(() => handlers.get('close')?.(0));
          return proc;
        }

        const outIdx = args.indexOf('--output-file');
        const base = outIdx !== -1 ? args[outIdx + 1] : null;
        if (!base || typeof base !== 'string') {
          throw new Error('missing --output-file arg');
        }
        undefined;
        return proc;
      },
    }));

    const { transcribeMediaFileWithWhisper } =
      await import('../packages/core/src/transcription/whisper.js');
    const progress = vi.fn();
    const result = await transcribeMediaFileWithWhisper({
      falApiKey: null,
      filePath: audioPath,
      filename: 'audio.mp3',
      groqApiKey: null,
      mediaType: 'audio/mpeg',
      onProgress: progress,
      openaiApiKey: null,
      totalDurationSeconds: 123,
    });

    expect(result.text).toBe('file mode ok');
    expect(result.provider).toBe('whisper.cpp');
    expect(progress).toHaveBeenCalled();
    expect(
      progress.mock.calls.some(([evt]) => {
        const event = evt as { processedDurationSeconds: number | null };
        return (
          typeof event.processedDurationSeconds === 'number' && event.processedDurationSeconds > 0
        );
      }),
    ).toBe(true);
  });

  it('falls back to OpenAI when whisper.cpp fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'summarize-whisper-cpp-fallback-'));
    const modelPath = join(root, 'ggml-base.bin');
    await writeFile(modelPath, new Uint8Array([1, 2, 3]));

    const originalFetch = globalThis.fetch;
    try {
      vi.resetModules();
      vi.stubEnv('SUMMARIZE_DISABLE_LOCAL_WHISPER_CPP', '0');
      vi.stubEnv('SUMMARIZE_WHISPER_CPP_MODEL_PATH', modelPath);
      vi.stubEnv('SUMMARIZE_WHISPER_CPP_BINARY', 'whisper-cli');

      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/v1/audio/transcriptions')) {
          return Response.json(
            { text: 'from openai' },
            { headers: { 'content-type': 'application/json' }, status: 200 },
          );
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }) as unknown as typeof fetch;

      vi.doMock('node:child_process', () => ({
        spawn: (_cmd: string, args: string[]) => {
          if (_cmd !== 'whisper-cli') {
            throw new Error(`Unexpected spawn: ${_cmd}`);
          }

          const stderr = new EventEmitter();
          stderr.setEncoding = () => {
            /* empty */
          };

          const handlers = new Map<string, (value?: unknown) => void>();
          const proc = {
            on(event: string, handler: (value?: unknown) => void) {
              handlers.set(event, handler);
              return proc;
            },
            stderr,
          } as unknown;

          if (args.includes('--help')) {
            queueMicrotask(() => handlers.get('close')?.(0));
            return proc;
          }

          queueMicrotask(() => handlers.get('close')?.(1));
          return proc;
        },
      }));

      const { transcribeMediaWithWhisper } =
        await import('../packages/core/src/transcription/whisper.js');
      const result = await transcribeMediaWithWhisper({
        bytes: new Uint8Array([1, 2, 3]),
        falApiKey: null,
        filename: 'audio.mp3',
        groqApiKey: null,
        mediaType: 'audio/mpeg',
        openaiApiKey: 'OPENAI',
      });

      expect(result.text).toBe('from openai');
      expect(result.provider).toBe('openai');
      expect(result.notes.join(' ')).toContain('falling back');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('skips whisper.cpp when whisper-cli is missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'summarize-whisper-cpp-missing-'));
    const modelPath = join(root, 'ggml-base.bin');
    await writeFile(modelPath, new Uint8Array([1, 2, 3]));

    vi.resetModules();
    vi.stubEnv('SUMMARIZE_DISABLE_LOCAL_WHISPER_CPP', '0');
    vi.stubEnv('SUMMARIZE_WHISPER_CPP_MODEL_PATH', modelPath);
    vi.stubEnv('SUMMARIZE_WHISPER_CPP_BINARY', 'whisper-cli');

    const spawn = vi.fn((_cmd: string) => {
      const handlers = new Map<string, (value?: unknown) => void>();
      const proc = {
        on(event: string, handler: (value?: unknown) => void) {
          handlers.set(event, handler);
          if (event === 'error') {
            queueMicrotask(() => {
              handler(new Error('spawn ENOENT'));
            });
          }
          return proc;
        },
      } as unknown;
      return proc;
    });

    vi.doMock('node:child_process', () => ({ spawn }));

    const { transcribeMediaWithWhisper } =
      await import('../packages/core/src/transcription/whisper.js');
    const result = await transcribeMediaWithWhisper({
      bytes: new Uint8Array([1, 2, 3]),
      falApiKey: null,
      filename: 'audio.mp3',
      groqApiKey: null,
      mediaType: 'audio/mpeg',
      openaiApiKey: null,
    });

    expect(result.text).toBeNull();
    expect(result.provider).toBeNull();
    expect(result.error?.message).toContain(
      'GROQ_API_KEY, ASSEMBLYAI_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY, or FAL_KEY',
    );
    expect(spawn).toHaveBeenCalled();
  });

  it('skips whisper.cpp when the model path env points to a missing file', async () => {
    vi.resetModules();
    vi.stubEnv('SUMMARIZE_DISABLE_LOCAL_WHISPER_CPP', '0');
    vi.stubEnv('SUMMARIZE_WHISPER_CPP_MODEL_PATH', '/nope/does-not-exist.bin');
    vi.stubEnv('SUMMARIZE_WHISPER_CPP_BINARY', 'whisper-cli');

    const spawn = vi.fn((_cmd: string, args: string[]) => {
      if (_cmd !== 'whisper-cli' || !args.includes('--help')) {
        throw new Error(`Unexpected spawn: ${_cmd} ${args.join(' ')}`);
      }
      const handlers = new Map<string, (value?: unknown) => void>();
      const proc = {
        on(event: string, handler: (value?: unknown) => void) {
          handlers.set(event, handler);
          if (event === 'close') {
            queueMicrotask(() => {
              handler(0);
            });
          }
          return proc;
        },
      } as unknown;
      return proc;
    });
    vi.doMock('node:child_process', () => ({ spawn }));

    const { transcribeMediaWithWhisper } =
      await import('../packages/core/src/transcription/whisper.js');
    const result = await transcribeMediaWithWhisper({
      bytes: new Uint8Array([1, 2, 3]),
      falApiKey: null,
      filename: 'audio.mp3',
      groqApiKey: null,
      mediaType: 'audio/mpeg',
      openaiApiKey: null,
    });

    expect(result.text).toBeNull();
    expect(result.provider).toBeNull();
    expect(result.error?.message).toContain(
      'GROQ_API_KEY, ASSEMBLYAI_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY, or FAL_KEY',
    );
    expect(spawn).toHaveBeenCalled();
  });

  it('falls back to OpenAI when mediaType is unsupported and ffmpeg is missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'summarize-whisper-cpp-unsupported-'));
    const modelPath = join(root, 'ggml-base.bin');
    await writeFile(modelPath, new Uint8Array([1, 2, 3]));

    const originalFetch = globalThis.fetch;
    try {
      vi.resetModules();
      vi.stubEnv('SUMMARIZE_DISABLE_LOCAL_WHISPER_CPP', '0');
      vi.stubEnv('SUMMARIZE_WHISPER_CPP_MODEL_PATH', modelPath);
      vi.stubEnv('SUMMARIZE_WHISPER_CPP_BINARY', 'whisper-cli');

      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/v1/audio/transcriptions')) {
          return Response.json(
            { text: 'openai took over' },
            { headers: { 'content-type': 'application/json' }, status: 200 },
          );
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }) as unknown as typeof fetch;

      vi.doMock('node:child_process', () => ({
        spawn: (_cmd: string, args: string[]) => {
          const handlers = new Map<string, (value?: unknown) => void>();
          const proc = {
            on(event: string, handler: (value?: unknown) => void) {
              handlers.set(event, handler);
              if (_cmd === 'ffmpeg' && args.includes('-version') && event === 'error') {
                queueMicrotask(() => {
                  handler(new Error('spawn ENOENT'));
                });
              }
              return proc;
            },
          } as unknown;

          if (_cmd === 'whisper-cli' && args.includes('--help')) {
            queueMicrotask(() => handlers.get('close')?.(0));
            return proc;
          }

          if (_cmd === 'ffmpeg' && args.includes('-version')) {
            queueMicrotask(() => handlers.get('error')?.(new Error('spawn ENOENT')));
            return proc;
          }

          throw new Error(`Unexpected spawn: ${_cmd} ${args.join(' ')}`);
        },
      }));

      const { transcribeMediaWithWhisper } =
        await import('../packages/core/src/transcription/whisper.js');
      const result = await transcribeMediaWithWhisper({
        bytes: new Uint8Array([1, 2, 3]),
        falApiKey: null,
        filename: 'clip.mp4',
        groqApiKey: null,
        mediaType: 'video/mp4',
        openaiApiKey: 'OPENAI',
      });

      expect(result.text).toBe('openai took over');
      expect(result.provider).toBe('openai');
      expect(result.notes.join(' ')).toContain('whisper.cpp failed');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('falls back to OpenAI when whisper.cpp produces an empty transcript', async () => {
    const root = await mkdtemp(join(tmpdir(), 'summarize-whisper-cpp-empty-'));
    const modelPath = join(root, 'ggml-base.bin');
    await writeFile(modelPath, new Uint8Array([1, 2, 3]));

    const originalFetch = globalThis.fetch;
    try {
      vi.resetModules();
      vi.stubEnv('SUMMARIZE_DISABLE_LOCAL_WHISPER_CPP', '0');
      vi.stubEnv('SUMMARIZE_WHISPER_CPP_MODEL_PATH', modelPath);
      vi.stubEnv('SUMMARIZE_WHISPER_CPP_BINARY', 'whisper-cli');

      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/v1/audio/transcriptions')) {
          return Response.json(
            { text: 'openai fallback' },
            { headers: { 'content-type': 'application/json' }, status: 200 },
          );
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }) as unknown as typeof fetch;

      vi.doMock('node:child_process', () => ({
        spawn: (_cmd: string, args: string[]) => {
          if (_cmd !== 'whisper-cli') {
            throw new Error(`Unexpected spawn: ${_cmd}`);
          }

          const stderr = new EventEmitter();
          stderr.setEncoding = () => {
            /* empty */
          };

          const handlers = new Map<string, (value?: unknown) => void>();
          const proc = {
            on(event: string, handler: (value?: unknown) => void) {
              handlers.set(event, handler);
              return proc;
            },
            stderr,
          } as unknown;

          if (args.includes('--help')) {
            queueMicrotask(() => handlers.get('close')?.(0));
            return proc;
          }

          const outIdx = args.indexOf('--output-file');
          const base = outIdx !== -1 ? args[outIdx + 1] : null;
          if (!base || typeof base !== 'string') {
            throw new Error('missing --output-file arg');
          }
          undefined;
          return proc;
        },
      }));

      const { transcribeMediaWithWhisper } =
        await import('../packages/core/src/transcription/whisper.js');
      const result = await transcribeMediaWithWhisper({
        bytes: new Uint8Array([1, 2, 3]),
        falApiKey: null,
        filename: 'audio.mp3',
        groqApiKey: null,
        mediaType: 'audio/mpeg',
        openaiApiKey: 'OPENAI',
      });

      expect(result.text).toBe('openai fallback');
      expect(result.provider).toBe('openai');
      expect(result.notes.join(' ')).toContain('whisper.cpp');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('uses the default model cache path under HOME when no explicit model env is set', async () => {
    const home = await mkdtemp(join(tmpdir(), 'summarize-whisper-cpp-home-'));
    const modelPath = join(home, '.summarize', 'cache', 'whisper-cpp', 'models', 'ggml-base.bin');
    await mkdir(join(home, '.summarize', 'cache', 'whisper-cpp', 'models'), { recursive: true });
    await writeFile(modelPath, new Uint8Array([1, 2, 3]));

    vi.resetModules();
    vi.stubEnv('HOME', home);
    vi.stubEnv('SUMMARIZE_DISABLE_LOCAL_WHISPER_CPP', '0');
    vi.stubEnv('SUMMARIZE_WHISPER_CPP_MODEL_PATH', '');
    vi.stubEnv('SUMMARIZE_WHISPER_CPP_BINARY', 'whisper-cli');

    vi.doMock('node:child_process', () => ({
      spawn: (_cmd: string, args: string[]) => {
        if (_cmd !== 'whisper-cli') {
          throw new Error(`Unexpected spawn: ${_cmd}`);
        }
        if (!args.includes('--help')) {
          throw new Error(`Unexpected args: ${args.join(' ')}`);
        }

        const handlers = new Map<string, (value?: unknown) => void>();
        const proc = {
          on(event: string, handler: (value?: unknown) => void) {
            handlers.set(event, handler);
            if (event === 'close') {
              queueMicrotask(() => {
                handler(0);
              });
            }
            return proc;
          },
        } as unknown;
        return proc;
      },
    }));

    const { isWhisperCppReady } = await import('../packages/core/src/transcription/whisper.js');
    await expect(isWhisperCppReady()).resolves.toBe(true);
  });

  it('transcodes unsupported media via ffmpeg and still transcribes locally', async () => {
    const root = await mkdtemp(join(tmpdir(), 'summarize-whisper-cpp-transcode-'));
    const modelPath = join(root, 'ggml-base.bin');
    const inputPath = join(root, 'video.mp4');
    await writeFile(modelPath, new Uint8Array([1, 2, 3]));
    await writeFile(inputPath, new Uint8Array([1, 2, 3]));

    vi.resetModules();
    vi.stubEnv('SUMMARIZE_DISABLE_LOCAL_WHISPER_CPP', '0');
    vi.stubEnv('SUMMARIZE_WHISPER_CPP_MODEL_PATH', modelPath);
    vi.stubEnv('SUMMARIZE_WHISPER_CPP_BINARY', 'whisper-cli');

    vi.doMock('node:child_process', () => ({
      spawn: (_cmd: string, args: string[]) => {
        const handlers = new Map<string, (value?: unknown) => void>();
        const stderr = new EventEmitter();
        stderr.setEncoding = () => {
          /* empty */
        };

        const proc = {
          on(event: string, handler: (value?: unknown) => void) {
            handlers.set(event, handler);
            return proc;
          },
          stderr,
        } as unknown;

        const close = (code: number) => {
          queueMicrotask(() => handlers.get('close')?.(code));
        };

        if (_cmd === 'whisper-cli' && args.includes('--help')) {
          close(0);
          return proc;
        }

        if (_cmd === 'ffmpeg' && args.includes('-version')) {
          close(0);
          return proc;
        }

        if (_cmd === 'ffmpeg') {
          const output = args.at(-1) ?? '';
          undefined;
          return proc;
        }

        if (_cmd === 'whisper-cli') {
          const outIdx = args.indexOf('--output-file');
          const base = outIdx !== -1 ? args[outIdx + 1] : null;
          if (!base || typeof base !== 'string') {
            throw new Error('missing --output-file arg');
          }
          undefined;
          return proc;
        }

        throw new Error(`Unexpected spawn: ${_cmd} ${args.join(' ')}`);
      },
    }));

    const { transcribeMediaFileWithWhisper } =
      await import('../packages/core/src/transcription/whisper.js');
    const result = await transcribeMediaFileWithWhisper({
      falApiKey: null,
      filePath: inputPath,
      filename: 'video.mp4',
      groqApiKey: null,
      mediaType: 'video/mp4',
      openaiApiKey: null,
      totalDurationSeconds: 60,
    });

    expect(result.text).toBe('transcoded ok');
    expect(result.provider).toBe('whisper.cpp');
    expect(result.notes.join(' ')).toContain('transcoded media to MP3 via ffmpeg');
  });

  it('surfaces a helpful local error when mediaType is unsupported and ffmpeg is missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'summarize-whisper-cpp-no-ffmpeg-'));
    const modelPath = join(root, 'ggml-base.bin');
    const inputPath = join(root, 'video.mp4');
    await writeFile(modelPath, new Uint8Array([1, 2, 3]));
    await writeFile(inputPath, new Uint8Array([1, 2, 3]));

    vi.resetModules();
    vi.stubEnv('SUMMARIZE_DISABLE_LOCAL_WHISPER_CPP', '0');
    vi.stubEnv('SUMMARIZE_WHISPER_CPP_MODEL_PATH', modelPath);
    vi.stubEnv('SUMMARIZE_WHISPER_CPP_BINARY', 'whisper-cli');

    vi.doMock('node:child_process', () => ({
      spawn: (_cmd: string, args: string[]) => {
        const handlers = new Map<string, (value?: unknown) => void>();
        const proc = {
          on(event: string, handler: (value?: unknown) => void) {
            handlers.set(event, handler);
            return proc;
          },
        } as unknown;

        if (_cmd === 'whisper-cli' && args.includes('--help')) {
          queueMicrotask(() => handlers.get('close')?.(0));
          return proc;
        }

        if (_cmd === 'ffmpeg' && args.includes('-version')) {
          queueMicrotask(() => handlers.get('error')?.(new Error('spawn ENOENT')));
          return proc;
        }

        throw new Error(`Unexpected spawn: ${_cmd} ${args.join(' ')}`);
      },
    }));

    const { transcribeMediaFileWithWhisper } =
      await import('../packages/core/src/transcription/whisper.js');
    const result = await transcribeMediaFileWithWhisper({
      falApiKey: null,
      filePath: inputPath,
      filename: 'video.mp4',
      groqApiKey: null,
      mediaType: 'video/mp4',
      openaiApiKey: null,
    });

    expect(result.text).toBeNull();
    expect(result.provider).toBeNull();
    expect(result.error?.message).toContain(
      'GROQ_API_KEY, ASSEMBLYAI_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY, or FAL_KEY',
    );
    expect(result.notes.join(' ')).toContain('supports only flac/mp3/ogg/wav');
  });

  it('skips whisper.cpp when model env points to a directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'summarize-whisper-cpp-dir-'));

    vi.resetModules();
    vi.stubEnv('SUMMARIZE_DISABLE_LOCAL_WHISPER_CPP', '0');
    vi.stubEnv('SUMMARIZE_WHISPER_CPP_MODEL_PATH', root);
    vi.stubEnv('SUMMARIZE_WHISPER_CPP_BINARY', 'whisper-cli');

    const spawn = vi.fn((_cmd: string, args: string[]) => {
      if (_cmd !== 'whisper-cli' || !args.includes('--help')) {
        throw new Error(`Unexpected spawn: ${_cmd} ${args.join(' ')}`);
      }
      const handlers = new Map<string, (value?: unknown) => void>();
      const proc = {
        on(event: string, handler: (value?: unknown) => void) {
          handlers.set(event, handler);
          if (event === 'close') {
            queueMicrotask(() => {
              handler(0);
            });
          }
          return proc;
        },
      } as unknown;
      return proc;
    });

    vi.doMock('node:child_process', () => ({ spawn }));

    const { isWhisperCppReady, transcribeMediaWithWhisper } =
      await import('../packages/core/src/transcription/whisper.js');
    await expect(isWhisperCppReady()).resolves.toBe(false);

    const result = await transcribeMediaWithWhisper({
      bytes: new Uint8Array([1, 2, 3]),
      falApiKey: null,
      filename: 'audio.mp3',
      groqApiKey: null,
      mediaType: 'audio/mpeg',
      openaiApiKey: null,
    });

    expect(result.text).toBeNull();
    expect(result.provider).toBeNull();
    expect(result.error?.message).toContain(
      'GROQ_API_KEY, ASSEMBLYAI_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY, or FAL_KEY',
    );
    expect(spawn).toHaveBeenCalled();
  });
});
