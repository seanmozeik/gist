import type { ProviderResult } from '../../types.js';
import {
  extractAppleEpisodeTitleFromHtml,
  extractApplePodcastIds,
  extractEmbeddedJsonUrl,
} from './apple.js';
import { TRANSCRIPTION_TIMEOUT_MS } from './constants.js';
import type { PodcastFlowContext } from './flow-context.js';
import { resolveApplePodcastEpisodeFromItunesLookup } from './itunes.js';
import { buildWhisperResult, joinNotes } from './results.js';
import {
  decodeXmlEntities,
  extractEnclosureForEpisode,
  extractEnclosureFromFeed,
  tryFetchTranscriptFromFeedXml,
} from './rss.js';

export async function fetchAppleTranscriptFromItunesLookup(
  flow: PodcastFlowContext,
): Promise<ProviderResult | null> {
  const appleIds =
    typeof flow.context.html !== 'string' ? extractApplePodcastIds(flow.context.url) : null;
  if (!appleIds) {return null;}

  try {
    const episode = await resolveApplePodcastEpisodeFromItunesLookup({
      episodeId: appleIds.episodeId,
      fetchImpl: flow.options.fetch,
      showId: appleIds.showId,
    });
    if (!episode) {
      throw new Error('iTunes lookup did not return an episodeUrl');
    }

    if (episode.feedUrl && episode.episodeTitle) {
      flow.pushOnce('podcastTranscript');
      const feedResponse = await flow.options.fetch(episode.feedUrl, {
        redirect: 'follow',
        signal: AbortSignal.timeout(TRANSCRIPTION_TIMEOUT_MS),
      });
      if (feedResponse.ok) {
        const feedXml = await feedResponse.text();
        let maybeTranscript: Awaited<ReturnType<typeof tryFetchTranscriptFromFeedXml>> = null;
        if (/podcast:transcript/i.test(feedXml)) {
          maybeTranscript = await tryFetchTranscriptFromFeedXml({
            episodeTitle: episode.episodeTitle,
            feedXml,
            fetchImpl: flow.options.fetch,
            notes: flow.notes,
          });
        }
        if (maybeTranscript) {
          flow.notes.push('Resolved Apple Podcasts episode via RSS <podcast:transcript>');
          return {
            attemptedProviders: flow.attemptedProviders,
            metadata: {
              episodeId: appleIds.episodeId,
              episodeTitle: episode.episodeTitle,
              feedUrl: episode.feedUrl,
              kind: 'apple_itunes_rss_transcript',
              provider: 'podcast',
              showId: appleIds.showId,
              transcriptType: maybeTranscript.transcriptType,
              transcriptUrl: maybeTranscript.transcriptUrl,
            },
            notes: joinNotes(flow.notes),
            segments: flow.options.transcriptTimestamps ? (maybeTranscript.segments ?? null) : null,
            source: 'podcastTranscript',
            text: maybeTranscript.text,
          };
        }
      }
    }

    const missing = flow.ensureTranscriptionProvider();
    if (missing) {return missing;}
    flow.pushOnce('whisper');
    const result = await flow.transcribe({
      durationSecondsHint: episode.durationSeconds,
      filenameHint: episode.fileExtension ? `episode.${episode.fileExtension}` : 'episode.mp3',
      url: episode.episodeUrl,
    });

    if (result.text) {
      flow.notes.push('Resolved Apple Podcasts episode via iTunes lookup');
    }
    return buildWhisperResult({
      attemptedProviders: flow.attemptedProviders,
      includeProviderOnFailure: true,
      metadata: {
        durationSeconds: episode.durationSeconds,
        episodeId: appleIds.episodeId,
        episodeUrl: episode.episodeUrl,
        feedUrl: episode.feedUrl,
        kind: 'apple_itunes_episode',
        provider: 'podcast',
        showId: appleIds.showId,
      },
      notes: flow.notes,
      outcome: result,
    });
  } catch (error) {
    return {
      attemptedProviders: flow.attemptedProviders,
      metadata: { kind: 'apple_itunes_episode', provider: 'podcast', showId: appleIds.showId },
      notes: `Apple Podcasts iTunes lookup failed: ${error instanceof Error ? error.message : String(error)}`,
      source: null,
      text: null,
    };
  }
}

export async function fetchAppleTranscriptFromEmbeddedHtml(
  flow: PodcastFlowContext,
): Promise<ProviderResult | null> {
  if (typeof flow.context.html !== 'string') {return null;}

  const appleEpisodeTitle = extractAppleEpisodeTitleFromHtml(flow.context.html);

  const appleFeedUrl = extractEmbeddedJsonUrl(flow.context.html, 'feedUrl');
  if (appleFeedUrl) {
    try {
      const feedResponse = await flow.options.fetch(appleFeedUrl, {
        signal: AbortSignal.timeout(TRANSCRIPTION_TIMEOUT_MS),
      });
      if (!feedResponse.ok) {
        throw new Error(`Feed fetch failed (${feedResponse.status})`);
      }
      const xml = await feedResponse.text();

      let maybeTranscript: Awaited<ReturnType<typeof tryFetchTranscriptFromFeedXml>> = null;
      if (/podcast:transcript/i.test(xml)) {
        flow.pushOnce('podcastTranscript');
        maybeTranscript = await tryFetchTranscriptFromFeedXml({
          episodeTitle: appleEpisodeTitle,
          feedXml: xml,
          fetchImpl: flow.options.fetch,
          notes: flow.notes,
        });
      }
      if (maybeTranscript) {
        return {
          attemptedProviders: flow.attemptedProviders,
          metadata: {
            episodeTitle: appleEpisodeTitle,
            feedUrl: appleFeedUrl,
            kind: 'apple_feed_transcript',
            provider: 'podcast',
            transcriptType: maybeTranscript.transcriptType,
            transcriptUrl: maybeTranscript.transcriptUrl,
          },
          notes: joinNotes(flow.notes),
          segments: flow.options.transcriptTimestamps ? (maybeTranscript.segments ?? null) : null,
          source: 'podcastTranscript',
          text: maybeTranscript.text,
        };
      }

      const enclosure =
        appleEpisodeTitle != null
          ? extractEnclosureForEpisode(xml, appleEpisodeTitle)
          : extractEnclosureFromFeed(xml);
      if (enclosure) {
        const resolvedUrl = decodeXmlEntities(enclosure.enclosureUrl);
        const {durationSeconds} = enclosure;
        const missing = flow.ensureTranscriptionProvider();
        if (missing) {return missing;}
        flow.pushOnce('whisper');
        let result: Awaited<ReturnType<typeof flow.transcribe>>;
        try {
          result = await flow.transcribe({
            durationSecondsHint: durationSeconds,
            filenameHint: 'episode.mp3',
            url: resolvedUrl,
          });
        } catch (error) {
          return {
            attemptedProviders: flow.attemptedProviders,
            metadata: {
              durationSeconds,
              enclosureUrl: resolvedUrl,
              episodeTitle: appleEpisodeTitle,
              feedUrl: appleFeedUrl,
              kind: 'apple_feed_url',
              provider: 'podcast',
            },
            notes: error instanceof Error ? error.message : String(error),
            source: null,
            text: null,
          };
        }
        return buildWhisperResult({
          attemptedProviders: flow.attemptedProviders,
          metadata: {
            durationSeconds,
            enclosureUrl: resolvedUrl,
            episodeTitle: appleEpisodeTitle,
            feedUrl: appleFeedUrl,
            kind: 'apple_feed_url',
            provider: 'podcast',
          },
          notes: flow.notes,
          outcome: result,
        });
      }
    } catch (error) {
      // Apple pages usually contain both `feedUrl` and `streamUrl`. If the feed is flaky/blocked,
      // Fall back to `streamUrl` instead of failing the whole provider.
      flow.notes.push(
        `Podcast feed fetch failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const appleStreamUrl = extractEmbeddedJsonUrl(flow.context.html, 'streamUrl');
  if (appleStreamUrl) {
    const missing = flow.ensureTranscriptionProvider();
    if (missing) {return missing;}
    flow.pushOnce('whisper');
    let result: Awaited<ReturnType<typeof flow.transcribe>>;
    try {
      result = await flow.transcribe({
        durationSecondsHint: null,
        filenameHint: 'episode.mp3',
        url: appleStreamUrl,
      });
    } catch (error) {
      return {
        attemptedProviders: flow.attemptedProviders,
        metadata: { kind: 'apple_stream_url', provider: 'podcast', streamUrl: appleStreamUrl },
        notes: error instanceof Error ? error.message : String(error),
        source: null,
        text: null,
      };
    }
    return buildWhisperResult({
      attemptedProviders: flow.attemptedProviders,
      metadata: { kind: 'apple_stream_url', provider: 'podcast', streamUrl: appleStreamUrl },
      notes: flow.notes,
      outcome: result,
    });
  }

  return null;
}
