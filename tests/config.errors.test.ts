import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadGistConfig } from '../src/config';

describe('config error handling', () => {
  it('throws on invalid JSON', () => {
    const root = mkdtempSync(join(tmpdir(), 'gist-config-'));
    const configPath = join(root, '.gist', 'config.json');
    mkdirSync(join(root, '.gist'), { recursive: true });
    writeFileSync(configPath, '{not json', 'utf8');

    expect(() => loadGistConfig({ env: { HOME: root } })).toThrow(/Invalid JSON in config file/);
  });

  it('throws when config contains comments', () => {
    const root = mkdtempSync(join(tmpdir(), 'gist-config-'));
    const configPath = join(root, '.gist', 'config.json');
    mkdirSync(join(root, '.gist'), { recursive: true });
    writeFileSync(
      configPath,
      '{\n  // no comments\n  "model": { "id": "openai/gpt-5.2" }\n}\n',
      'utf8',
    );

    expect(() => loadGistConfig({ env: { HOME: root } })).toThrow(/comments are not allowed/i);
  });

  it('throws when top-level is not an object', () => {
    const root = mkdtempSync(join(tmpdir(), 'gist-config-'));
    const configPath = join(root, '.gist', 'config.json');
    mkdirSync(join(root, '.gist'), { recursive: true });
    writeFileSync(configPath, JSON.stringify(['nope']), 'utf8');

    expect(() => loadGistConfig({ env: { HOME: root } })).toThrow(/expected an object/);
  });

  it('throws when model is empty', () => {
    const root = mkdtempSync(join(tmpdir(), 'gist-config-'));
    const configPath = join(root, '.gist', 'config.json');
    mkdirSync(join(root, '.gist'), { recursive: true });
    writeFileSync(configPath, JSON.stringify({ model: '   ' }), 'utf8');

    expect(() => loadGistConfig({ env: { HOME: root } })).toThrow(/"model" must not be empty/i);
  });

  it('ignores unexpected top-level keys (including "auto")', () => {
    const root = mkdtempSync(join(tmpdir(), 'gist-config-'));
    const configPath = join(root, '.gist', 'config.json');
    mkdirSync(join(root, '.gist'), { recursive: true });
    writeFileSync(configPath, JSON.stringify({ auto: [], model: { mode: 'auto' } }), 'utf8');

    const loaded = loadGistConfig({ env: { HOME: root } });
    expect(loaded.config?.model).toEqual({ mode: 'auto' });
  });

  it('throws when model.rules is not an array', () => {
    const root = mkdtempSync(join(tmpdir(), 'gist-config-'));
    const configPath = join(root, '.gist', 'config.json');
    mkdirSync(join(root, '.gist'), { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify({ model: { mode: 'auto', rules: { nope: true } } }),
      'utf8',
    );

    expect(() => loadGistConfig({ env: { HOME: root } })).toThrow(
      /"model\.rules" must be an array/i,
    );
  });

  it('throws when model.rules[].when is not an array', () => {
    const root = mkdtempSync(join(tmpdir(), 'gist-config-'));
    const configPath = join(root, '.gist', 'config.json');
    mkdirSync(join(root, '.gist'), { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify({
        model: {
          mode: 'auto',
          rules: [{ candidates: ['openai/gpt-5-nano'], when: { kind: 'video' } }],
        },
      }),
      'utf8',
    );

    expect(() => loadGistConfig({ env: { HOME: root } })).toThrow(
      /model\.rules\[\]\.when.*must be an array/i,
    );
  });

  it('throws when model.rules[].when is empty', () => {
    const root = mkdtempSync(join(tmpdir(), 'gist-config-'));
    const configPath = join(root, '.gist', 'config.json');
    mkdirSync(join(root, '.gist'), { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify({
        model: { mode: 'auto', rules: [{ candidates: ['openai/gpt-5-nano'], when: [] }] },
      }),
      'utf8',
    );

    expect(() => loadGistConfig({ env: { HOME: root } })).toThrow(
      /model\.rules\[\]\.when.*must not be empty/i,
    );
  });

  it('throws when model.rules[].when contains unknown kinds', () => {
    const root = mkdtempSync(join(tmpdir(), 'gist-config-'));
    const configPath = join(root, '.gist', 'config.json');
    mkdirSync(join(root, '.gist'), { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify({
        model: { mode: 'auto', rules: [{ candidates: ['openai/gpt-5-nano'], when: ['nope'] }] },
      }),
      'utf8',
    );

    expect(() => loadGistConfig({ env: { HOME: root } })).toThrow(/unknown "when" kind/i);
  });
});
