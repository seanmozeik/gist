import type { CacheMode, FetchLinkContentOptions } from '../../../content/index';
import { isLocalFileUrl, resolveLocalFileMtime } from '../../../content/local-file';

interface UrlFetchFlags {
  timeoutMs: number;
  maxExtractCharacters?: number | null;
  youtubeMode: 'auto' | 'web' | 'yt-dlp' | 'no-auto';
  videoMode: 'auto' | 'transcript' | 'understand';
  transcriptTimestamps: boolean;
}

interface UrlMarkdownOptions {
  effectiveMarkdownMode: 'off' | 'auto' | 'llm' | 'readability';
  markdownRequested: boolean;
}

export function shouldPreferTranscriptForTarget(videoMode: UrlFetchFlags['videoMode']): boolean {
  return videoMode === 'transcript';
}

export function resolveUrlFetchOptions({
  targetUrl,
  flags,
  markdown,
  cacheMode,
}: {
  targetUrl: string;
  flags: UrlFetchFlags;
  markdown: UrlMarkdownOptions;
  cacheMode: CacheMode;
}): { localFile: boolean; options: FetchLinkContentOptions } {
  const localFile = isLocalFileUrl(targetUrl);
  return {
    localFile,
    options: {
      cacheMode,
      fileMtime: localFile ? resolveLocalFileMtime(targetUrl) : null,
      format: markdown.markdownRequested ? 'markdown' : 'text',
      markdownMode: markdown.markdownRequested ? markdown.effectiveMarkdownMode : undefined,
      maxCharacters:
        typeof flags.maxExtractCharacters === 'number' && flags.maxExtractCharacters > 0
          ? flags.maxExtractCharacters
          : undefined,
      mediaTranscript: shouldPreferTranscriptForTarget(flags.videoMode) ? 'prefer' : 'auto',
      timeoutMs: flags.timeoutMs,
      transcriptTimestamps: flags.transcriptTimestamps,
      youtubeTranscript: flags.youtubeMode,
    },
  };
}
