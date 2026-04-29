import type { TranscriptSegment } from '../../../link-preview/types.js';
import {
  jsonTranscriptToPlainText,
  jsonTranscriptToSegments,
  vttToPlainText,
  vttToSegments,
} from '../../parse.js';
import { TRANSCRIPTION_TIMEOUT_MS } from './constants.js';
import {
  decodeXmlEntities,
  extractFeedItems,
  extractItemTitle,
  normalizeLooseTitle,
} from './rss-feed.js';

interface TranscriptCandidate {
  url: string;
  type: string | null;
}

export async function tryFetchTranscriptFromFeedXml({
  fetchImpl,
  feedXml,
  episodeTitle,
  notes,
}: {
  fetchImpl: typeof fetch;
  feedXml: string;
  episodeTitle: string | null;
  notes: string[];
}): Promise<{
  text: string;
  transcriptUrl: string;
  transcriptType: string | null;
  segments: TranscriptSegment[] | null;
} | null> {
  const items = extractFeedItems(feedXml);
  const normalizedTarget = episodeTitle ? normalizeLooseTitle(episodeTitle) : null;

  for (const item of items) {
    if (normalizedTarget) {
      const title = extractItemTitle(item);
      if (!title || normalizeLooseTitle(title) !== normalizedTarget) {
        continue;
      }
    }

    const preferred = selectPreferredTranscriptCandidate(
      extractPodcastTranscriptCandidatesFromItem(item),
    );
    if (!preferred) {
      if (normalizedTarget) {
        return null;
      }
      continue;
    }

    const transcriptUrl = decodeXmlEntities(preferred.url);
    try {
      const res = await fetchImpl(transcriptUrl, {
        headers: { accept: 'text/vtt,text/plain,application/json;q=0.9,*/*;q=0.8' },
        redirect: 'follow',
        signal: AbortSignal.timeout(TRANSCRIPTION_TIMEOUT_MS),
      });
      if (!res.ok) {
        throw new Error(`transcript fetch failed (${res.status})`);
      }

      const contentType =
        res.headers.get('content-type')?.toLowerCase().split(';')[0]?.trim() ?? null;
      const effectiveType = preferred.type?.toLowerCase().split(';')[0]?.trim() ?? contentType;
      const body = await res.text();
      const parsed = parseTranscriptBody({ body, effectiveType, transcriptUrl });
      if (!parsed.text) {
        if (normalizedTarget) {
          return null;
        }
        continue;
      }

      notes.push('Used RSS <podcast:transcript> (skipped Whisper)');
      return {
        segments: parsed.segments,
        text: parsed.text,
        transcriptType: effectiveType,
        transcriptUrl,
      };
    } catch (error) {
      if (normalizedTarget) {
        notes.push(
          `RSS <podcast:transcript> fetch failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        return null;
      }
    }
  }

  return null;
}

function extractPodcastTranscriptCandidatesFromItem(itemXml: string): TranscriptCandidate[] {
  const matches = itemXml.matchAll(
    /<podcast:transcript\b[^>]*\burl\s*=\s*(['"])([^'"]+)\1[^>]*>/gi,
  );
  const results: TranscriptCandidate[] = [];
  for (const match of matches) {
    const tag = match[0];
    const url = match[2]?.trim();
    if (!url) {
      continue;
    }
    const type = /\btype\s*=\s*(['"])([^'"]+)\1/i.exec(tag)?.[2]?.trim() ?? null;
    results.push({ type, url });
  }
  return results;
}

function selectPreferredTranscriptCandidate(
  candidates: TranscriptCandidate[],
): TranscriptCandidate | null {
  if (candidates.length === 0) {
    return null;
  }
  const normalized = candidates.map((candidate) => ({
    ...candidate,
    type: candidate.type?.toLowerCase().split(';')[0]?.trim() ?? null,
  }));

  const json = normalized.find(
    (candidate) =>
      candidate.type === 'application/json' || candidate.url.toLowerCase().endsWith('.json'),
  );
  if (json) {
    return json;
  }

  const vtt = normalized.find(
    (candidate) => candidate.type === 'text/vtt' || candidate.url.toLowerCase().endsWith('.vtt'),
  );
  if (vtt) {
    return vtt;
  }

  return normalized[0] ?? null;
}

function parseTranscriptBody(args: {
  body: string;
  transcriptUrl: string;
  effectiveType: string | null;
}): { text: string | null; segments: TranscriptSegment[] | null } {
  const { body, transcriptUrl, effectiveType } = args;
  if (effectiveType === 'application/json' || transcriptUrl.toLowerCase().endsWith('.json')) {
    try {
      const payload = JSON.parse(body);
      return {
        segments: jsonTranscriptToSegments(payload),
        text: jsonTranscriptToPlainText(payload),
      };
    } catch {
      return { segments: null, text: null };
    }
  }
  if (effectiveType === 'text/vtt' || transcriptUrl.toLowerCase().endsWith('.vtt')) {
    const plain = vttToPlainText(body);
    return { segments: vttToSegments(body), text: plain.length > 0 ? plain : null };
  }
  const plain = body.trim();
  return { segments: null, text: plain.length > 0 ? plain : null };
}
