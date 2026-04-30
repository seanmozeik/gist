import { describe, expect, it } from 'vitest';

import { canHandle } from '../src/content/transcript/providers/podcast';

describe('podcast transcript provider - canHandle + RSS detection branches', () => {
  it('detects RSS/Atom/XML and common podcast hosts', () => {
    expect(
      canHandle({ html: '<rss></rss>', resourceKey: null, url: 'https://example.com/feed.xml' }),
    ).toBe(true);
    expect(
      canHandle({
        html: '<!doctype html><rss><channel/></rss>',
        resourceKey: null,
        url: 'https://example.com/feed.xml',
      }),
    ).toBe(true);
    expect(
      canHandle({
        html: '<?xml version="1.0"?><rss><channel></channel></rss>',
        resourceKey: null,
        url: 'https://example.com/feed.xml',
      }),
    ).toBe(true);
    expect(
      canHandle({
        html: '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>',
        resourceKey: null,
        url: 'https://example.com/atom.xml',
      }),
    ).toBe(true);
    expect(
      canHandle({
        html: '<!doctype html><feed xmlns="http://www.w3.org/2005/Atom"></feed>',
        resourceKey: null,
        url: 'https://example.com/atom.xml',
      }),
    ).toBe(true);

    expect(
      canHandle({ html: null, resourceKey: null, url: 'https://open.spotify.com/episode/abc' }),
    ).toBe(true);
    expect(
      canHandle({
        html: null,
        resourceKey: null,
        url: 'https://podcasts.apple.com/us/podcast/id123?i=456',
      }),
    ).toBe(true);

    expect(canHandle({ html: null, resourceKey: null, url: 'https://example.com/podcast' })).toBe(
      true,
    );
    expect(canHandle({ html: null, resourceKey: null, url: 'https://example.com/article' })).toBe(
      false,
    );
  });
});
