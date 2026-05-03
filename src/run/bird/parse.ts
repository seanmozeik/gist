import { tweetMediaToBirdMedia } from './media';
import type { BirdTweetPayload } from './types';

export function parseBirdTweetPayload(raw: unknown): BirdTweetPayload {
  const envelope = raw as { success?: boolean; tweet?: unknown } | null;
  const tweetRaw = envelope?.tweet ?? raw;
  const tweet = tweetRaw as {
    id?: string;
    text?: string;
    author?: { username?: string; name?: string };
    createdAt?: string;
    media?: unknown[];
  } | null;
  if (!tweet || typeof tweet.text !== 'string') {
    throw new Error('bird read returned invalid payload');
  }
  return {
    author: tweet.author,
    createdAt: tweet.createdAt,
    id: tweet.id,
    media: tweetMediaToBirdMedia(tweet.media),
    text: tweet.text,
  };
}
