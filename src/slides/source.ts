import { resolveLocalDirectMediaSource } from '@steipete/summarize-core/content/local-file';

import type { ExtractedLinkContent } from '../content/index.js';
import { extractYouTubeVideoId, isDirectVideoInput, isYouTubeUrl } from '../content/index.js';
import { buildDirectSourceId, buildYoutubeSourceId } from './source-id.js';
import type { SlideSource } from './types.js';

export { isDirectVideoInput } from '../content/index.js';

function resolveLocalDirectVideoSource(raw: string): SlideSource | null {
  const local = resolveLocalDirectMediaSource(raw, 'video');
  if (!local) {return null;}
  return {
    kind: 'direct',
    sourceId: buildDirectSourceId(`${local.fileUrl}#mtime=${Math.round(local.mtimeMs).toString()}`),
    url: local.fileUrl,
  };
}

export function resolveSlideSource({
  url,
  extracted,
}: {
  url: string;
  extracted: ExtractedLinkContent;
}): SlideSource | null {
  const directUrl = extracted.video?.url ?? extracted.url;
  const youtubeCandidate =
    extractYouTubeVideoId(extracted.video?.url ?? '') ??
    extractYouTubeVideoId(extracted.url) ??
    extractYouTubeVideoId(url);
  if (youtubeCandidate) {
    return {
      kind: 'youtube',
      sourceId: buildYoutubeSourceId(youtubeCandidate),
      url: `https://www.youtube.com/watch?v=${youtubeCandidate}`,
    };
  }

  if (
    extracted.video?.kind === 'direct' ||
    isDirectVideoInput(directUrl) ||
    isDirectVideoInput(url)
  ) {
    const normalized = directUrl ?? url;
    return (
      resolveLocalDirectVideoSource(normalized) ?? {
        kind: 'direct',
        sourceId: buildDirectSourceId(normalized),
        url: normalized,
      }
    );
  }

  if (isYouTubeUrl(url)) {
    const fallbackId = extractYouTubeVideoId(url);
    if (fallbackId) {
      return {
        kind: 'youtube',
        sourceId: buildYoutubeSourceId(fallbackId),
        url: `https://www.youtube.com/watch?v=${fallbackId}`,
      };
    }
  }

  return null;
}

export function resolveSlideSourceFromUrl(url: string): SlideSource | null {
  const youtubeCandidate = extractYouTubeVideoId(url);
  if (youtubeCandidate) {
    return {
      kind: 'youtube',
      sourceId: buildYoutubeSourceId(youtubeCandidate),
      url: `https://www.youtube.com/watch?v=${youtubeCandidate}`,
    };
  }

  const localSource = resolveLocalDirectVideoSource(url);
  if (localSource) {return localSource;}

  if (isDirectVideoInput(url)) {
    return { kind: 'direct', sourceId: buildDirectSourceId(url), url };
  }

  if (isYouTubeUrl(url)) {
    const fallbackId = extractYouTubeVideoId(url);
    if (fallbackId) {
      return {
        kind: 'youtube',
        sourceId: buildYoutubeSourceId(fallbackId),
        url: `https://www.youtube.com/watch?v=${fallbackId}`,
      };
    }
  }

  return null;
}
