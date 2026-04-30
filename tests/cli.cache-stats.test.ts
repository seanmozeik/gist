import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { createCacheStore } from '../src/cache';
import { runCli } from '../src/run';

function collectStream() {
  let text = '';
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      text += chunk.toString();
      callback();
    },
  });
  return { getText: () => text, stream };
}

function noopStream(): Writable {
  return new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
}

describe('--cache-stats', () => {
  it('prints cache entry counts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gist-cache-stats-'));
    const path = join(root, '.gist', 'cache.sqlite');
    const store = await createCacheStore({ maxBytes: 1024 * 1024, path });

    store.setText('extract', 'e1', 'value', null);
    store.setText('summary', 's1', 'value', null);
    await store.transcriptCache.set({
      content: 'hi',
      metadata: null,
      resourceKey: 'abc',
      service: 'youtube',
      source: 'youtubei',
      ttlMs: 1000,
      url: 'https://example.com',
    });

    store.close();

    const stdout = collectStream();
    await runCli(['--cache-stats'], {
      env: { HOME: root },
      fetch: globalThis.fetch.bind(globalThis),
      stderr: noopStream(),
      stdout: stdout.stream,
    });

    const output = stdout.getText();
    expect(output).toContain('Entries: total=3');
    expect(output).toContain('extract=1');
    expect(output).toContain('summary=1');
    expect(output).toContain('transcript=1');
  });
});
