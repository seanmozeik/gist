import { describe, expect, it, vi } from 'vitest';

import { createRetryLogger } from '../src/run/logging';

describe('run/logging', () => {
  it('formats retry reasons', () => {
    const stderr = { write: vi.fn() } as unknown as NodeJS.WritableStream;

    const log = createRetryLogger({
      color: false,
      modelId: 'openai/gpt-test',
      stderr,
      verbose: true,
    });

    log({ attempt: 1, delayMs: 10, error: 'Empty summary', maxRetries: 2 });
    expect((stderr.write as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toContain(
      'LLM empty output',
    );

    log({ attempt: 2, delayMs: 10, error: new Error('timed out'), maxRetries: 2 });
    expect((stderr.write as unknown as ReturnType<typeof vi.fn>).mock.calls[1]?.[0]).toContain(
      'LLM timeout',
    );

    log({ attempt: 3, delayMs: 10, error: { message: 'something else' }, maxRetries: 4 });
    expect((stderr.write as unknown as ReturnType<typeof vi.fn>).mock.calls[2]?.[0]).toContain(
      'LLM error',
    );
  });
});
