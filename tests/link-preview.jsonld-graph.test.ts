import { describe, expect, it, vi } from 'vitest';

import { createLinkPreviewClient } from '../src/content/index.js';

const htmlResponse = (html: string, status = 200) =>
  new Response(html, { headers: { 'Content-Type': 'text/html' }, status });

describe('link preview extraction (json-ld graph)', () => {
  it('selects the longest description across @graph entries', async () => {
    const shortDescription = 'Short summary.';
    const longDescription = 'L'.repeat(240);

    const jsonLd = JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'PodcastEpisode', description: shortDescription, name: 'Episode Short' },
        { '@type': 'Article', description: longDescription, headline: 'Longform piece' },
      ],
    });

    const html = `<!doctype html><html><head>
      <title>Example</title>
      <script type="application/ld+json">${jsonLd}</script>
    </head><body>
      <p>Fallback body text that should not win.</p>
    </body></html>`;

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === 'https://example.com/graph') {
        return htmlResponse(html);
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });

    const client = createLinkPreviewClient({ fetch: fetchMock as unknown as typeof fetch });

    const result = await client.fetchLinkContent('https://example.com/graph', {
      firecrawl: 'off',
      format: 'text',
      timeoutMs: 2000,
    });

    expect(result.content).toContain(longDescription);
    expect(result.content).not.toContain(shortDescription);
  });
});
