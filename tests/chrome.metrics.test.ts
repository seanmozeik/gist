import { describe, expect, it } from 'vitest';

import { buildMetricsParts, buildMetricsTokens } from '../apps/chrome-extension/src/lib/metrics';

describe('chrome metrics', () => {
  it('omits input summary duplicates', () => {
    const summary = '7.5s · example.com · 2.1k words · openrouter/foo/bar';
    const parts = buildMetricsParts({ inputSummary: '2.1k words · 7.5s', summary });
    expect(parts).toEqual(['example.com', 'openrouter/foo/bar']);
  });

  it('shortens OpenRouter prefix when requested', () => {
    const summary = 'Cached · openrouter/xiaomi/mimo-v2:free';
    const parts = buildMetricsParts({ shortenOpenRouter: true, summary });
    expect(parts).toEqual(['Cached', 'or/xiaomi/mimo-v2:free']);
  });

  it('builds link tokens for urls and domains', () => {
    const tokens = buildMetricsTokens({
      inputSummary: null,
      summary: 'example.com · https://example.com/docs',
    });
    expect(tokens).toEqual([
      { href: 'https://example.com', kind: 'link', text: 'example.com' },
      { href: 'https://example.com/docs', kind: 'link', text: 'https://example.com/docs' },
    ]);
  });

  it('links media labels to source url', () => {
    const tokens = buildMetricsTokens({
      inputSummary: null,
      sourceUrl: 'https://youtube.com/watch?v=test',
      summary: '12m YouTube · 1.2k words',
    });
    expect(tokens[0]).toEqual({
      after: '',
      before: '12m ',
      href: 'https://youtube.com/watch?v=test',
      kind: 'media',
      label: 'YouTube',
    });
  });
});
