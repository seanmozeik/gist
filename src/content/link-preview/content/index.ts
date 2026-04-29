import { resolveTranscriptForLink } from '../../transcript/index.js';
import { resolveTranscriptionAvailability } from '../../transcript/providers/transcription-start.js';
import { resolveTranscriptionConfig } from '../../transcript/transcription-config.js';
import { isDirectMediaUrl, isYouTubeUrl } from '../../url.js';
import type { FirecrawlScrapeResult, LinkPreviewDeps } from '../deps.js';
import type { CacheMode, FirecrawlDiagnostics, TranscriptResolution } from '../types.js';
import { normalizeForPrompt } from './cleaner.js';
import { MIN_READABILITY_CONTENT_CHARACTERS } from './constants.js';
import { fetchHtmlDocument, fetchWithFirecrawl } from './fetcher.js';
import { buildResultFromFirecrawl, shouldFallbackToFirecrawl } from './firecrawl.js';
import { buildResultFromHtmlDocument } from './html.js';
import { extractApplePodcastIds, extractSpotifyEpisodeId } from './podcast-utils.js';
import { extractReadabilityFromHtml } from './readability.js';
import {
  isAnubisHtml,
  isBlockedTwitterContent,
  isTwitterBroadcastUrl,
  isTwitterStatusUrl,
  toNitterUrls,
} from './twitter-utils.js';
import type { ExtractedLinkContent, FetchLinkContentOptions, MarkdownMode } from './types.js';
import {
  appendNote,
  ensureTranscriptDiagnostics,
  finalizeExtractedLinkContent,
  resolveCacheMode,
  resolveFirecrawlMode,
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
  const transcription = resolveTranscriptionConfig({
    assemblyaiApiKey: deps.assemblyaiApiKey,
    env: deps.env,
    falApiKey: deps.falApiKey,
    geminiApiKey: deps.geminiApiKey,
    groqApiKey: deps.groqApiKey,
    openaiApiKey: deps.openaiApiKey,
    transcription: deps.transcription ?? null,
  });
  const timeoutMs = resolveTimeoutMs(options);
  const cacheMode = resolveCacheMode(options);
  const maxCharacters = resolveMaxCharacters(options);
  const youtubeTranscriptMode = options?.youtubeTranscript ?? 'auto';
  const mediaTranscriptMode = options?.mediaTranscript ?? 'auto';
  const transcriptTimestamps = options?.transcriptTimestamps ?? false;
  const firecrawlMode = resolveFirecrawlMode(options);
  const markdownRequested = (options?.format ?? 'text') === 'markdown';
  const markdownMode: MarkdownMode = options?.markdownMode ?? 'auto';
  const fileMtime = options?.fileMtime ?? null;

  const canUseFirecrawl =
    firecrawlMode !== 'off' && deps.scrapeWithFirecrawl !== null && !isYouTubeUrl(url);

  const spotifyEpisodeId = extractSpotifyEpisodeId(url);
  if (spotifyEpisodeId) {
    const transcriptionAvailability = await resolveTranscriptionAvailability({ transcription });
    if (!transcriptionAvailability.hasAnyProvider) {
      throw new Error(
        'Spotify episode transcription requires a transcription provider (install whisper-cpp or set GROQ_API_KEY, ASSEMBLYAI_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY, or FAL_KEY); otherwise you may only get a captcha/recaptcha HTML page.',
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
        firecrawl: {
          attempted: false,
          cacheMode,
          cacheStatus: cacheMode === 'bypass' ? 'bypassed' : 'unknown',
          notes: 'Spotify short-circuit skipped HTML/Firecrawl',
          used: false,
        },
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
    const transcriptionAvailability = await resolveTranscriptionAvailability({ transcription });
    if (!transcriptionAvailability.hasAnyProvider) {
      throw new Error(
        'Apple Podcasts transcription requires a transcription provider (install whisper-cpp or set GROQ_API_KEY, ASSEMBLYAI_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY, or FAL_KEY); otherwise you may only get a slow/blocked HTML page.',
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
        firecrawl: {
          attempted: false,
          cacheMode,
          cacheStatus: cacheMode === 'bypass' ? 'bypassed' : 'unknown',
          notes: 'Apple Podcasts short-circuit skipped HTML/Firecrawl',
          used: false,
        },
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
      'X broadcast: skipped HTML/Firecrawl',
    );

    return finalizeExtractedLinkContent({
      baseContent: selectBaseContent('', transcriptResolution.text, transcriptResolution.segments),
      description: null,
      diagnostics: {
        firecrawl: {
          attempted: false,
          cacheMode,
          cacheStatus: cacheMode === 'bypass' ? 'bypassed' : 'unknown',
          notes: 'X broadcast short-circuit skipped HTML/Firecrawl',
          used: false,
        },
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
      'Direct media URL: skipped HTML/Firecrawl',
    );

    return finalizeExtractedLinkContent({
      baseContent: selectBaseContent('', transcriptResolution.text, transcriptResolution.segments),
      description: null,
      diagnostics: {
        firecrawl: {
          attempted: false,
          cacheMode,
          cacheStatus: cacheMode === 'bypass' ? 'bypassed' : 'unknown',
          notes: 'Direct media URL skipped HTML/Firecrawl',
          used: false,
        },
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

  let firecrawlAttempted = false;
  let firecrawlPayload: FirecrawlScrapeResult | null = null;
  const firecrawlDiagnostics: FirecrawlDiagnostics = {
    attempted: false,
    cacheMode,
    cacheStatus: cacheMode === 'bypass' ? 'bypassed' : 'unknown',
    notes: null,
    used: false,
  };

  const twitterStatus = isTwitterStatusUrl(url);
  const nitterUrls = twitterStatus ? toNitterUrls(url) : [];
  let birdError: unknown = null;
  let nitterError: unknown = null;

  const attemptFirecrawl = async (reason: string): Promise<ExtractedLinkContent | null> => {
    if (!canUseFirecrawl) {
      return null;
    }

    if (!firecrawlAttempted) {
      const attempt = await fetchWithFirecrawl(url, deps.scrapeWithFirecrawl, {
        cacheMode,
        onProgress: deps.onProgress ?? null,
        reason,
        timeoutMs,
      });
      firecrawlAttempted = true;
      firecrawlPayload = attempt.payload;
      firecrawlDiagnostics.attempted = attempt.diagnostics.attempted;
      firecrawlDiagnostics.used = attempt.diagnostics.used;
      firecrawlDiagnostics.cacheMode = attempt.diagnostics.cacheMode;
      firecrawlDiagnostics.cacheStatus = attempt.diagnostics.cacheStatus;
      firecrawlDiagnostics.notes = attempt.diagnostics.notes ?? null;
    }

    firecrawlDiagnostics.notes = appendNote(firecrawlDiagnostics.notes, reason);

    if (!firecrawlPayload) {
      return null;
    }

    const firecrawlResult = await buildResultFromFirecrawl({
      cacheMode,
      deps,
      firecrawlDiagnostics,
      markdownRequested,
      maxCharacters,
      mediaTranscriptMode,
      payload: firecrawlPayload,
      transcriptTimestamps,
      url,
      youtubeTranscriptMode,
    });
    if (firecrawlResult) {
      return firecrawlResult;
    }

    firecrawlDiagnostics.notes = appendNote(
      firecrawlDiagnostics.notes,
      'Firecrawl returned empty content',
    );
    return null;
  };

  const attemptBird = async (): Promise<ExtractedLinkContent | null> => {
    if (!deps.readTweetWithBird || !twitterStatus) {
      return null;
    }

    deps.onProgress?.({ client: null, kind: 'bird-start', url });
    try {
      const tweet = await deps.readTweetWithBird({ timeoutMs, url });
      const text = tweet?.text?.trim() ?? '';
      const tweetClient = tweet?.client === 'xurl' ? 'xurl' : 'bird';
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
          firecrawl: firecrawlDiagnostics,
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

  const attemptNitter = async (): Promise<string | null> => {
    if (nitterUrls.length === 0) {
      return null;
    }
    for (const nitterUrl of nitterUrls) {
      deps.onProgress?.({ kind: 'nitter-start', url: nitterUrl });
      try {
        const nitterResult = await fetchHtmlDocument(deps.fetch, nitterUrl, { timeoutMs });
        const nitterHtml = nitterResult.html;
        if (!nitterHtml.trim()) {
          nitterError = new Error(`Nitter returned empty body from ${new URL(nitterUrl).host}`);
          deps.onProgress?.({ kind: 'nitter-done', ok: false, textBytes: null, url: nitterUrl });
          continue;
        }
        if (isAnubisHtml(nitterHtml)) {
          nitterError = new Error(
            `Nitter returned Anubis challenge from ${new URL(nitterUrl).host}`,
          );
          deps.onProgress?.({ kind: 'nitter-done', ok: false, textBytes: null, url: nitterUrl });
          continue;
        }
        deps.onProgress?.({
          kind: 'nitter-done',
          ok: true,
          textBytes: Buffer.byteLength(nitterHtml, 'utf8'),
          url: nitterUrl,
        });
        return nitterHtml;
      } catch (error) {
        nitterError = error;
        deps.onProgress?.({ kind: 'nitter-done', ok: false, textBytes: null, url: nitterUrl });
      }
    }
    return null;
  };

  const nitterHtml = await attemptNitter();
  if (nitterHtml) {
    const nitterResult = await buildResultFromHtmlDocument({
      cacheMode,
      deps,
      firecrawlDiagnostics,
      html: nitterHtml,
      markdownMode,
      markdownRequested,
      maxCharacters,
      mediaTranscriptMode,
      readabilityCandidate: null,
      timeoutMs,
      transcriptTimestamps,
      url,
      youtubeTranscriptMode,
    });
    if (!isBlockedTwitterContent(nitterResult.content)) {
      nitterResult.diagnostics.strategy = 'nitter';
      return nitterResult;
    }
    nitterError = new Error('Nitter returned blocked or empty content');
  }

  if (firecrawlMode === 'always') {
    const firecrawlResult = await attemptFirecrawl('Firecrawl forced via options');
    if (firecrawlResult) {
      return firecrawlResult;
    }
  }

  let htmlResult: { html: string; finalUrl: string } | null = null;
  let htmlError: unknown = null;

  try {
    htmlResult = await fetchHtmlDocument(deps.fetch, url, {
      onProgress: deps.onProgress ?? null,
      timeoutMs,
    });
  } catch (error) {
    htmlError = error;
  }

  if (!htmlResult) {
    if (!canUseFirecrawl) {
      throw htmlError instanceof Error ? htmlError : new Error('Failed to fetch HTML document');
    }

    const firecrawlResult = await attemptFirecrawl('HTML fetch failed; falling back to Firecrawl');
    if (firecrawlResult) {
      return firecrawlResult;
    }

    const firecrawlError = firecrawlDiagnostics.notes
      ? `; Firecrawl notes: ${firecrawlDiagnostics.notes}`
      : '';
    throw new Error(
      `Failed to fetch HTML document${firecrawlError}${
        htmlError instanceof Error ? `; HTML error: ${htmlError.message}` : ''
      }`,
    );
  }

  const { html } = htmlResult;
  const effectiveUrl = htmlResult.finalUrl || url;
  let readabilityCandidate: Awaited<ReturnType<typeof extractReadabilityFromHtml>> | null = null;

  if (firecrawlMode === 'auto' && shouldFallbackToFirecrawl(html)) {
    readabilityCandidate = await extractReadabilityFromHtml(html, effectiveUrl);
    const readabilityText = readabilityCandidate?.text
      ? normalizeForPrompt(readabilityCandidate.text)
      : '';
    if (readabilityText.length < MIN_READABILITY_CONTENT_CHARACTERS) {
      const firecrawlResult = await attemptFirecrawl(
        'HTML content looked blocked/thin; falling back to Firecrawl',
      );
      if (firecrawlResult) {
        return firecrawlResult;
      }
    }
  }

  const htmlExtracted = await buildResultFromHtmlDocument({
    cacheMode,
    deps,
    firecrawlDiagnostics,
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
      : (birdError
        ? `X CLI failed: ${birdError instanceof Error ? birdError.message : String(birdError)}`
        : 'X CLI returned no text');
    const nitterNote =
      nitterUrls.length > 0
        ? (nitterError
          ? `Nitter failed: ${nitterError instanceof Error ? nitterError.message : String(nitterError)}`
          : 'Nitter returned no text')
        : 'Nitter not available';
    throw new Error(`Unable to fetch tweet content from X. ${birdNote}. ${nitterNote}.`);
  }
  return htmlExtracted;
}

export type { ExtractedLinkContent, FetchLinkContentOptions } from './types.js';
