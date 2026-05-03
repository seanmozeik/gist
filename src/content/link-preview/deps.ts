import type { MediaCache, TranscriptCache } from '../cache/types';
import type { TranscriptionConfig } from '../transcript/transcription-config';
import type { TranscriptSource } from './types';

// Enum-like constants for progress kinds (keeps call sites typo-resistant without TS `enum` runtime quirks).
export const ProgressKind = {
  BirdDone: 'bird-done',
  BirdStart: 'bird-start',
  FetchHtmlDone: 'fetch-html-done',

  FetchHtmlProgress: 'fetch-html-progress',
  FetchHtmlStart: 'fetch-html-start',
  TranscriptDone: 'transcript-done',

  TranscriptMediaDownloadDone: 'transcript-media-download-done',
  TranscriptMediaDownloadProgress: 'transcript-media-download-progress',

  TranscriptMediaDownloadStart: 'transcript-media-download-start',
  TranscriptStart: 'transcript-start',

  TranscriptWhisperProgress: 'transcript-whisper-progress',
  TranscriptWhisperStart: 'transcript-whisper-start',
} as const;

export type TranscriptionProviderHint = 'openrouter' | 'sidecar' | 'unknown';

/** Public progress events emitted by link preview fetchers. */
export type LinkPreviewProgressEvent =
  | { kind: 'fetch-html-start'; url: string }
  | { kind: 'fetch-html-progress'; url: string; downloadedBytes: number; totalBytes: number | null }
  | { kind: 'fetch-html-done'; url: string; downloadedBytes: number; totalBytes: number | null }
  | {
      kind: 'transcript-media-download-start';
      url: string;
      service: 'youtube' | 'podcast' | 'generic';
      mediaUrl: string | null;
      mediaKind?: 'video' | 'audio' | null;
      totalBytes: number | null;
    }
  | {
      kind: 'transcript-media-download-progress';
      url: string;
      service: 'youtube' | 'podcast' | 'generic';
      downloadedBytes: number;
      totalBytes: number | null;
      mediaKind?: 'video' | 'audio' | null;
    }
  | {
      kind: 'transcript-media-download-done';
      url: string;
      service: 'youtube' | 'podcast' | 'generic';
      downloadedBytes: number;
      totalBytes: number | null;
      mediaKind?: 'video' | 'audio' | null;
    }
  | {
      kind: 'transcript-whisper-start';
      url: string;
      service: 'youtube' | 'podcast' | 'generic';
      providerHint: TranscriptionProviderHint;
      modelId: string | null;
      totalDurationSeconds: number | null;
      parts: number | null;
    }
  | {
      kind: 'transcript-whisper-progress';
      url: string;
      service: 'youtube' | 'podcast' | 'generic';
      processedDurationSeconds: number | null;
      totalDurationSeconds: number | null;
      partIndex: number | null;
      parts: number | null;
    }
  | {
      kind: 'transcript-start';
      url: string;
      service: 'youtube' | 'podcast' | 'generic';
      hint: string | null;
    }
  | {
      kind: 'transcript-done';
      url: string;
      ok: boolean;
      service: 'youtube' | 'podcast' | 'generic';
      source: TranscriptSource | null;
      hint: string | null;
    }
  | { kind: 'bird-start'; url: string; client?: 'bird' | null }
  | {
      kind: 'bird-done';
      url: string;
      client?: 'bird' | null;
      ok: boolean;
      textBytes: number | null;
    };

export type ConvertHtmlToMarkdown = (args: {
  url: string;
  html: string;
  title: string | null;
  siteName: string | null;
  timeoutMs: number;
}) => Promise<string>;

export interface BirdTweetMedia {
  kind: 'video' | 'audio';
  urls: string[];
  preferredUrl: string | null;
  source: 'extended_entities' | 'card' | 'entities';
}

export interface BirdTweetPayload {
  id?: string;
  text: string;
  author?: { username?: string; name?: string };
  createdAt?: string;
  media?: BirdTweetMedia | null;
  client?: 'bird';
}

export type ReadTweetWithBird = (args: {
  url: string;
  timeoutMs: number;
}) => Promise<BirdTweetPayload | null>;

export interface TwitterCookieSource {
  cookiesFromBrowser: string | null;
  source?: string | null;
  warnings?: string[];
}

export type ResolveTwitterCookies = (args: { url: string }) => Promise<TwitterCookieSource>;

/** Internal dependency bag; prefer createLinkPreviewClient unless you need custom wiring. */
export interface LinkPreviewDeps {
  /**
   * HTML/markdown document transport for link preview. When omitted, `@seanmozeik/magic-fetch` uses
   * built-in impit (Chrome TLS, HTTP/3). Pass **`fetchImplementation`** to inject a mock or alternate transport.
   */
  fetchImplementation?: typeof fetch;
  env?: Record<string, string | undefined>;
  ytDlpPath: string | null;
  transcription?: TranscriptionConfig | null;
  convertHtmlToMarkdown: ConvertHtmlToMarkdown | null;
  transcriptCache: TranscriptCache | null;
  mediaCache?: MediaCache | null;
  readTweetWithBird?: ReadTweetWithBird | null;
  resolveTwitterCookies?: ResolveTwitterCookies | null;
  onProgress?: ((event: LinkPreviewProgressEvent) => void) | null;
}
