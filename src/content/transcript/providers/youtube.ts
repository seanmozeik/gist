import { resolveTranscriptionConfig } from '../transcription-config.js';
import type { ProviderContext, ProviderFetchOptions, ProviderResult } from '../types.js';
import { resolveTranscriptProviderCapabilities } from './transcription-capability.js';
import {
  buildUnavailableResult,
  loadYoutubeHtml,
  resolveDurationMetadata,
  resolveEffectiveVideoId,
  tryManualCaptionTranscript,
  tryWebTranscript,
  tryYtDlpTranscript,
} from './youtube/provider-flow.js';

const YOUTUBE_URL_PATTERN = /youtube\.com|youtu\.be/i;

export const canHandle = ({ url }: ProviderContext): boolean => YOUTUBE_URL_PATTERN.test(url);

export const fetchTranscript = async (
  context: ProviderContext,
  options: ProviderFetchOptions,
): Promise<ProviderResult> => {
  const attemptedProviders: ProviderResult['attemptedProviders'] = [];
  const notes: string[] = [];
  const transcription = resolveTranscriptionConfig(options);
  const { url } = context;
  const html = await loadYoutubeHtml(context, options);
  const mode = options.youtubeTranscriptMode;
  const progress = typeof options.onProgress === 'function' ? options.onProgress : null;
  const transcriptionCapabilities = await resolveTranscriptProviderCapabilities({
    transcription,
    ytDlpPath: options.ytDlpPath,
  });
  const { canRunYtDlp } = transcriptionCapabilities;
  const pushHint = (hint: string) => {
    progress?.({ hint, kind: 'transcript-start', service: 'youtube', url });
  };

  if (mode === 'yt-dlp' && !options.ytDlpPath) {
    throw new Error(
      'Missing yt-dlp binary for --youtube yt-dlp (set YT_DLP_PATH or install yt-dlp)',
    );
  }
  if (mode === 'yt-dlp' && !transcriptionCapabilities.canTranscribe) {
    throw new Error(
      'Missing transcription provider for --youtube yt-dlp (set GIST_LOCAL_BASE_URL or OPENROUTER_API_KEY)',
    );
  }

  if (!html) {
    return { attemptedProviders, source: null, text: null };
  }
  const effectiveVideoId = resolveEffectiveVideoId(context);
  const htmlText = html ?? '';
  if (!effectiveVideoId) {
    return { attemptedProviders, source: null, text: null };
  }
  const durationMetadata = await resolveDurationMetadata({
    effectiveVideoId,
    htmlText,
    options,
    url,
  });
  const flow = {
    attemptedProviders,
    canRunYtDlp,
    context,
    durationMetadata,
    effectiveVideoId,
    htmlText,
    notes,
    options,
    pushHint,
    transcription,
  };

  // Try no-auto mode (skip auto-generated captions, fall back to yt-dlp)
  if (mode === 'no-auto') {
    const manualTranscript = await tryManualCaptionTranscript(flow);
    if (manualTranscript) {
      return manualTranscript;
    }
    notes.push('No creator captions found, using yt-dlp transcription');
  }

  // Try web methods (youtubei, captionTracks) if mode is 'auto' or 'web'
  if (mode === 'auto' || mode === 'web') {
    const transcript = await tryWebTranscript(flow);
    if (transcript) {
      return transcript;
    }
  }

  // Try yt-dlp audio transcription if mode is 'auto', 'no-auto', or 'yt-dlp'.
  if (mode === 'yt-dlp' || mode === 'no-auto' || (mode === 'auto' && canRunYtDlp)) {
    const transcript = await tryYtDlpTranscript({ flow, mode });
    if (transcript) {
      return transcript;
    }
  }

  return buildUnavailableResult(flow);
};
