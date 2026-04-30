import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadGistConfig } from '../src/config.js';

const writeJsonConfig = (value: unknown) => {
  const root = mkdtempSync(join(tmpdir(), 'gist-config-more-'));
  const dir = join(root, '.gist');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.json'), JSON.stringify(value), 'utf8');
  return root;
};

describe('config extra branches', () => {
  it('rejects model.id without a provider prefix', () => {
    const root = writeJsonConfig({ model: { id: 'gpt-5.2' } });
    expect(() => loadGistConfig({ env: { HOME: root } })).toThrow(/must be provider-prefixed/i);
  });

  it('rejects model.name "auto" in object form', () => {
    const root = writeJsonConfig({ model: { name: 'auto' } });
    expect(() => loadGistConfig({ env: { HOME: root } })).toThrow(/must not be "auto"/i);
  });

  it('rejects invalid models keys (duplicates, spaces, slashes)', () => {
    const rootDup = writeJsonConfig({
      models: { Fast: { id: 'openai/gpt-5.2' }, fast: { id: 'openai/gpt-5.2' } },
    });
    expect(() => loadGistConfig({ env: { HOME: rootDup } })).toThrow(/duplicate model name/i);

    const rootSpace = writeJsonConfig({ models: { 'my preset': { id: 'openai/gpt-5.2' } } });
    expect(() => loadGistConfig({ env: { HOME: rootSpace } })).toThrow(/must not contain spaces/i);

    const rootSlash = writeJsonConfig({ models: { 'a/b': { id: 'openai/gpt-5.2' } } });
    expect(() => loadGistConfig({ env: { HOME: rootSlash } })).toThrow(/must not include/i);
  });

  it('rejects models entries that reference another model by name', () => {
    const root = writeJsonConfig({ models: { fast: { name: 'other' } } });
    expect(() => loadGistConfig({ env: { HOME: root } })).toThrow(
      /must not reference another model/i,
    );
  });

  it('rejects cli.disabled and per-provider enabled keys', () => {
    const rootDisabled = writeJsonConfig({ cli: { disabled: true } });
    expect(() => loadGistConfig({ env: { HOME: rootDisabled } })).toThrow(
      /"cli\.disabled" is not supported/i,
    );

    const rootNested = writeJsonConfig({ cli: { claude: { enabled: true } } });
    expect(() => loadGistConfig({ env: { HOME: rootNested } })).toThrow(
      /"cli\.claude\.enabled" is not supported/i,
    );
  });

  it('rejects invalid cli.enabled and cli.extraArgs shapes', () => {
    const rootEnabled = writeJsonConfig({ cli: { enabled: 'codex' } });
    expect(() => loadGistConfig({ env: { HOME: rootEnabled } })).toThrow(
      /"cli\.enabled" must be an array/i,
    );

    const rootUnknown = writeJsonConfig({ cli: { enabled: ['nope'] } });
    expect(() => loadGistConfig({ env: { HOME: rootUnknown } })).toThrow(/unknown CLI provider/i);

    const rootExtraArgs = writeJsonConfig({ cli: { extraArgs: [1] } });
    expect(() => loadGistConfig({ env: { HOME: rootExtraArgs } })).toThrow(
      /"cli\.extraArgs" must be an array of strings/i,
    );
  });

  it('rejects non-object openai config', () => {
    const root = writeJsonConfig({ openai: 1 });
    expect(() => loadGistConfig({ env: { HOME: root } })).toThrow(/"openai" must be an object/i);
  });

  it('rejects non-object output config', () => {
    const root = writeJsonConfig({ output: 1 });
    expect(() => loadGistConfig({ env: { HOME: root } })).toThrow(/"output" must be an object/i);
  });

  it('rejects invalid output.length', () => {
    const root = writeJsonConfig({ output: { length: 'tiny' } });
    expect(() => loadGistConfig({ env: { HOME: root } })).toThrow(/output\.length/i);
  });

  it('rejects non-object ui config', () => {
    const root = writeJsonConfig({ ui: 1 });
    expect(() => loadGistConfig({ env: { HOME: root } })).toThrow(/"ui" must be an object/i);
  });

  it('rejects invalid ui.theme', () => {
    const root = writeJsonConfig({ ui: { theme: 'nope' } });
    expect(() => loadGistConfig({ env: { HOME: root } })).toThrow(/ui\.theme/i);
  });
});
