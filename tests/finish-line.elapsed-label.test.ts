import { describe, expect, it } from 'vitest';

import { buildFinishLineText } from '../src/run/finish-line';

const baseReport = {
  llm: [{ calls: 1, completionTokens: 1, promptTokens: 1, totalTokens: 2 }],
  services: { apify: { requests: 0 }, firecrawl: { requests: 0 } },
};

describe('finish line elapsed label', () => {
  it('uses custom elapsed label when provided', () => {
    const text = buildFinishLineText({
      costUsd: null,
      detailed: false,
      elapsedLabel: 'Cached',
      elapsedMs: 0,
      extraParts: null,
      label: 'Example',
      model: 'openrouter/xiaomi/mimo-v2-flash:free',
      report: baseReport,
    });

    expect(text.line.split(' · ')[0]).toBe('Cached');
  });

  it('falls back to formatted time when elapsed label is blank', () => {
    const text = buildFinishLineText({
      costUsd: null,
      detailed: false,
      elapsedLabel: '   ',
      elapsedMs: 1050,
      extraParts: null,
      label: null,
      model: null,
      report: baseReport,
    });

    expect(text.line.startsWith('1.1s')).toBe(true);
  });
});
