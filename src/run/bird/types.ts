export interface BirdTweetMedia {
  kind: 'video' | 'audio';
  urls: string[];
  preferredUrl: string | null;
  source: 'extended_entities' | 'card' | 'entities';
}

export interface BirdTweetPayload {
  id?: string;
  text: string;
  author?: { username?: string; name?: string };
  createdAt?: string;
  media?: BirdTweetMedia | null;
}
