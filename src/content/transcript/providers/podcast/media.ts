import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  transcribeMediaFileWithWhisper,
  type TranscriptionProgressEvent,
} from '../../../../transcription/endpoint.js';
import type { ProviderFetchOptions } from '../../types.js';
import { resolveTranscriptionStartInfo } from '../transcription-start.js';
import { MAX_REMOTE_MEDIA_BYTES, TRANSCRIPTION_TIMEOUT_MS } from './constants.js';

export interface TranscribeRequest {
  url: string;
  filenameHint: string;
  durationSecondsHint: number | null;
}

export interface TranscriptionResult {
  text: string | null;
  provider: string | null;
  error: Error | null;
}

export async function transcribeMediaUrl({
  fetchImpl,
  env,
  url,
  filenameHint,
  durationSecondsHint,
  notes,
  progress,
}: {
  fetchImpl: typeof fetch;
  env?: Record<string, string | undefined>;
  url: string;
  filenameHint: string;
  durationSecondsHint: number | null;
  notes: string[];
  progress: {
    url: string;
    service: 'podcast';
    onProgress: ProviderFetchOptions['onProgress'] | null;
  } | null;
}): Promise<TranscriptionResult> {
  const startInfo = await resolveTranscriptionStartInfo({ env });
  if (!startInfo.availability.hasAnyProvider) {
    return {
      error: new Error(
        'No transcription provider available. Set GIST_LOCAL_BASE_URL or OPENROUTER_API_KEY.',
      ),
      provider: null,
      text: null,
    };
  }

  const head = await probeRemoteMedia(fetchImpl, url);
  if (head.contentLength !== null && head.contentLength > MAX_REMOTE_MEDIA_BYTES) {
    throw new Error(
      `Remote media too large (${formatBytes(head.contentLength)}). Limit is ${formatBytes(MAX_REMOTE_MEDIA_BYTES)}.`,
    );
  }

  const mediaType = head.mediaType ?? 'application/octet-stream';
  const filename = head.filename ?? filenameHint;
  const totalBytes = head.contentLength;

  progress?.onProgress?.({
    kind: 'transcript-media-download-start',
    mediaKind: 'audio',
    mediaUrl: url,
    service: progress.service,
    totalBytes,
    url: progress.url,
  });

  const tmpFile = join(tmpdir(), `gist-podcast-${crypto.randomUUID()}.bin`);
  try {
    const downloadedBytes = await downloadToFile(fetchImpl, url, tmpFile, {
      onProgress: (nextDownloadedBytes) =>
        progress?.onProgress?.({
          downloadedBytes: nextDownloadedBytes,
          kind: 'transcript-media-download-progress',
          mediaKind: 'audio',
          service: progress.service,
          totalBytes,
          url: progress.url,
        }),
      totalBytes,
    });
    progress?.onProgress?.({
      downloadedBytes,
      kind: 'transcript-media-download-done',
      mediaKind: 'audio',
      service: progress.service,
      totalBytes,
      url: progress.url,
    });

    progress?.onProgress?.({
      kind: 'transcript-whisper-start',
      modelId: startInfo.modelId,
      parts: null,
      providerHint: startInfo.providerHint,
      service: progress.service,
      totalDurationSeconds: durationSecondsHint,
      url: progress.url,
    });

    const onProgress = (event: TranscriptionProgressEvent) => {
      progress?.onProgress?.({
        kind: 'transcript-whisper-progress',
        partIndex: event.partIndex,
        parts: event.parts,
        processedDurationSeconds: event.processedDurationSeconds,
        service: progress.service,
        totalDurationSeconds: event.totalDurationSeconds,
        url: progress.url,
      });
    };

    const transcript = await transcribeMediaFileWithWhisper({
      env,
      filePath: tmpFile,
      filename,
      mediaType,
      onProgress,
    });
    if (transcript.notes.length > 0) {
      notes.push(...transcript.notes);
    }
    return { error: transcript.error, provider: transcript.provider, text: transcript.text };
  } finally {
    await fs.unlink(tmpFile).catch(() => {
      /* Empty */
    });
  }
}

export async function probeRemoteMedia(
  fetchImpl: typeof fetch,
  url: string,
): Promise<{ contentLength: number | null; mediaType: string | null; filename: string | null }> {
  try {
    const res = await fetchImpl(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(TRANSCRIPTION_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error('head failed');
    }
    const contentLength = parseContentLength(res.headers.get('content-length'));
    const mediaType = normalizeHeaderType(res.headers.get('content-type'));
    const filename = filenameFromUrl(url);
    return { contentLength, filename, mediaType };
  } catch {
    return { contentLength: null, filename: filenameFromUrl(url), mediaType: null };
  }
}

export async function downloadToFile(
  fetchImpl: typeof fetch,
  url: string,
  filePath: string,
  options?: { totalBytes: number | null; onProgress?: ((downloadedBytes: number) => void) | null },
): Promise<number> {
  const res = await fetchImpl(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(TRANSCRIPTION_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Download failed (${res.status})`);
  }
  const { body } = res;
  if (!body) {
    const bytes = new Uint8Array(await res.arrayBuffer());
    await fs.writeFile(filePath, bytes);
    options?.onProgress?.(bytes.byteLength);
    return bytes.byteLength;
  }

  const handle = await fs.open(filePath, 'w');
  let downloadedBytes = 0;
  let lastReported = 0;
  try {
    const reader = body.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        if (!value) {
          continue;
        }
        await handle.write(value);
        downloadedBytes += value.byteLength;
        if (downloadedBytes - lastReported >= 128 * 1024) {
          lastReported = downloadedBytes;
          options?.onProgress?.(downloadedBytes);
        }
      }
      options?.onProgress?.(downloadedBytes);
    } finally {
      await reader.cancel().catch(() => {
        /* Empty */
      });
    }
  } finally {
    await handle.close().catch(() => {
      /* Empty */
    });
  }
  return downloadedBytes;
}

export function normalizeHeaderType(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.split(';')[0]?.trim().toLowerCase() ?? null;
}

export function parseContentLength(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

export function filenameFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const base = parsed.pathname.split('/').pop() ?? '';
    return base.trim().length > 0 ? base : null;
  } catch {
    return null;
  }
}

export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  const decimals = value >= 10 || idx === 0 ? 0 : 1;
  return `${value.toFixed(decimals)}${units[idx]}`;
}
