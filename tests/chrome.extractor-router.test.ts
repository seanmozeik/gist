import { describe, expect, it, vi } from 'vitest';

import {
  routeExtract,
  type ExtractLog,
} from '../apps/chrome-extension/src/entrypoints/background/extractors/router.js';

function createContext(overrides: Partial<Parameters<typeof routeExtract>[0]> = {}) {
  const logs: { event: string; detail?: Record<string, unknown> }[] = [];
  const log: ExtractLog = (event, detail) => {
    logs.push({ detail, event });
  };
  const extractFromTab = vi.fn(async () => ({
    data: {
      media: null,
      ok: true as const,
      text: 'Readable page text',
      title: 'Page Title',
      truncated: false,
      url: 'https://example.com/article',
    },
    ok: true as const,
  }));
  const fetchImpl = vi.fn(
    async () => new Response('{}', { status: 500 }),
  ) as unknown as typeof fetch;

  return {
    ctx: {
      extractFromTab,
      fetchImpl,
      log,
      maxChars: 10_000,
      minTextChars: 1,
      tabId: 7,
      title: 'Tab Title',
      token: 'token',
      url: 'https://example.com/article',
      ...overrides,
    },
    extractFromTab,
    fetchImpl,
    logs,
  };
}

describe('chrome/extractor-router', () => {
  it('hard-switches preferUrl pages without trying extractors', async () => {
    const { ctx, extractFromTab, fetchImpl, logs } = createContext({
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    });

    const result = await routeExtract(ctx);

    expect(result).toBeNull();
    expect(extractFromTab).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(logs.map((entry) => entry.event)).toEqual([
      'extractor.route.start',
      'extractor.route.preferUrlHardSwitch',
    ]);
  });

  it('extracts Reddit comments through the .json API before page readability', async () => {
    const redditJson = [
      {
        data: {
          children: [
            {
              data: {
                author: 'op',
                created_utc: 1_700_000_000,
                num_comments: 2,
                score: 42,
                selftext: 'Original post body',
                subreddit: 'summarize',
                title: 'Useful thread',
              },
              kind: 't3',
            },
          ],
        },
        kind: 'Listing',
      },
      {
        data: {
          children: [
            {
              data: {
                author: 'alice',
                body: 'Top level comment',
                created_utc: 1_700_000_100,
                replies: {
                  data: {
                    children: [
                      {
                        kind: 't1',
                        data: {
                          body: 'Nested reply',
                          author: 'bob',
                          created_utc: 1_700_000_200,
                          score: 3,
                          replies: '',
                        },
                      },
                    ],
                  },
                  kind: 'Listing',
                },
                score: 5,
              },
              kind: 't1',
            },
          ],
        },
        kind: 'Listing',
      },
    ];
    const fetchImpl = vi.fn(async () => Response.json(redditJson)) as unknown as typeof fetch;
    const { ctx, extractFromTab, logs } = createContext({
      fetchImpl,
      title: 'Fallback title',
      url: 'https://www.reddit.com/r/summarize/comments/abc123/useful_thread/',
    });

    const result = await routeExtract(ctx);

    expect(result?.source).toBe('page');
    expect(result?.extracted.title).toBe('Useful thread');
    expect(result?.extracted.text).toContain('op posted in r/summarize');
    expect(result?.extracted.text).toContain('Title: Useful thread');
    expect(result?.extracted.text).toContain(
      '[2023-11-14T22:15:00.000Z] alice (score:5): Top level comment',
    );
    expect(result?.extracted.text).toContain(
      '  [2023-11-14T22:16:40.000Z] bob (score:3): Nested reply',
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://www.reddit.com/r/summarize/comments/abc123.json',
      expect.objectContaining({ credentials: 'include' }),
    );
    expect(extractFromTab).not.toHaveBeenCalled();
    expect(
      logs.some(
        (entry) =>
          entry.event === 'extractor.success' && entry.detail?.extractor === 'reddit-thread',
      ),
    ).toBe(true);
  });

  it('falls back to page readability when Reddit .json extraction fails', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('{}', { status: 429 }),
    ) as unknown as typeof fetch;
    const { ctx, extractFromTab, logs } = createContext({
      fetchImpl,
      url: 'https://old.reddit.com/r/summarize/comments/abc123/useful_thread/',
    });

    const result = await routeExtract(ctx);

    expect(result?.source).toBe('page');
    expect(result?.extracted.text).toBe('Readable page text');
    expect(extractFromTab).toHaveBeenCalledOnce();
    expect(
      logs.some(
        (entry) => entry.event === 'extractor.fail' && entry.detail?.extractor === 'reddit-thread',
      ),
    ).toBe(true);
    expect(
      logs.some(
        (entry) =>
          entry.event === 'extractor.success' && entry.detail?.extractor === 'page-readability',
      ),
    ).toBe(true);
  });

  it('falls back to daemon URL extraction when page readability is too small', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        extracted: {
          content:
            'Daemon extracted article content with enough text to satisfy the chat threshold. This covers the fallback path after page extraction returns only a tiny stub.',
          title: 'Daemon Title',
          truncated: false,
          url: 'https://example.com/article',
        },
        ok: true,
      }),
    );
    const extractFromTab = vi.fn(async () => ({
      data: {
        media: null,
        ok: true as const,
        text: 'short',
        title: 'Page Title',
        truncated: false,
        url: 'https://example.com/article',
      },
      ok: true as const,
    }));
    const { ctx, logs } = createContext({
      extractFromTab,
      fetchImpl: fetchMock as unknown as typeof fetch,
      minTextChars: 100,
    });

    const result = await routeExtract(ctx);

    expect(result?.source).toBe('url');
    expect(result?.extracted.title).toBe('Daemon Title');
    expect(result?.extracted.text).toContain('Daemon extracted article content');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      extractOnly: true,
      mode: 'url',
      url: 'https://example.com/article',
    });
    expect(
      logs.some(
        (entry) => entry.event === 'extractor.success' && entry.detail?.extractor === 'url-daemon',
      ),
    ).toBe(true);
  });
});
