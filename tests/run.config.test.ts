import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveConfigState } from '../src/run/run-config.js';

function resolveTestConfigState(programOpts: Record<string, unknown>) {
  return resolveConfigState({
    cliFlagPresent: false,
    cliProviderArg: null,
    envForRun: { HOME: mkdtempSync(join(tmpdir(), 'gist-run-config-')) },
    languageExplicitlySet: false,
    programOpts: { videoMode: 'auto', ...programOpts },
    videoModeExplicitlySet: false,
  });
}

describe('run config', () => {
  it('maps --fast and --thinking to OpenAI request overrides', () => {
    expect(
      resolveTestConfigState({ fast: true, thinking: 'mid' }).openaiRequestOptionsOverride,
    ).toEqual({ reasoningEffort: 'medium', serviceTier: 'fast' });
  });

  it('maps --service-tier to OpenAI request overrides', () => {
    expect(resolveTestConfigState({ serviceTier: 'flex' }).openaiRequestOptionsOverride).toEqual({
      serviceTier: 'flex',
    });
  });

  it('lets --service-tier default explicitly clear a configured tier', () => {
    expect(resolveTestConfigState({ serviceTier: 'default' }).openaiRequestOptionsOverride).toEqual(
      { serviceTier: 'default' },
    );
  });

  it('rejects conflicting --fast and --service-tier values', () => {
    expect(() => resolveTestConfigState({ fast: true, serviceTier: 'flex' })).toThrow(
      /Use either --fast or --service-tier/,
    );
  });
});
