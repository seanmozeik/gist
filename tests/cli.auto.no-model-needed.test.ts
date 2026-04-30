import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

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

const mocks = vi.hoisted(() => ({
  completeSimple: vi.fn(() => {
    throw new Error('should not be called');
  }),
  getModel: vi.fn(() => {
    throw new Error('no model');
  }),
  streamSimple: vi.fn(() => {
    throw new Error('should not be called');
  }),
}));

vi.mock('@mariozechner/pi-ai', () => ({
  completeSimple: mocks.completeSimple,
  getModel: mocks.getModel,
  streamSimple: mocks.streamSimple,
}));

describe('--model auto no-model-needed', () => {
  it('skips the model when extracted text fits in desired output tokens', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gist-auto-no-model-needed-'));
    const filePath = join(root, 'input.txt');
    writeFileSync(filePath, 'hello world', 'utf8');

    const stdout = collectStream();
    const stderr = collectStream();

    await runCli(['--model', 'auto', '--max-output-tokens', '500', '--plain', filePath], {
      env: { HOME: root, OPENAI_API_KEY: 'test' },
      fetch: async () => {
        throw new Error('unexpected fetch');
      },
      stderr: stderr.stream,
      stdout: stdout.stream,
    });

    expect(stdout.getText()).toContain('hello world');
    expect(stderr.getText()).not.toMatch(/model:/i);
    expect(mocks.streamSimple).not.toHaveBeenCalled();
    expect(mocks.completeSimple).not.toHaveBeenCalled();
  });
});
