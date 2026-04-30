import fs from 'node:fs';

import { describe, expect, it } from 'vitest';

import { FALLBACK_VERSION, resolvePackageVersion } from '../src/version.js';

describe('resolvePackageVersion', () => {
  it('prefers GIST_VERSION when set', () => {
    const previous = process.env.GIST_VERSION;
    process.env.GIST_VERSION = '9.9.9';
    try {
      expect(resolvePackageVersion()).toBe('9.9.9');
    } finally {
      if (previous === undefined) {
        delete process.env.GIST_VERSION;
      } else {
        process.env.GIST_VERSION = previous;
      }
    }
  });

  it('falls back when importMetaUrl is invalid', () => {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')) as { version: string };
    expect(resolvePackageVersion('not a url')).toBe(pkg.version);
  });

  it('keeps fallback version in sync with package.json', () => {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')) as { version: string };
    expect(FALLBACK_VERSION).toBe(pkg.version);
  });
});
