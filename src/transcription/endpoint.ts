const DEFAULT_ENDPOINT = '/transcribe';
const OPENROUTER_TRANSCRIPTION_MODEL = 'openai/whisper-1';

export interface TranscriptionResult {
  text: string | null;
  provider: 'sidecar' | 'openrouter' | null;
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

function resolveAudioFormat({ filename, mediaType }: { filename: string; mediaType: string }) {
  const extension = filename.split('.').pop()?.toLowerCase();
  if (extension && /^[a-z0-9]+$/.test(extension)) {
    return extension === 'mpeg' ? 'mp3' : extension;
  }
  if (/mpeg|mp3/i.test(mediaType)) {
    return 'mp3';
  }
  if (/mp4|m4a/i.test(mediaType)) {
    return 'm4a';
  }
  if (/wav/i.test(mediaType)) {
    return 'wav';
  }
  if (/webm/i.test(mediaType)) {
    return 'webm';
  }
  if (/flac/i.test(mediaType)) {
    return 'flac';
  }
  if (/ogg/i.test(mediaType)) {
    return 'ogg';
  }
  return 'mp3';
}

function readOpenRouterText(data: unknown): string | null {
  const content = (data as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]
    ?.message?.content;
  if (typeof content === 'string') {
    return content.trim() || null;
  }
  if (Array.isArray(content)) {
    const text = content
      .map((part) =>
        typeof part === 'object' && part && 'text' in part
          ? String((part as { text?: unknown }).text ?? '')
          : '',
      )
      .join('')
      .trim();
    return text || null;
  }
  return null;
}

function hasOpenRouterApiKey(env: Record<string, string | undefined> | undefined): boolean {
  return Boolean((env?.OPENROUTER_API_KEY ?? process.env.OPENROUTER_API_KEY)?.trim());
}

function resolveOpenRouterTranscriptionModel(
  env: Record<string, string | undefined> | undefined,
): string {
  const configured = env?.GIST_TRANSCRIPTION_MODEL ?? process.env.GIST_TRANSCRIPTION_MODEL ?? '';
  return configured.trim() || OPENROUTER_TRANSCRIPTION_MODEL;
}

async function transcribeWithOpenRouter(
  options: TranscribeMediaOptions,
): Promise<TranscriptionResult> {
  const apiKey = options.env?.OPENROUTER_API_KEY ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey?.trim()) {
    return {
      error: new Error('OpenRouter transcription not configured. Set OPENROUTER_API_KEY.'),
      notes: [],
      provider: 'openrouter',
      text: null,
    };
  }

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      body: JSON.stringify({
        messages: [
          {
            content: [
              { text: 'Transcribe this audio. Return only the transcript text.', type: 'text' },
              {
                input_audio: {
                  data: Buffer.from(options.bytes).toString('base64'),
                  format: resolveAudioFormat(options),
                },
                type: 'input_audio',
              },
            ],
            role: 'user',
          },
        ],
        model: resolveOpenRouterTranscriptionModel(options.env),
        stream: false,
      }),
      headers: { Authorization: `Bearer ${apiKey.trim()}`, 'Content-Type': 'application/json' },
      method: 'POST',
    });
    if (!response.ok) {
      return {
        error: new Error(
          `OpenRouter transcription failed: ${response.status} ${response.statusText}`,
        ),
        notes: [],
        provider: 'openrouter',
        text: null,
      };
    }
    const data: unknown = await response.json();
    return { error: null, notes: [], provider: 'openrouter', text: readOpenRouterText(data) };
  } catch (error) {
    return {
      error: error instanceof Error ? error : new Error(String(error)),
      notes: [],
      provider: 'openrouter',
      text: null,
    };
  }
}

export async function transcribeMediaWithWhisper(
  options: TranscribeMediaOptions,
): Promise<TranscriptionResult> {
  const localBaseUrl = options.env?.GIST_LOCAL_BASE_URL ?? process.env.GIST_LOCAL_BASE_URL;
  if (!localBaseUrl) {
    return transcribeWithOpenRouter(options);
  }

  const endpoint =
    localBaseUrl +
    (options.env?.GIST_TRANSCRIPTION_ENDPOINT ??
      process.env.GIST_TRANSCRIPTION_ENDPOINT ??
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

    const response = await fetch(endpoint, { body: formData, method: 'POST' });
    if (!response.ok) {
      return {
        error: new Error(`Transcription failed: ${response.status} ${response.statusText}`),
        notes: [],
        provider: 'sidecar',
        text: null,
      };
    }

    const data = (await response.json()) as { text?: string; segments?: unknown[] };
    const result: TranscriptionResult = {
      error: null,
      notes: [],
      provider: 'sidecar',
      text: data.text ?? null,
    };
    if (result.text || !hasOpenRouterApiKey(options.env)) {
      return result;
    }
    const fallback = await transcribeWithOpenRouter(options);
    if (fallback.text) {
      return { ...fallback, notes: ['Local sidecar returned no transcript'] };
    }
    return result;
  } catch (error) {
    const result: TranscriptionResult = {
      error: error instanceof Error ? error : new Error(String(error)),
      notes: [],
      provider: 'sidecar',
      text: null,
    };
    if (!hasOpenRouterApiKey(options.env)) {
      return result;
    }
    const fallback = await transcribeWithOpenRouter(options);
    if (fallback.text) {
      return {
        ...fallback,
        notes: [`Local sidecar failed: ${result.error?.message ?? 'unknown'}`],
      };
    }
    return result;
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
    env: options.env,
    filename: options.filename,
    mediaType: options.mediaType,
    onProgress: options.onProgress,
  });
}
