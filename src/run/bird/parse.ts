import { extractMediaFromBirdRaw } from './media.js';
import type { BirdTweetPayload } from './types.js';

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
  return { ...rest, media };
}
