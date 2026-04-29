import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  cloudProviderLabel,
  formatCloudFallbackTargets,
  resolveCloudProviderOrder,
  type CloudProvider,
} from './cloud-providers.js';
import { DEFAULT_SEGMENT_SECONDS, MAX_OPENAI_UPLOAD_BYTES } from './constants.js';
import { isFfmpegAvailable } from './ffmpeg.js';
import { buildMissingTranscriptionProviderMessage } from './provider-setup.js';
import {
  attemptRemoteBytesProvider,
  attemptRemoteFileProvider,
} from './remote-provider-attempts.js';
import type { WhisperProgressEvent, WhisperTranscriptionResult } from './types.js';
import { formatBytes, readFirstBytes } from './utils.js';

type Env = Record<string, string | undefined>;

interface CloudArgs {
  groqApiKey: string | null;
  groqError?: Error | null;
  assemblyaiApiKey: string | null;
  geminiApiKey: string | null;
  openaiApiKey: string | null;
  falApiKey: string | null;
  env: Env;
}

interface FailedAttempt {
  provider: CloudProvider | 'groq' | null;
  error: Error;
}

function withMergedNotes(
  result: WhisperTranscriptionResult,
  notes: string[],
): WhisperTranscriptionResult {
  if (result.notes.length === 0) {
    return { ...result, notes };
  }
  return { ...result, notes: [...notes, ...result.notes] };
}

function buildNoProviderResult({
  notes,
  groqApiKey,
  groqError,
}: {
  notes: string[];
  groqApiKey: string | null;
  groqError: Error | null;
}): WhisperTranscriptionResult {
  if (groqApiKey) {
    return {
      error: groqError ?? new Error('No transcription providers available'),
      notes,
      provider: 'groq',
      text: null,
    };
  }
  return {
    error: new Error(buildMissingTranscriptionProviderMessage()),
    notes,
    provider: null,
    text: null,
  };
}

async function transcribeBytesAcrossProviders({
  providerOrder,
  bytes,
  mediaType,
  filename,
  notes,
  groqApiKey,
  groqError = null,
  assemblyaiApiKey,
  geminiApiKey,
  openaiApiKey,
  falApiKey,
  env,
  onProgress,
  transcribeOversizedBytesWithChunking,
}: {
  providerOrder: CloudProvider[];
  bytes: Uint8Array;
  mediaType: string;
  filename: string | null;
  notes: string[];
  onProgress?: ((event: WhisperProgressEvent) => void) | null;
  transcribeOversizedBytesWithChunking?: (args: {
    bytes: Uint8Array;
    mediaType: string;
    filename: string | null;
    onProgress?: ((event: WhisperProgressEvent) => void) | null;
  }) => Promise<WhisperTranscriptionResult>;
} & CloudArgs): Promise<WhisperTranscriptionResult> {
  if (providerOrder.length === 0) {
    return buildNoProviderResult({ groqApiKey, groqError, notes });
  }

  let currentBytes = bytes;
  let currentMediaType = mediaType;
  let currentFilename = filename;
  let lastFailure: FailedAttempt | null = null;

  for (const [index, provider] of providerOrder.entries()) {
    const attempt = await attemptRemoteBytesProvider({
      assemblyaiApiKey,
      env,
      falApiKey,
      geminiApiKey,
      notes,
      onProgress,
      openaiApiKey,
      provider,
      state: { bytes: currentBytes, filename: currentFilename, mediaType: currentMediaType },
      transcribeOversizedBytesWithChunking,
    });
    currentBytes = attempt.state.bytes;
    currentMediaType = attempt.state.mediaType;
    currentFilename = attempt.state.filename;
    if (attempt.result) {
      return withMergedNotes(attempt.result, notes);
    }
    if (!attempt.error) {
      continue;
    }

    lastFailure = { error: attempt.error, provider };
    const remaining = providerOrder.slice(index + 1).filter((candidate) => {
      if (candidate !== 'fal') {
        return true;
      }
      return currentMediaType.toLowerCase().startsWith('audio/');
    });
    if (remaining.length > 0) {
      notes.push(
        `${cloudProviderLabel(provider, false)} transcription failed; falling back to ${formatCloudFallbackTargets(remaining)}: ${attempt.error.message}`,
      );
    }
  }

  if (lastFailure) {
    return { error: lastFailure.error, notes, provider: lastFailure.provider, text: null };
  }
  return buildNoProviderResult({ groqApiKey, groqError, notes });
}

export async function transcribeBytesWithRemoteFallbacks({
  bytes,
  mediaType,
  filename,
  notes,
  groqApiKey,
  groqError = null,
  assemblyaiApiKey,
  geminiApiKey,
  openaiApiKey,
  falApiKey,
  env,
  onProgress,
  transcribeOversizedBytesWithChunking,
}: {
  bytes: Uint8Array;
  mediaType: string;
  filename: string | null;
  notes: string[];
  onProgress?: ((event: WhisperProgressEvent) => void) | null;
  transcribeOversizedBytesWithChunking: (args: {
    bytes: Uint8Array;
    mediaType: string;
    filename: string | null;
    onProgress?: ((event: WhisperProgressEvent) => void) | null;
  }) => Promise<WhisperTranscriptionResult>;
} & CloudArgs): Promise<WhisperTranscriptionResult> {
  return transcribeBytesAcrossProviders({
    assemblyaiApiKey,
    bytes,
    env,
    falApiKey,
    filename,
    geminiApiKey,
    groqApiKey,
    groqError,
    mediaType,
    notes,
    onProgress,
    openaiApiKey,
    providerOrder: resolveCloudProviderOrder({
      assemblyaiApiKey,
      falApiKey,
      geminiApiKey,
      openaiApiKey,
    }),
    transcribeOversizedBytesWithChunking,
  });
}

export async function transcribeFileWithRemoteFallbacks({
  filePath,
  mediaType,
  filename,
  notes,
  groqApiKey,
  groqError = null,
  assemblyaiApiKey,
  geminiApiKey,
  openaiApiKey,
  falApiKey,
  env,
  totalDurationSeconds,
  onProgress,
  transcribeChunkedFile,
}: {
  filePath: string;
  mediaType: string;
  filename: string | null;
  notes: string[];
  totalDurationSeconds: number | null;
  onProgress?: ((event: WhisperProgressEvent) => void) | null;
  transcribeChunkedFile: (args: {
    filePath: string;
    segmentSeconds: number;
    totalDurationSeconds: number | null;
    onProgress?: ((event: WhisperProgressEvent) => void) | null;
  }) => Promise<WhisperTranscriptionResult>;
} & CloudArgs): Promise<WhisperTranscriptionResult> {
  const providerOrder = resolveCloudProviderOrder({
    assemblyaiApiKey,
    falApiKey,
    geminiApiKey,
    openaiApiKey,
  });
  if (providerOrder.length === 0) {
    return buildNoProviderResult({ groqApiKey, groqError, notes });
  }

  const stat = await fs.stat(filePath);
  onProgress?.({
    partIndex: null,
    parts: null,
    processedDurationSeconds: null,
    totalDurationSeconds,
  });
  let cachedBytes: Uint8Array | null = null;
  const readFileBytes = async () => {
    if (cachedBytes) {
      return cachedBytes;
    }
    cachedBytes = new Uint8Array(await fs.readFile(filePath));
    return cachedBytes;
  };

  let lastFailure: FailedAttempt | null = null;

  for (const [index, provider] of providerOrder.entries()) {
    const fileAttempt = await attemptRemoteFileProvider({
      assemblyaiApiKey,
      env,
      filePath,
      filename,
      geminiApiKey,
      mediaType,
      provider,
    });
    if (fileAttempt.kind === 'result') {
      return withMergedNotes(fileAttempt.result, notes);
    }
    if (fileAttempt.kind === 'delegate-to-bytes') {
      if (provider === 'openai' && stat.size > MAX_OPENAI_UPLOAD_BYTES) {
        const canChunk = await isFfmpegAvailable();
        if (canChunk) {
          return withMergedNotes(
            await transcribeChunkedFile({
              filePath,
              onProgress,
              segmentSeconds: DEFAULT_SEGMENT_SECONDS,
              totalDurationSeconds,
            }),
            notes,
          );
        }
        notes.push(
          `Media too large for Whisper upload (${formatBytes(stat.size)}); install ffmpeg to enable chunked transcription`,
        );
        const head = await readFirstBytes(filePath, MAX_OPENAI_UPLOAD_BYTES);
        return withMergedNotes(
          await transcribeBytesAcrossProviders({
            assemblyaiApiKey,
            bytes: head,
            env,
            falApiKey,
            filename,
            geminiApiKey,
            groqApiKey,
            groqError,
            mediaType,
            notes: [],
            onProgress,
            openaiApiKey,
            providerOrder: providerOrder.slice(index),
          }),
          notes,
        );
      }
      return withMergedNotes(
        await transcribeBytesAcrossProviders({
          assemblyaiApiKey,
          bytes: await readFileBytes(),
          env,
          falApiKey,
          filename,
          geminiApiKey,
          groqApiKey,
          groqError,
          mediaType,
          notes: [],
          onProgress,
          openaiApiKey,
          providerOrder: providerOrder.slice(index),
        }),
        notes,
      );
    }
    lastFailure = { error: fileAttempt.error, provider };
    const remaining = providerOrder.slice(index + 1);
    if (remaining.length > 0) {
      notes.push(
        `${cloudProviderLabel(provider, false)} transcription failed; falling back to ${formatCloudFallbackTargets(remaining)}: ${fileAttempt.error.message}`,
      );
    }
  }

  if (lastFailure) {
    return { error: lastFailure.error, notes, provider: lastFailure.provider, text: null };
  }
  return buildNoProviderResult({ groqApiKey, groqError, notes });
}

export async function transcribeOversizedBytesViaTempFile({
  bytes,
  mediaType,
  filename,
  onProgress,
  transcribeFile,
}: {
  bytes: Uint8Array;
  mediaType: string;
  filename: string | null;
  onProgress?: ((event: WhisperProgressEvent) => void) | null;
  transcribeFile: (args: {
    filePath: string;
    mediaType: string;
    filename: string | null;
    onProgress?: ((event: WhisperProgressEvent) => void) | null;
  }) => Promise<WhisperTranscriptionResult>;
}): Promise<WhisperTranscriptionResult> {
  const tempFile = join(tmpdir(), `summarize-whisper-${randomUUID()}`);
  try {
    await fs.writeFile(tempFile, bytes);
    return await transcribeFile({ filePath: tempFile, filename, mediaType, onProgress });
  } finally {
    await fs.unlink(tempFile).catch(() => {});
  }
}
