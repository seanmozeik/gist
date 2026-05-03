import { describe, expect, it, vi } from 'vitest';

import { fetchHtmlDocument } from '../src/content/link-preview/content/fetcher.js';

describe('link preview fetcher - more branches', () => {
  it('throws on non-OK response and unsupported content-type', async () => {
    await expect(
      fetchHtmlDocument('https://example.com', {
        fetchImplementation: vi.fn(
          async () =>
            new Response('nope', { headers: { 'content-type': 'text/html' }, status: 403 }),
        ) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/status 403/);

    await expect(
      fetchHtmlDocument('https://example.com', {
        fetchImplementation: vi.fn(
          async () =>
            new Response('nope', { headers: { 'content-type': 'application/pdf' }, status: 200 }),
        ) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/Unsupported content-type/);
  });

  it('handles missing body, streaming bodies, and abort errors', async () => {
    const events: { kind: string }[] = [];
    const fetchNoBody = vi.fn(async () => {
      return {
        body: null,
        headers: new Headers({ 'content-length': '3', 'content-type': 'text/html' }),
        ok: true,
        status: 200,
        async text() {
          return 'abc';
        },
      } as unknown as Response;
    });
    const htmlResult = await fetchHtmlDocument('https://example.com', {
      fetchImplementation: fetchNoBody as unknown as typeof fetch,
      onProgress: (e) => events.push(e as { kind: string }),
    });
    expect(htmlResult.html).toBe('abc');
    expect(events.some((e) => e.kind === 'fetch-html-done')).toBe(true);

    const reader = (() => {
      let i = 0;
      return {
        async read() {
          i += 1;
          if (i === 1) {
            return { done: false, value: undefined as unknown as Uint8Array };
          }
          if (i === 2) {
            return { done: false, value: new TextEncoder().encode('hi') };
          }
          return { done: true, value: undefined as unknown as Uint8Array };
        },
      };
    })();
    const fetchStream = vi.fn(async () => {
      return {
        body: { getReader: () => reader },
        headers: new Headers({ 'content-type': 'text/html' }),
        ok: true,
        status: 200,
      } as unknown as Response;
    });
    const streamed = await fetchHtmlDocument('https://example.com', {
      fetchImplementation: fetchStream as unknown as typeof fetch,
    });
    expect(streamed.html).toContain('hi');

    const abortingFetch = vi.fn(async () => {
      throw new DOMException('aborted', 'AbortError');
    });
    await expect(
      fetchHtmlDocument('https://example.com', {
        fetchImplementation: abortingFetch as unknown as typeof fetch,
        timeoutMs: 1,
      }),
    ).rejects.toThrow(/timed out/);
  });

  it('surfaces transport errors without Bun-specific retries', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('ZlibError: ShortRead');
    });

    await expect(
      fetchHtmlDocument('https://example.com', {
        fetchImplementation: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toThrow('ZlibError: ShortRead');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
