import { describe, expect, it } from 'vitest';

import { mergeDaemonEnv } from '../src/daemon/env-merge.js';

describe('daemon/env-merge', () => {
  it('prefers snapshot values (launchd-safe)', () => {
    const merged = mergeDaemonEnv({
      envForRun: { OPENAI_API_KEY: 'from-run', PATH: '/usr/bin:/bin' },
      snapshot: { OPENAI_API_KEY: 'from-snapshot', PATH: '/opt/homebrew/bin:/usr/bin:/bin' },
    });

    expect(merged.PATH).toBe('/opt/homebrew/bin:/usr/bin:/bin');
    expect(merged.OPENAI_API_KEY).toBe('from-snapshot');
  });

  it('keeps runtime env values not present in snapshot', () => {
    const merged = mergeDaemonEnv({
      envForRun: { FOO: 'bar', HOME: '/Users/peter' },
      snapshot: { PATH: '/opt/homebrew/bin:/usr/bin:/bin' },
    });

    expect(merged.HOME).toBe('/Users/peter');
    expect(merged.FOO).toBe('bar');
    expect(merged.PATH).toBe('/opt/homebrew/bin:/usr/bin:/bin');
  });
});
