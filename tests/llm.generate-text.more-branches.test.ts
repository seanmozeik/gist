import { describe, expect, it, vi } from 'vitest';

import { generateTextWithModelId, streamTextWithModelId } from '../src/llm/generate-text.js';
import { makeAssistantMessage, makeTextDeltaStream } from './helpers/pi-ai-mock.js';

const mocks = vi.hoisted(() => ({
  completeSimple: vi.fn(),
  getModel: vi.fn(() => {
    throw new Error('no model');
  }),
  streamSimple: vi.fn(),
}));

vi.mock('@mariozechner/pi-ai', () => ({
  completeSimple: mocks.completeSimple,
  getModel: mocks.getModel,
  streamSimple: mocks.streamSimple,
}));

describe('llm/generate-text extra branches', () => {
  it('streamTextWithModelId resolves usage=null when stream.result rejects', async () => {
    mocks.streamSimple.mockImplementationOnce(() =>
      makeTextDeltaStream(['o', 'k'], makeAssistantMessage({ text: 'ok' }), {
        error: new Error('no usage'),
      }),
    );

    const result = await streamTextWithModelId({
      apiKeys: {
        anthropicApiKey: null,
        googleApiKey: null,
        openaiApiKey: 'k',
        openrouterApiKey: null,
        xaiApiKey: null,
      },
      fetchImpl: globalThis.fetch.bind(globalThis),
      maxOutputTokens: 10,
      modelId: 'openai/gpt-5-chat',
      prompt: { userText: 'hi' },
      timeoutMs: 2000,
    });

    const chunks: string[] = [];
    for await (const chunk of result.textStream) {
      chunks.push(chunk);
    }
    expect(chunks.join('')).toBe('ok');
    await expect(result.usage).resolves.toBeNull();
  });

  it('streamTextWithModelId normalizes anthropic access errors via error events', async () => {
    mocks.streamSimple.mockImplementationOnce(() =>
      makeTextDeltaStream(['o', 'k'], makeAssistantMessage({ provider: 'anthropic', text: 'ok' }), {
        error: Object.assign(new Error('model: claude-3-5-sonnet-latest'), {
          responseBody: JSON.stringify({
            error: { message: 'model: claude-3-5-sonnet-latest', type: 'permission_error' },
            type: 'error',
          }),
          statusCode: 403,
        }),
      }),
    );

    const result = await streamTextWithModelId({
      apiKeys: {
        anthropicApiKey: 'k',
        googleApiKey: null,
        openaiApiKey: null,
        openrouterApiKey: null,
        xaiApiKey: null,
      },
      fetchImpl: globalThis.fetch.bind(globalThis),
      maxOutputTokens: 10,
      modelId: 'anthropic/claude-3-5-sonnet-latest',
      prompt: { userText: 'hi' },
      timeoutMs: 2000,
    });

    for await (const _chunk of result.textStream) {
      // Drain stream to observe error event and store lastError.
    }
    const err = result.lastError();
    expect(err instanceof Error ? err.message : String(err)).toMatch(
      /Anthropic API rejected model/i,
    );
  });

  it('generateTextWithModelId retries on timeout-like errors', async () => {
    vi.useFakeTimers();
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      let calls = 0;
      mocks.completeSimple.mockImplementation(async () => {
        calls += 1;
        if (calls === 1) {
          throw new Error('timed out');
        }
        return makeAssistantMessage({ text: 'OK' });
      });

      const onRetry = vi.fn();
      const promise = generateTextWithModelId({
        apiKeys: {
          anthropicApiKey: null,
          googleApiKey: null,
          openaiApiKey: 'k',
          openrouterApiKey: null,
          xaiApiKey: null,
        },
        fetchImpl: globalThis.fetch.bind(globalThis),
        maxOutputTokens: 10,
        modelId: 'openai/gpt-5-chat',
        onRetry,
        prompt: { userText: 'hi' },
        retries: 1,
        timeoutMs: 2000,
      });

      await vi.runOnlyPendingTimersAsync();
      const result = await promise;
      expect(result.text).toBe('OK');
      expect(onRetry).toHaveBeenCalled();
      expect(calls).toBe(2);
    } finally {
      randomSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('throws missing key errors for openai/... models', async () => {
    mocks.completeSimple.mockReset();
    await expect(
      generateTextWithModelId({
        apiKeys: {
          anthropicApiKey: null,
          googleApiKey: null,
          openaiApiKey: null,
          openrouterApiKey: null,
          xaiApiKey: null,
        },
        fetchImpl: globalThis.fetch.bind(globalThis),
        maxOutputTokens: 10,
        modelId: 'openai/gpt-5-chat',
        prompt: { userText: 'hi' },
        timeoutMs: 2000,
      }),
    ).rejects.toThrow(/Missing OPENAI_API_KEY/i);
  });
});
