import { randomUUID } from 'node:crypto';
import { createWriteStream, promises as fs } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';

import { spawnTracked } from '../processes.js';
import { isFfmpegAvailable, runFfmpegTranscodeToWav } from './whisper/ffmpeg.js';
import type { WhisperProgressEvent, WhisperTranscriptionResult } from './whisper/types.js';
import { wrapError } from './whisper/utils.js';

export type OnnxModelId = 'parakeet' | 'canary';

type Env = Record<string, string | undefined>;

export function resolvePreferredOnnxModel(env: Env = process.env): OnnxModelId | null {
  const raw = env.SUMMARIZE_TRANSCRIBER?.trim().toLowerCase() ?? '';
  if (raw === 'parakeet' || raw === 'canary') {
    return raw;
  }
  if (raw && raw !== 'auto') {
    return null;
  }
  if (resolveOnnxCommand('parakeet', env)) {
    return 'parakeet';
  }
  if (resolveOnnxCommand('canary', env)) {
    return 'canary';
  }
  return null;
}

export function isOnnxCliConfigured(model: OnnxModelId, env: Env = process.env): boolean {
  return resolveOnnxCommand(model, env) !== null;
}

const COMMAND_ENV_VAR: Record<OnnxModelId, string> = {
  canary: 'SUMMARIZE_ONNX_CANARY_CMD',
  parakeet: 'SUMMARIZE_ONNX_PARAKEET_CMD',
};

const MODEL_SOURCES: Record<
  OnnxModelId,
  { repo: string; files: { name: string; path: string }[] }
> = {
  canary: {
    files: [
      { name: 'model', path: 'model.onnx' },
      { name: 'vocab', path: 'vocab.txt' },
    ],
    repo: 'istupakov/canary-1b-v2-onnx',
  },
  parakeet: {
    files: [
      { name: 'model', path: 'model.onnx' },
      { name: 'vocab', path: 'vocab.txt' },
    ],
    repo: 'istupakov/parakeet-tdt-0.6b-v3-onnx',
  },
};

export function resolveOnnxProviderId(model: OnnxModelId): WhisperTranscriptionResult['provider'] {
  return model === 'parakeet' ? 'onnx-parakeet' : 'onnx-canary';
}

export function resolveOnnxCommand(model: OnnxModelId, env: Env = process.env): string | null {
  const raw = env[COMMAND_ENV_VAR[model]]?.trim();
  return raw && raw.length > 0 ? raw : null;
}

interface ModelArtifacts {
  modelDir: string;
  modelPath: string;
  vocabPath: string;
}

type CommandTemplate =
  | { kind: 'argv'; argvTemplate: string[] }
  | { kind: 'shell'; commandTemplate: string };

function parseCommandTemplate(raw: string): CommandTemplate {
  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (
        Array.isArray(parsed) &&
        parsed.length > 0 &&
        parsed.every((v) => typeof v === 'string' && v.trim().length > 0)
      ) {
        return { argvTemplate: parsed as string[], kind: 'argv' };
      }
    } catch {
      // Fall through to shell mode
    }
  }
  return { commandTemplate: trimmed, kind: 'shell' };
}

function shellEscape(value: string): string {
  if (process.platform === 'win32') {
    // Best-effort: quote for cmd.exe-ish shells.
    return `"${value.replaceAll('"', '""')}"`;
  }
  // POSIX shell-safe single-quote escaping.
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function buildArgvCommand({
  argvTemplate,
  inputPath,
  artifacts,
}: {
  argvTemplate: string[];
  inputPath: string;
  artifacts: ModelArtifacts;
}): { command: string; args: string[] } {
  const inputPlaceholderPresent = argvTemplate.some((arg) => arg.includes('{input}'));
  const replacements: Record<string, string> = {
    '{input}': inputPath,
    '{model_dir}': artifacts.modelDir,
    '{model}': artifacts.modelPath,
    '{vocab}': artifacts.vocabPath,
  };

  const argv = argvTemplate.map((arg) => {
    let next = arg;
    for (const [needle, replacement] of Object.entries(replacements)) {
      if (next.includes(needle)) {
        next = next.replaceAll(needle, replacement);
      }
    }
    return next;
  });

  if (!inputPlaceholderPresent) {
    argv.push(inputPath);
  }

  const [command, ...args] = argv;
  return { args, command };
}

function buildShellCommand({
  commandTemplate,
  inputPath,
  artifacts,
}: {
  commandTemplate: string;
  inputPath: string;
  artifacts: ModelArtifacts;
}): string {
  const inputPlaceholderPresent = commandTemplate.includes('{input}');
  const replacements: Record<string, string> = {
    '{input}': shellEscape(inputPath),
    '{model_dir}': shellEscape(artifacts.modelDir),
    '{model}': shellEscape(artifacts.modelPath),
    '{vocab}': shellEscape(artifacts.vocabPath),
  };

  let command = commandTemplate;
  for (const [needle, replacement] of Object.entries(replacements)) {
    if (command.includes(needle)) {
      command = command.replaceAll(needle, replacement);
    }
  }

  if (!inputPlaceholderPresent) {
    command = `${command} ${shellEscape(inputPath)}`;
  }

  return command;
}

function resolveCacheDir(env: Env) {
  const override = env.SUMMARIZE_ONNX_CACHE_DIR?.trim();
  if (override) {
    return override;
  }
  const base = env.XDG_CACHE_HOME?.trim() ?? join(homedir(), '.cache');
  return join(base, 'summarize', 'onnx');
}

async function ensurePathExists(path: string) {
  await fs.mkdir(path, { recursive: true });
}

async function downloadFile(url: string, destination: string) {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(
      `download failed (${response.status}): ${response.statusText || 'unknown error'}`,
    );
  }

  // `fetch` Response.body is typed as DOM `ReadableStream` but Node's `Readable.fromWeb` expects
  // `node:stream/web`'s `ReadableStream` (which includes async-iterator helpers). Runtime is fine.
  const body = response.body as unknown as NodeReadableStream;
  await pipeline(Readable.fromWeb(body), createWriteStream(destination));
}

async function ensureModelArtifactsDownloaded({
  model,
  notes,
  env,
}: {
  model: OnnxModelId;
  notes: string[];
  env: Env;
}): Promise<ModelArtifacts> {
  const cacheDir = resolveCacheDir(env);
  const modelDir = join(cacheDir, model);
  await ensurePathExists(modelDir);

  const source = MODEL_SOURCES[model];
  const mirrorOverride = env.SUMMARIZE_ONNX_MODEL_BASE_URL?.trim()?.replace(/\/$/, '') ?? null;

  let downloaded = false;
  for (const file of source.files) {
    const targetPath = join(modelDir, file.path);
    const exists = await fs
      .stat(targetPath)
      .then(() => true)
      .catch(() => false);
    if (exists) {
      continue;
    }

    const baseUrl = mirrorOverride ?? `https://huggingface.co/${source.repo}/resolve/main`;
    const url = `${baseUrl}/${file.path}`;
    await downloadFile(url, targetPath);
    downloaded = true;
  }

  if (downloaded) {
    notes.push(`Downloaded ${model} ONNX files to ${modelDir}`);
  }

  return {
    modelDir,
    modelPath: join(modelDir, 'model.onnx'),
    vocabPath: join(modelDir, 'vocab.txt'),
  };
}

async function ensureWavInput({
  filePath,
  mediaType,
  notes,
}: {
  filePath: string;
  mediaType: string;
  notes: string[];
}): Promise<{ path: string; cleanup: (() => Promise<void>) | null }> {
  const lower = mediaType.toLowerCase();
  if (lower.includes('wav') || lower.includes('wave')) {
    return { cleanup: null, path: filePath };
  }

  const ffmpegAvailable = await isFfmpegAvailable();
  if (!ffmpegAvailable) {
    notes.push('ONNX transcriber: proceeding without ffmpeg transcode (input not WAV)');
    return { cleanup: null, path: filePath };
  }

  const outputPath = join(tmpdir(), `summarize-onnx-${randomUUID()}.wav`);
  try {
    await runFfmpegTranscodeToWav({ inputPath: filePath, outputPath });
    notes.push('ONNX transcriber: transcoded media to 16kHz WAV via ffmpeg');
    return {
      cleanup: async () => {
        await fs.unlink(outputPath).catch(() => {
          /* empty */
        });
      },
      path: outputPath,
    };
  } catch (error) {
    notes.push(
      `ONNX transcriber: ffmpeg transcode to WAV failed (${wrapError('ffmpeg', error).message}); using original input`,
    );
    return { cleanup: null, path: filePath };
  }
}

export async function transcribeWithOnnxCli({
  model,
  bytes,
  mediaType,
  filename,
  totalDurationSeconds = null,
  onProgress = null,
  env = process.env,
}: {
  model: OnnxModelId;
  bytes: Uint8Array;
  mediaType: string;
  filename: string | null;
  totalDurationSeconds?: number | null;
  onProgress?: ((event: WhisperProgressEvent) => void) | null;
  env?: Env;
}): Promise<WhisperTranscriptionResult> {
  const nameHint = filename?.trim() ?? 'media';
  const baseName = basename(nameHint).replaceAll('/', '_').replaceAll('\\', '_').trim() ?? 'media';
  const safeName = extname(baseName) ? baseName : `${baseName}${extname(nameHint) ?? '.bin'}`;
  const tempFile = join(tmpdir(), `summarize-onnx-${randomUUID()}-${safeName}`);
  try {
    await fs.writeFile(tempFile, bytes);
    return await transcribeWithOnnxCliFile({
      env,
      filePath: tempFile,
      mediaType,
      model,
      onProgress,
      totalDurationSeconds,
    });
  } finally {
    await fs.unlink(tempFile).catch(() => {
      /* empty */
    });
  }
}

export async function transcribeWithOnnxCliFile({
  model,
  filePath,
  mediaType,
  totalDurationSeconds = null,
  onProgress = null,
  env = process.env,
}: {
  model: OnnxModelId;
  filePath: string;
  mediaType: string;
  totalDurationSeconds?: number | null;
  onProgress?: ((event: WhisperProgressEvent) => void) | null;
  env?: Env;
}): Promise<WhisperTranscriptionResult> {
  const notes: string[] = [];
  const commandTemplate = resolveOnnxCommand(model, env);
  const provider = resolveOnnxProviderId(model);

  if (!commandTemplate) {
    return {
      error: new Error(
        `${provider}: command not configured (set ${COMMAND_ENV_VAR[model]} to a CLI that emits text from WAV audio)`,
      ),
      notes,
      provider,
      text: null,
    };
  }

  let artifacts: ModelArtifacts;
  try {
    artifacts = await ensureModelArtifactsDownloaded({ env, model, notes });
  } catch (error) {
    return {
      error: wrapError(`${provider} model download failed`, error),
      notes,
      provider,
      text: null,
    };
  }

  const wavInput = await ensureWavInput({ filePath, mediaType, notes });
  const template = parseCommandTemplate(commandTemplate);
  const argvCommand =
    template.kind === 'argv'
      ? buildArgvCommand({
          argvTemplate: template.argvTemplate,
          artifacts,
          inputPath: wavInput.path,
        })
      : null;
  const shellCommand =
    template.kind === 'shell'
      ? buildShellCommand({
          artifacts,
          commandTemplate: template.commandTemplate,
          inputPath: wavInput.path,
        })
      : null;

  return new Promise<WhisperTranscriptionResult>((resolve) => {
    onProgress?.({
      partIndex: null,
      parts: null,
      processedDurationSeconds: null,
      totalDurationSeconds,
    });

    const { proc } = argvCommand
      ? spawnTracked(argvCommand.command, argvCommand.args, {
          kind: provider ?? 'onnx',
          label: provider ?? argvCommand.command,
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      : spawnTracked(shellCommand!, [], {
          kind: provider ?? 'onnx',
          label: provider ?? 'onnx',
          shell: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
    let stdout = '';
    let stderr = '';
    proc.stdout?.setEncoding('utf8');
    proc.stdout?.on('data', (chunk: string) => {
      if (stdout.length > 256_000) {
        return;
      }
      stdout += chunk;
    });
    proc.stderr?.setEncoding('utf8');
    proc.stderr?.on('data', (chunk: string) => {
      if (stderr.length > 16_000) {
        return;
      }
      stderr += chunk;
    });
    proc.on('error', (error) => {
      if (wavInput.cleanup) {
        undefined;
      }
      resolve({ error: wrapError(`${provider} failed`, error), notes, provider, text: null });
    });
    proc.on('close', (code) => {
      undefined;
    });
  });
}
