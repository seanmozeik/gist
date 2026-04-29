import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  readTweetWithBird,
  readTweetWithPreferredClient,
  readTweetWithXurl,
  withBirdTip,
} from '../src/run/bird.js';
import { BIRD_TIP } from '../src/run/constants.js';

const TEST_CLI_TIMEOUT_MS = 10_000;

const makeCliScript = (binary: 'bird' | 'xurl', script: string) => {
  const root = mkdtempSync(join(tmpdir(), `summarize-${binary}-`));
  const binDir = join(root, 'bin');
  mkdirSync(binDir, { recursive: true });
  const cliPath = join(binDir, binary);
  writeFileSync(cliPath, script, 'utf8');
  chmodSync(cliPath, 0o755);
  return { binDir, root };
};

const scriptForJson = (payload: unknown) => {
  const json = JSON.stringify(payload);
  return `#!/bin/sh\necho '${json}'\n`;
};

describe('tweet CLI helpers', () => {
  it('reads tweets and extracts media from bird extended entities', async () => {
    const payload = {
      _raw: {
        legacy: {
          extended_entities: {
            media: [
              { type: 'photo' },
              {
                type: 'audio',
                video_info: {
                  variants: [
                    { bitrate: 64, content_type: 'video/mp4', url: 'not-a-url' },
                    {
                      bitrate: 120,
                      content_type: 'video/mp4',
                      url: 'https://video.twimg.com/low.mp4',
                    },
                    {
                      bitrate: 240,
                      content_type: 'video/mp4',
                      url: 'https://video.twimg.com/high.mp4',
                    },
                    { content_type: 'text/plain', url: 'https://video.twimg.com/playlist.m3u8' },
                  ],
                },
              },
            ],
          },
        },
      },
      id: '1',
      text: 'Hello from bird',
    };
    const { binDir } = makeCliScript('bird', scriptForJson(payload));
    const result = await readTweetWithBird({
      env: { PATH: binDir },
      timeoutMs: TEST_CLI_TIMEOUT_MS,
      url: 'https://x.com/user/status/123',
    });

    expect(result.client).toBe('bird');
    expect(result.text).toBe('Hello from bird');
    expect(result.media?.source).toBe('extended_entities');
    expect(result.media?.kind).toBe('audio');
    expect(result.media?.preferredUrl).toBe('https://video.twimg.com/high.mp4');
    expect(result.media?.urls).toContain('https://video.twimg.com/low.mp4');
  });

  it('reads tweets and extracts media from xurl responses', async () => {
    const payload = {
      data: {
        attachments: { media_keys: ['7_1'] },
        author_id: '99',
        created_at: '2026-03-07T00:00:00.000Z',
        id: '2',
        text: 'Hello from xurl',
      },
      includes: {
        media: [
          { media_key: '7_2', type: 'photo', url: 'https://pbs.twimg.com/ignored.jpg' },
          {
            media_key: '7_1',
            type: 'video',
            variants: [
              { bit_rate: 64, content_type: 'video/mp4', url: 'https://video.twimg.com/low.mp4' },
              { bit_rate: 256, content_type: 'video/mp4', url: 'https://video.twimg.com/high.mp4' },
            ],
          },
        ],
        users: [{ id: '99', name: 'Peter', username: 'steipete' }],
      },
    };
    const { binDir } = makeCliScript('xurl', scriptForJson(payload));
    const result = await readTweetWithXurl({
      env: { PATH: binDir },
      timeoutMs: TEST_CLI_TIMEOUT_MS,
      url: 'https://x.com/steipete/status/2',
    });

    expect(result.client).toBe('xurl');
    expect(result.text).toBe('Hello from xurl');
    expect(result.author?.username).toBe('steipete');
    expect(result.media?.source).toBe('xurl');
    expect(result.media?.preferredUrl).toBe('https://video.twimg.com/high.mp4');
  });

  it('prefers long-form note_tweet or article text from xurl payloads', async () => {
    const noteTweetPayload = {
      data: {
        author_id: '99',
        id: '5',
        note_tweet: {
          text: 'This is the full long-form X post text that should win over the teaser.',
        },
        text: 'short teaser',
      },
      includes: { users: [{ id: '99', name: 'Peter', username: 'steipete' }] },
    };
    const { binDir: noteDir } = makeCliScript('xurl', scriptForJson(noteTweetPayload));
    const noteResult = await readTweetWithXurl({
      env: { PATH: noteDir },
      timeoutMs: TEST_CLI_TIMEOUT_MS,
      url: 'https://x.com/steipete/status/5',
    });
    expect(noteResult.text).toContain('full long-form X post text');

    const articlePayload = {
      data: {
        article: {
          text: 'Article body that should outrank the short teaser and preserve article content.',
          title: 'Deep Dive',
        },
        author_id: '99',
        id: '6',
        text: 'short teaser',
      },
      includes: { users: [{ id: '99', name: 'Peter', username: 'steipete' }] },
    };
    const { binDir: articleDir } = makeCliScript('xurl', scriptForJson(articlePayload));
    const articleResult = await readTweetWithXurl({
      env: { PATH: articleDir },
      timeoutMs: TEST_CLI_TIMEOUT_MS,
      url: 'https://x.com/steipete/status/6',
    });
    expect(articleResult.text).toContain('Deep Dive');
    expect(articleResult.text).toContain('Article body');
  });

  it('prefers xurl when both CLIs are installed and falls back to bird on xurl failure', async () => {
    const root = mkdtempSync(join(tmpdir(), 'summarize-tweet-cli-'));
    const binDir = join(root, 'bin');
    mkdirSync(binDir, { recursive: true });

    writeFileSync(join(binDir, 'xurl'), '#!/bin/sh\necho "xurl boom" 1>&2\nexit 1\n', 'utf8');
    writeFileSync(
      join(binDir, 'bird'),
      '#!/bin/sh\necho \'{"id":"3","text":"bird fallback","author":{"username":"birdy"}}\'\n',
      'utf8',
    );
    chmodSync(join(binDir, 'xurl'), 0o755);
    chmodSync(join(binDir, 'bird'), 0o755);

    const result = await readTweetWithPreferredClient({
      env: { PATH: binDir },
      timeoutMs: TEST_CLI_TIMEOUT_MS,
      url: 'https://x.com/user/status/3',
    });
    expect(result.client).toBe('bird');
    expect(result.text).toBe('bird fallback');

    writeFileSync(
      join(binDir, 'xurl'),
      scriptForJson({
        data: { author_id: '9', id: '4', text: 'xurl wins' },
        includes: { users: [{ id: '9', name: 'Xurl User', username: 'xurl-user' }] },
      }),
      'utf8',
    );
    chmodSync(join(binDir, 'xurl'), 0o755);

    const preferred = await readTweetWithPreferredClient({
      env: { PATH: binDir },
      timeoutMs: TEST_CLI_TIMEOUT_MS,
      url: 'https://x.com/user/status/4',
    });
    expect(preferred.client).toBe('xurl');
    expect(preferred.text).toBe('xurl wins');
  });

  it('surfaces CLI errors, empty output, and invalid payloads', async () => {
    const { binDir: errorBird } = makeCliScript('bird', '#!/bin/sh\necho "boom" 1>&2\nexit 1\n');
    await expect(
      readTweetWithBird({
        env: { PATH: errorBird },
        timeoutMs: TEST_CLI_TIMEOUT_MS,
        url: 'https://x.com/user/status/1',
      }),
    ).rejects.toThrow(/bird read failed: boom/);

    const { binDir: emptyXurl } = makeCliScript('xurl', '#!/bin/sh\n');
    await expect(
      readTweetWithXurl({
        env: { PATH: emptyXurl },
        timeoutMs: TEST_CLI_TIMEOUT_MS,
        url: 'https://x.com/user/status/1',
      }),
    ).rejects.toThrow(/xurl read returned empty output/);

    const { binDir: invalidBird } = makeCliScript('bird', '#!/bin/sh\necho "not json"\n');
    await expect(
      readTweetWithBird({
        env: { PATH: invalidBird },
        timeoutMs: TEST_CLI_TIMEOUT_MS,
        url: 'https://x.com/user/status/1',
      }),
    ).rejects.toThrow(/bird read returned invalid JSON/);

    const { binDir: invalidXurl } = makeCliScript('xurl', scriptForJson({ data: { id: '1' } }));
    await expect(
      readTweetWithXurl({
        env: { PATH: invalidXurl },
        timeoutMs: TEST_CLI_TIMEOUT_MS,
        url: 'https://x.com/user/status/1',
      }),
    ).rejects.toThrow(/xurl read returned invalid payload/);

    const { binDir: unauthorizedXurl } = makeCliScript(
      'xurl',
      scriptForJson({
        detail: 'Unauthorized',
        status: 401,
        title: 'Unauthorized',
        type: 'about:blank',
      }),
    );
    await expect(
      readTweetWithXurl({
        env: { PATH: unauthorizedXurl },
        timeoutMs: TEST_CLI_TIMEOUT_MS,
        url: 'https://x.com/user/status/1',
      }),
    ).rejects.toThrow(/xurl auth status.*install "bird"/);
  });

  it('adds install tips only when neither xurl nor bird is available', () => {
    const baseError = new Error('nope');
    const url = 'https://x.com/user/status/123';
    const tipError = withBirdTip(baseError, url, { PATH: '' });
    expect(tipError.message).toContain(BIRD_TIP);

    const { binDir } = makeCliScript('xurl', '#!/bin/sh\nexit 0\n');
    const noTip = withBirdTip(baseError, url, { PATH: binDir });
    expect(noTip.message).toBe(baseError.message);

    const nonStatus = withBirdTip(baseError, 'https://x.com/user', { PATH: '' });
    expect(nonStatus.message).toBe(baseError.message);
  });
});
