import { describe, expect, it, vi } from 'vitest';

import { createLinkPreviewClient } from '../src/content/index';
import type { ConvertHtmlToMarkdown } from '../src/content/link-preview/deps';

const htmlResponse = (html: string, status = 200) =>
  new Response(html, { headers: { 'Content-Type': 'text/html' }, status });

describe('link preview extraction (readability markdown)', () => {
  it('uses Readability markdown from magic-fetch when markdownMode=readability', async () => {
    const html = `<!doctype html><html><head><title>Hello</title></head><body>
      <article><h1>Hello</h1><p>Readable content</p></article>
    </body></html>`;

    const convertHtmlToMarkdownMock = vi.fn(async () => '# Hello\n\nReadable content');

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === 'https://example.com') {
        return htmlResponse(html);
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });

    const client = createLinkPreviewClient({
      convertHtmlToMarkdown: convertHtmlToMarkdownMock as unknown as ConvertHtmlToMarkdown,
      fetchImplementation: fetchMock as unknown as typeof fetch,
    });

    const result = await client.fetchLinkContent('https://example.com', {
      firecrawl: 'off',
      format: 'markdown',
      markdownMode: 'readability',
      timeoutMs: 2000,
    });

    expect(result.content.toLowerCase()).toContain('readable');
    expect(result.diagnostics.markdown.used).toBe(true);
    expect(result.diagnostics.markdown.provider).toBe('readability');
    expect(result.diagnostics.markdown.notes).toContain('Readability');
    expect(convertHtmlToMarkdownMock).not.toHaveBeenCalled();
  });
});
