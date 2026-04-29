import type { ProviderResult } from '../../types.js';
import { fetchTranscriptWithYtDlp } from '../youtube/yt-dlp.js';
import type { PodcastFlowContext } from './flow-context.js';
import { buildWhisperResult, joinNotes } from './results.js';
import {
  decodeXmlEntities,
  extractEnclosureFromFeed,
  tryFetchTranscriptFromFeedXml,
} from './rss.js';

export async function tryPodcastTranscriptFromFeed(
  flow: PodcastFlowContext,
): Promise<ProviderResult | null> {
  if (!flow.feedHtml || !/podcast:transcript/i.test(flow.feedHtml)) {
    return null;
  }

  flow.pushOnce('podcastTranscript');
  const direct = await tryFetchTranscriptFromFeedXml({
    episodeTitle: null,
    feedXml: flow.feedHtml,
    fetchImpl: flow.options.fetch,
    notes: flow.notes,
  });
  if (!direct) {
    return null;
  }

  return {
    attemptedProviders: flow.attemptedProviders,
    metadata: {
      kind: 'rss_podcast_transcript',
      provider: 'podcast',
      transcriptType: direct.transcriptType,
      transcriptUrl: direct.transcriptUrl,
    },
    notes: joinNotes(flow.notes),
    segments: flow.options.transcriptTimestamps ? (direct.segments ?? null) : null,
    source: 'podcastTranscript',
    text: direct.text,
  };
}

export async function tryFeedEnclosureTranscript(
  flow: PodcastFlowContext,
): Promise<ProviderResult | null> {
  if (!flow.feedHtml) {
    return null;
  }

  const feedEnclosure = extractEnclosureFromFeed(flow.feedHtml);
  if (!feedEnclosure) {
    return null;
  }

  const resolvedUrl = decodeXmlEntities(feedEnclosure.enclosureUrl);
  const { durationSeconds } = feedEnclosure;

  try {
    const missing = flow.ensureTranscriptionProvider();
    if (missing) {
      return missing;
    }

    flow.pushOnce('whisper');
    const transcript = await flow.transcribe({
      durationSecondsHint: durationSeconds,
      filenameHint: 'episode.mp3',
      url: resolvedUrl,
    });

    return buildWhisperResult({
      attemptedProviders: flow.attemptedProviders,
      includeProviderOnFailure: true,
      metadata: {
        durationSeconds,
        enclosureUrl: resolvedUrl,
        kind: 'rss_enclosure',
        provider: 'podcast',
      },
      notes: flow.notes,
      outcome: transcript,
    });
  } catch (error) {
    return {
      attemptedProviders: flow.attemptedProviders,
      metadata: { enclosureUrl: resolvedUrl, kind: 'rss_enclosure', provider: 'podcast' },
      notes: `Podcast enclosure download failed: ${error instanceof Error ? error.message : String(error)}`,
      source: null,
      text: null,
    };
  }
}

export async function tryOgAudioTranscript(
  flow: PodcastFlowContext,
): Promise<ProviderResult | null> {
  if (!flow.feedHtml) {
    return null;
  }

  const ogAudioUrl = extractOgAudioUrl(flow.feedHtml);
  if (!ogAudioUrl) {
    return null;
  }

  flow.attemptedProviders.push('whisper');
  const result = await flow.transcribe({
    durationSecondsHint: null,
    filenameHint: 'audio.mp3',
    url: ogAudioUrl,
  });
  if (result.text) {
    flow.notes.push('Used og:audio media (may be a preview clip, not the full episode)');
    return buildWhisperResult({
      attemptedProviders: flow.attemptedProviders,
      metadata: { kind: 'og_audio', ogAudioUrl, provider: 'podcast' },
      notes: flow.notes,
      outcome: result,
    });
  }

  return {
    attemptedProviders: flow.attemptedProviders,
    metadata: { kind: 'og_audio', ogAudioUrl, provider: 'podcast' },
    notes: result.error?.message ?? null,
    source: null,
    text: null,
  };
}

export async function tryPodcastYtDlpTranscript(
  flow: PodcastFlowContext,
): Promise<ProviderResult | null> {
  if (!flow.options.ytDlpPath) {
    return null;
  }

  flow.attemptedProviders.push('yt-dlp');
  try {
    const result = await fetchTranscriptWithYtDlp({
      mediaCache: flow.options.mediaCache ?? null,
      mediaKind: 'audio',
      service: 'podcast',
      transcription: flow.transcription,
      url: flow.context.url,
      ytDlpPath: flow.options.ytDlpPath,
    });
    if (result.notes.length > 0) {
      flow.notes.push(...result.notes);
    }

    return {
      attemptedProviders: flow.attemptedProviders,
      metadata: { kind: 'yt_dlp', provider: 'podcast', transcriptionProvider: result.provider },
      notes: joinNotes(flow.notes),
      source: result.text ? 'yt-dlp' : null,
      text: result.text,
    };
  } catch (error) {
    return {
      attemptedProviders: flow.attemptedProviders,
      metadata: { kind: 'yt_dlp', provider: 'podcast' },
      notes: `yt-dlp transcription failed: ${error instanceof Error ? error.message : String(error)}`,
      source: null,
      text: null,
    };
  }
}

export function buildNoTranscriptResult(flow: PodcastFlowContext): ProviderResult {
  const missing = flow.ensureTranscriptionProvider();
  if (missing) {
    return missing;
  }

  return {
    attemptedProviders: flow.attemptedProviders,
    metadata: { provider: 'podcast', reason: 'no_enclosure_and_no_yt_dlp' },
    source: null,
    text: null,
  };
}

function extractOgAudioUrl(html: string): string | null {
  const match = /<meta\s+property=['"]og:audio['"]\s+content=['"]([^'"]+)['"][^>]*>/i.exec(html);
  if (!match?.[1]) {
    return null;
  }
  const candidate = match[1].trim();
  if (!candidate) {
    return null;
  }
  return /^https?:\/\//i.test(candidate) ? candidate : null;
}
