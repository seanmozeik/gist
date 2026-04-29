export type TweetCliClient = 'xurl' | 'bird';

export interface BirdTweetMedia {
  kind: 'video' | 'audio';
  urls: string[];
  preferredUrl: string | null;
  source: 'extended_entities' | 'card' | 'entities' | 'xurl';
}

export interface BirdTweetPayload {
  id?: string;
  text: string;
  author?: { username?: string; name?: string };
  createdAt?: string;
  media?: BirdTweetMedia | null;
  client?: TweetCliClient;
}
