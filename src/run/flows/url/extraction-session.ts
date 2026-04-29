import { NEGATIVE_TTL_MS } from '@steipete/summarize-core/content';
import * as urlUtils from '@steipete/summarize-core/content/url';

import { buildExtractCacheKey } from '../../../cache.js';
import {
  createLinkPreviewClient,
  type ExtractedLinkContent,
  type LinkPreviewProgressEvent,
} from '../../../content/index.js';
import { createFirecrawlScraper } from '../../../firecrawl.js';
import { resolveSlideSource } from '../../../slides/index.js';
import { readTweetWithPreferredClient } from '../../bird.js';
import { resolveTwitterCookies } from '../../cookies/twitter.js';
import { hasBirdCli, hasXurlCli } from '../../env.js';
import { writeVerbose } from '../../logging.js';
import { fetchLinkContentWithBirdTip } from './extract.js';
import { resolveUrlFetchOptions } from './fetch-options.js';
import type { UrlFlowContext } from './types.js';

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
  const {firecrawlApiKey} = model.apiStatus;
  const scrapeWithFirecrawl =
    model.apiStatus.firecrawlConfigured && flags.firecrawlMode !== 'off' && firecrawlApiKey
      ? createFirecrawlScraper({ apiKey: firecrawlApiKey, fetchImpl: io.fetch })
      : null;

  const readTweetWithBirdClient =
    hasXurlCli(io.env) || hasBirdCli(io.env)
      ? ({ url, timeoutMs }: { url: string; timeoutMs: number }) =>
          readTweetWithPreferredClient({ env: io.env, timeoutMs, url })
      : null;

  const client = createLinkPreviewClient({
    apifyApiToken: model.apiStatus.apifyToken,
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
    scrapeWithFirecrawl,
    transcriptCache,
    transcription: {
      assemblyaiApiKey: model.apiStatus.assemblyaiApiKey,
      env: io.envForRun,
      falApiKey: model.apiStatus.falApiKey,
      geminiApiKey: model.apiStatus.googleApiKey,
      groqApiKey: model.apiStatus.groqApiKey,
      openaiApiKey: model.apiStatus.openaiApiKey,
    },
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
              firecrawl: options.firecrawl,
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
      const cached = cacheStore.getJson<ExtractedLinkContent>('extract', cacheKey);
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
      const extracted = await fetchLinkContentWithBirdTip({
        client,
        env: io.env,
        options,
        url: targetUrl,
      });
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
      if (!preferUrlMode || isTwitter || isPodcast) throw error;
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
          firecrawl: {
            attempted: false,
            cacheMode: cacheState.mode,
            cacheStatus: 'bypassed',
            notes: 'skipped (url-only fallback)',
            used: false,
          },
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
    let extracted = await fetchWithCache(url);
    if (flags.slides && !resolveSlideSource({ extracted, url })) {
      const isTwitter = urlUtils.isTwitterStatusUrl?.(url) ?? false;
      if (isTwitter) {
        const refreshed = await fetchWithCache(url, { bypassExtractCache: true });
        if (resolveSlideSource({ extracted: refreshed, url })) {
          writeVerbose(
            io.stderr,
            flags.verbose,
            'extract refresh for slides',
            flags.verboseColor,
            io.envForRun,
          );
          extracted = refreshed;
        }
      }
    }
    return extracted;
  };

  return { cacheStore, fetchInitialExtract, fetchWithCache };
}
