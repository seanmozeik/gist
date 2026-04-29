import type { ProviderResult } from '../../types.js';
import { TRANSCRIPTION_TIMEOUT_MS } from './constants.js';
import type { PodcastFlowContext } from './flow-context.js';
import {
  resolvePodcastEpisodeFromItunesSearch,
  resolvePodcastFeedUrlFromItunesSearch,
} from './itunes.js';
import { buildWhisperResult, joinNotes } from './results.js';
import {
  decodeXmlEntities,
  extractEnclosureForEpisode,
  tryFetchTranscriptFromFeedXml,
} from './rss.js';
import {
  extractSpotifyEmbedData,
  extractSpotifyEpisodeId,
  fetchSpotifyEmbedHtml,
} from './spotify.js';

export async function fetchSpotifyTranscript(
  flow: PodcastFlowContext,
): Promise<ProviderResult | null> {
  const spotifyEpisodeId = extractSpotifyEpisodeId(flow.context.url);
  if (!spotifyEpisodeId) {return null;}

  try {
    // Spotify episode pages frequently trigger bot protection (captcha/recaptcha) and the
    // Episode audio itself is sometimes DRM-protected. So we:
    // - fetch the lightweight embed page for stable metadata (__NEXT_DATA__),
    // - first try the embed-provided audio URL (works for many episodes),
    // - then fall back to resolving the publisher RSS feed via Apple’s iTunes directory.
    const embedUrl = `https://open.spotify.com/embed/episode/${spotifyEpisodeId}`;
    const { html: embedHtml, via } = await fetchSpotifyEmbedHtml({
      embedUrl,
      episodeId: spotifyEpisodeId,
      fetchImpl: flow.options.fetch,
      scrapeWithFirecrawl: flow.options.scrapeWithFirecrawl ?? null,
    });

    const embedData = extractSpotifyEmbedData(embedHtml);
    if (!embedData) {
      throw new Error('Spotify embed data not found (missing __NEXT_DATA__)');
    }
    const {showTitle} = embedData;
    const {episodeTitle} = embedData;
    const embedAudioUrl = embedData.audioUrl;
    const embedDurationSeconds = embedData.durationSeconds;
    const embedAudioLooksEncrypted = looksLikeSpotifyEncryptedAudioFormat(embedData.drmFormat);

    if (embedAudioUrl && embedAudioLooksEncrypted) {
      flow.notes.push(
        `Spotify embed audio format ${embedData.drmFormat ?? 'unknown'} looks encrypted; falling back to iTunes RSS`,
      );
    } else if (embedAudioUrl) {
      const missing = flow.ensureTranscriptionProvider();
      if (missing) {return missing;}
      flow.pushOnce('whisper');
      const result = await flow
        .transcribe({
          durationSecondsHint: embedDurationSeconds,
          filenameHint: 'episode.mp4',
          url: embedAudioUrl,
        })
        .catch((error: unknown) => ({
          error: error instanceof Error ? error : new Error(String(error)),
          provider: null,
          text: null,
        }));
      const embedTranscriptChars = result.text?.trim().length ?? 0;
      const shouldTreatAsPreview =
        embedTranscriptChars > 0 &&
        (embedTranscriptChars < 200 ||
          (embedTranscriptChars < 800 &&
            (embedDurationSeconds == null ||
              (typeof embedDurationSeconds === 'number' && embedDurationSeconds >= 600))));

      if (result.text && !shouldTreatAsPreview) {
        flow.notes.push(
          via === 'firecrawl'
            ? 'Resolved Spotify embed audio via Firecrawl'
            : 'Resolved Spotify embed audio',
        );
        return buildWhisperResult({
          attemptedProviders: flow.attemptedProviders,
          metadata: {
            audioUrl: embedAudioUrl,
            drmFormat: embedData.drmFormat,
            durationSeconds: embedDurationSeconds,
            episodeId: spotifyEpisodeId,
            episodeTitle,
            kind: 'spotify_embed_audio',
            provider: 'podcast',
            showTitle,
          },
          notes: flow.notes,
          outcome: result,
        });
      }
      if (shouldTreatAsPreview) {
        flow.notes.push(
          `Spotify embed audio looked like a short clip (${embedTranscriptChars} chars); falling back to iTunes RSS`,
        );
      }
      flow.notes.push(
        `Spotify embed audio transcription failed; falling back to iTunes RSS: ${
          result.error?.message ?? 'unknown error'
        }`,
      );
    }

    const feedUrl = await resolvePodcastFeedUrlFromItunesSearch(flow.options.fetch, showTitle);
    if (!feedUrl) {
      const episodeFromSearch = await resolvePodcastEpisodeFromItunesSearch(
        flow.options.fetch,
        showTitle,
        episodeTitle,
      );
      if (episodeFromSearch) {
        const missing = flow.ensureTranscriptionProvider();
        if (missing) {return missing;}
        flow.pushOnce('whisper');
        const result = await flow.transcribe({
          durationSecondsHint: episodeFromSearch.durationSeconds,
          filenameHint: 'episode.mp3',
          url: episodeFromSearch.episodeUrl,
        });
        if (result.text) {
          flow.notes.push('Resolved Spotify episode via iTunes episode search');
          return buildWhisperResult({
            attemptedProviders: flow.attemptedProviders,
            metadata: {
              durationSeconds: episodeFromSearch.durationSeconds,
              episodeId: spotifyEpisodeId,
              episodeTitle: episodeFromSearch.episodeTitle,
              episodeUrl: episodeFromSearch.episodeUrl,
              kind: 'spotify_itunes_search_episode',
              provider: 'podcast',
              showTitle,
            },
            notes: flow.notes,
            outcome: result,
          });
        }
      }
      throw new Error(
        `Spotify episode audio appears DRM-protected; could not resolve RSS feed via iTunes Search API for show "${showTitle}"`,
      );
    }

    const feedResponse = await flow.options.fetch(feedUrl, {
      signal: AbortSignal.timeout(TRANSCRIPTION_TIMEOUT_MS),
    });
    if (!feedResponse.ok) {
      throw new Error(`Podcast feed fetch failed (${feedResponse.status})`);
    }
    const feedXml = await feedResponse.text();
    let maybeTranscript: Awaited<ReturnType<typeof tryFetchTranscriptFromFeedXml>> = null;
    if (/podcast:transcript/i.test(feedXml)) {
      flow.pushOnce('podcastTranscript');
      maybeTranscript = await tryFetchTranscriptFromFeedXml({
        episodeTitle,
        feedXml,
        fetchImpl: flow.options.fetch,
        notes: flow.notes,
      });
    }
    if (maybeTranscript) {
      return {
        attemptedProviders: flow.attemptedProviders,
        metadata: {
          episodeId: spotifyEpisodeId,
          episodeTitle,
          feedUrl,
          kind: 'spotify_itunes_rss_transcript',
          provider: 'podcast',
          showTitle,
          transcriptType: maybeTranscript.transcriptType,
          transcriptUrl: maybeTranscript.transcriptUrl,
        },
        notes: joinNotes(flow.notes),
        segments: flow.options.transcriptTimestamps ? (maybeTranscript.segments ?? null) : null,
        source: 'podcastTranscript',
        text: maybeTranscript.text,
      };
    }
    const match = extractEnclosureForEpisode(feedXml, episodeTitle);
    if (!match) {
      const episodeFromSearch = await resolvePodcastEpisodeFromItunesSearch(
        flow.options.fetch,
        showTitle,
        episodeTitle,
      );
      if (episodeFromSearch) {
        const missing = flow.ensureTranscriptionProvider();
        if (missing) {return missing;}
        flow.pushOnce('whisper');
        const result = await flow.transcribe({
          durationSecondsHint: episodeFromSearch.durationSeconds,
          filenameHint: 'episode.mp3',
          url: episodeFromSearch.episodeUrl,
        });
        if (result.text) {
          flow.notes.push('Resolved Spotify episode via iTunes episode search');
          return buildWhisperResult({
            attemptedProviders: flow.attemptedProviders,
            metadata: {
              durationSeconds: episodeFromSearch.durationSeconds,
              episodeId: spotifyEpisodeId,
              episodeTitle: episodeFromSearch.episodeTitle,
              episodeUrl: episodeFromSearch.episodeUrl,
              kind: 'spotify_itunes_search_episode',
              provider: 'podcast',
              showTitle,
            },
            notes: flow.notes,
            outcome: result,
          });
        }
      }
      throw new Error(`Episode enclosure not found in RSS feed for "${episodeTitle}"`);
    }
    const enclosureUrl = decodeXmlEntities(match.enclosureUrl);
    const {durationSeconds} = match;

    flow.notes.push(
      via === 'firecrawl'
        ? 'Resolved Spotify episode via Firecrawl embed + iTunes RSS'
        : 'Resolved Spotify episode via iTunes RSS',
    );
    const missing = flow.ensureTranscriptionProvider();
    if (missing) {return missing;}
    flow.pushOnce('whisper');
    const result = await flow.transcribe({
      durationSecondsHint: durationSeconds,
      filenameHint: 'episode.mp3',
      url: enclosureUrl,
    });
    return buildWhisperResult({
      attemptedProviders: flow.attemptedProviders,
      includeProviderOnFailure: true,
      metadata: {
        durationSeconds,
        enclosureUrl,
        episodeId: spotifyEpisodeId,
        episodeTitle,
        feedUrl,
        kind: 'spotify_itunes_rss_enclosure',
        provider: 'podcast',
        showTitle,
      },
      notes: flow.notes,
      outcome: result,
    });
  } catch (error) {
    return {
      attemptedProviders: flow.attemptedProviders,
      metadata: {
        episodeId: spotifyEpisodeId,
        kind: 'spotify_itunes_rss_enclosure',
        provider: 'podcast',
      },
      notes: `Spotify episode fetch failed: ${error instanceof Error ? error.message : String(error)}`,
      source: null,
      text: null,
    };
  }
}

function looksLikeSpotifyEncryptedAudioFormat(format: string | null): boolean {
  return /(?:^|_)C(?:BCS|ENC)(?:_|$)/i.test(format ?? '');
}
