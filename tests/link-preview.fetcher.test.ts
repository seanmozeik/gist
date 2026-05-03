import { describe, expect, it, vi } from 'vitest';

import { fetchHtmlDocument } from '../src/content/link-preview/content/fetcher.js';

const htmlResponse = (html: string, status = 200) =>
  new Response(html, { headers: { 'Content-Type': 'text/html' }, status });

describe('link preview fetcher', () => {
  it('does not request compressed HTML outside Bun', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers['Accept-Encoding']).toBeUndefined();
      return htmlResponse('<html>ok</html>');
    });

    const result = await fetchHtmlDocument('https://example.com', {
      fetchImplementation: fetchMock as unknown as typeof fetch,
    });

    expect(result.html).toContain('ok');
  });

  it('throws when HTML response is non-2xx', async () => {
    const fetchMock = vi.fn(async () => htmlResponse('<html></html>', 403));
    await expect(
      fetchHtmlDocument('https://example.com', {
        fetchImplementation: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toThrow('Failed to fetch HTML document (status 403)');
  });

  it('returns the final URL when fetch follows redirects', async () => {
    const response = htmlResponse('<html>ok</html>');
    Object.defineProperty(response, 'url', { configurable: true, value: 'https://gist.sh/' });
    const fetchMock = vi.fn(async () => response);

    const result = await fetchHtmlDocument('https://t.co/abc', {
      fetchImplementation: fetchMock as unknown as typeof fetch,
    });

    expect(result.finalUrl).toBe('https://gist.sh/');
    expect(result.html).toContain('ok');
  });
});
