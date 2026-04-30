import type { MediaCache, TranscriptCache } from '../cache/types.js';
import {
  resolveTranscriptionConfig,
  type TranscriptionConfig,
} from '../transcript/transcription-config.js';
import { fetchLinkContent } from './content/index.js';
import type { ExtractedLinkContent, FetchLinkContentOptions } from './content/types.js';
import type {
  ConvertHtmlToMarkdown,
  LinkPreviewDeps,
  LinkPreviewProgressEvent,
  ResolveTwitterCookies,
} from './deps.js';

/** Public client used by external consumers to fetch link content. */
export interface LinkPreviewClient {
  fetchLinkContent(url: string, options?: FetchLinkContentOptions): Promise<ExtractedLinkContent>;
}

/** Public options for wiring dependencies into the link preview client. */
export interface LinkPreviewClientOptions {
  fetch?: typeof fetch;
  env?: Record<string, string | undefined>;
  ytDlpPath?: string | null;
  transcription?: Partial<TranscriptionConfig> | null;
  convertHtmlToMarkdown?: ConvertHtmlToMarkdown | null;
  transcriptCache?: TranscriptCache | null;
  mediaCache?: MediaCache | null;
  readTweetWithBird?: LinkPreviewDeps['readTweetWithBird'];
  resolveTwitterCookies?: ResolveTwitterCookies | null;
  onProgress?: ((event: LinkPreviewProgressEvent) => void) | null;
}

/** Public factory for a link preview client with injectable dependencies. */
export function createLinkPreviewClient(options: LinkPreviewClientOptions = {}): LinkPreviewClient {
  const fetchImpl: typeof fetch =
    options.fetch ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args));
  const env = typeof options.env === 'object' && options.env ? options.env : undefined;
  const ytDlpPath = typeof options.ytDlpPath === 'string' ? options.ytDlpPath : null;
  const transcription = resolveTranscriptionConfig({
    env,
    transcription: options.transcription ?? null,
  });
  const convertHtmlToMarkdown: ConvertHtmlToMarkdown | null = options.convertHtmlToMarkdown ?? null;
  const transcriptCache: TranscriptCache | null = options.transcriptCache ?? null;
  const mediaCache: MediaCache | null = options.mediaCache ?? null;
  const readTweetWithBird =
    typeof options.readTweetWithBird === 'function' ? options.readTweetWithBird : null;
  const resolveTwitterCookies =
    typeof options.resolveTwitterCookies === 'function' ? options.resolveTwitterCookies : null;
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;

  return {
    fetchLinkContent: (url: string, contentOptions?: FetchLinkContentOptions) =>
      fetchLinkContent(url, contentOptions, {
        convertHtmlToMarkdown,
        env,
        fetch: fetchImpl,
        mediaCache,
        onProgress,
        readTweetWithBird,
        resolveTwitterCookies,
        transcriptCache,
        transcription,
        ytDlpPath,
      }),
  };
}
