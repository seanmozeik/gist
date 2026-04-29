import { describe, expect, it } from 'vitest';

import { resolveAutoDaemonMode } from '../src/daemon/auto-mode.js';

describe('daemon/auto-mode', () => {
  it('prefers url for media urls', () => {
    expect(
      resolveAutoDaemonMode({ hasText: true, url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }),
    ).toEqual({ fallback: 'page', primary: 'url' });

    expect(resolveAutoDaemonMode({ hasText: true, url: 'https://example.com/video.mp4' })).toEqual({
      fallback: 'page',
      primary: 'url',
    });
  });

  it('prefers page when text is present and url is not media-like', () => {
    expect(resolveAutoDaemonMode({ hasText: true, url: 'https://example.com/article' })).toEqual({
      fallback: 'url',
      primary: 'page',
    });
  });

  it('prefers url when no text is present', () => {
    expect(resolveAutoDaemonMode({ hasText: false, url: 'https://example.com/article' })).toEqual({
      fallback: null,
      primary: 'url',
    });
  });
});
