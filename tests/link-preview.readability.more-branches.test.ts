import { describe, expect, it } from 'vitest';

import {
  extractReadabilityFromHtml,
  toReadabilityHtml,
} from '../packages/core/src/content/link-preview/content/readability.js';

describe('readability helpers', () => {
  it('returns null for unreadable html and import-safe failures', async () => {
    await expect(extractReadabilityFromHtml('<html><body></body></html>')).resolves.toBeNull();
  });

  it('falls back to escaped article html when only text exists', () => {
    expect(
      toReadabilityHtml({ excerpt: null, html: null, text: `<Hello & "world">`, title: null }),
    ).toBe('<article><p>&lt;Hello &amp; &quot;world&quot;&gt;</p></article>');
    expect(toReadabilityHtml({ excerpt: null, html: null, text: '', title: null })).toBeNull();
    expect(toReadabilityHtml(null)).toBeNull();
  });
});
