import { buildExtractCacheKey } from '../../../cache';
import { NEGATIVE_TTL_MS } from '../../../content/index';
import {
  createLinkPreviewClient,
  type ExtractedLinkContent,
  type LinkPreviewProgressEvent,
} from '../../../content/index.js';
import * as urlUtils from '../../../content/url';
import { readTweetWithPreferredClient } from '../../bird';
import { resolveTwitterCookies } from '../../cookies/twitter';
import { hasBirdCli } from '../../env';
import { writeVerbose } from '../../logging';
import { fetchLinkContentWithBirdTip } from './extract';
import { resolveUrlFetchOptions } from './fetch-options';
import type { UrlFlowContext } from './types';

type LinkPreviewClientOptions = NonNullable<Parameters<typeof createLinkPreviewClient>[0]>;
type ConvertHtmlToMarkdown = LinkPreviewClientOptions['convertHtmlToMarkdown'];
type LinkPreviewProgressHandler = ((event: LinkPreviewProgressEvent) => void) | null;

export interface UrlExtractionSession {
  cacheStore: UrlFlowContext['cache']['store'] | null;
  fetchInitialExtract: (url: string) => Promise<ExtractedLinkContent>;
  fetchWithCache: (
    targetUrl: string,
    options?: { bypassExtractCache?: boolean },
  ) => Promise<ExtractedLinkContent>;
}

export function createUrlExtractionSession({
  ctx,
  markdown,
  onProgress,
}: {
  ctx: UrlFlowContext;
  markdown: {
    convertHtmlToMarkdown: ConvertHtmlToMarkdown;
    effectiveMarkdownMode: 'off' | 'auto' | 'llm' | 'readability';
    markdownRequested: boolean;
  };
  onProgress: LinkPreviewProgressHandler;
}): UrlExtractionSession {
  const { io, flags, model, cache: cacheState } = ctx;
  const cacheStore = cacheState.mode === 'default' ? cacheState.store : null;
  const transcriptCache = cacheStore ? cacheStore.transcriptCache : null;

  const readTweetWithBirdClient = hasBirdCli(io.env)
    ? ({ url, timeoutMs }: { url: string; timeoutMs: number }) =>
        readTweetWithPreferredClient({ env: io.env, timeoutMs, url })
    : null;

  const client = createLinkPreviewClient({
    convertHtmlToMarkdown: markdown.convertHtmlToMarkdown,
    env: io.envForRun,
    fetch: io.fetch,
    mediaCache: ctx.mediaCache ?? null,
    onProgress,
    readTweetWithBird: readTweetWithBirdClient,
    resolveTwitterCookies: async (_args) => {
      const res = await resolveTwitterCookies({ env: io.env });
      return {
        cookiesFromBrowser: res.cookies.cookiesFromBrowser,
        source: res.cookies.source,
        warnings: res.warnings,
      };
    },
    transcriptCache,
    transcription: null,
    ytDlpPath: model.apiStatus.ytDlpPath,
  });

  const fetchWithCache = async (
    targetUrl: string,
    { bypassExtractCache = false }: { bypassExtractCache?: boolean } = {},
  ): Promise<ExtractedLinkContent> => {
    const { localFile, options } = resolveUrlFetchOptions({
      cacheMode: cacheState.mode,
      flags,
      markdown,
      targetUrl,
    });
    const cacheKey =
      !localFile && cacheStore && cacheState.mode === 'default'
        ? buildExtractCacheKey({
            options: {
              format: options.format,
              markdownMode: options.markdownMode ?? null,
              mediaTranscript: options.mediaTranscript,
              transcriptTimestamps: options.transcriptTimestamps ?? false,
              youtubeTranscript: options.youtubeTranscript,
              ...(typeof options.maxCharacters === 'number'
                ? { maxCharacters: options.maxCharacters }
                : {}),
            },
            url: targetUrl,
          })
        : null;
    if (!bypassExtractCache && cacheKey && cacheStore) {
      const cached = cacheStore.getJson('extract', cacheKey) as ExtractedLinkContent | null;
      if (cached) {
        writeVerbose(
          io.stderr,
          flags.verbose,
          'cache hit extract',
          flags.verboseColor,
          io.envForRun,
        );
        return cached;
      }
      writeVerbose(
        io.stderr,
        flags.verbose,
        'cache miss extract',
        flags.verboseColor,
        io.envForRun,
      );
    }
    try {
      const extracted = await fetchLinkContentWithBirdTip({ client, options, url: targetUrl });
      if (cacheKey && cacheStore) {
        const extractTtlMs =
          extracted.transcriptSource === 'unavailable' ? NEGATIVE_TTL_MS : cacheState.ttlMs;
        cacheStore.setJson('extract', cacheKey, extracted, extractTtlMs);
        writeVerbose(
          io.stderr,
          flags.verbose,
          'cache write extract',
          flags.verboseColor,
          io.envForRun,
        );
      }
      return extracted;
    } catch (error) {
      const preferUrlMode =
        typeof urlUtils.shouldPreferUrlMode === 'function'
          ? urlUtils.shouldPreferUrlMode(targetUrl)
          : false;
      const isTwitter = urlUtils.isTwitterStatusUrl?.(targetUrl) ?? false;
      const isPodcast = urlUtils.isPodcastHost?.(targetUrl) ?? false;
      const isForcedYoutubeYtDlp = options.youtubeTranscript === 'yt-dlp';
      if (isForcedYoutubeYtDlp) {
        throw error;
      }
      if (!preferUrlMode || isTwitter || isPodcast) {
        throw error;
      }
      writeVerbose(
        io.stderr,
        flags.verbose,
        `extract fallback url-only (${(error as Error).message ?? String(error)})`,
        flags.verboseColor,
        io.envForRun,
      );
      return {
        content: '',
        description: null,
        diagnostics: {
          markdown: {
            notes: 'skipped (url fallback)',
            provider: null,
            requested: false,
            used: false,
          },
          strategy: 'html',
          transcript: {
            attemptedProviders: [],
            cacheMode: cacheState.mode,
            cacheStatus: 'unknown',
            provider: null,
            textProvided: false,
          },
        },
        isVideoOnly: true,
        mediaDurationSeconds: null,
        siteName: null,
        title: null,
        totalCharacters: 0,
        transcriptCharacters: null,
        transcriptLines: null,
        transcriptMetadata: null,
        transcriptSegments: null,
        transcriptSource: null,
        transcriptTimedText: null,
        transcriptWordCount: null,
        transcriptionProvider: null,
        truncated: false,
        url: targetUrl,
        video: null,
        wordCount: 0,
      };
    }
  };

  const fetchInitialExtract = async (url: string): Promise<ExtractedLinkContent> => {
    return fetchWithCache(url);
  };

  return { cacheStore, fetchInitialExtract, fetchWithCache };
}
