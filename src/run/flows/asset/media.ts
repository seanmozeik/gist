/**
 * Media file transcription handler for local audio/video files.
 * Phase 2: Transcript provider integration
 * Phase 2.2: Local file path handling for transcript caching
 */

import { statSync } from 'node:fs';
import { isAbsolute, resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createLinkPreviewClient, type ExtractedLinkContent } from '../../../content/index';
import type { AssetAttachment } from '../../attachments';
import { readTweetWithPreferredClient } from '../../bird';
import { resolveTwitterCookies } from '../../cookies/twitter';
import { hasBirdCli } from '../../env';
import { writeVerbose } from '../../logging';
import { MAX_LOCAL_MEDIA_BYTES, MAX_LOCAL_MEDIA_LABEL } from './media-policy';
import type { AssetSummaryContext, GistAssetArgs } from './summary';

/**
 * Get file modification time for cache invalidation support.
 * Returns null if the path is not a local file or file doesn't exist.
 */
function getFileModificationTime(filePath: string): number | null {
  // Only support absolute local file paths
  if (!isAbsolute(filePath)) {
    return null;
  }
  try {
    const stats = statSync(filePath);
    return stats.mtimeMs ?? null;
  } catch {
    // File doesn't exist or can't be accessed
    return null;
  }
}

/**
 * Handler for local audio/video files.
 *
 * Phase 2 Implementation:
 * 1. Validates transcription provider availability
 * 2. Creates LinkPreviewClient with necessary dependencies
 * 3. Calls client.fetchLinkContent to trigger transcription
 * 4. Converts transcript text to AssetAttachment
 * 5. Calls gistAsset with the transcript
 *
 * Phase 2.2 Enhancement:
 * - Captures file modification time for cache invalidation
 * - Passes fileMtime to transcript cache for local file support
 */
export async function gistMediaFile(ctx: AssetSummaryContext, args: GistAssetArgs): Promise<void> {
  // Helper to check if a binary is available on PATH
  const isBinaryAvailable = async (binary: string): Promise<boolean> => {
    const { spawn } = await import('node:child_process');
    return new Promise<boolean>((resolve) => {
      const proc = spawn(binary, ['--help'], {
        env: ctx.env,
        stdio: ['ignore', 'ignore', 'ignore'],
      });
      proc.on('error', () => {
        resolve(false);
      });
      proc.on('close', (code) => {
        resolve(code === 0);
      });
    });
  };

  // Check for yt-dlp: either via env var or on PATH
  const ytDlpPath = ctx.env.YT_DLP_PATH ?? ((await isBinaryAvailable('yt-dlp')) ? 'yt-dlp' : null);

  const hasAnyTranscriptionProvider =
    Boolean(ctx.envForRun.GIST_LOCAL_BASE_URL?.trim()) ||
    Boolean(ctx.envForRun.OPENROUTER_API_KEY?.trim());

  if (!hasAnyTranscriptionProvider) {
    throw new Error('Media transcription requires GIST_LOCAL_BASE_URL or OPENROUTER_API_KEY.');
  }

  const isHttpUrl = (value: string): boolean => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  };

  // For URLs, skip local file validation - yt-dlp will handle the download
  const isUrl = args.sourceKind === 'asset-url' || isHttpUrl(args.sourceLabel);

  let absolutePath: string;
  let fileMtime: number | null = null;

  if (isUrl) {
    // For URLs, use the URL directly - no local path resolution needed
    absolutePath = args.sourceLabel;
  } else {
    absolutePath = resolvePath(args.sourceLabel);

    // Get file modification time for cache invalidation (after path resolution)
    fileMtime = getFileModificationTime(absolutePath);

    // Validate file size before attempting transcription
    try {
      const stats = statSync(absolutePath);
      const fileSizeBytes = stats.size;
      const maxSizeBytes = MAX_LOCAL_MEDIA_BYTES;

      if (fileSizeBytes === 0) {
        throw new Error('Media file is empty (0 bytes). Please provide a valid audio/video file.');
      }

      if (fileSizeBytes > maxSizeBytes) {
        const fileSizeMB = Math.round(fileSizeBytes / (1024 * 1024));
        throw new Error(
          `Media file is too large (${fileSizeMB} MB). Maximum supported size is ${MAX_LOCAL_MEDIA_LABEL}.`,
        );
      }
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.includes('empty') || error.message.includes('large'))
      ) {
        throw error; // Re-throw our validation errors
      }
      // For other statSync errors (e.g., file not found), let them bubble up
      throw new Error(
        `Unable to access media file: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { cause: error },
      );
    }
  }

  const cacheMode = ctx.cache.mode;

  // Create reader for X tweets (for completeness, not used for media)
  const readTweetWithBirdClient = hasBirdCli(ctx.env)
    ? ({ url, timeoutMs }: { url: string; timeoutMs: number }) =>
        readTweetWithPreferredClient({ env: ctx.env, timeoutMs, url })
    : null;

  // Create link preview client for transcript resolution
  const transcriptCache =
    cacheMode === 'default' ? (ctx.cache.store?.transcriptCache ?? null) : null;

  const client = createLinkPreviewClient({
    env: ctx.envForRun,
    ytDlpPath,
    transcription: { env: ctx.envForRun },
    convertHtmlToMarkdown: null, // Not needed for media
    readTweetWithBird: readTweetWithBirdClient,
    resolveTwitterCookies: async (_args) => {
      const res = await resolveTwitterCookies({ env: ctx.env });
      return {
        cookiesFromBrowser: res.cookies.cookiesFromBrowser,
        source: res.cookies.source,
        warnings: res.warnings,
      };
    },
    fetch: ctx.trackedFetch,
    transcriptCache,
    mediaCache: ctx.mediaCache ?? null,
    onProgress: (_event) => {
      // Could update progress here if needed
      // For now, silent transcription
    },
  });

  try {
    // For URLs, use directly. For local files, convert to file:// URL.
    // Yt-dlp can handle both http(s) URLs and file:// URLs.
    const fileUrl = isUrl ? absolutePath : pathToFileURL(absolutePath).href;

    // Fetch the link content (will trigger transcription for media)
    // Using file:// URL ensures the provider chain can handle local files properly
    const extracted: ExtractedLinkContent = await client.fetchLinkContent(fileUrl, {
      timeoutMs: ctx.timeoutMs,
      cacheMode,
      youtubeTranscript: 'auto', // Not used for local files, but set for completeness
      mediaTranscript: 'prefer', // Prefer transcription for media files
      transcriptTimestamps: false,
      fileMtime, // Include file modification time for cache invalidation
    });

    // Check if we got a transcript
    if (!extracted.content || extracted.content.trim().length === 0) {
      throw new Error(`Failed to transcribe media file. Check that:
  - Audio/video format is supported (MP3, WAV, M4A, OGG, FLAC, MP4, MOV, WEBM)
  - Transcription provider is configured
  - File is readable
  - Media file is not corrupted`);
    }

    // Create a text-based attachment from the transcript
    const filename = args.sourceLabel.split('/').pop() ?? 'media';
    const transcriptAttachment: AssetAttachment = {
      bytes: new TextEncoder().encode(extracted.content),
      filename: `${filename}.transcript.txt`,
      kind: 'file',
      mediaType: 'text/plain',
    };

    writeVerbose(
      ctx.stderr,
      ctx.verbose,
      `transcription done media file: ${extracted.diagnostics?.transcript?.provider ?? 'unknown'}`,
      false,
      ctx.envForRun,
    );

    // If extract mode, output the transcript directly without LLM summarization
    if (ctx.extractMode) {
      ctx.clearProgressForStdout();
      ctx.stdout.write(extracted.content);
      if (!extracted.content.endsWith('\n')) {
        ctx.stdout.write('\n');
      }
      return;
    }

    // Call the standard asset summarization with the transcript
    const { gistAsset } = await import('./summary.js');
    await gistAsset(ctx, {
      attachment: transcriptAttachment,
      onModelChosen: args.onModelChosen,
      sourceKind: 'file',
      sourceLabel: `${args.sourceLabel} (transcript)`,
    });
  } catch (error) {
    // Re-throw with better context for transcription errors
    if (error instanceof Error && error.message.includes('transcribe')) {
      throw error;
    }
    throw new Error(
      `Transcription failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}
