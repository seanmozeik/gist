import { describe, expect, it } from 'vitest';

import { buildFinishLineText } from '../src/run/finish-line.js';

describe('finish line transcript label de-dupe', () => {
  it('does not repeat YouTube label when transcript label already includes it', () => {
    const text = buildFinishLineText({
      costUsd: null,
      detailed: false,
      elapsedMs: 12_000,
      extraParts: ['txc=10 min YouTube · 1.7k words'],
      label: 'YouTube',
      model: 'openrouter/xiaomi/mimo-v2-flash:free',
      report: {
        llm: [{ promptTokens: 2600, completionTokens: 386, totalTokens: 2986, calls: 1 }],
        services: { apify: { requests: 0 }, firecrawl: { requests: 0 } },
      },
    });

    const occurrences = text.line.match(/YouTube/g)?.length ?? 0;
    expect(occurrences).toBe(1);
  });

  it('drops the site label when transcript label already implies a podcast', () => {
    const text = buildFinishLineText({
      costUsd: null,
      detailed: false,
      elapsedMs: 12_000,
      extraParts: ['txc=45 min podcast · 12.4k words'],
      label: 'Spotify',
      model: 'openrouter/xiaomi/mimo-v2-flash:free',
      report: {
        llm: [{ promptTokens: 2600, completionTokens: 386, totalTokens: 2986, calls: 1 }],
        services: { apify: { requests: 0 }, firecrawl: { requests: 0 } },
      },
    });

    expect(text.line).not.toContain('Spotify');
  });
});
