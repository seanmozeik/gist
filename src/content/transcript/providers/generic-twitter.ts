import type { DirectMediaKind } from '../../direct-media.js';
import { normalizeTranscriptText } from '../normalize.js';
import type { TranscriptionConfig } from '../transcription-config.js';
import type { ProviderContext, ProviderFetchOptions, ProviderResult } from '../types.js';
import {
  buildMissingTranscriptionProviderResult,
  resolveTranscriptProviderCapabilities,
} from './transcription-capability.js';

export async function fetchTwitterMediaTranscript({
  context,
  options,
  transcription,
  attemptedProviders,
  notes,
  mediaKindHint,
}: {
  context: ProviderContext;
  options: ProviderFetchOptions;
  transcription: TranscriptionConfig;
  attemptedProviders: ProviderResult['attemptedProviders'];
  notes: string[];
  mediaKindHint: DirectMediaKind | null;
}): Promise<ProviderResult> {
  if (!options.ytDlpPath) {
    return {
      attemptedProviders,
      metadata: { kind: 'twitter', provider: 'generic', reason: 'missing_yt_dlp' },
      notes: 'yt-dlp is not configured (set YT_DLP_PATH or ensure yt-dlp is on PATH)',
      source: null,
      text: null,
    };
  }

  const transcriptionCapabilities = await resolveTranscriptProviderCapabilities({
    transcription,
    ytDlpPath: options.ytDlpPath,
  });
  if (!transcriptionCapabilities.canTranscribe) {
    return buildMissingTranscriptionProviderResult({
      attemptedProviders,
      metadata: { kind: 'twitter', provider: 'generic', reason: 'missing_transcription_keys' },
    });
  }

  attemptedProviders.push('yt-dlp');

  const resolved = options.resolveTwitterCookies
    ? await options.resolveTwitterCookies({ url: context.url })
    : null;
  if (resolved?.warnings?.length) {
    notes.push(...resolved.warnings);
  }

  const extraArgs: string[] = [];
  if (resolved?.cookiesFromBrowser) {
    extraArgs.push('--cookies-from-browser', resolved.cookiesFromBrowser);
    if (resolved.source) {
      notes.push(`Using X cookies from ${resolved.source}`);
    }
  }

  const mod = await import('./youtube/yt-dlp.js');
  const ytdlpResult = await mod.fetchTranscriptWithYtDlp({
    extraArgs: extraArgs.length > 0 ? extraArgs : undefined,
    mediaCache: options.mediaCache ?? null,
    mediaKind: mediaKindHint,
    onProgress: options.onProgress ?? null,
    service: 'generic',
    transcription,
    url: context.url,
    ytDlpPath: options.ytDlpPath,
  });
  if (ytdlpResult.notes.length > 0) {
    notes.push(...ytdlpResult.notes);
  }

  if (ytdlpResult.text) {
    return {
      attemptedProviders,
      metadata: {
        cookieSource: resolved?.source ?? null,
        kind: 'twitter',
        provider: 'generic',
        transcriptionProvider: ytdlpResult.provider,
      },
      notes: notes.length > 0 ? notes.join('; ') : null,
      source: 'yt-dlp',
      text: normalizeTranscriptText(ytdlpResult.text),
    };
  }

  if (ytdlpResult.error) {
    notes.push(`yt-dlp transcription failed: ${ytdlpResult.error.message}`);
  }

  return {
    attemptedProviders,
    metadata: {
      kind: 'twitter',
      provider: 'generic',
      reason: ytdlpResult.error ? 'yt_dlp_failed' : 'no_transcript',
      transcriptionProvider: ytdlpResult.provider,
    },
    notes: notes.length > 0 ? notes.join('; ') : null,
    source: null,
    text: null,
  };
}
