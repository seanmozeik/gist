import { describe, expect, it } from 'vitest';

import { createLinkPreviewClient } from '../src/content/index';

const GEMINI_API_KEY =
  process.env.GEMINI_API_KEY ??
  process.env.GOOGLE_GENERATIVE_AI_API_KEY ??
  process.env.GOOGLE_API_KEY ??
  null;
const LIVE = process.env.GIST_LIVE_TESTS === '1' && Boolean(GEMINI_API_KEY);

describe('live podcast RSS transcript (Gemini)', () => {
  const run = LIVE ? it : it.skip;

  run(
    'transcribes latest episode from an RSS feed enclosure with Gemini',
    async () => {
      const url = 'https://feeds.npr.org/500005/podcast.xml';
      const env = {
        ...process.env,
        GEMINI_API_KEY: GEMINI_API_KEY ?? '',
        GIST_DISABLE_LOCAL_WHISPER_CPP: '1',
      };

      const client = createLinkPreviewClient({ env });
      const result = await client.fetchLinkContent(url, {
        cacheMode: 'bypass',
        timeoutMs: 300_000,
      });

      expect(result.transcriptSource).toBe('whisper');
      expect(result.transcriptCharacters ?? 0).toBeGreaterThan(20);
      expect(result.content.trim().length).toBeGreaterThan(20);
    },
    600_000,
  );
});
