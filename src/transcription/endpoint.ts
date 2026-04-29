const DEFAULT_ENDPOINT = '/transcribe';

export interface TranscriptionResult {
  text: string | null;
  provider: 'sidecar' | null;
  error: Error | null;
  notes: string[];
}

export interface TranscriptionProgressEvent {
  partIndex: number | null;
  parts: number | null;
  processedDurationSeconds: number | null;
  totalDurationSeconds: number | null;
}

export type TranscriptionProgressCallback = (event: TranscriptionProgressEvent) => void;

interface TranscribeMediaOptions {
  bytes: Uint8Array;
  mediaType: string;
  filename: string;
  onProgress?: TranscriptionProgressCallback | null;
  env?: Record<string, string | undefined>;
}

export async function transcribeMediaWithWhisper(
  options: TranscribeMediaOptions,
): Promise<TranscriptionResult> {
  const localBaseUrl =
    options.env?.SUMMARIZE_LOCAL_BASE_URL ?? process.env.SUMMARIZE_LOCAL_BASE_URL;
  if (!localBaseUrl) {
    return {
      text: null,
      provider: 'sidecar',
      error: new Error('Local sidecar not configured. Set SUMMARIZE_LOCAL_BASE_URL env var.'),
      notes: [],
    };
  }

  const endpoint =
    localBaseUrl +
    (options.env?.SUMMARIZE_TRANSCRIPTION_ENDPOINT ??
      process.env.SUMMARIZE_TRANSCRIPTION_ENDPOINT ??
      DEFAULT_ENDPOINT);

  try {
    options.onProgress?.({
      partIndex: null,
      parts: null,
      processedDurationSeconds: null,
      totalDurationSeconds: null,
    });

    const formData = new FormData();
    const buffer = Buffer.from(options.bytes);
    const blob = new Blob([buffer], { type: options.mediaType });
    formData.append('file', blob, options.filename);

    const response = await fetch(endpoint, { method: 'POST', body: formData });
    if (!response.ok) {
      return {
        text: null,
        provider: 'sidecar',
        error: new Error(`Transcription failed: ${response.status} ${response.statusText}`),
        notes: [],
      };
    }

    const data = (await response.json()) as { text?: string; segments?: unknown[] };
    return { text: data.text ?? null, provider: 'sidecar', error: null, notes: [] };
  } catch (err) {
    return {
      text: null,
      provider: 'sidecar',
      error: err instanceof Error ? err : new Error(String(err)),
      notes: [],
    };
  }
}

export async function transcribeMediaFileWithWhisper(options: {
  filePath: string;
  mediaType: string;
  filename: string;
  onProgress?: TranscriptionProgressCallback | null;
  env?: Record<string, string | undefined>;
}): Promise<TranscriptionResult> {
  const { promises: fs } = await import('node:fs');
  const bytes = await fs.readFile(options.filePath);
  return transcribeMediaWithWhisper({
    bytes,
    mediaType: options.mediaType,
    filename: options.filename,
    onProgress: options.onProgress,
    env: options.env,
  });
}
