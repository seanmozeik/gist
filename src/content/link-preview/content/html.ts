import { resolveTranscriptForLink } from '../../transcript/index.js';
import { extractYouTubeVideoId, isYouTubeUrl, isYouTubeVideoUrl } from '../../url.js';
import type { LinkPreviewDeps } from '../deps.js';
import type { FirecrawlDiagnostics, MarkdownDiagnostics } from '../types.js';
import { extractArticleContent, sanitizeHtmlForMarkdownConversion } from './article.js';
import { normalizeForPrompt } from './cleaner.js';
import {
  MIN_HTML_CONTENT_CHARACTERS,
  MIN_METADATA_DESCRIPTION_CHARACTERS,
  MIN_READABILITY_CONTENT_CHARACTERS,
  READABILITY_RELATIVE_THRESHOLD,
} from './constants.js';
import { extractJsonLdContent } from './jsonld.js';
import { extractMetadataFromHtml } from './parsers.js';
import { isPodcastHost, isPodcastLikeJsonLdType } from './podcast-utils.js';
import { extractReadabilityFromHtml, toReadabilityHtml } from './readability.js';
import type { ExtractedLinkContent, FetchLinkContentOptions, MarkdownMode } from './types.js';
import {
  ensureTranscriptDiagnostics,
  finalizeExtractedLinkContent,
  pickFirstText,
  selectBaseContent,
} from './utils.js';
import { detectPrimaryVideoFromHtml } from './video.js';
import { extractYouTubeShortDescription } from './youtube.js';

const LEADING_CONTROL_PATTERN = /^[\s\p{Cc}]+/u;

function stripLeadingTitle(content: string, title: string | null | undefined): string {
  if (!(content && title)) {
    return content;
  }

  const normalizedTitle = title.trim();
  if (normalizedTitle.length === 0) {
    return content;
  }

  const trimmedContent = content.trimStart();
  if (!trimmedContent.toLowerCase().startsWith(normalizedTitle.toLowerCase())) {
    return content;
  }

  const remainderOriginal = trimmedContent.slice(normalizedTitle.length);
  const remainder = remainderOriginal.replace(LEADING_CONTROL_PATTERN, '');
  return remainder;
}

export async function buildResultFromHtmlDocument({
  url,
  html,
  cacheMode,
  maxCharacters,
  youtubeTranscriptMode,
  mediaTranscriptMode,
  transcriptTimestamps,
  firecrawlDiagnostics,
  markdownRequested,
  markdownMode,
  timeoutMs,
  deps,
  readabilityCandidate,
}: {
  url: string;
  html: string;
  cacheMode: FetchLinkContentOptions['cacheMode'];
  maxCharacters: number | null;
  youtubeTranscriptMode: FetchLinkContentOptions['youtubeTranscript'];
  mediaTranscriptMode: FetchLinkContentOptions['mediaTranscript'];
  transcriptTimestamps?: FetchLinkContentOptions['transcriptTimestamps'];
  firecrawlDiagnostics: FirecrawlDiagnostics;
  markdownRequested: boolean;
  markdownMode: MarkdownMode;
  timeoutMs: number;
  deps: LinkPreviewDeps;
  readabilityCandidate: Awaited<ReturnType<typeof extractReadabilityFromHtml>> | null;
}): Promise<ExtractedLinkContent> {
  if (isYouTubeVideoUrl(url) && !extractYouTubeVideoId(url)) {
    throw new Error('Invalid YouTube video id in URL');
  }

  const { title, description, siteName } = extractMetadataFromHtml(html, url);
  const jsonLd = extractJsonLdContent(html);
  const mergedTitle = pickFirstText([jsonLd?.title, title]);
  const mergedDescription = pickFirstText([jsonLd?.description, description]);
  const isPodcastJsonLd = isPodcastLikeJsonLdType(jsonLd?.type);
  const readability = readabilityCandidate ?? (await extractReadabilityFromHtml(html, url));
  const readabilityText = readability?.text ? normalizeForPrompt(readability.text) : '';
  const readabilityHtml = toReadabilityHtml(readability);

  const normalizedSegmentsFromHtml = normalizeForPrompt(extractArticleContent(html));
  const normalizedSegmentsFromReadabilityHtml = readabilityHtml
    ? normalizeForPrompt(extractArticleContent(readabilityHtml))
    : '';
  const preferReadabilityHtml =
    normalizedSegmentsFromReadabilityHtml.length >= MIN_READABILITY_CONTENT_CHARACTERS &&
    (normalizedSegmentsFromHtml.length < MIN_HTML_CONTENT_CHARACTERS ||
      normalizedSegmentsFromReadabilityHtml.length >=
        normalizedSegmentsFromHtml.length * READABILITY_RELATIVE_THRESHOLD);
  const normalizedSegments = preferReadabilityHtml
    ? normalizedSegmentsFromReadabilityHtml
    : normalizedSegmentsFromHtml;

  const preferReadabilityText =
    !preferReadabilityHtml &&
    readabilityText.length >= MIN_READABILITY_CONTENT_CHARACTERS &&
    (normalizedSegmentsFromHtml.length < MIN_HTML_CONTENT_CHARACTERS ||
      readabilityText.length >= normalizedSegmentsFromHtml.length * READABILITY_RELATIVE_THRESHOLD);
  const preferReadability = preferReadabilityHtml || preferReadabilityText;
  const effectiveNormalized = preferReadabilityText ? readabilityText : normalizedSegments;
  const descriptionCandidate = mergedDescription ? normalizeForPrompt(mergedDescription) : '';
  const preferDescription =
    descriptionCandidate.length >= MIN_METADATA_DESCRIPTION_CHARACTERS &&
    (isPodcastJsonLd ||
      isPodcastHost(url) ||
      (!preferReadability &&
        (effectiveNormalized.length < MIN_HTML_CONTENT_CHARACTERS ||
          descriptionCandidate.length >=
            effectiveNormalized.length * READABILITY_RELATIVE_THRESHOLD)));
  const effectiveNormalizedWithDescription = preferDescription
    ? descriptionCandidate
    : effectiveNormalized;
  const transcriptResolution = await resolveTranscriptForLink(url, html, deps, {
    cacheMode,
    mediaTranscriptMode,
    transcriptTimestamps,
    youtubeTranscriptMode,
  });

  const youtubeDescription =
    transcriptResolution.text === null ? extractYouTubeShortDescription(html) : null;
  const baseCandidate = youtubeDescription
    ? normalizeForPrompt(youtubeDescription)
    : effectiveNormalizedWithDescription;

  let baseContent = selectBaseContent(baseCandidate, transcriptResolution.text);
  if (baseContent === normalizedSegments) {
    baseContent = stripLeadingTitle(baseContent, mergedTitle ?? title);
  }

  const transcriptDiagnostics = ensureTranscriptDiagnostics(
    transcriptResolution,
    cacheMode ?? 'default',
  );

  const markdownDiagnostics: MarkdownDiagnostics = await (async () => {
    if (!markdownRequested) {
      return { notes: null, provider: null, requested: false, used: false };
    }

    if (isYouTubeUrl(url)) {
      return {
        notes: 'Skipping Markdown conversion for YouTube URLs',
        provider: null,
        requested: true,
        used: false,
      };
    }

    if (!deps.convertHtmlToMarkdown) {
      return {
        notes: 'No HTML→Markdown converter configured',
        provider: null,
        requested: true,
        used: false,
      };
    }

    try {
      const htmlForMarkdown =
        markdownMode === 'readability' && readabilityHtml ? readabilityHtml : html;
      const sanitizedHtml = sanitizeHtmlForMarkdownConversion(htmlForMarkdown);
      const markdown = await deps.convertHtmlToMarkdown({
        html: sanitizedHtml,
        siteName,
        timeoutMs,
        title: mergedTitle ?? title,
        url,
      });
      const normalizedMarkdown = normalizeForPrompt(markdown);
      if (normalizedMarkdown.length === 0) {
        return {
          notes: 'HTML→Markdown conversion returned empty content',
          provider: null,
          requested: true,
          used: false,
        };
      }

      baseContent = normalizedMarkdown;
      return {
        notes:
          markdownMode === 'readability' && readabilityHtml
            ? 'Readability HTML used for markdown input'
            : null,
        provider: 'llm',
        requested: true,
        used: true,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        notes: `HTML→Markdown conversion failed: ${message}`,
        provider: null,
        requested: true,
        used: false,
      };
    }
  })();

  const video = detectPrimaryVideoFromHtml(html, url);
  const isVideoOnly =
    !transcriptResolution.text &&
    baseContent.length < MIN_HTML_CONTENT_CHARACTERS &&
    video !== null;

  return finalizeExtractedLinkContent({
    baseContent,
    description: mergedDescription ?? description,
    diagnostics: {
      firecrawl: firecrawlDiagnostics,
      markdown: markdownDiagnostics,
      strategy: 'html',
      transcript: transcriptDiagnostics,
    },
    isVideoOnly,
    maxCharacters,
    siteName,
    title: mergedTitle ?? title,
    transcriptResolution,
    url,
    video,
  });
}
