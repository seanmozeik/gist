import { resolveTranscriptForLink } from '../../transcript/index';
import { resolveTranscriptionAvailability } from '../../transcript/providers/transcription-start';
import { isDirectMediaUrl } from '../../url';
import type { LinkPreviewDeps } from '../deps';
import type { CacheMode, TranscriptResolution } from '../types';
import { fetchHtmlDocument } from './fetcher';
import { buildResultFromHtmlDocument } from './html';
import { extractApplePodcastIds, extractSpotifyEpisodeId } from './podcast-utils';
import type { extractReadabilityFromHtml } from './readability';
import {
  isBlockedTwitterContent,
  isTwitterBroadcastUrl,
  isTwitterStatusUrl,
} from './twitter-utils.js';
import type { ExtractedLinkContent, FetchLinkContentOptions, MarkdownMode } from './types';
import {
  appendNote,
  ensureTranscriptDiagnostics,
  finalizeExtractedLinkContent,
  resolveCacheMode,
  resolveMaxCharacters,
  resolveTimeoutMs,
  selectBaseContent,
} from './utils.js';

const MAX_TWITTER_TEXT_FOR_TRANSCRIPT = 500;

const buildSkippedTwitterTranscript = (
  cacheMode: CacheMode,
  notes: string,
): TranscriptResolution => ({
  diagnostics: {
    attemptedProviders: [],
    cacheMode,
    cacheStatus: cacheMode === 'bypass' ? 'bypassed' : 'unknown',
    notes,
    provider: null,
    textProvided: false,
  },
  source: null,
  text: null,
});

export async function fetchLinkContent(
  url: string,
  options: FetchLinkContentOptions | undefined,
  deps: LinkPreviewDeps,
): Promise<ExtractedLinkContent> {
  const timeoutMs = resolveTimeoutMs(options);
  const cacheMode = resolveCacheMode(options);
  const maxCharacters = resolveMaxCharacters(options);
  const youtubeTranscriptMode = options?.youtubeTranscript ?? 'auto';
  const mediaTranscriptMode = options?.mediaTranscript ?? 'auto';
  const transcriptTimestamps = options?.transcriptTimestamps ?? false;
  const markdownRequested = (options?.format ?? 'text') === 'markdown';
  const markdownMode: MarkdownMode = options?.markdownMode ?? 'auto';
  const fileMtime = options?.fileMtime ?? null;

  const spotifyEpisodeId = extractSpotifyEpisodeId(url);
  if (spotifyEpisodeId) {
    const transcriptionAvailability = await resolveTranscriptionAvailability({ env: deps.env });
    if (!transcriptionAvailability.hasAnyProvider) {
      throw new Error(
        'Spotify episode transcription requires GIST_LOCAL_BASE_URL or OPENROUTER_API_KEY.',
      );
    }

    const transcriptResolution = await resolveTranscriptForLink(url, null, deps, {
      cacheMode,
      fileMtime,
      mediaTranscriptMode,
      transcriptTimestamps,
      youtubeTranscriptMode,
    });
    if (!transcriptResolution.text) {
      const notes = transcriptResolution.diagnostics?.notes;
      const suffix = notes ? ` (${notes})` : '';
      throw new Error(`Failed to transcribe Spotify episode${suffix}`);
    }

    const transcriptDiagnostics = ensureTranscriptDiagnostics(
      transcriptResolution,
      cacheMode ?? 'default',
    );
    transcriptDiagnostics.notes = appendNote(
      transcriptDiagnostics.notes,
      'Spotify episode: skipped HTML fetch to avoid captcha pages',
    );

    return finalizeExtractedLinkContent({
      baseContent: selectBaseContent('', transcriptResolution.text, transcriptResolution.segments),
      description: null,
      diagnostics: {
        markdown: {
          notes: 'Spotify short-circuit uses transcript content',
          provider: null,
          requested: markdownRequested,
          used: false,
        },
        strategy: 'html',
        transcript: transcriptDiagnostics,
      },
      isVideoOnly: false,
      maxCharacters,
      siteName: 'Spotify',
      title: null,
      transcriptResolution,
      url,
      video: null,
    });
  }

  const appleIds = extractApplePodcastIds(url);
  if (appleIds) {
    const transcriptionAvailability = await resolveTranscriptionAvailability({ env: deps.env });
    if (!transcriptionAvailability.hasAnyProvider) {
      throw new Error(
        'Apple Podcasts transcription requires GIST_LOCAL_BASE_URL or OPENROUTER_API_KEY.',
      );
    }

    const transcriptResolution = await resolveTranscriptForLink(url, null, deps, {
      cacheMode,
      fileMtime,
      mediaTranscriptMode,
      transcriptTimestamps,
      youtubeTranscriptMode,
    });
    if (!transcriptResolution.text) {
      const notes = transcriptResolution.diagnostics?.notes;
      const suffix = notes ? ` (${notes})` : '';
      throw new Error(`Failed to transcribe Apple Podcasts episode${suffix}`);
    }

    const transcriptDiagnostics = ensureTranscriptDiagnostics(
      transcriptResolution,
      cacheMode ?? 'default',
    );
    transcriptDiagnostics.notes = appendNote(
      transcriptDiagnostics.notes,
      'Apple Podcasts: skipped HTML fetch (prefer iTunes lookup / enclosures)',
    );

    return finalizeExtractedLinkContent({
      baseContent: selectBaseContent('', transcriptResolution.text, transcriptResolution.segments),
      description: null,
      diagnostics: {
        markdown: {
          notes: 'Apple Podcasts short-circuit uses transcript content',
          provider: null,
          requested: markdownRequested,
          used: false,
        },
        strategy: 'html',
        transcript: transcriptDiagnostics,
      },
      isVideoOnly: false,
      maxCharacters,
      siteName: 'Apple Podcasts',
      title: null,
      transcriptResolution,
      url,
      video: null,
    });
  }

  if (isTwitterBroadcastUrl(url)) {
    const broadcastTranscriptMode = mediaTranscriptMode === 'auto' ? 'prefer' : mediaTranscriptMode;
    const transcriptResolution = await resolveTranscriptForLink(url, null, deps, {
      cacheMode,
      fileMtime,
      mediaTranscriptMode: broadcastTranscriptMode,
      transcriptTimestamps,
      youtubeTranscriptMode,
    });
    if (!transcriptResolution.text) {
      const notes = transcriptResolution.diagnostics?.notes;
      const suffix = notes ? ` (${notes})` : '';
      throw new Error(`Failed to transcribe X broadcast${suffix}`);
    }

    const transcriptDiagnostics = ensureTranscriptDiagnostics(
      transcriptResolution,
      cacheMode ?? 'default',
    );
    transcriptDiagnostics.notes = appendNote(
      transcriptDiagnostics.notes,
      'X broadcast: skipped HTML fetch',
    );

    return finalizeExtractedLinkContent({
      baseContent: selectBaseContent('', transcriptResolution.text, transcriptResolution.segments),
      description: null,
      diagnostics: {
        markdown: {
          notes: 'X broadcast uses transcript content',
          provider: null,
          requested: markdownRequested,
          used: false,
        },
        strategy: 'html',
        transcript: transcriptDiagnostics,
      },
      isVideoOnly: true,
      maxCharacters,
      siteName: 'X',
      title: null,
      transcriptResolution,
      url,
      video: { kind: 'direct', url },
    });
  }

  if (isDirectMediaUrl(url) && mediaTranscriptMode === 'prefer') {
    const transcriptResolution = await resolveTranscriptForLink(url, null, deps, {
      cacheMode,
      fileMtime,
      mediaTranscriptMode,
      transcriptTimestamps,
      youtubeTranscriptMode,
    });
    if (!transcriptResolution.text) {
      const notes = transcriptResolution.diagnostics?.notes;
      const suffix = notes ? ` (${notes})` : '';
      throw new Error(`Failed to transcribe media${suffix}`);
    }

    const transcriptDiagnostics = ensureTranscriptDiagnostics(
      transcriptResolution,
      cacheMode ?? 'default',
    );
    transcriptDiagnostics.notes = appendNote(
      transcriptDiagnostics.notes,
      'Direct media URL: skipped HTML fetch',
    );

    return finalizeExtractedLinkContent({
      baseContent: selectBaseContent('', transcriptResolution.text, transcriptResolution.segments),
      description: null,
      diagnostics: {
        markdown: {
          notes: 'Direct media URL uses transcript content',
          provider: null,
          requested: markdownRequested,
          used: false,
        },
        strategy: 'html',
        transcript: transcriptDiagnostics,
      },
      isVideoOnly: true,
      maxCharacters,
      siteName: null,
      title: null,
      transcriptResolution,
      url,
      video: { kind: 'direct', url },
    });
  }

  const twitterStatus = isTwitterStatusUrl(url);
  let birdError: unknown = null;

  const attemptBird = async (): Promise<ExtractedLinkContent | null> => {
    if (!deps.readTweetWithBird || !twitterStatus) {
      return null;
    }

    deps.onProgress?.({ client: null, kind: 'bird-start', url });
    try {
      const tweet = await deps.readTweetWithBird({ timeoutMs, url });
      const text = tweet?.text?.trim() ?? '';
      const tweetClient = 'bird';
      if (text.length === 0) {
        deps.onProgress?.({
          client: tweetClient,
          kind: 'bird-done',
          ok: false,
          textBytes: null,
          url,
        });
        return null;
      }

      const title = tweet?.author?.username ? `@${tweet.author.username}` : null;
      const description = null;
      const siteName = 'X';
      const media = tweet?.media ?? null;
      const mediaUrl = media?.preferredUrl ?? media?.urls?.[0] ?? null;
      const hasMedia = Boolean(mediaUrl);
      const shouldAttemptTranscript =
        mediaTranscriptMode === 'prefer' || (mediaTranscriptMode === 'auto' && hasMedia);
      const autoModeNote = !shouldAttemptTranscript
        ? 'Skipped tweet transcript (media transcript mode is auto; enable --video-mode transcript to force audio).'
        : null;
      const longFormNote =
        !hasMedia && text.length >= MAX_TWITTER_TEXT_FOR_TRANSCRIPT
          ? `Skipped yt-dlp transcript for long-form tweet text (${text.length} chars)`
          : null;
      const skipTranscriptReason = [autoModeNote, longFormNote].filter(Boolean).join(' ') || null;
      const mediaTranscriptModeForTweet = shouldAttemptTranscript ? 'prefer' : mediaTranscriptMode;
      const transcriptResolution = skipTranscriptReason
        ? buildSkippedTwitterTranscript(cacheMode, skipTranscriptReason)
        : await resolveTranscriptForLink(url, null, deps, {
            cacheMode,
            fileMtime,
            mediaKindHint: media?.kind ?? null,
            mediaTranscriptMode: mediaTranscriptModeForTweet,
            transcriptTimestamps,
            youtubeTranscriptMode,
          });
      const transcriptDiagnostics = ensureTranscriptDiagnostics(
        transcriptResolution,
        cacheMode ?? 'default',
      );
      const result = finalizeExtractedLinkContent({
        baseContent: selectBaseContent(
          text,
          transcriptResolution.text,
          transcriptResolution.segments,
        ),
        description,
        diagnostics: {
          markdown: {
            notes: `${tweetClient} tweet fetch provides plain text`,
            provider: null,
            requested: markdownRequested,
            used: false,
          },
          strategy: tweetClient,
          transcript: transcriptDiagnostics,
        },
        isVideoOnly: false,
        maxCharacters,
        siteName,
        title,
        transcriptResolution,
        url,
        video: mediaUrl && media?.kind === 'video' ? { kind: 'direct', url: mediaUrl } : null,
      });
      deps.onProgress?.({
        client: tweetClient,
        kind: 'bird-done',
        ok: true,
        textBytes: Buffer.byteLength(result.content, 'utf8'),
        url,
      });
      return result;
    } catch (error) {
      birdError = error;
      deps.onProgress?.({ client: null, kind: 'bird-done', ok: false, textBytes: null, url });
      return null;
    }
  };

  const birdResult = await attemptBird();
  if (birdResult) {
    return birdResult;
  }

  let htmlResult: { html: string; finalUrl: string } | null = null;
  let htmlError: unknown = null;

  try {
    htmlResult = await fetchHtmlDocument(url, {
      fetchImplementation: deps.fetchImplementation,
      markdownExtractFetch: markdownRequested,
      onProgress: deps.onProgress ?? null,
      timeoutMs,
    });
  } catch (error) {
    htmlError = error;
  }

  if (!htmlResult) {
    throw htmlError instanceof Error ? htmlError : new Error('Failed to fetch HTML document');
  }

  const { html } = htmlResult;
  const effectiveUrl = htmlResult.finalUrl || url;
  const readabilityCandidate: Awaited<ReturnType<typeof extractReadabilityFromHtml>> | null = null;

  const htmlExtracted = await buildResultFromHtmlDocument({
    cacheMode,
    deps,
    html,
    markdownMode,
    markdownRequested,
    maxCharacters,
    mediaTranscriptMode,
    readabilityCandidate,
    timeoutMs,
    transcriptTimestamps,
    url: effectiveUrl,
    youtubeTranscriptMode,
  });
  if (twitterStatus && isBlockedTwitterContent(htmlExtracted.content)) {
    const birdNote = !deps.readTweetWithBird
      ? 'X CLI not available'
      : birdError
        ? `X CLI failed: ${birdError instanceof Error ? birdError.message : String(birdError)}`
        : 'X CLI returned no text';
    throw new Error(`Unable to fetch tweet content from X. ${birdNote}.`);
  }
  return htmlExtracted;
}

export type { ExtractedLinkContent, FetchLinkContentOptions } from './types.js';
