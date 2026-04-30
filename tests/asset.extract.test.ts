import { describe, expect, it } from 'vitest';

import { extractAssetContent } from '../src/run/flows/asset/extract';

describe('extractAssetContent', () => {
  it('returns inline text for text-like files', async () => {
    const res = await extractAssetContent({
      attachment: {
        bytes: new TextEncoder().encode('hello'),
        filename: 'file.txt',
        kind: 'file',
        mediaType: 'text/plain',
      },
      ctx: {
        env: {},
        envForRun: {},
        execFileImpl: (() => {
          throw new Error('execFile should not be called for text attachments');
        }) as never,
        preprocessMode: 'auto',
        timeoutMs: 1000,
      },
    });

    expect(res.content).toBe('hello');
    expect(res.diagnostics.markdown.used).toBe(false);
  });

  it('throws for images', async () => {
    await expect(
      extractAssetContent({
        attachment: {
          bytes: new Uint8Array([1, 2, 3]),
          filename: 'img.png',
          kind: 'image',
          mediaType: 'image/png',
        },
        ctx: {
          env: {},
          envForRun: {},
          execFileImpl: (() => {
            /* Empty */
          }) as never,
          preprocessMode: 'auto',
          timeoutMs: 1000,
        },
      }),
    ).rejects.toThrow(/No extractable text found/i);
  });

  it('throws when preprocessing is disabled for binary files', async () => {
    await expect(
      extractAssetContent({
        attachment: {
          bytes: new Uint8Array([1, 2, 3]),
          filename: 'file.pdf',
          kind: 'file',
          mediaType: 'application/pdf',
        },
        ctx: {
          env: {},
          envForRun: {},
          execFileImpl: (() => {
            /* Empty */
          }) as never,
          preprocessMode: 'off',
          timeoutMs: 1000,
        },
      }),
    ).rejects.toThrow(/does not support extracting binary files/i);
  });

  it('throws with a helpful message when uvx is missing', async () => {
    await expect(
      extractAssetContent({
        attachment: {
          bytes: new Uint8Array([1, 2, 3]),
          filename: 'file.pdf',
          kind: 'file',
          mediaType: 'application/pdf',
        },
        ctx: {
          env: { PATH: '' },
          envForRun: { PATH: '' },
          execFileImpl: (() => {
            /* Empty */
          }) as never,
          preprocessMode: 'auto',
          timeoutMs: 1000,
        },
      }),
    ).rejects.toThrow(/Missing uvx\/markitdown/i);
  });

  it('preprocesses supported binary files via markitdown', async () => {
    let called = 0;
    let lastCmd: string | null = null;
    const execFileImpl = ((cmd: string, _args: string[], _opts: unknown, cb: unknown) => {
      called += 1;
      lastCmd = cmd;
      (cb as (err: unknown, stdout: string, stderr: string) => void)(null, '# ok', '');
    }) as unknown as typeof import('node:child_process').execFile;

    const res = await extractAssetContent({
      attachment: {
        bytes: new Uint8Array([1, 2, 3]),
        filename: 'file.pdf',
        kind: 'file',
        mediaType: 'application/pdf',
      },
      ctx: {
        env: { UVX_PATH: 'uvx' },
        envForRun: { UVX_PATH: 'uvx' },
        execFileImpl,
        preprocessMode: 'auto',
        timeoutMs: 1000,
      },
    });

    expect(called).toBe(1);
    expect(lastCmd).toBe('uvx');
    expect(res.content).toBe('# ok');
    expect(res.diagnostics.markdown.used).toBe(true);
    expect(res.diagnostics.markdown.notes).toBe('markitdown');
  });
});
