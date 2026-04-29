import { extractMediaFromBirdRaw } from './media.js';
import type { BirdTweetPayload } from './types.js';

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : null;

const asArray = (value: unknown): unknown[] | null => (Array.isArray(value) ? value : null);

const asString = (value: unknown): string | null => (typeof value === 'string' ? value : null);

const asNumber = (value: unknown): number | null => (typeof value === 'number' ? value : null);

function resolveTweetText(data: Record<string, unknown>): string | null {
  const dataText = asString(data.text)?.trim() ?? '';
  const noteTweet = asRecord(data.note_tweet);
  const noteTweetText = asString(noteTweet?.text)?.trim() ?? '';
  const candidates = [dataText, noteTweetText].filter((value) => value.length > 0);
  if (candidates.length === 0) {
    return null;
  }
  return candidates.toSorted((left, right) => right.length - left.length)[0] ?? null;
}

export function parseBirdTweetPayload(raw: unknown): BirdTweetPayload {
  const parsed = raw as
    | (BirdTweetPayload & { _raw?: unknown })
    | (BirdTweetPayload & { _raw?: unknown })[];
  const tweet = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!tweet || typeof tweet.text !== 'string') {
    throw new Error('bird read returned invalid payload');
  }
  const { _raw, ...rest } = tweet as BirdTweetPayload & { _raw?: unknown };
  const media = extractMediaFromBirdRaw(_raw);
  return { ...rest, client: 'bird', media };
}
