import { describe, expect, it } from 'vitest';

import { resolveRunnerSlidesSettings } from '../src/run/runner-slides';

describe('resolveRunnerSlidesSettings', () => {
  it('allows slides for local video files', () => {
    const settings = resolveRunnerSlidesSettings({
      config: null,
      inputTarget: { filePath: '/tmp/video.webm', kind: 'file' },
      normalizedArgv: ['--slides'],
      programOpts: { slides: true },
    });

    expect(settings?.enabled).toBe(true);
  });

  it('rejects slides for stdin', () => {
    expect(() =>
      resolveRunnerSlidesSettings({
        config: null,
        inputTarget: { kind: 'stdin' },
        normalizedArgv: ['--slides'],
        programOpts: { slides: true },
      }),
    ).toThrow('--slides is only supported for URLs or local video files');
  });

  it('rejects direct audio URLs', () => {
    expect(() =>
      resolveRunnerSlidesSettings({
        config: null,
        inputTarget: { kind: 'url', url: 'https://cdn.example.com/audio.mp3' },
        normalizedArgv: ['--slides'],
        programOpts: { slides: true },
      }),
    ).toThrow('--slides is only supported for video URLs or local video files');
  });
});
