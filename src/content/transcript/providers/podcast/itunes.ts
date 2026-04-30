import { ITUNES_LOOKUP_URL, ITUNES_SEARCH_URL, TRANSCRIPTION_TIMEOUT_MS } from './constants.js';
import { asRecordArray, getJsonArray, getRecordString } from './json.js';
import { normalizeLooseTitle } from './rss.js';

export async function resolveApplePodcastEpisodeFromItunesLookup({
  fetchImpl,
  showId,
  episodeId,
}: {
  fetchImpl: typeof fetch;
  showId: string;
  episodeId: string | null;
}): Promise<{
  episodeUrl: string;
  feedUrl: string | null;
  fileExtension: string | null;
  durationSeconds: number | null;
  episodeTitle: string | null;
} | null> {
  const query = new URLSearchParams({ entity: 'podcastEpisode', id: showId, limit: '200' });
  const res = await fetchImpl(`${ITUNES_LOOKUP_URL}?${query.toString()}`, {
    headers: { accept: 'application/json' },
    redirect: 'follow',
    signal: AbortSignal.timeout(TRANSCRIPTION_TIMEOUT_MS),
  });
  if (!res.ok) {
    return null;
  }
  const payload = (await res.json()) as unknown;
  const results = asRecordArray(getJsonArray(payload, ['results']));

  const show = results.find(
    (r) =>
      getRecordString(r, 'wrapperType') === 'track' && getRecordString(r, 'kind') === 'podcast',
  );
  const feedUrl =
    typeof show?.feedUrl === 'string' && show.feedUrl.trim() ? show.feedUrl.trim() : null;

  const episodes = results.filter((r) => getRecordString(r, 'wrapperType') === 'podcastEpisode');
  if (episodes.length === 0) {
    return null;
  }

  const chosen = (() => {
    if (episodeId) {
      const match = episodes.find((r) => String(r.trackId ?? '') === episodeId);
      if (match) {
        return match;
      }
    }
    // No i=... in URL: pick the newest episode by release date.
    const sorted = [...episodes].toSorted((a, b) => {
      const aDate = Date.parse(String(a.releaseDate ?? ''));
      const bDate = Date.parse(String(b.releaseDate ?? ''));
      if (!Number.isFinite(aDate) && !Number.isFinite(bDate)) {
        return 0;
      }
      if (!Number.isFinite(aDate)) {
        return 1;
      }
      if (!Number.isFinite(bDate)) {
        return -1;
      }
      return bDate - aDate;
    });
    return sorted[0];
  })();
  if (!chosen) {
    return null;
  }

  const episodeUrlRaw =
    typeof chosen.episodeUrl === 'string'
      ? chosen.episodeUrl.trim()
      : typeof chosen.previewUrl === 'string'
        ? chosen.previewUrl.trim()
        : '';
  if (!episodeUrlRaw || !/^https?:\/\//i.test(episodeUrlRaw)) {
    return null;
  }

  const fileExtension =
    typeof chosen.episodeFileExtension === 'string' && chosen.episodeFileExtension.trim()
      ? chosen.episodeFileExtension.trim().replace(/^\./, '')
      : null;
  const durationSeconds =
    typeof chosen.trackTimeMillis === 'number' && Number.isFinite(chosen.trackTimeMillis)
      ? chosen.trackTimeMillis / 1000
      : null;

  const episodeTitle =
    typeof chosen.trackName === 'string' && chosen.trackName.trim()
      ? chosen.trackName.trim()
      : null;

  return { durationSeconds, episodeTitle, episodeUrl: episodeUrlRaw, feedUrl, fileExtension };
}

export async function resolvePodcastFeedUrlFromItunesSearch(
  fetchImpl: typeof fetch,
  showTitle: string,
): Promise<string | null> {
  const query = new URLSearchParams({
    entity: 'podcast',
    limit: '10',
    media: 'podcast',
    term: showTitle,
  });
  const res = await fetchImpl(`${ITUNES_SEARCH_URL}?${query.toString()}`, {
    headers: { accept: 'application/json' },
    redirect: 'follow',
    signal: AbortSignal.timeout(TRANSCRIPTION_TIMEOUT_MS),
  });
  if (!res.ok) {
    return null;
  }
  const payload = (await res.json()) as unknown;
  const results = asRecordArray(getJsonArray(payload, ['results']));
  if (results.length === 0) {
    return null;
  }

  const normalizedTarget = normalizeLooseTitle(showTitle);
  const exact = results.find(
    (r) => normalizeLooseTitle(String(r.collectionName ?? '')) === normalizedTarget,
  );
  const best = exact ?? results[0];
  const feedUrl = typeof best?.feedUrl === 'string' ? best.feedUrl.trim() : '';
  return feedUrl && /^https?:\/\//i.test(feedUrl) ? feedUrl : null;
}

export async function resolvePodcastEpisodeFromItunesSearch(
  fetchImpl: typeof fetch,
  showTitle: string,
  episodeTitle: string,
): Promise<{ episodeUrl: string; durationSeconds: number | null; episodeTitle: string } | null> {
  const query = new URLSearchParams({
    entity: 'podcastEpisode',
    limit: '25',
    media: 'podcast',
    term: `${showTitle} ${episodeTitle}`,
  });
  const res = await fetchImpl(`${ITUNES_SEARCH_URL}?${query.toString()}`, {
    headers: { accept: 'application/json' },
    redirect: 'follow',
    signal: AbortSignal.timeout(TRANSCRIPTION_TIMEOUT_MS),
  });
  if (!res.ok) {
    return null;
  }
  const payload = (await res.json()) as unknown;
  const results = asRecordArray(getJsonArray(payload, ['results']));
  if (results.length === 0) {
    return null;
  }

  const normalizedShow = normalizeLooseTitle(showTitle);
  const normalizedEpisode = normalizeLooseTitle(episodeTitle);

  const candidates = results
    .map((record) => {
      const title = getRecordString(record, 'trackName');
      const collection = getRecordString(record, 'collectionName');
      const episodeUrl = getRecordString(record, 'episodeUrl');
      const durationMs = record.trackTimeMillis;
      const durationSeconds =
        typeof durationMs === 'number' && Number.isFinite(durationMs) ? durationMs / 1000 : null;
      return { collection, durationSeconds, episodeUrl, title };
    })
    .filter((entry) => Boolean(entry.episodeUrl) && Boolean(entry.title));

  if (candidates.length === 0) {
    return null;
  }

  const exact = candidates.find(
    (entry) =>
      normalizeLooseTitle(entry.title ?? '') === normalizedEpisode &&
      normalizeLooseTitle(entry.collection ?? '') === normalizedShow,
  );
  const exactEpisode = candidates.find(
    (entry) => normalizeLooseTitle(entry.title ?? '') === normalizedEpisode,
  );
  const best = exact ?? exactEpisode ?? candidates[0];
  if (!best?.episodeUrl) {
    return null;
  }

  return {
    durationSeconds: best.durationSeconds,
    episodeTitle: best.title ?? episodeTitle,
    episodeUrl: best.episodeUrl,
  };
}
