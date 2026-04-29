import type { Api } from '@mariozechner/pi-ai';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { generateTextWithModelId, streamTextWithModelId } from '../src/llm/generate-text.js';
import { buildDocumentPrompt } from './helpers/document-prompt.js';
import { buildMinimalPdf } from './helpers/pdf.js';
import { makeAssistantMessage, makeTextDeltaStream } from './helpers/pi-ai-mock.js';

interface MockModel { provider: string; id: string; api: Api }

const mocks = vi.hoisted(() => ({
  completeSimple: vi.fn(),
  getModel: vi.fn(() => {
    throw new Error('no model');
  }),
  streamSimple: vi.fn(),
}));

mocks.completeSimple.mockImplementation(async (model: MockModel) =>
  makeAssistantMessage({
    api: model.api,
    model: model.id,
    provider: model.provider,
    text: 'ok',
    usage: { input: 1, output: 2, totalTokens: 3 },
  }),
);
mocks.streamSimple.mockImplementation((_model: MockModel) =>
  makeTextDeltaStream(['o', 'k'], makeAssistantMessage({ text: 'ok' })),
);

vi.mock('@mariozechner/pi-ai', () => ({
  completeSimple: mocks.completeSimple,
  getModel: mocks.getModel,
  streamSimple: mocks.streamSimple,
}));

describe('llm generate/stream', () => {
  const originalBaseUrl = process.env.OPENAI_BASE_URL;

  afterEach(() => {
    mocks.completeSimple.mockClear();
    mocks.streamSimple.mockClear();
    process.env.OPENAI_BASE_URL = originalBaseUrl;
  });

  it('routes by provider (generateText) and includes maxOutputTokens when set', async () => {
    mocks.completeSimple.mockClear();
    await generateTextWithModelId({
      apiKeys: {
        anthropicApiKey: null,
        googleApiKey: null,
        openaiApiKey: null,
        openrouterApiKey: null,
        xaiApiKey: 'k',
      },
      fetchImpl: globalThis.fetch.bind(globalThis),
      maxOutputTokens: 7,
      modelId: 'xai/grok-4-fast-non-reasoning',
      prompt: { userText: 'hi' },
      timeoutMs: 2000,
    });
    await generateTextWithModelId({
      apiKeys: {
        anthropicApiKey: null,
        googleApiKey: 'k',
        openaiApiKey: null,
        openrouterApiKey: null,
        xaiApiKey: null,
      },
      fetchImpl: globalThis.fetch.bind(globalThis),
      maxOutputTokens: 7,
      modelId: 'google/gemini-3-flash-preview',
      prompt: { userText: 'hi' },
      timeoutMs: 2000,
    });
    await generateTextWithModelId({
      apiKeys: {
        anthropicApiKey: 'k',
        googleApiKey: null,
        openaiApiKey: null,
        openrouterApiKey: null,
        xaiApiKey: null,
      },
      fetchImpl: globalThis.fetch.bind(globalThis),
      maxOutputTokens: 7,
      modelId: 'anthropic/claude-opus-4-5',
      prompt: { userText: 'hi' },
      timeoutMs: 2000,
    });
    await generateTextWithModelId({
      apiKeys: {
        anthropicApiKey: null,
        googleApiKey: null,
        openaiApiKey: 'k',
        openrouterApiKey: null,
        xaiApiKey: null,
      },
      fetchImpl: globalThis.fetch.bind(globalThis),
      maxOutputTokens: 7,
      modelId: 'openai/gpt-5-chat',
      prompt: { userText: 'hi' },
      timeoutMs: 2000,
    });
    expect(mocks.completeSimple).toHaveBeenCalledTimes(4);
    for (const call of mocks.completeSimple.mock.calls) {
      const options = (call?.[2] ?? {}) as Record<string, unknown>;
      expect(options).toHaveProperty('maxTokens', 7);
    }
  });

  it('does not include maxOutputTokens when unset', async () => {
    mocks.completeSimple.mockClear();
    mocks.streamSimple.mockClear();

    await generateTextWithModelId({
      apiKeys: {
        anthropicApiKey: null,
        googleApiKey: null,
        openaiApiKey: 'k',
        openrouterApiKey: null,
        xaiApiKey: null,
      },
      fetchImpl: globalThis.fetch.bind(globalThis),
      modelId: 'openai/gpt-5-chat',
      prompt: { userText: 'hi' },
      timeoutMs: 2000,
    });

    await streamTextWithModelId({
      apiKeys: {
        anthropicApiKey: null,
        googleApiKey: null,
        openaiApiKey: 'k',
        openrouterApiKey: null,
        xaiApiKey: null,
      },
      fetchImpl: globalThis.fetch.bind(globalThis),
      modelId: 'openai/gpt-5-chat',
      prompt: { userText: 'hi' },
      timeoutMs: 2000,
    });

    expect(mocks.completeSimple).toHaveBeenCalledTimes(1);
    expect(mocks.streamSimple).toHaveBeenCalledTimes(1);

    const generateArgs = (mocks.completeSimple.mock.calls[0]?.[2] ?? {}) as Record<string, unknown>;
    const streamArgs = (mocks.streamSimple.mock.calls[0]?.[2] ?? {}) as Record<string, unknown>;

    expect(generateArgs).not.toHaveProperty('maxTokens');
    expect(streamArgs).not.toHaveProperty('maxTokens');
  });

  it('skips temperature for OpenAI GPT-5 models (generate/stream)', async () => {
    mocks.completeSimple.mockClear();
    mocks.streamSimple.mockClear();

    await generateTextWithModelId({
      apiKeys: {
        anthropicApiKey: null,
        googleApiKey: null,
        openaiApiKey: 'k',
        openrouterApiKey: null,
        xaiApiKey: null,
      },
      fetchImpl: globalThis.fetch.bind(globalThis),
      modelId: 'openai/gpt-5-mini',
      prompt: { userText: 'hi' },
      temperature: 0.7,
      timeoutMs: 2000,
    });

    await streamTextWithModelId({
      apiKeys: {
        anthropicApiKey: null,
        googleApiKey: null,
        openaiApiKey: 'k',
        openrouterApiKey: null,
        xaiApiKey: null,
      },
      fetchImpl: globalThis.fetch.bind(globalThis),
      modelId: 'openai/gpt-5-mini',
      prompt: { userText: 'hi' },
      temperature: 0.7,
      timeoutMs: 2000,
    });

    const generateArgs = (mocks.completeSimple.mock.calls[0]?.[2] ?? {}) as Record<string, unknown>;
    const streamArgs = (mocks.streamSimple.mock.calls[0]?.[2] ?? {}) as Record<string, unknown>;

    expect(generateArgs).not.toHaveProperty('temperature');
    expect(streamArgs).not.toHaveProperty('temperature');
  });

  it('forwards temperature for non-GPT-5 OpenAI models', async () => {
    mocks.completeSimple.mockClear();
    mocks.streamSimple.mockClear();

    await generateTextWithModelId({
      apiKeys: {
        anthropicApiKey: null,
        googleApiKey: null,
        openaiApiKey: 'k',
        openrouterApiKey: null,
        xaiApiKey: null,
      },
      fetchImpl: globalThis.fetch.bind(globalThis),
      modelId: 'openai/gpt-4.1',
      prompt: { userText: 'hi' },
      temperature: 0.2,
      timeoutMs: 2000,
    });

    await streamTextWithModelId({
      apiKeys: {
        anthropicApiKey: null,
        googleApiKey: null,
        openaiApiKey: 'k',
        openrouterApiKey: null,
        xaiApiKey: null,
      },
      fetchImpl: globalThis.fetch.bind(globalThis),
      modelId: 'openai/gpt-4.1',
      prompt: { userText: 'hi' },
      temperature: 0.2,
      timeoutMs: 2000,
    });

    const generateArgs = (mocks.completeSimple.mock.calls[0]?.[2] ?? {}) as Record<string, unknown>;
    const streamArgs = (mocks.streamSimple.mock.calls[0]?.[2] ?? {}) as Record<string, unknown>;

    expect(generateArgs).toMatchObject({ temperature: 0.2 });
    expect(streamArgs).toMatchObject({ temperature: 0.2 });
  });

  it('uses Anthropic document calls for PDF prompts', async () => {
    mocks.completeSimple.mockClear();

    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          content: [{ text: 'ok', type: 'text' }],
          usage: { input_tokens: 3, output_tokens: 4 },
        }),
        { headers: { 'content-type': 'application/json' }, status: 200 },
      );
    });

    const pdfBytes = buildMinimalPdf('Hello PDF');
    const result = await generateTextWithModelId({
      apiKeys: {
        anthropicApiKey: 'k',
        googleApiKey: null,
        openaiApiKey: null,
        openrouterApiKey: null,
        xaiApiKey: null,
      },
      fetchImpl: fetchMock as unknown as typeof fetch,
      modelId: 'anthropic/claude-opus-4-5',
      prompt: buildDocumentPrompt({
        text: 'Summarize the attached PDF.',
        bytes: pdfBytes,
        filename: 'test.pdf',
      }),
      timeoutMs: 2000,
    });

    expect(result.text).toBe('ok');
    expect(result.usage).toMatchObject({ completionTokens: 4, promptTokens: 3, totalTokens: 7 });
    expect(mocks.completeSimple).toHaveBeenCalledTimes(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const options = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(options.body));
    expect(body.model).toBe('claude-opus-4-5');
    expect(body.messages?.[0]?.content?.[0]?.type).toBe('document');
    expect(body.messages?.[0]?.content?.[0]?.source?.media_type).toBe('application/pdf');
    expect(typeof body.messages?.[0]?.content?.[0]?.source?.data).toBe('string');
  });

  it('uses OpenAI responses for PDF prompts', async () => {
    mocks.completeSimple.mockClear();
    process.env.OPENAI_BASE_URL = '';

    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          output_text: 'ok',
          usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 },
        }),
        { headers: { 'content-type': 'application/json' }, status: 200 },
      );
    });

    const pdfBytes = buildMinimalPdf('Hello PDF');
    const result = await generateTextWithModelId({
      apiKeys: {
        anthropicApiKey: null,
        googleApiKey: null,
        openaiApiKey: 'k',
        openrouterApiKey: null,
        xaiApiKey: null,
      },
      fetchImpl: fetchMock as unknown as typeof fetch,
      modelId: 'openai/gpt-5.2',
      prompt: buildDocumentPrompt({
        text: 'Summarize the attached PDF.',
        bytes: pdfBytes,
        filename: 'test.pdf',
      }),
      timeoutMs: 2000,
    });

    expect(result.text).toBe('ok');
    expect(result.usage).toMatchObject({ completionTokens: 3, promptTokens: 2, totalTokens: 5 });
    expect(mocks.completeSimple).toHaveBeenCalledTimes(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const options = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(options.body));
    expect(body.model).toBe('gpt-5.2');
    expect(body.input?.[0]?.content?.[0]?.type).toBe('input_file');
    expect(body.input?.[0]?.content?.[0]?.file_data).toMatch(/^data:application\/pdf;base64,/);
  });

  it('uses Gemini inline data for PDF prompts', async () => {
    mocks.completeSimple.mockClear();

    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'ok' }] } }],
          usageMetadata: { candidatesTokenCount: 2, promptTokenCount: 1, totalTokenCount: 3 },
        }),
        { headers: { 'content-type': 'application/json' }, status: 200 },
      );
    });

    const pdfBytes = buildMinimalPdf('Hello PDF');
    const result = await generateTextWithModelId({
      apiKeys: {
        anthropicApiKey: null,
        googleApiKey: 'k',
        openaiApiKey: null,
        openrouterApiKey: null,
        xaiApiKey: null,
      },
      fetchImpl: fetchMock as unknown as typeof fetch,
      modelId: 'google/gemini-3-flash-preview',
      prompt: buildDocumentPrompt({
        text: 'Summarize the attached PDF.',
        bytes: pdfBytes,
        filename: 'test.pdf',
      }),
      timeoutMs: 2000,
    });

    expect(result.text).toBe('ok');
    expect(result.usage).toMatchObject({ completionTokens: 2, promptTokens: 1, totalTokens: 3 });
    expect(mocks.completeSimple).toHaveBeenCalledTimes(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const options = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(options.body));
    expect(body.contents?.[0]?.parts?.[0]?.inline_data?.mime_type).toBe('application/pdf');
    expect(body.contents?.[0]?.parts?.[0]?.inline_data?.data).toBeTypeOf('string');
  });

  it('routes by provider (streamText) and includes maxOutputTokens when set', async () => {
    mocks.streamSimple.mockClear();
    await streamTextWithModelId({
      apiKeys: {
        anthropicApiKey: null,
        googleApiKey: null,
        openaiApiKey: null,
        openrouterApiKey: null,
        xaiApiKey: 'k',
      },
      fetchImpl: globalThis.fetch.bind(globalThis),
      maxOutputTokens: 9,
      modelId: 'xai/grok-4-fast-non-reasoning',
      prompt: { userText: 'hi' },
      timeoutMs: 2000,
    });
    await streamTextWithModelId({
      apiKeys: {
        anthropicApiKey: null,
        googleApiKey: 'k',
        openaiApiKey: null,
        openrouterApiKey: null,
        xaiApiKey: null,
      },
      fetchImpl: globalThis.fetch.bind(globalThis),
      maxOutputTokens: 9,
      modelId: 'google/gemini-3-flash-preview',
      prompt: { userText: 'hi' },
      timeoutMs: 2000,
    });
    await streamTextWithModelId({
      apiKeys: {
        anthropicApiKey: 'k',
        googleApiKey: null,
        openaiApiKey: null,
        openrouterApiKey: null,
        xaiApiKey: null,
      },
      fetchImpl: globalThis.fetch.bind(globalThis),
      maxOutputTokens: 9,
      modelId: 'anthropic/claude-opus-4-5',
      prompt: { userText: 'hi' },
      timeoutMs: 2000,
    });
    await streamTextWithModelId({
      apiKeys: {
        anthropicApiKey: null,
        googleApiKey: null,
        openaiApiKey: 'k',
        openrouterApiKey: null,
        xaiApiKey: null,
      },
      fetchImpl: globalThis.fetch.bind(globalThis),
      maxOutputTokens: 9,
      modelId: 'openai/gpt-5.2',
      prompt: { userText: 'hi' },
      timeoutMs: 2000,
    });
    expect(mocks.streamSimple).toHaveBeenCalledTimes(4);
    for (const call of mocks.streamSimple.mock.calls) {
      const options = (call?.[2] ?? {}) as Record<string, unknown>;
      expect(options).toHaveProperty('maxTokens', 9);
    }
  });

  it('throws a friendly timeout error on AbortError', async () => {
    mocks.completeSimple.mockImplementationOnce(async () => {
      throw new DOMException('aborted', 'AbortError');
    });
    await expect(
      generateTextWithModelId({
        apiKeys: {
          anthropicApiKey: null,
          googleApiKey: null,
          openaiApiKey: 'k',
          openrouterApiKey: null,
          xaiApiKey: null,
        },
        fetchImpl: globalThis.fetch.bind(globalThis),
        maxOutputTokens: 10,
        modelId: 'openai/gpt-5.2',
        prompt: { userText: 'hi' },
        timeoutMs: 1,
      }),
    ).rejects.toThrow(/timed out/i);
  });

  it('retries once when the model returns an empty output', async () => {
    mocks.completeSimple.mockClear();
    mocks.completeSimple.mockImplementationOnce(async () =>
      makeAssistantMessage({ text: '   ', usage: { input: 1, output: 2, totalTokens: 3 } }),
    );
    mocks.completeSimple.mockImplementationOnce(async () =>
      makeAssistantMessage({ text: 'ok', usage: { input: 1, output: 2, totalTokens: 3 } }),
    );

    const result = await generateTextWithModelId({
      apiKeys: {
        anthropicApiKey: null,
        googleApiKey: null,
        openaiApiKey: 'k',
        openrouterApiKey: null,
        xaiApiKey: null,
      },
      fetchImpl: globalThis.fetch.bind(globalThis),
      maxOutputTokens: 10,
      modelId: 'openai/gpt-5.2',
      prompt: { userText: 'hi' },
      retries: 1,
      timeoutMs: 2000,
    });

    expect(result.text).toBe('ok');
    expect(mocks.completeSimple).toHaveBeenCalledTimes(2);
  });

  it('retries GPT-5-family empty outputs once without maxOutputTokens', async () => {
    delete process.env.OPENAI_BASE_URL;
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { max_output_tokens?: number };
        expect(body.max_output_tokens).toBe(200);
        return new Response(JSON.stringify({ output: [{ content: [{ text: '   ' }] }] }), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        });
      })
      .mockImplementationOnce(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { max_output_tokens?: number };
        expect(body).not.toHaveProperty('max_output_tokens');
        return new Response(
          JSON.stringify({ output: [{ content: [{ text: 'ok without cap' }] }] }),
          { headers: { 'content-type': 'application/json' }, status: 200 },
        );
      });

    const result = await generateTextWithModelId({
      apiKeys: {
        anthropicApiKey: null,
        googleApiKey: null,
        openaiApiKey: 'k',
        openrouterApiKey: null,
        xaiApiKey: null,
      },
      fetchImpl: fetchMock as typeof fetch,
      maxOutputTokens: 200,
      modelId: 'openai/gpt-5-mini',
      prompt: { userText: 'hi' },
      timeoutMs: 2000,
    });

    expect(result.text).toBe('ok without cap');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries OpenRouter GPT-5-family empty outputs once without maxOutputTokens', async () => {
    delete process.env.OPENAI_BASE_URL;
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { max_tokens?: number };
        expect(body.max_tokens).toBe(200);
        return new Response(JSON.stringify({ choices: [{ message: { content: null } }] }), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        });
      })
      .mockImplementationOnce(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { max_tokens?: number };
        expect(body).not.toHaveProperty('max_tokens');
        return new Response(
          JSON.stringify({ choices: [{ message: { content: 'ok from openrouter without cap' } }] }),
          { headers: { 'content-type': 'application/json' }, status: 200 },
        );
      });

    const result = await generateTextWithModelId({
      apiKeys: {
        anthropicApiKey: null,
        googleApiKey: null,
        openaiApiKey: null,
        openrouterApiKey: 'k',
        xaiApiKey: null,
      },
      fetchImpl: fetchMock as typeof fetch,
      forceOpenRouter: true,
      maxOutputTokens: 200,
      modelId: 'openai/openai/gpt-5-mini',
      prompt: { userText: 'hi' },
      timeoutMs: 2000,
    });

    expect(result.text).toBe('ok from openrouter without cap');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('falls back from empty Google preview responses to google/gemini-2.5-flash', async () => {
    mocks.completeSimple.mockClear();
    mocks.completeSimple.mockImplementationOnce(async (model: MockModel) =>
      makeAssistantMessage({
        api: 'google-generative-ai',
        model: model.id,
        provider: 'google',
        text: '   ',
        usage: { input: 1, output: 2, totalTokens: 3 },
      }),
    );
    mocks.completeSimple.mockImplementationOnce(async (model: MockModel) =>
      makeAssistantMessage({
        api: 'google-generative-ai',
        model: model.id,
        provider: 'google',
        text: 'ok',
        usage: { input: 1, output: 2, totalTokens: 3 },
      }),
    );

    const result = await generateTextWithModelId({
      apiKeys: {
        anthropicApiKey: null,
        googleApiKey: 'k',
        openaiApiKey: null,
        openrouterApiKey: null,
        xaiApiKey: null,
      },
      fetchImpl: globalThis.fetch.bind(globalThis),
      maxOutputTokens: 10,
      modelId: 'google/gemini-3-flash-preview',
      prompt: { userText: 'hi' },
      timeoutMs: 2000,
    });

    expect(result.text).toBe('ok');
    expect(result.canonicalModelId).toBe('google/gemini-2.5-flash');
    expect((mocks.completeSimple.mock.calls[0]?.[0] as MockModel).id).toBe(
      'gemini-3-flash-preview',
    );
    expect((mocks.completeSimple.mock.calls[1]?.[0] as MockModel).id).toBe('gemini-2.5-flash');
  });

  it('accepts Google thinking-only responses without failing empty-summary', async () => {
    mocks.completeSimple.mockReset();
    mocks.completeSimple.mockImplementation(async (model: MockModel) =>
      makeAssistantMessage({
        api: model.api,
        model: model.id,
        provider: model.provider,
        text: 'ok',
        usage: { input: 1, output: 2, totalTokens: 3 },
      }),
    );
    mocks.completeSimple.mockImplementationOnce(async () => ({
      ...makeAssistantMessage({
        api: 'google-generative-ai',
        model: 'gemini-3-flash-preview',
        provider: 'google',
        usage: { input: 1, output: 2, totalTokens: 3 },
      }),
      content: [{ thinking: 'ok from thinking', type: 'thinking' as const }],
    }));

    const result = await generateTextWithModelId({
      apiKeys: {
        anthropicApiKey: null,
        googleApiKey: 'k',
        openaiApiKey: null,
        openrouterApiKey: null,
        xaiApiKey: null,
      },
      fetchImpl: globalThis.fetch.bind(globalThis),
      maxOutputTokens: 10,
      modelId: 'google/gemini-3-flash-preview',
      prompt: { userText: 'hi' },
      timeoutMs: 2000,
    });

    expect(result.text.trim().length).toBeGreaterThan(0);
  });

  it('falls back from empty Google preview document responses to google/gemini-2.5-flash', async () => {
    mocks.completeSimple.mockClear();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.includes('models/gemini-3-flash-preview:generateContent')
        ? {
            candidates: [{ content: { parts: [] } }],
            usageMetadata: { candidatesTokenCount: 2, promptTokenCount: 1, totalTokenCount: 3 },
          }
        : {
            candidates: [{ content: { parts: [{ text: 'ok from document fallback' }] } }],
            usageMetadata: { candidatesTokenCount: 2, promptTokenCount: 1, totalTokenCount: 3 },
          };
      return new Response(JSON.stringify(body), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      });
    });

    const pdfBytes = buildMinimalPdf('Hello PDF');
    const result = await generateTextWithModelId({
      apiKeys: {
        anthropicApiKey: null,
        googleApiKey: 'k',
        openaiApiKey: null,
        openrouterApiKey: null,
        xaiApiKey: null,
      },
      fetchImpl: fetchMock as unknown as typeof fetch,
      modelId: 'google/gemini-3-flash-preview',
      prompt: buildDocumentPrompt({
        text: 'Summarize the attached PDF.',
        bytes: pdfBytes,
        filename: 'test.pdf',
      }),
      timeoutMs: 2000,
    });

    expect(result.text).toBe('ok from document fallback');
    expect(result.canonicalModelId).toBe('google/gemini-2.5-flash');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('models/gemini-3-flash-preview');
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('models/gemini-2.5-flash');
  });

  it('surfaces embedded Google API errors instead of reporting an empty summary', async () => {
    mocks.completeSimple.mockClear();
    mocks.completeSimple.mockImplementationOnce(async () => ({
      api: 'google-generative-ai',
      content: [],
      errorMessage: JSON.stringify({
        error: {
          message: JSON.stringify({
            error: {
              code: 404,
              message:
                'models/gemini-3-flash is not found for API version v1beta, or is not supported for generateContent. Call ListModels to see the list of available models and their supported methods.',
              status: 'NOT_FOUND',
            },
          }),
          code: 404,
          status: 'Not Found',
        },
      }),
      model: 'gemini-3-flash',
      provider: 'google',
      role: 'assistant',
      stopReason: 'error',
      timestamp: Date.now(),
      usage: {
        cacheRead: 0,
        cacheWrite: 0,
        cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
        input: 0,
        output: 0,
        totalTokens: 0,
      },
    }));

    await expect(
      generateTextWithModelId({
        apiKeys: {
          anthropicApiKey: null,
          googleApiKey: 'k',
          openaiApiKey: null,
          openrouterApiKey: null,
          xaiApiKey: null,
        },
        fetchImpl: globalThis.fetch.bind(globalThis),
        maxOutputTokens: 10,
        modelId: 'google/gemini-3-flash',
        prompt: { userText: 'hi' },
        timeoutMs: 2000,
      }),
    ).rejects.toThrow(/Google API rejected model "gemini-3-flash"/);
  });

  it('enforces missing-key errors per provider', async () => {
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
        modelId: 'google/gemini-3-flash-preview',
        prompt: { userText: 'hi' },
        timeoutMs: 2000,
      }),
    ).rejects.toThrow(/GEMINI_API_KEY/i);

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
        modelId: 'xai/grok-4-fast-non-reasoning',
        prompt: { userText: 'hi' },
        timeoutMs: 2000,
      }),
    ).rejects.toThrow(/XAI_API_KEY/i);

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
        modelId: 'anthropic/claude-opus-4-5',
        prompt: { userText: 'hi' },
        timeoutMs: 2000,
      }),
    ).rejects.toThrow(/ANTHROPIC_API_KEY/i);
  });

  it('uses chat completions for custom OPENAI_BASE_URL and skips OpenRouter headers', async () => {
    process.env.OPENAI_BASE_URL = 'https://openai.example.com/v1';
    mocks.completeSimple.mockClear();

    await generateTextWithModelId({
      apiKeys: {
        anthropicApiKey: null,
        googleApiKey: null,
        openaiApiKey: 'openai-key',
        openrouterApiKey: 'openrouter-key',
        xaiApiKey: null,
      },
      fetchImpl: globalThis.fetch.bind(globalThis),
      modelId: 'openai/gpt-5.2',
      prompt: { userText: 'hi' },
      timeoutMs: 2000,
    });

    const model = mocks.completeSimple.mock.calls[0]?.[0] as { baseUrl?: string; api?: string };
    expect(model.baseUrl).toBe('https://openai.example.com/v1');
    expect(model.api).toBe('openai-completions');

    const {headers} = (
      mocks.completeSimple.mock.calls[0]?.[0] as { headers?: Record<string, string> }
    );
    expect(headers?.['HTTP-Referer'] ?? null).toBeNull();
  });

  it('adds OpenRouter headers and forces chat completions when OPENROUTER_API_KEY is set', async () => {
    delete process.env.OPENAI_BASE_URL;
    mocks.completeSimple.mockClear();

    await generateTextWithModelId({
      apiKeys: {
        anthropicApiKey: null,
        googleApiKey: null,
        openaiApiKey: null,
        openrouterApiKey: 'openrouter-key',
        xaiApiKey: null,
      },
      fetchImpl: globalThis.fetch.bind(globalThis),
      modelId: 'openai/openai/gpt-oss-20b',
      prompt: { userText: 'hi' },
      timeoutMs: 2000,
    });

    const model = mocks.completeSimple.mock.calls[0]?.[0] as {
      baseUrl?: string;
      api?: string;
      headers?: Record<string, string>;
    };
    expect(model.baseUrl).toBe('https://openrouter.ai/api/v1');
    expect(model.api).toBe('openai-completions');
    expect(model.headers?.['HTTP-Referer']).toBe('https://github.com/steipete/summarize');
    expect(model.headers?.['X-Title']).toBe('summarize');
  });

  it('uses the GitHub Models chat-completions endpoint for github-copilot ids', async () => {
    mocks.completeSimple.mockClear();
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(_input)).toBe('https://models.github.ai/inference/chat/completions');
        expect((init?.headers as Record<string, string>)?.Accept).toBe(
          'application/vnd.github+json',
        );
        expect((init?.headers as Record<string, string>)?.['X-GitHub-Api-Version']).toBe(
          '2026-03-10',
        );
        const body = JSON.parse(String(init?.body)) as {
          model: string;
          messages: { role: string; content: string }[];
        };
        expect(body.model).toBe('openai/gpt-5.4');
        expect(body.messages.at(-1)).toEqual({ content: 'hi', role: 'user' });
        return new Response(JSON.stringify({ error: 'server error' }), { status: 500 });
      })
      .mockImplementationOnce(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as {
          model: string;
          messages: { role: string; content: string }[];
        };
        expect(body.model).toBe('openai/gpt-5-chat');
        expect(body.messages.at(-1)).toEqual({ content: 'hi', role: 'user' });
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: 'ok from github models', role: 'assistant' } }],
            usage: { completion_tokens: 2, prompt_tokens: 1, total_tokens: 3 },
          }),
          { headers: { 'content-type': 'application/json' }, status: 200 },
        );
      });

    try {
      vi.stubGlobal('fetch', fetchMock);
      const result = await generateTextWithModelId({
        apiKeys: {
          anthropicApiKey: null,
          googleApiKey: null,
          openaiApiKey: 'gh-token',
          openrouterApiKey: null,
          xaiApiKey: null,
        },
        fetchImpl: fetchMock as typeof fetch,
        modelId: 'github-copilot/gpt-5.4',
        prompt: { userText: 'hi' },
        timeoutMs: 2000,
      });

      expect(result.text).toBe('ok from github models');
      expect(result.canonicalModelId).toBe('github-copilot/openai/gpt-5-chat');
      expect(result.provider).toBe('github-copilot');
      expect(mocks.completeSimple).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('omits temperature for GitHub Models GPT-5-family ids', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { model: string; temperature?: number };
      expect(body.model).toBe('openai/gpt-5');
      expect(body).not.toHaveProperty('temperature');
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'ok from gpt-5', role: 'assistant' } }],
          usage: { completion_tokens: 2, prompt_tokens: 1, total_tokens: 3 },
        }),
        { headers: { 'content-type': 'application/json' }, status: 200 },
      );
    });

    try {
      vi.stubGlobal('fetch', fetchMock);
      const result = await generateTextWithModelId({
        apiKeys: {
          anthropicApiKey: null,
          googleApiKey: null,
          openaiApiKey: 'gh-token',
          openrouterApiKey: null,
          xaiApiKey: null,
        },
        fetchImpl: fetchMock as typeof fetch,
        modelId: 'github-copilot/gpt-5',
        prompt: { userText: 'hi' },
        temperature: 0.3,
        timeoutMs: 2000,
      });

      expect(result.text).toBe('ok from gpt-5');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('applies provider baseUrl overrides (google/xai/zai)', async () => {
    mocks.completeSimple.mockClear();

    await generateTextWithModelId({
      apiKeys: {
        anthropicApiKey: null,
        googleApiKey: 'k',
        openaiApiKey: null,
        openrouterApiKey: null,
        xaiApiKey: null,
      },
      fetchImpl: globalThis.fetch.bind(globalThis),
      googleBaseUrlOverride: 'https://google-proxy.example.com',
      modelId: 'google/gemini-3-flash-preview',
      prompt: { userText: 'hi' },
      timeoutMs: 2000,
    });

    const googleModel = mocks.completeSimple.mock.calls[0]?.[0] as { baseUrl?: string };
    expect(googleModel.baseUrl).toBe('https://google-proxy.example.com');

    mocks.completeSimple.mockClear();
    await generateTextWithModelId({
      apiKeys: {
        anthropicApiKey: null,
        googleApiKey: null,
        openaiApiKey: null,
        openrouterApiKey: null,
        xaiApiKey: 'k',
      },
      fetchImpl: globalThis.fetch.bind(globalThis),
      modelId: 'xai/grok-4-fast-non-reasoning',
      prompt: { userText: 'hi' },
      timeoutMs: 2000,
      xaiBaseUrlOverride: 'https://xai-proxy.example.com/v1',
    });

    const xaiModel = mocks.completeSimple.mock.calls[0]?.[0] as { baseUrl?: string };
    expect(xaiModel.baseUrl).toBe('https://xai-proxy.example.com/v1');

    mocks.completeSimple.mockClear();
    await generateTextWithModelId({
      apiKeys: {
        anthropicApiKey: null,
        googleApiKey: null,
        openaiApiKey: 'k',
        openrouterApiKey: null,
        xaiApiKey: null,
      },
      fetchImpl: globalThis.fetch.bind(globalThis),
      modelId: 'zai/glm-4.7',
      openaiBaseUrlOverride: 'https://zai-proxy.example.com/v4',
      prompt: { userText: 'hi' },
      timeoutMs: 2000,
    });

    const zaiModel = mocks.completeSimple.mock.calls[0]?.[0] as { baseUrl?: string };
    expect(zaiModel.baseUrl).toBe('https://zai-proxy.example.com/v4');
  });

  it('wraps anthropic model access errors with a helpful message', async () => {
    mocks.completeSimple.mockImplementationOnce(async () => {
      const error = Object.assign(new Error('model: claude-3-5-sonnet-latest'), {
        responseBody: JSON.stringify({
          type: 'error',
          error: { type: 'not_found_error', message: 'model: claude-3-5-sonnet-latest' },
        }),
        statusCode: 404,
      });
      throw error;
    });

    await expect(
      generateTextWithModelId({
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
      }),
    ).rejects.toThrow(/Anthropic API rejected model "claude-3-5-sonnet-latest"/i);

    mocks.streamSimple.mockImplementationOnce(() => {
      const error = Object.assign(new Error('model: claude-3-5-sonnet-latest'), {
        responseBody: JSON.stringify({
          type: 'error',
          error: { type: 'permission_error', message: 'model: claude-3-5-sonnet-latest' },
        }),
        statusCode: 403,
      });
      throw error;
    });

    await expect(
      streamTextWithModelId({
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
      }),
    ).rejects.toThrow(/Anthropic API rejected model "claude-3-5-sonnet-latest"/i);
  });

  it('throws a friendly timeout error on AbortError (streamText)', async () => {
    mocks.streamSimple.mockImplementationOnce(() => {
      throw new DOMException('aborted', 'AbortError');
    });
    await expect(
      streamTextWithModelId({
        apiKeys: {
          anthropicApiKey: null,
          googleApiKey: null,
          openaiApiKey: 'k',
          openrouterApiKey: null,
          xaiApiKey: null,
        },
        fetchImpl: globalThis.fetch.bind(globalThis),
        maxOutputTokens: 10,
        modelId: 'openai/gpt-5.2',
        prompt: { userText: 'hi' },
        timeoutMs: 1,
      }),
    ).rejects.toThrow(/timed out/i);
  });

  it('times out when a stream stalls before yielding', async () => {
    mocks.streamSimple.mockImplementationOnce(() => ({
      async *[Symbol.asyncIterator]() {
        await new Promise(() => {});
      },
      result: async () => makeAssistantMessage({ text: 'ok' }),
    }));
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
      modelId: 'openai/gpt-5.2',
      prompt: { userText: 'hi' },
      timeoutMs: 5,
    });
    const iterator = result.textStream[Symbol.asyncIterator]();
    const nextPromise = iterator.next();
    await expect(nextPromise).rejects.toThrow(/timed out/i);
  }, 250);

  it('resolves stream usage as null when stream.result() never settles', async () => {
    const finalMessage = makeAssistantMessage({ text: 'ok' });
    mocks.streamSimple.mockImplementationOnce(() => ({
      async *[Symbol.asyncIterator]() {
        yield { contentIndex: 0, delta: 'ok', partial: finalMessage, type: 'text_delta' as const };
        yield { message: finalMessage, reason: 'stop' as const, type: 'done' as const };
      },
      async result() {
        await new Promise(() => {});
      },
    }));

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
      modelId: 'openai/gpt-5.2',
      prompt: { userText: 'hi' },
      timeoutMs: 20,
    });

    let streamed = '';
    for await (const delta of result.textStream) {streamed += delta;}
    expect(streamed).toBe('ok');
    await expect(result.usage).resolves.toBeNull();
  });
});
