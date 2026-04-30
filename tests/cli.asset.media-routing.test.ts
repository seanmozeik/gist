import { Writable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { withUrlAsset } from '../src/run/flows/asset/input';

describe('media URL routing', () => {
  it('routes direct media URLs with query parameters to transcription', async () => {
    const stderr = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });
    const gistMediaFile = vi.fn(async () => {
      /* Empty */
    });
    const ctx = {
      clearProgressIfCurrent: vi.fn(),
      env: {},
      gistAsset: vi.fn(async () => {
        throw new Error('gistAsset should not be called');
      }),
      gistMediaFile,
      progressEnabled: false,
      setClearProgressBeforeStdout: vi.fn(),
      stderr,
      timeoutMs: 1000,
      trackedFetch: vi.fn(async () => {
        throw new Error('fetch should not be called');
      }) as unknown as typeof fetch,
    };

    const handled = await withUrlAsset(
      ctx,
      'https://example.com/audio.mp3?token=abc',
      false,
      async () => {
        throw new Error('handler should not be called');
      },
    );

    expect(handled).toBe(true);
    expect(gistMediaFile).toHaveBeenCalledTimes(1);
  });
});
