import { join, resolve as resolvePath } from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveCachePath } from '../src/cache.js';

describe('resolveCachePath', () => {
  it('uses HOME for default path', () => {
    const home = '/tmp/summarize-home';
    const resolved = resolveCachePath({ cachePath: null, env: { HOME: home } });
    expect(resolved).toBe(join(home, '.summarize', 'cache.sqlite'));
  });

  it('expands relative and tilde paths', () => {
    const home = '/tmp/summarize-home';
    const relative = resolveCachePath({ cachePath: 'cache.sqlite', env: { HOME: home } });
    const tilde = resolveCachePath({ cachePath: '~/cache.sqlite', env: { HOME: home } });
    expect(relative).toBe(resolvePath(join(home, 'cache.sqlite')));
    expect(tilde).toBe(resolvePath(join(home, 'cache.sqlite')));
  });

  it('returns null when no home is available', () => {
    expect(resolveCachePath({ cachePath: null, env: {} })).toBeNull();
  });

  it('accepts absolute paths without HOME', () => {
    const absolute = '/tmp/summarize-cache.sqlite';
    expect(resolveCachePath({ cachePath: absolute, env: {} })).toBe(absolute);
  });
});
