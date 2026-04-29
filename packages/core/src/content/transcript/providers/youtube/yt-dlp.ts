import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { spawnTracked } from '../../../../processes.js';
import {
  probeMediaDurationSecondsWithFfprobe,
  type TranscriptionProvider,
  transcribeMediaFileWithWhisper,
} from '../../../../transcription/whisper.js';
import { buildMissingTranscriptionProviderMessage } from '../../../../transcription/whisper/provider-setup.js';
import type { MediaCache } from '../../../cache/types.js';
import type { LinkPreviewProgressEvent } from '../../../link-preview/deps.js';
import { ProgressKind } from '../../../link-preview/deps.js';
import { resolveLocalDirectMediaSource } from '../../../local-file.js';
import {
  resolveTranscriptionConfig,
  type TranscriptionConfig,
} from '../../transcription-config.js';
import { resolveTranscriptionStartInfo } from '../transcription-start.js';

const YT_DLP_TIMEOUT_MS = 300_000;
const MAX_STDERR_BYTES = 8192;
const DEFAULT_AUDIO_FORMAT =
  'bestaudio[vcodec=none]/best[height<=360]/best[height<=480]/best[height<=720]/best';

interface YtDlpTranscriptResult {
  text: string | null;
  provider: TranscriptionProvider | null;
  error: Error | null;
  notes: string[];
}

interface YtDlpRequest {
  ytDlpPath: string | null;
  transcription?: Partial<TranscriptionConfig> | null;
  env?: Record<string, string | undefined>;
  groqApiKey?: string | null;
  assemblyaiApiKey?: string | null;
  geminiApiKey?: string | null;
  openaiApiKey?: string | null;
  falApiKey?: string | null;
  url: string;
  onProgress?: ((event: LinkPreviewProgressEvent) => void) | null;
  service?: 'youtube' | 'podcast' | 'generic';
  mediaKind?: 'video' | 'audio' | null;
  mediaCache?: MediaCache | null;
  extraArgs?: string[];
}

interface YtDlpDurationRequest {
  ytDlpPath: string | null;
  url: string;
}

export const fetchTranscriptWithYtDlp = async ({
  ytDlpPath,
  transcription,
  env,
  groqApiKey,
  assemblyaiApiKey,
  geminiApiKey,
  openaiApiKey,
  falApiKey,
  url,
  onProgress,
  service = 'youtube',
  mediaKind = null,
  mediaCache = null,
  extraArgs,
}: YtDlpRequest): Promise<YtDlpTranscriptResult> => {
  const notes: string[] = [];
  const effectiveTranscription = resolveTranscriptionConfig({
    assemblyaiApiKey,
    env,
    falApiKey,
    geminiApiKey,
    groqApiKey,
    openaiApiKey,
    transcription,
  });

  if (!ytDlpPath) {
    return {
      error: new Error('yt-dlp is not configured (set YT_DLP_PATH or ensure yt-dlp is on PATH)'),
      notes,
      provider: null,
      text: null,
    };
  }
  const effectiveEnv = effectiveTranscription.env ?? process.env;
  const startInfo = await resolveTranscriptionStartInfo({ transcription: effectiveTranscription });

  if (!startInfo.availability.hasAnyProvider) {
    return {
      error: new Error(buildMissingTranscriptionProviderMessage()),
      notes,
      provider: null,
      text: null,
    };
  }

  const progress = typeof onProgress === 'function' ? onProgress : null;
  const { providerHint } = startInfo;
  const { modelId } = startInfo;
  const localFileInput = resolveLocalDirectMediaSource(url, mediaKind);
  const cachedMedia = localFileInput ? null : mediaCache ? await mediaCache.get({ url }) : null;

  const outputFile = join(tmpdir(), `summarize-${randomUUID()}.mp3`);
  let filePath = localFileInput?.filePath ?? cachedMedia?.filePath ?? outputFile;
  const mediaType = localFileInput?.mediaType ?? 'audio/mpeg';
  const filename =
    localFileInput?.filename ??
    cachedMedia?.filename ??
    (cachedMedia?.filePath ? basename(cachedMedia.filePath) : null) ??
    'audio.mp3';
  let shouldCleanup = !localFileInput?.filePath && !cachedMedia?.filePath;
  try {
    if (localFileInput) {
      notes.push('local file input');
    } else if (cachedMedia?.filePath) {
      progress?.({
        kind: ProgressKind.TranscriptMediaDownloadStart,
        mediaKind,
        mediaUrl: url,
        service,
        totalBytes: cachedMedia.sizeBytes ?? null,
        url,
      });
      progress?.({
        downloadedBytes: cachedMedia.sizeBytes ?? 0,
        kind: ProgressKind.TranscriptMediaDownloadDone,
        mediaKind,
        service,
        totalBytes: cachedMedia.sizeBytes ?? null,
        url,
      });
      notes.push('media cache hit');
    } else {
      progress?.({
        kind: ProgressKind.TranscriptMediaDownloadStart,
        mediaKind,
        mediaUrl: url,
        service,
        totalBytes: null,
        url,
      });
      await downloadAudio(
        ytDlpPath,
        url,
        outputFile,
        extraArgs,
        progress
          ? (downloadedBytes, totalBytes) => {
              progress({
                downloadedBytes,
                kind: ProgressKind.TranscriptMediaDownloadProgress,
                mediaKind,
                service,
                totalBytes,
                url,
              });
            }
          : null,
      );
      const stat = await fs.stat(outputFile);
      progress?.({
        downloadedBytes: stat.size,
        kind: ProgressKind.TranscriptMediaDownloadDone,
        mediaKind,
        service,
        totalBytes: null,
        url,
      });

      if (mediaCache) {
        const stored = await mediaCache.put({
          filePath: outputFile,
          filename: 'audio.mp3',
          mediaType: 'audio/mpeg',
          url,
        });
        if (stored?.filePath) {
          ({ filePath } = stored);
          shouldCleanup = false;
          notes.push('media cached');
        }
      }
    }

    const probedDurationSeconds = await probeMediaDurationSecondsWithFfprobe(filePath);
    progress?.({
      kind: ProgressKind.TranscriptWhisperStart,
      modelId,
      parts: null,
      providerHint,
      service,
      totalDurationSeconds: probedDurationSeconds,
      url,
    });
    const result = await transcribeMediaFileWithWhisper({
      assemblyaiApiKey: effectiveTranscription.assemblyaiApiKey,
      env: effectiveEnv,
      falApiKey: effectiveTranscription.falApiKey,
      filePath,
      filename,
      geminiApiKey: effectiveTranscription.geminiApiKey,
      groqApiKey: effectiveTranscription.groqApiKey,
      mediaType,
      onProgress: (event) => {
        progress?.({
          kind: ProgressKind.TranscriptWhisperProgress,
          partIndex: event.partIndex,
          parts: event.parts,
          processedDurationSeconds: event.processedDurationSeconds,
          service,
          totalDurationSeconds: event.totalDurationSeconds,
          url,
        });
      },
      openaiApiKey: effectiveTranscription.openaiApiKey,
      totalDurationSeconds: probedDurationSeconds,
    });
    if (result.notes.length > 0) {
      notes.push(...result.notes);
    }
    return { error: result.error, notes, provider: result.provider, text: result.text };
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('unable to obtain file audio codec with ffprobe')
    ) {
      return {
        error: null,
        notes: [...notes, 'yt-dlp: Media has no audio stream'],
        provider: null,
        text: '',
      };
    }
    return {
      error: wrapError('yt-dlp failed to download audio', error),
      notes,
      provider: null,
      text: null,
    };
  } finally {
    if (shouldCleanup) {
      await fs.unlink(filePath).catch(() => {
        /* empty */
      });
    }
  }
};

export const fetchDurationSecondsWithYtDlp = async ({
  ytDlpPath,
  url,
}: YtDlpDurationRequest): Promise<number | null> => {
  if (!ytDlpPath) {
    return null;
  }

  return new Promise((resolve) => {
    const args = ['--skip-download', '--dump-json', '--no-playlist', '--no-warnings', url];
    const { proc } = spawnTracked(ytDlpPath, args, {
      kind: 'yt-dlp',
      label: 'yt-dlp',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';

    const timeout = setTimeout(() => {
      proc.kill('SIGKILL');
      resolve(null);
    }, 30_000);

    proc.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    proc.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > MAX_STDERR_BYTES) {
        stderr = stderr.slice(-MAX_STDERR_BYTES);
      }
    });

    proc.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        resolve(null);
        return;
      }
      const jsonLine = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.startsWith('{'));
      if (!jsonLine) {
        resolve(null);
        return;
      }
      try {
        const parsed = JSON.parse(jsonLine) as { duration?: unknown };
        const duration = typeof parsed.duration === 'number' ? parsed.duration : Number.NaN;
        resolve(Number.isFinite(duration) && duration > 0 ? duration : null);
      } catch {
        resolve(null);
      }
    });

    proc.on('error', () => {
      clearTimeout(timeout);
      resolve(null);
    });
  });
};

async function downloadAudio(
  ytDlpPath: string,
  url: string,
  outputFile: string,
  extraArgs?: string[],
  onProgress?: ((downloadedBytes: number, totalBytes: number | null) => void) | null,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const progressTemplate =
      'progress:%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s';
    // Add --enable-file-urls flag for local file:// URLs
    const isFileUrl = url.startsWith('file://');
    const args = [
      '-f',
      DEFAULT_AUDIO_FORMAT,
      '-x',
      '--audio-format',
      'mp3',
      '--concurrent-fragments',
      '4',
      '--no-playlist',
      '--retries',
      '3',
      '--no-warnings',
      ...(isFileUrl ? ['--enable-file-urls'] : []),
      ...(onProgress ? ['--progress', '--newline', '--progress-template', progressTemplate] : []),
      ...(extraArgs?.length ? extraArgs : []),
      '-o',
      outputFile,
      url,
    ];

    const { proc, handle } = spawnTracked(ytDlpPath, args, {
      kind: 'yt-dlp',
      label: 'yt-dlp',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    let progressBuffer = '';
    let lastTotalBytes: number | null = null;

    const reportProgress = (downloadedBytes: number, totalBytes: number | null): void => {
      if (!onProgress) {
        return;
      }
      let normalizedTotal = totalBytes;
      if (typeof normalizedTotal === 'number' && Number.isFinite(normalizedTotal)) {
        if (normalizedTotal > 0) {
          if (lastTotalBytes === null || normalizedTotal > lastTotalBytes) {
            lastTotalBytes = normalizedTotal;
          } else if (normalizedTotal < lastTotalBytes) {
            normalizedTotal = lastTotalBytes;
          }
        }
      } else if (lastTotalBytes !== null) {
        normalizedTotal = lastTotalBytes;
      }
      onProgress(downloadedBytes, normalizedTotal);
      if (normalizedTotal && normalizedTotal > 0) {
        const pct = Math.max(
          0,
          Math.min(100, Math.round((downloadedBytes / normalizedTotal) * 100)),
        );
        handle?.setProgress(pct, 'download');
      }
    };

    const handleProgressChunk = (chunk: string) => {
      if (!onProgress) {
        return;
      }
      progressBuffer += chunk;
      const lines = progressBuffer.split(/\r?\n/);
      progressBuffer = lines.pop() ?? '';
      for (const line of lines) {
        emitProgressFromLine(line, reportProgress);
      }
    };

    if (proc.stdout) {
      proc.stdout.setEncoding('utf8');
      proc.stdout.on('data', (chunk: string) => {
        handleProgressChunk(chunk);
      });
    }

    if (proc.stderr) {
      proc.stderr.setEncoding('utf8');
      proc.stderr.on('data', (chunk: string) => {
        if (stderr.length < MAX_STDERR_BYTES) {
          const remaining = MAX_STDERR_BYTES - stderr.length;
          stderr += chunk.slice(0, remaining);
        }
        handleProgressChunk(chunk);
      });
    }

    const timeout = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error('yt-dlp download timeout'));
    }, YT_DLP_TIMEOUT_MS);

    proc.on('close', (code, signal) => {
      if (onProgress && progressBuffer.trim().length > 0) {
        emitProgressFromLine(progressBuffer, reportProgress);
      }
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
        return;
      }
      const detail = stderr.trim();
      const suffix = detail ? `: ${detail}` : '';
      if (code === null) {
        reject(new Error(`yt-dlp terminated (${signal ?? 'unknown'})${suffix}`));
        return;
      }
      reject(new Error(`yt-dlp exited with code ${code}${suffix}`));
    });

    proc.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function emitProgressFromLine(
  line: string,
  onProgress: (downloadedBytes: number, totalBytes: number | null) => void,
): void {
  const trimmed = line.trim();
  if (!trimmed.startsWith('progress:')) {
    return;
  }
  const payload = trimmed.slice('progress:'.length);
  const [downloadedRaw, totalRaw, estimateRaw] = payload.split('|');
  const downloaded = Number.parseFloat(downloadedRaw);
  if (!Number.isFinite(downloaded) || downloaded < 0) {
    return;
  }
  const totalCandidate = Number.parseFloat(totalRaw);
  const estimateCandidate = Number.parseFloat(estimateRaw);
  const totalBytes =
    Number.isFinite(totalCandidate) && totalCandidate > 0
      ? totalCandidate
      : Number.isFinite(estimateCandidate) && estimateCandidate > 0
        ? estimateCandidate
        : null;
  onProgress(downloaded, totalBytes);
}

function wrapError(prefix: string, error: unknown): Error {
  if (error instanceof Error) {
    return new Error(`${prefix}: ${error.message}`, { cause: error });
  }
  return new Error(`${prefix}: ${String(error)}`);
}
