import type { LinkPreviewDeps } from '../link-preview/deps';
import type {
  CacheMode,
  TranscriptDiagnostics,
  TranscriptResolution,
} from '../link-preview/types.js';
import { mapCachedSource, readTranscriptCache, writeTranscriptCache } from './cache';
import {
  canHandle as canHandleGeneric,
  fetchTranscript as fetchGeneric,
} from './providers/generic.js';
import {
  canHandle as canHandlePodcast,
  fetchTranscript as fetchPodcast,
} from './providers/podcast.js';
import {
  canHandle as canHandleYoutube,
  fetchTranscript as fetchYoutube,
} from './providers/youtube.js';
import { resolveTranscriptionConfig } from './transcription-config';
import type {
  ProviderContext,
  ProviderFetchOptions,
  ProviderModule,
  ProviderResult,
} from './types.js';
import {
  extractEmbeddedYouTubeUrlFromHtml,
  extractYouTubeVideoId as extractYouTubeVideoIdInternal,
  isYouTubeUrl as isYouTubeUrlInternal,
} from './utils.js';

interface ResolveTranscriptOptions {
  youtubeTranscriptMode?: ProviderFetchOptions['youtubeTranscriptMode'];
  mediaTranscriptMode?: ProviderFetchOptions['mediaTranscriptMode'];
  mediaKindHint?: ProviderFetchOptions['mediaKindHint'];
  transcriptTimestamps?: ProviderFetchOptions['transcriptTimestamps'];
  cacheMode?: CacheMode;
  fileMtime?: number | null;
}

const PROVIDERS: ProviderModule[] = [
  { canHandle: canHandleYoutube, fetchTranscript: fetchYoutube, id: 'youtube' },
  { canHandle: canHandlePodcast, fetchTranscript: fetchPodcast, id: 'podcast' },
  { canHandle: canHandleGeneric, fetchTranscript: fetchGeneric, id: 'generic' },
];
const GENERIC_PROVIDER_ID = 'generic';

export const resolveTranscriptForLink = async (
  url: string,
  html: string | null,
  deps: LinkPreviewDeps,
  {
    youtubeTranscriptMode,
    mediaTranscriptMode,
    mediaKindHint,
    transcriptTimestamps,
    cacheMode: providedCacheMode,
    fileMtime,
  }: ResolveTranscriptOptions = {},
): Promise<TranscriptResolution> => {
  const normalizedUrl = url.trim();
  const embeddedYoutubeUrl =
    !isYouTubeUrlInternal(normalizedUrl) && html
      ? await extractEmbeddedYouTubeUrlFromHtml(html)
      : null;
  const effectiveUrl = embeddedYoutubeUrl ?? normalizedUrl;
  const resourceKey = extractResourceKey(effectiveUrl);
  const baseContext: ProviderContext = { html, resourceKey, url: effectiveUrl };
  const provider: ProviderModule = selectProvider(baseContext);
  const cacheMode: CacheMode = providedCacheMode ?? 'default';

  const cacheOutcome = await readTranscriptCache({
    cacheMode,
    fileMtime: fileMtime ?? null,
    transcriptCache: deps.transcriptCache,
    transcriptTimestamps: Boolean(transcriptTimestamps),
    url: normalizedUrl,
  });

  const diagnostics: TranscriptDiagnostics = {
    attemptedProviders: [],
    cacheMode,
    cacheStatus: cacheOutcome.diagnostics.cacheStatus,
    notes: cacheOutcome.diagnostics.notes ?? null,
    provider: cacheOutcome.diagnostics.provider,
    textProvided: cacheOutcome.diagnostics.textProvided,
  };

  if (cacheOutcome.resolution) {
    return { ...cacheOutcome.resolution, diagnostics };
  }

  const shouldReportProgress = provider.id === 'youtube' || provider.id === 'podcast';
  if (shouldReportProgress) {
    deps.onProgress?.({
      hint:
        provider.id === 'youtube'
          ? 'YouTube: resolving transcript'
          : 'Podcast: resolving transcript',
      kind: 'transcript-start',
      service: provider.id,
      url: normalizedUrl,
    });
  }

  const transcription = resolveTranscriptionConfig({
    env: deps.env,
    transcription: deps.transcription ?? null,
  });

  const providerResult = await executeProvider(provider, baseContext, {
    env: deps.env,
    fetch: deps.fetch,
    mediaCache: deps.mediaCache ?? null,
    mediaKindHint: mediaKindHint ?? null,
    mediaTranscriptMode: mediaTranscriptMode ?? 'auto',
    onProgress: deps.onProgress ?? null,
    resolveTwitterCookies: deps.resolveTwitterCookies ?? null,
    transcriptTimestamps: transcriptTimestamps ?? false,
    transcription,
    youtubeTranscriptMode: youtubeTranscriptMode ?? 'auto',
    ytDlpPath: deps.ytDlpPath,
  });

  if (shouldReportProgress) {
    deps.onProgress?.({
      hint: providerResult.source ? `${provider.id}/${providerResult.source}` : provider.id,
      kind: 'transcript-done',
      ok: Boolean(providerResult.text && providerResult.text.length > 0),
      service: provider.id,
      source: providerResult.source,
      url: normalizedUrl,
    });
  }

  diagnostics.provider = providerResult.source;
  diagnostics.attemptedProviders = providerResult.attemptedProviders;
  diagnostics.textProvided = Boolean(providerResult.text && providerResult.text.length > 0);
  if (providerResult.notes) {
    diagnostics.notes = appendNote(diagnostics.notes, providerResult.notes);
  }

  if (providerResult.source !== null || providerResult.text !== null) {
    if (transcriptTimestamps) {
      const nextMeta = { ...providerResult.metadata };
      if (providerResult.segments && providerResult.segments.length > 0) {
        nextMeta.timestamps = true;
        nextMeta.segments = providerResult.segments;
      } else {
        nextMeta.timestamps ??= false;
      }
      providerResult.metadata = nextMeta;
    } else if (providerResult.segments && providerResult.segments.length > 0) {
      providerResult.metadata = { ...providerResult.metadata, segments: providerResult.segments };
    }
    await writeTranscriptCache({
      fileMtime,
      resourceKey,
      result: providerResult,
      service: provider.id,
      transcriptCache: deps.transcriptCache,
      url: normalizedUrl,
    });
  }

  if (!providerResult.text && cacheOutcome.cached?.content && cacheMode !== 'bypass') {
    diagnostics.cacheStatus = 'fallback';
    diagnostics.provider = mapCachedSource(cacheOutcome.cached.source);
    diagnostics.textProvided = Boolean(
      cacheOutcome.cached.content && cacheOutcome.cached.content.length > 0,
    );
    diagnostics.notes = appendNote(
      diagnostics.notes,
      'Falling back to cached transcript content after provider miss',
    );

    return {
      diagnostics,
      metadata: cacheOutcome.cached.metadata ?? null,
      segments: transcriptTimestamps
        ? resolveSegmentsFromMetadata(cacheOutcome.cached.metadata)
        : null,
      source: diagnostics.provider,
      text: cacheOutcome.cached.content,
    };
  }

  return {
    diagnostics,
    metadata: providerResult.metadata ?? null,
    segments: transcriptTimestamps ? (providerResult.segments ?? null) : null,
    source: providerResult.source,
    text: providerResult.text,
  };
};

const extractResourceKey = (url: string): string | null => {
  if (isYouTubeUrlInternal(url)) {
    return extractYouTubeVideoIdInternal(url);
  }
  return null;
};

const selectProvider = (context: ProviderContext): ProviderModule => {
  const genericProviderModule = PROVIDERS.find((provider) => provider.id === GENERIC_PROVIDER_ID);

  const specializedProvider = PROVIDERS.find(
    (provider) => provider.id !== GENERIC_PROVIDER_ID && provider.canHandle(context),
  );
  if (specializedProvider) {
    return specializedProvider;
  }

  if (genericProviderModule) {
    return genericProviderModule;
  }

  throw new Error('Generic transcript provider is not registered');
};

const executeProvider = async (
  provider: ProviderModule,
  context: ProviderContext,
  options: ProviderFetchOptions,
): Promise<ProviderResult> => provider.fetchTranscript(context, options);

const appendNote = (existing: string | null | undefined, next: string): string => {
  if (!existing) {
    return next;
  }
  return `${existing}; ${next}`;
};

const resolveSegmentsFromMetadata = (metadata?: Record<string, unknown> | null) => {
  if (!metadata) {
    return null;
  }
  const { segments } = metadata as { segments?: unknown };
  return Array.isArray(segments) && segments.length > 0
    ? (segments as TranscriptResolution['segments'])
    : null;
};
