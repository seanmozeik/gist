import type { MediaCache } from '../cache/types';
import type { MediaTranscriptMode, YoutubeTranscriptMode } from '../link-preview/content/types';
import type { LinkPreviewProgressEvent, ResolveTwitterCookies } from '../link-preview/deps';
import type { TranscriptResolution, TranscriptSource } from '../link-preview/types';
import type { TranscriptionConfig } from './transcription-config';

export type TranscriptService = 'youtube' | 'podcast' | 'generic';

export interface ProviderContext {
  url: string;
  html: string | null;
  resourceKey: string | null;
}

export interface ProviderFetchOptions {
  fetch: typeof fetch;
  env?: Record<string, string | undefined>;
  youtubeTranscriptMode: YoutubeTranscriptMode;
  mediaTranscriptMode: MediaTranscriptMode;
  mediaKindHint?: 'video' | 'audio' | null;
  transcriptTimestamps?: boolean;
  ytDlpPath: string | null;
  transcription?: TranscriptionConfig;
  mediaCache?: MediaCache | null;
  resolveTwitterCookies?: ResolveTwitterCookies | null;
  onProgress?: ((event: LinkPreviewProgressEvent) => void) | null;
}

export interface ProviderResult extends TranscriptResolution {
  metadata?: Record<string, unknown>;
  attemptedProviders: TranscriptSource[];
  notes?: string | null;
}

export interface ProviderModule {
  id: TranscriptService;
  canHandle(context: ProviderContext): boolean;
  fetchTranscript(context: ProviderContext, options: ProviderFetchOptions): Promise<ProviderResult>;
}

export type { TranscriptSource } from '../link-preview/types.js';
