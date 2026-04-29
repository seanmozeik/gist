import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { spawnTracked } from '../../processes.js';
import {
  DISABLE_LOCAL_WHISPER_CPP_ENV,
  WHISPER_CPP_BINARY_ENV,
  WHISPER_CPP_MODEL_PATH_ENV,
} from './constants.js';
import {
  isFfmpegAvailable,
  runFfmpegTranscodeToMp3,
  runFfmpegTranscodeToMp3Lenient,
} from './ffmpeg.js';
import type { WhisperProgressEvent, WhisperTranscriptionResult } from './types.js';
import { wrapError } from './utils.js';

export async function isWhisperCppReady(
  env?: Record<string, string | undefined>,
): Promise<boolean> {
  if (!isWhisperCppEnabled(env)) {
    return false;
  }
  if (!(await isWhisperCliAvailable(env))) {
    return false;
  }
  const model = await resolveWhisperCppModelPath(env);
  return Boolean(model);
}

export async function resolveWhisperCppModelNameForDisplay(
  env?: Record<string, string | undefined>,
): Promise<string | null> {
  const modelPath = await resolveWhisperCppModelPath(env);
  return modelPath ? resolveWhisperCppModelLabelFromPath(modelPath) : null;
}

export async function transcribeWithWhisperCppFile({
  filePath,
  mediaType,
  totalDurationSeconds,
  onProgress,
  env,
}: {
  filePath: string;
  mediaType: string;
  totalDurationSeconds: number | null;
  onProgress?: ((event: WhisperProgressEvent) => void) | null;
  env?: Record<string, string | undefined>;
}): Promise<WhisperTranscriptionResult> {
  const notes: string[] = [];
  const modelPath = await resolveWhisperCppModelPath(env);
  if (!modelPath) {
    return {
      error: new Error('whisper.cpp model not found (set SUMMARIZE_WHISPER_CPP_MODEL_PATH)'),
      notes,
      provider: null,
      text: null,
    };
  }

  const canUseDirectly = isWhisperCppSupportedMediaType(mediaType);
  const canTranscode = !canUseDirectly && (await isFfmpegAvailable());
  if (!canUseDirectly && !canTranscode) {
    return {
      error: new Error(
        `whisper.cpp supports only flac/mp3/ogg/wav (mediaType=${mediaType}); install ffmpeg to transcode`,
      ),
      notes,
      provider: 'whisper.cpp',
      text: null,
    };
  }
  const effectivePath = (() => {
    if (canUseDirectly) {
      return { cleanup: null as (() => Promise<void>) | null, path: filePath };
    }
    if (!canTranscode) {
      return { cleanup: null as (() => Promise<void>) | null, path: filePath };
    }
    const mp3Path = join(tmpdir(), `summarize-whisper-cpp-${randomUUID()}.mp3`);
    return {
      cleanup: async () => {
        await fs.unlink(mp3Path).catch(() => {
          /* empty */
        });
      },
      path: mp3Path,
    };
  })();

  try {
    if (!canUseDirectly && canTranscode) {
      // Whisper-cli supports only a few audio formats. We transcode via ffmpeg when possible to
      // Keep “any media file” working locally too.
      try {
        await runFfmpegTranscodeToMp3({ inputPath: filePath, outputPath: effectivePath.path });
        notes.push('whisper.cpp: transcoded media to MP3 via ffmpeg');
      } catch (error) {
        await runFfmpegTranscodeToMp3Lenient({
          inputPath: filePath,
          outputPath: effectivePath.path,
        });
        notes.push('whisper.cpp: transcoded media to MP3 via ffmpeg (lenient)');
        notes.push(`whisper.cpp: strict transcode failed: ${wrapError('ffmpeg', error).message}`);
      }
      onProgress?.({
        partIndex: null,
        parts: null,
        processedDurationSeconds: null,
        totalDurationSeconds,
      });
    }

    const outputBase = join(tmpdir(), `summarize-whisper-cpp-out-${randomUUID()}`);
    const outputTxt = `${outputBase}.txt`;

    const args = [
      '--model',
      modelPath,
      '--language',
      'auto',
      '--no-timestamps',
      '--no-prints',
      '--print-progress',
      '--output-txt',
      '--output-file',
      outputBase,
      effectivePath.path,
    ];

    try {
      await new Promise<void>((resolve, reject) => {
        const { proc, handle } = spawnTracked(resolveWhisperCppBinary(env), args, {
          kind: 'whisper.cpp',
          label: 'whisper.cpp',
          stdio: ['ignore', 'ignore', 'pipe'],
        });
        let stderr = '';
        proc.stderr?.setEncoding('utf8');
        let lastProgressPercent = -1;
        proc.stderr?.on('data', (chunk: string) => {
          if (stderr.length <= 8192) {
            stderr += chunk;
          }

          // Progress output from `whisper-cli --print-progress` arrives on stderr. We parse it
          // Best-effort and map to seconds when we know the total duration.
          const lines = chunk.split(/\r?\n/);
          for (const line of lines) {
            const match = /progress\s*=\s*(\d{1,3})%/i.exec(line);
            if (!match) {
              continue;
            }
            const raw = Number(match[1]);
            if (!Number.isFinite(raw)) {
              continue;
            }
            const pct = Math.max(0, Math.min(100, Math.round(raw)));
            if (pct === lastProgressPercent) {
              continue;
            }
            lastProgressPercent = pct;
            handle?.setProgress(pct, 'transcribing');
            const processed =
              typeof totalDurationSeconds === 'number' && totalDurationSeconds > 0
                ? (totalDurationSeconds * pct) / 100
                : null;
            onProgress?.({
              partIndex: null,
              parts: null,
              processedDurationSeconds: processed,
              totalDurationSeconds,
            });
          }
        });
        proc.on('error', reject);
        proc.on('close', (code) => {
          if (code === 0) {
            resolve();
            return;
          }
          reject(new Error(`whisper.cpp failed (${code ?? 'unknown'}): ${stderr.trim()}`));
        });
      });
    } catch (error) {
      return {
        error: wrapError('whisper.cpp failed', error),
        notes,
        provider: 'whisper.cpp',
        text: null,
      };
    }

    const raw = await fs.readFile(outputTxt, 'utf8').catch(() => '');
    await fs.unlink(outputTxt).catch(() => {
      /* empty */
    });
    const text = raw.trim();
    if (!text) {
      return {
        error: new Error('whisper.cpp returned empty text'),
        notes,
        provider: 'whisper.cpp',
        text: null,
      };
    }
    notes.push(`whisper.cpp: model=${resolveWhisperCppModelLabelFromPath(modelPath)}`);
    return { error: null, notes, provider: 'whisper.cpp', text };
  } finally {
    await effectivePath.cleanup?.().catch(() => {
      /* empty */
    });
  }
}

function isWhisperCppEnabled(env?: Record<string, string | undefined>): boolean {
  const source = env ?? process.env;
  return (source[DISABLE_LOCAL_WHISPER_CPP_ENV] ?? '').trim() !== '1';
}

async function isWhisperCliAvailable(env?: Record<string, string | undefined>): Promise<boolean> {
  const bin = resolveWhisperCppBinary(env);
  return new Promise((resolve) => {
    const { proc } = spawnTracked(bin, ['--help'], {
      captureOutput: false,
      kind: 'whisper.cpp',
      label: 'whisper.cpp',
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    proc.on('error', () => {
      resolve(false);
    });
    proc.on('close', (code) => {
      resolve(code === 0);
    });
  });
}

function resolveWhisperCppBinary(env?: Record<string, string | undefined>): string {
  const source = env ?? process.env;
  const override = (source[WHISPER_CPP_BINARY_ENV] ?? '').trim();
  return override.length > 0 ? override : 'whisper-cli';
}

async function resolveWhisperCppModelPath(
  env?: Record<string, string | undefined>,
): Promise<string | null> {
  const source = env ?? process.env;
  const override = (source[WHISPER_CPP_MODEL_PATH_ENV] ?? '').trim();
  if (override) {
    try {
      const stat = await fs.stat(override);
      return stat.isFile() ? override : null;
    } catch {
      return null;
    }
  }

  const home = (source.HOME ?? source.USERPROFILE ?? '').trim();
  const cacheCandidate = home
    ? join(home, '.summarize', 'cache', 'whisper-cpp', 'models', 'ggml-base.bin')
    : null;
  if (cacheCandidate) {
    try {
      const stat = await fs.stat(cacheCandidate);
      if (stat.isFile()) {
        return cacheCandidate;
      }
    } catch {
      // Ignore
    }
  }

  return null;
}

function resolveWhisperCppModelLabelFromPath(modelPath: string): string {
  const base = modelPath.split('/').pop() ?? modelPath;
  let name = base
    .replace(/^ggml-/, '')
    .replace(/\.bin$/i, '')
    .replace(/\.en$/i, '');
  name = name.trim();
  return name.length > 0 ? name : base;
}

function isWhisperCppSupportedMediaType(mediaType: string): boolean {
  const type = mediaType.toLowerCase().split(';')[0]?.trim() ?? '';
  return (
    type === 'audio/mpeg' ||
    type === 'audio/mp3' ||
    type === 'audio/mpga' ||
    type === 'audio/ogg' ||
    type === 'audio/oga' ||
    type === 'application/ogg' ||
    type === 'audio/flac' ||
    type === 'audio/x-wav' ||
    type === 'audio/wav'
  );
}
