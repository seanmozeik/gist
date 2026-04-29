import {
  isTwitterBroadcastUrl,
  isTwitterStatusUrl,
} from '../../link-preview/content/twitter-utils.js';
import { inferDirectMediaKind, isDirectMediaUrl } from '../../url.js';
import { normalizeTranscriptText } from '../normalize.js';
import { resolveTranscriptionConfig } from '../transcription-config.js';
import type { ProviderContext, ProviderFetchOptions, ProviderResult } from '../types.js';
import { fetchDirectMediaTranscript } from './generic-direct-media.js';
import { detectEmbeddedMedia, fetchCaptionTrack } from './generic-embedded.js';
import { fetchTwitterMediaTranscript } from './generic-twitter.js';

export const canHandle = (): boolean => true;

export const fetchTranscript = async (
  context: ProviderContext,
  options: ProviderFetchOptions,
): Promise<ProviderResult> => {
  const attemptedProviders: ProviderResult['attemptedProviders'] = [];
  const notes: string[] = [];
  const transcription = resolveTranscriptionConfig(options);

  const embedded = context.html ? detectEmbeddedMedia(context.html, context.url) : null;
  const twitterStatus = isTwitterStatusUrl(context.url);
  const twitterMedia = twitterStatus || isTwitterBroadcastUrl(context.url);
  const hasEmbeddedMedia = Boolean(embedded?.mediaUrl ?? embedded?.kind);
  const mediaKindHint =
    options.mediaKindHint ?? embedded?.kind ?? inferDirectMediaKind(context.url) ?? null;
  if (embedded?.track) {
    attemptedProviders.push('embedded');
    const caption = await fetchCaptionTrack(
      options.fetch,
      embedded.track,
      notes,
      Boolean(options.transcriptTimestamps),
    );
    if (caption?.text) {
      return {
        attemptedProviders,
        metadata: {
          kind: embedded.kind,
          provider: 'embedded',
          trackLanguage: embedded.track.language,
          trackType: embedded.track.type,
          trackUrl: embedded.track.url,
        },
        notes: notes.length > 0 ? notes.join('; ') : null,
        segments: options.transcriptTimestamps ? (caption.segments ?? null) : null,
        source: 'embedded',
        text: normalizeTranscriptText(caption.text),
      };
    }
  }

  const shouldAttemptMediaTranscript =
    options.mediaTranscriptMode === 'prefer' || (twitterStatus && hasEmbeddedMedia);
  const mediaUrl = shouldAttemptMediaTranscript
    ? (embedded?.mediaUrl ?? (isDirectMediaUrl(context.url) ? context.url : null))
    : null;

  if (
    shouldAttemptMediaTranscript &&
    (mediaUrl || embedded?.kind || isDirectMediaUrl(context.url))
  ) {
    const result = await fetchDirectMediaTranscript({
      attemptedProviders,
      kind: embedded?.kind ?? inferDirectMediaKind(mediaUrl ?? context.url) ?? null,
      notes,
      options,
      transcription,
      url: mediaUrl ?? context.url,
    });
    if (result) {return result;}
  }

  if (twitterStatus && options.mediaTranscriptMode !== 'prefer' && !hasEmbeddedMedia) {
    return {
      attemptedProviders,
      metadata: { kind: 'twitter', provider: 'generic', reason: 'media_mode_auto' },
      notes:
        'Twitter transcript skipped (media transcript mode is auto; enable --video-mode transcript to force audio).',
      source: null,
      text: null,
    };
  }

  if (!twitterMedia) {
    return {
      attemptedProviders,
      metadata: { provider: 'generic', reason: 'not_implemented' },
      notes: notes.length > 0 ? notes.join('; ') : null,
      source: null,
      text: null,
    };
  }
  return fetchTwitterMediaTranscript({
    attemptedProviders,
    context,
    mediaKindHint,
    notes,
    options,
    transcription,
  });
};
