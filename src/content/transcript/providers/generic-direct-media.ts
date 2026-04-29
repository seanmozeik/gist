import type { DirectMediaKind } from '../../direct-media.js';
import { normalizeTranscriptText } from '../normalize.js';
import type { TranscriptionConfig } from '../transcription-config.js';
import type { ProviderFetchOptions, ProviderResult } from '../types.js';
import { resolveTranscriptProviderCapabilities } from './transcription-capability.js';

export async function fetchDirectMediaTranscript({
  url,
  options,
  transcription,
  notes,
  attemptedProviders,
  kind,
}: {
  url: string;
  options: ProviderFetchOptions;
  transcription: TranscriptionConfig;
  notes: string[];
  attemptedProviders: ProviderResult['attemptedProviders'];
  kind: DirectMediaKind | null;
}): Promise<ProviderResult | null> {
  if (!options.ytDlpPath) {
    notes.push('yt-dlp is not configured (set YT_DLP_PATH or ensure yt-dlp is on PATH)');
    return null;
  }

  const transcriptionCapabilities = await resolveTranscriptProviderCapabilities({
    transcription,
    ytDlpPath: options.ytDlpPath,
  });
  if (!transcriptionCapabilities.canTranscribe) {
    notes.push(transcriptionCapabilities.missingProviderNote);
    return null;
  }

  attemptedProviders.push('yt-dlp');

  const mod = await import('./youtube/yt-dlp.js');
  const ytdlpResult = await mod.fetchTranscriptWithYtDlp({
    mediaCache: options.mediaCache ?? null,
    mediaKind: kind ?? options.mediaKindHint ?? null,
    onProgress: options.onProgress ?? null,
    service: 'generic',
    transcription,
    url,
    ytDlpPath: options.ytDlpPath,
  });
  if (ytdlpResult.notes.length > 0) {
    notes.push(...ytdlpResult.notes);
  }

  if (ytdlpResult.text) {
    return {
      attemptedProviders,
      metadata: {
        kind: kind ?? 'media',
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
  return null;
}
