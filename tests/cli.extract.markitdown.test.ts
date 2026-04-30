import { Writable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import type { ExecFileFn } from '../src/markitdown';
import { runCli } from '../src/run';

describe('cli --extract --format md (markitdown fallback)', () => {
  it('converts HTML to Markdown via markitdown when no LLM keys are configured', async () => {
    const html =
      '<!doctype html><html><head><title>Ok</title></head>' +
      '<body><article><h1>Title</h1><p>Hello</p></article></body></html>';

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === 'https://example.com') {
        return new Response(html, { headers: { 'Content-Type': 'text/html' }, status: 200 });
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });

    const execFileMock = vi.fn((file, args, _opts, cb) => {
      expect(file).toBe('uvx');
      expect(args.slice(0, 3)).toEqual(['--from', 'markitdown[all]', 'markitdown']);
      cb(null, String.raw`# Converted\n\nHello\n`, '');
    });

    let stdoutText = '';
    const stdout = new Writable({
      write(chunk, _encoding, callback) {
        stdoutText += chunk.toString();
        callback();
      },
    });

    await runCli(['--extract', '--format', 'md', 'https://example.com'], {
      env: { UVX_PATH: 'uvx' },
      execFile: execFileMock as unknown as ExecFileFn,
      fetch: fetchMock as unknown as typeof fetch,
      stderr: new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        },
      }),
      stdout,
    });

    expect(execFileMock).toHaveBeenCalledTimes(1);
    expect(stdoutText).toContain('# Converted');
  });
});
