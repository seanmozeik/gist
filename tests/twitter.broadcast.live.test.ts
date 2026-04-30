import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createLinkPreviewClient } from '../src/content/index.js';
import { readTweetWithPreferredClient } from '../src/run/bird.js';
import { resolveTwitterCookies } from '../src/run/cookies/twitter.js';
import { resolveExecutableInPath } from '../src/run/env.js';
import { extractSlidesForSource, resolveSlideSource } from '../src/slides/index.js';
import { resolveSlideSettings } from '../src/slides/settings.js';

const ENV = process.env as Record<string, string | undefined>;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? null;
const FAL_KEY = process.env.FAL_KEY ?? null;
const YT_DLP_PATH = process.env.YT_DLP_PATH ?? null;
const BIRD_PATH = resolveExecutableInPath('bird', ENV);
const FFMPEG_PATH = resolveExecutableInPath('ffmpeg', ENV);
const TWEET_URL = process.env.GIST_LIVE_TWITTER_BROADCAST_URL ?? null;

const LIVE =
  process.env.GIST_LIVE_TESTS === '1' &&
  Boolean(TWEET_URL) &&
  Boolean(YT_DLP_PATH) &&
  Boolean(BIRD_PATH) &&
  (Boolean(OPENAI_API_KEY) || Boolean(FAL_KEY));
const LIVE_SLIDES = LIVE && Boolean(FFMPEG_PATH);
const LIVE_FETCH_TIMEOUT_MS = Number(process.env.GIST_LIVE_TWITTER_FETCH_TIMEOUT_MS ?? '300000');
const LIVE_FETCH_TEST_TIMEOUT_MS = Number(
  process.env.GIST_LIVE_TWITTER_TEST_TIMEOUT_MS ?? '480000',
);
const LIVE_SLIDES_TIMEOUT_MS = Number(process.env.GIST_LIVE_TWITTER_SLIDES_TIMEOUT_MS ?? '420000');
const LIVE_SLIDES_TEST_TIMEOUT_MS = Number(
  process.env.GIST_LIVE_TWITTER_SLIDES_TEST_TIMEOUT_MS ?? '780000',
);

const createClient = () =>
  createLinkPreviewClient({
    falApiKey: FAL_KEY,
    groqApiKey: null,
    openaiApiKey: OPENAI_API_KEY,
    readTweetWithBird: ({ url, timeoutMs }) =>
      readTweetWithPreferredClient({ env: ENV, timeoutMs, url }),
    resolveTwitterCookies: async () => {
      const res = await resolveTwitterCookies({ env: ENV });
      return {
        cookiesFromBrowser: res.cookies.cookiesFromBrowser,
        source: res.cookies.source,
        warnings: res.warnings,
      };
    },
    ytDlpPath: YT_DLP_PATH,
  });

describe('live X broadcast (tweet video)', () => {
  const run = LIVE ? it : it.skip;

  run(
    'transcribes tweet video via yt-dlp and exposes a video url',
    async () => {
      const client = createClient();
      const result = await client.fetchLinkContent(TWEET_URL, { timeoutMs: LIVE_FETCH_TIMEOUT_MS });

      expect(result.video).not.toBeNull();
      expect(result.transcriptSource).not.toBeNull();
      expect(result.transcriptCharacters ?? 0).toBeGreaterThan(20);
    },
    LIVE_FETCH_TEST_TIMEOUT_MS,
  );
});

describe('live X broadcast slides', () => {
  const run = LIVE_SLIDES ? it : it.skip;

  run(
    'extracts slides for tweet video',
    async () => {
      const client = createClient();
      const result = await client.fetchLinkContent(TWEET_URL, { timeoutMs: LIVE_FETCH_TIMEOUT_MS });
      const source = resolveSlideSource({ extracted: result, url: TWEET_URL! });

      expect(source).not.toBeNull();
      if (!source) {
        return;
      }

      const slidesDir = mkdtempSync(path.join(tmpdir(), 'gist-live-slides-'));
      const settings = resolveSlideSettings({ cwd: slidesDir, slides: true, slidesDir });
      if (!settings) {
        throw new Error('Failed to resolve slide settings');
      }

      const slides = await extractSlidesForSource({
        env: ENV,
        ffmpegPath: null,
        noCache: true,
        settings,
        source,
        tesseractPath: null,
        timeoutMs: LIVE_SLIDES_TIMEOUT_MS,
        ytDlpPath: YT_DLP_PATH,
      });

      expect(slides.slides.length).toBeGreaterThan(0);
    },
    LIVE_SLIDES_TEST_TIMEOUT_MS,
  );
});
