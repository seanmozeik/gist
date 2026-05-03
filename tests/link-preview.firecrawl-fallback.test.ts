import { describe, expect, it, vi } from 'vitest';

import { createLinkPreviewClient } from '../src/content/index';

const htmlResponse = (html: string, status = 200) =>
  new Response(html, { headers: { 'Content-Type': 'text/html' }, status });

const pdfResponse = (payload: string, status = 200) =>
  new Response(payload, { headers: { 'Content-Type': 'application/pdf' }, status });

describe('link preview extraction (Firecrawl fallback)', () => {
  it('does not call Firecrawl for short but complete pages', async () => {
    const html =
      '<!doctype html><html><head><title>Example</title></head><body><main><p>' +
      'This domain is for use in documentation examples without needing permission.' +
      '</p></main></body></html>';

    const scrapeWithFirecrawl = vi.fn(async () => ({
      html: null,
      markdown: '# Should not run',
      metadata: null,
    }));

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === 'https://example.com') {
        return htmlResponse(html);
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });

    const client = createLinkPreviewClient({
      fetchImplementation: fetchMock as unknown as typeof fetch,
      scrapeWithFirecrawl,
    });

    const result = await client.fetchLinkContent('https://example.com', { timeoutMs: 2000 });
    expect(result.diagnostics.strategy).toBe('html');
    expect(scrapeWithFirecrawl).not.toHaveBeenCalled();
  });

  it('does not call Firecrawl when HTML looks usable', async () => {
    const html = `<!doctype html><html><head><title>Ok</title></head><body><article><p>${'A'.repeat(
      260,
    )}</p></article></body></html>`;

    const scrapeWithFirecrawl = vi.fn(async () => ({
      html: null,
      markdown: '# Should not run',
      metadata: null,
    }));

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === 'https://example.com') {
        return htmlResponse(html);
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });

    const client = createLinkPreviewClient({
      fetchImplementation: fetchMock as unknown as typeof fetch,
      scrapeWithFirecrawl,
    });

    const result = await client.fetchLinkContent('https://example.com', { timeoutMs: 2000 });
    expect(result.diagnostics.strategy).toBe('html');
    expect(scrapeWithFirecrawl).not.toHaveBeenCalled();
  });

  it('does not call Firecrawl when blocked markers only appear in scripts', async () => {
    const html =
      '<!doctype html><html><head><title>Ok</title></head><body>' +
      `<article><p>${'A'.repeat(280)}</p></article>` +
      '<script>window.guard="captcha";</script>' +
      '</body></html>';

    const scrapeWithFirecrawl = vi.fn(async () => ({
      html: null,
      markdown: '# Should not run',
      metadata: null,
    }));

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === 'https://example.com') {
        return htmlResponse(html);
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });

    const client = createLinkPreviewClient({
      fetchImplementation: fetchMock as unknown as typeof fetch,
      scrapeWithFirecrawl,
    });

    const result = await client.fetchLinkContent('https://example.com', { timeoutMs: 2000 });
    expect(result.diagnostics.strategy).toBe('html');
    expect(scrapeWithFirecrawl).not.toHaveBeenCalled();
  });
  it('falls back to Firecrawl when extracted HTML looks thin but document is large', async () => {
    const html =
      `<!doctype html><html><head><title>App Shell</title></head><body><main>` +
      `<div id="root"></div><script>/*${'X'.repeat(9000)}*/</script></main></body></html>`;

    const scrapeWithFirecrawl = vi.fn(async () => ({
      html: '<html><head><title>Firecrawl</title></head><body></body></html>',
      markdown: 'Hello from Firecrawl',
      metadata: { title: 'Firecrawl title' },
    }));

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === 'https://example.com') {
        return htmlResponse(html);
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });

    const client = createLinkPreviewClient({
      fetchImplementation: fetchMock as unknown as typeof fetch,
      scrapeWithFirecrawl,
    });

    const result = await client.fetchLinkContent('https://example.com', { timeoutMs: 2000 });
    expect(result.diagnostics.strategy).toBe('firecrawl');
    expect(result.content).toContain('Hello from Firecrawl');
    expect(scrapeWithFirecrawl).toHaveBeenCalledTimes(1);
  });

  it('does not call Firecrawl when firecrawl is off', async () => {
    const html =
      '<!doctype html><html><head><title>Blocked</title></head><body>Attention Required! | Cloudflare</body></html>';

    const scrapeWithFirecrawl = vi.fn(async () => ({
      html: '<html><head><title>Firecrawl</title></head><body></body></html>',
      markdown: 'Hello from Firecrawl',
      metadata: { title: 'Firecrawl title' },
    }));

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === 'https://example.com') {
        return htmlResponse(html);
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });

    const client = createLinkPreviewClient({
      fetchImplementation: fetchMock as unknown as typeof fetch,
      scrapeWithFirecrawl,
    });

    const result = await client.fetchLinkContent('https://example.com', {
      firecrawl: 'off',
      timeoutMs: 2000,
    });
    expect(result.diagnostics.strategy).toBe('html');
    expect(scrapeWithFirecrawl).not.toHaveBeenCalled();
  });

  it('calls Firecrawl first when firecrawl is always', async () => {
    const html = `<!doctype html><html><head><title>Ok</title></head><body><article><p>${'A'.repeat(
      260,
    )}</p></article></body></html>`;

    const scrapeWithFirecrawl = vi.fn(async () => ({
      html: '<html><head><title>Firecrawl</title></head><body></body></html>',
      markdown: 'Hello from Firecrawl',
      metadata: { title: 'Firecrawl title' },
    }));

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === 'https://example.com') {
        return htmlResponse(html);
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });

    const client = createLinkPreviewClient({
      fetchImplementation: fetchMock as unknown as typeof fetch,
      scrapeWithFirecrawl,
    });

    const result = await client.fetchLinkContent('https://example.com', {
      firecrawl: 'always',
      timeoutMs: 2000,
    });
    expect(result.diagnostics.strategy).toBe('firecrawl');
    expect(result.content).toContain('Hello from Firecrawl');
    expect(scrapeWithFirecrawl).toHaveBeenCalledTimes(1);
  });

  it('falls back to Firecrawl when HTML looks blocked', async () => {
    const html =
      '<!doctype html><html><head><title>Blocked</title></head><body>Attention Required! | Cloudflare</body></html>';

    const scrapeWithFirecrawl = vi.fn(async () => ({
      html: '<html><head><title>Firecrawl</title></head><body></body></html>',
      markdown: 'Hello from Firecrawl',
      metadata: { title: 'Firecrawl title' },
    }));

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === 'https://example.com') {
        return htmlResponse(html);
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });

    const client = createLinkPreviewClient({
      fetchImplementation: fetchMock as unknown as typeof fetch,
      scrapeWithFirecrawl,
    });

    const result = await client.fetchLinkContent('https://example.com', { timeoutMs: 2000 });
    expect(result.diagnostics.strategy).toBe('firecrawl');
    expect(result.content).toContain('Hello from Firecrawl');
    expect(scrapeWithFirecrawl).toHaveBeenCalledTimes(1);
  });

  it('falls back to Firecrawl when HTML fetch fails', async () => {
    const scrapeWithFirecrawl = vi.fn(async () => ({
      html: '<html><head><title>Firecrawl</title></head><body></body></html>',
      markdown: 'Hello from Firecrawl',
      metadata: { title: 'Firecrawl title' },
    }));

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === 'https://example.com') {
        return htmlResponse('nope', 403);
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });

    const client = createLinkPreviewClient({
      fetchImplementation: fetchMock as unknown as typeof fetch,
      scrapeWithFirecrawl,
    });

    const result = await client.fetchLinkContent('https://example.com', { timeoutMs: 2000 });
    expect(result.diagnostics.strategy).toBe('firecrawl');
    expect(result.content).toContain('Hello from Firecrawl');
  });

  it('falls back to Firecrawl when the URL is not HTML (e.g. PDF)', async () => {
    const scrapeWithFirecrawl = vi.fn(async () => ({
      html: '<html><head><title>Firecrawl</title></head><body></body></html>',
      markdown: 'Hello from Firecrawl',
      metadata: { title: 'Firecrawl title' },
    }));

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === 'https://example.com/paper') {
        return pdfResponse('%PDF-1.4 fake payload');
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });

    const client = createLinkPreviewClient({
      fetchImplementation: fetchMock as unknown as typeof fetch,
      scrapeWithFirecrawl,
    });

    const result = await client.fetchLinkContent('https://example.com/paper', { timeoutMs: 2000 });
    expect(result.diagnostics.strategy).toBe('firecrawl');
    expect(scrapeWithFirecrawl).toHaveBeenCalledTimes(1);
    expect(result.content).toContain('Hello from Firecrawl');
  });
});
