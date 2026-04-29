import { describe, expect, it, vi } from 'vitest';

import { buildMinimalPdf } from './helpers/pdf.js';

const mocks = vi.hoisted(() => ({ completeSimple: vi.fn() }));

vi.mock('@mariozechner/pi-ai', () => ({ completeSimple: mocks.completeSimple }));

import {
  completeOpenAiDocument,
  completeOpenAiText,
  resolveOpenAiClientConfig,
} from '../src/llm/providers/openai.js';

describe('openai provider helpers', () => {
  it('resolves openrouter config from keys and forced mode', () => {
    expect(
      resolveOpenAiClientConfig({ apiKeys: { openaiApiKey: null, openrouterApiKey: 'or-key' } }),
    ).toEqual({
      apiKey: 'or-key',
      baseURL: 'https://openrouter.ai/api/v1',
      isOpenRouter: true,
      useChatCompletions: true,
    });

    expect(
      resolveOpenAiClientConfig({
        apiKeys: { openaiApiKey: 'oa-key', openrouterApiKey: null },
        forceOpenRouter: true,
      }),
    ).toEqual({
      apiKey: 'oa-key',
      baseURL: 'https://openrouter.ai/api/v1',
      isOpenRouter: true,
      useChatCompletions: true,
    });
  });

  it('handles custom and invalid base URLs', () => {
    expect(
      resolveOpenAiClientConfig({
        apiKeys: { openaiApiKey: 'oa-key', openrouterApiKey: null },
        openaiBaseUrlOverride: 'https://gateway.example/v1',
      }),
    ).toEqual({
      apiKey: 'oa-key',
      baseURL: 'https://gateway.example/v1',
      isOpenRouter: false,
      useChatCompletions: true,
    });

    expect(
      resolveOpenAiClientConfig({
        apiKeys: { openaiApiKey: 'oa-key', openrouterApiKey: null },
        openaiBaseUrlOverride: 'not a url',
      }),
    ).toEqual({
      apiKey: 'oa-key',
      baseURL: 'not a url',
      isOpenRouter: false,
      useChatCompletions: false,
    });
  });

  it('raises missing key errors for OpenAI and OpenRouter modes', () => {
    expect(() =>
      resolveOpenAiClientConfig({ apiKeys: { openaiApiKey: null, openrouterApiKey: null } }),
    ).toThrow(/Missing OPENAI_API_KEY/);

    expect(() =>
      resolveOpenAiClientConfig({
        apiKeys: { openaiApiKey: null, openrouterApiKey: null },
        forceOpenRouter: true,
      }),
    ).toThrow(/Missing OPENROUTER_API_KEY/);
  });

  it('builds OpenAI document response URLs for /responses, /v1, and root bases', async () => {
    const pdfBytes = buildMinimalPdf('Hello PDF');
    const fetchMock = vi.fn(async () => {
      return Response.json(
        {
          output: [{ content: [{ text: 'ok' }] }],
          usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
        },
        { headers: { 'content-type': 'application/json' }, status: 200 },
      );
    });

    const promptText = 'Summarize';
    const document = {
      bytes: pdfBytes,
      filename: 'test.pdf',
      kind: 'document' as const,
      mediaType: 'application/pdf',
    };

    for (const baseURL of [
      'https://api.openai.com/responses',
      'https://api.openai.com/v1',
      'https://api.openai.com',
    ]) {
      const result = await completeOpenAiDocument({
        document,
        fetchImpl: fetchMock as unknown as typeof fetch,
        modelId: 'gpt-5.2',
        openaiConfig: { apiKey: 'oa-key', baseURL, isOpenRouter: false, useChatCompletions: true },
        promptText,
        timeoutMs: 2000,
      });

      expect(result.text).toBe('ok');
    }

    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      'https://api.openai.com/responses',
      'https://api.openai.com/v1/responses',
      'https://api.openai.com/v1/responses',
    ]);
  });

  it('rejects unsupported document attachment backends', async () => {
    const pdfBytes = buildMinimalPdf('Hello PDF');
    const document = {
      bytes: pdfBytes,
      filename: 'test.pdf',
      kind: 'document' as const,
      mediaType: 'application/pdf',
    };

    await expect(
      completeOpenAiDocument({
        document,
        fetchImpl: globalThis.fetch.bind(globalThis),
        modelId: 'gpt-5.2',
        openaiConfig: {
          apiKey: 'oa-key',
          baseURL: 'https://openrouter.ai/api/v1',
          isOpenRouter: true,
          useChatCompletions: true,
        },
        promptText: 'Summarize',
        timeoutMs: 2000,
      }),
    ).rejects.toThrow(/OpenRouter does not support PDF attachments/);

    await expect(
      completeOpenAiDocument({
        document,
        fetchImpl: globalThis.fetch.bind(globalThis),
        modelId: 'gpt-5.2',
        openaiConfig: {
          apiKey: 'oa-key',
          baseURL: 'https://gateway.example/v1',
          isOpenRouter: false,
          useChatCompletions: true,
        },
        promptText: 'Summarize',
        timeoutMs: 2000,
      }),
    ).rejects.toThrow(/Document attachments require api.openai.com/);
  });

  it('rejects non-document attachments for the document API', async () => {
    await expect(
      completeOpenAiDocument({
        document: {
          bytes: new Uint8Array([1, 2, 3]),
          filename: 'test.png',
          kind: 'image',
          mediaType: 'image/png',
        },
        fetchImpl: globalThis.fetch.bind(globalThis),
        modelId: 'gpt-5.2',
        openaiConfig: {
          apiKey: 'oa-key',
          baseURL: 'https://api.openai.com/v1',
          isOpenRouter: false,
          useChatCompletions: true,
        },
        promptText: 'Summarize',
        timeoutMs: 2000,
      }),
    ).rejects.toThrow(/expected a document attachment/);
  });

  it('surfaces document API failures and empty document outputs', async () => {
    const pdfBytes = buildMinimalPdf('Hello PDF');
    const document = {
      bytes: pdfBytes,
      filename: 'test.pdf',
      kind: 'document' as const,
      mediaType: 'application/pdf',
    };

    await expect(
      completeOpenAiDocument({
        document,
        fetchImpl: (async () => Response.json({ error: 'boom' }, { status: 500 })) as typeof fetch,
        modelId: 'gpt-5.2',
        openaiConfig: {
          apiKey: 'oa-key',
          baseURL: 'https://api.openai.com/v1',
          isOpenRouter: false,
          useChatCompletions: true,
        },
        promptText: 'Summarize',
        timeoutMs: 2000,
      }),
    ).rejects.toThrow(/OpenAI API error \(500\)/);

    await expect(
      completeOpenAiDocument({
        document,
        fetchImpl: (async () =>
          Response.json(
            { output: [{ content: [{ text: '   ' }] }] },
            { status: 200 },
          )) as typeof fetch,
        modelId: 'gpt-5.2',
        openaiConfig: {
          apiKey: 'oa-key',
          baseURL: 'https://api.openai.com/v1',
          isOpenRouter: false,
          useChatCompletions: true,
        },
        promptText: 'Summarize',
        timeoutMs: 2000,
      }),
    ).rejects.toThrow(/empty summary/);
  });

  it('reads GitHub chat completion arrays and rejects empty results', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => {
        return Response.json(
          {
            choices: [
              {
                message: {
                  content: [
                    { text: 'Hello', type: 'text' },
                    { text: ' world', type: 'text' },
                  ],
                },
              },
            ],
            usage: { completion_tokens: 2, prompt_tokens: 1, total_tokens: 3 },
          },
          { headers: { 'content-type': 'application/json' }, status: 200 },
        );
      })
      .mockImplementationOnce(async () => {
        return Response.json(
          { choices: [{ message: { content: [{ image_url: 'x', type: 'image' }] } }] },
          { headers: { 'content-type': 'application/json' }, status: 200 },
        );
      });

    const originalFetch = globalThis.fetch;
    vi.stubGlobal('fetch', fetchMock);
    try {
      const context = {
        messages: [
          { content: 'hello', role: 'user' as const },
          { content: [{ text: 'seen', type: 'text' as const }], role: 'assistant' as const },
        ],
        systemPrompt: 'system',
      };

      const result = await completeOpenAiText({
        context,
        modelId: 'openai/gpt-4.1',
        openaiConfig: {
          apiKey: 'gh-key',
          baseURL: 'https://models.github.ai/inference',
          extraHeaders: { Accept: 'application/vnd.github+json' },
          isOpenRouter: false,
          useChatCompletions: true,
        },
        signal: new AbortController().signal,
      });

      expect(result.text).toBe('Hello world');

      await expect(
        completeOpenAiText({
          context,
          modelId: 'openai/gpt-4.1',
          openaiConfig: {
            apiKey: 'gh-key',
            baseURL: 'https://models.github.ai/inference',
            isOpenRouter: false,
            useChatCompletions: true,
          },
          signal: new AbortController().signal,
        }),
      ).rejects.toThrow(/empty summary/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('uses the Responses API for OpenAI GPT-5-family text models', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.openai.com/v1/responses');
      const body = JSON.parse(String(init?.body)) as {
        model: string;
        instructions?: string;
        input: { role: string; content: { type: string; text: string }[] }[];
      };
      expect(body.model).toBe('gpt-5.4');
      expect(body.instructions).toBe('system');
      expect(body.input).toEqual([
        { content: [{ text: 'hello', type: 'input_text' }], role: 'user' },
        { content: [{ text: 'seen', type: 'input_text' }], role: 'assistant' },
      ]);
      return Response.json(
        {
          output: [{ content: [{ text: 'Hello from responses' }] }],
          usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
        },
        { headers: { 'content-type': 'application/json' }, status: 200 },
      );
    });

    const result = await completeOpenAiText({
      context: {
        messages: [
          { content: 'hello', role: 'user' },
          { content: [{ text: 'seen', type: 'text' }], role: 'assistant' },
        ],
        systemPrompt: 'system',
      },
      fetchImpl: fetchMock as typeof fetch,
      modelId: 'gpt-5.4',
      openaiConfig: {
        apiKey: 'oa-key',
        baseURL: 'https://api.openai.com/v1',
        isOpenRouter: false,
        useChatCompletions: false,
      },
      signal: new AbortController().signal,
    });

    expect(result.text).toBe('Hello from responses');
    expect(result.resolvedModelId).toBe('gpt-5.4');
  });

  it('forwards OpenAI Responses request options', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        service_tier?: string;
        reasoning?: { effort?: string };
        text?: { verbosity?: string };
      };
      expect(body.service_tier).toBe('priority');
      expect(body.reasoning?.effort).toBe('medium');
      expect(body.text?.verbosity).toBe('low');
      return Response.json(
        { output_text: 'ok' },
        { headers: { 'content-type': 'application/json' }, status: 200 },
      );
    });

    const result = await completeOpenAiText({
      context: { messages: [{ content: 'hello', role: 'user' }], systemPrompt: null },
      fetchImpl: fetchMock as typeof fetch,
      modelId: 'gpt-5.5',
      openaiConfig: {
        apiKey: 'oa-key',
        baseURL: 'https://api.openai.com/v1',
        isOpenRouter: false,
        requestOptions: { reasoningEffort: 'medium', serviceTier: 'fast', textVerbosity: 'low' },
        useChatCompletions: false,
      },
      signal: new AbortController().signal,
    });

    expect(result.text).toBe('ok');
  });

  it('forwards OpenAI Chat Completions request options', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        service_tier?: string;
        reasoning_effort?: string;
        verbosity?: string;
      };
      expect(body.service_tier).toBe('priority');
      expect(body.reasoning_effort).toBe('low');
      expect(body.verbosity).toBe('high');
      return Response.json(
        { choices: [{ message: { content: 'ok' } }] },
        { headers: { 'content-type': 'application/json' }, status: 200 },
      );
    });

    const result = await completeOpenAiText({
      context: { messages: [{ content: 'hello', role: 'user' }], systemPrompt: null },
      fetchImpl: fetchMock as typeof fetch,
      modelId: 'gpt-5.5',
      openaiConfig: {
        apiKey: 'oa-key',
        baseURL: 'https://api.openai.com/v1',
        isOpenRouter: false,
        requestOptions: { reasoningEffort: 'low', serviceTier: 'fast', textVerbosity: 'high' },
        useChatCompletions: true,
      },
      signal: new AbortController().signal,
    });

    expect(result.text).toBe('ok');
  });

  it('uses chat completions directly for OpenRouter GPT-5-family text models', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://openrouter.ai/api/v1/chat/completions');
      expect((init?.headers as Record<string, string>)?.['HTTP-Referer']).toBe(
        'https://github.com/steipete/summarize',
      );
      expect((init?.headers as Record<string, string>)?.['X-Title']).toBe('summarize');
      const body = JSON.parse(String(init?.body)) as {
        model: string;
        messages: { role: string; content: string }[];
      };
      expect(body.model).toBe('openai/gpt-5-mini');
      expect(body.messages).toEqual([{ content: 'hello', role: 'user' }]);
      return Response.json(
        {
          choices: [{ message: { content: 'Hello from OpenRouter' } }],
          usage: { completion_tokens: 2, prompt_tokens: 1, total_tokens: 3 },
        },
        { headers: { 'content-type': 'application/json' }, status: 200 },
      );
    });

    const result = await completeOpenAiText({
      context: { messages: [{ content: 'hello', role: 'user' }], systemPrompt: null },
      fetchImpl: fetchMock as typeof fetch,
      modelId: 'openai/gpt-5-mini',
      openaiConfig: {
        apiKey: 'or-key',
        baseURL: 'https://openrouter.ai/api/v1',
        isOpenRouter: true,
        useChatCompletions: true,
      },
      signal: new AbortController().signal,
    });

    expect(result.text).toBe('Hello from OpenRouter');
    expect(result.resolvedModelId).toBe('openai/gpt-5-mini');
  });

  it('falls back GitHub GPT-5-family requests to gpt-5-chat when the direct id fails', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { model: string };
        expect(body.model).toBe('openai/gpt-5.4');
        return Response.json({ error: 'server error' }, { status: 500 });
      })
      .mockImplementationOnce(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { model: string };
        expect(body.model).toBe('openai/gpt-5-chat');
        return Response.json(
          {
            choices: [{ message: { content: 'Hello from GitHub compat' } }],
            usage: { completion_tokens: 2, prompt_tokens: 1, total_tokens: 3 },
          },
          { headers: { 'content-type': 'application/json' }, status: 200 },
        );
      });

    const result = await completeOpenAiText({
      context: { messages: [{ content: 'hello', role: 'user' }], systemPrompt: null },
      fetchImpl: fetchMock as typeof fetch,
      modelId: 'openai/gpt-5.4',
      openaiConfig: {
        apiKey: 'gh-key',
        baseURL: 'https://models.github.ai/inference',
        isOpenRouter: false,
        useChatCompletions: true,
      },
      signal: new AbortController().signal,
    });

    expect(result.text).toBe('Hello from GitHub compat');
    expect(result.resolvedModelId).toBe('openai/gpt-5-chat');
  });

  it('surfaces GitHub chat completion HTTP errors', async () => {
    const originalFetch = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ error: 'denied' }, { status: 403 })),
    );
    try {
      await expect(
        completeOpenAiText({
          context: { messages: [{ content: 'hello', role: 'user' }], systemPrompt: null },
          modelId: 'openai/gpt-4.1',
          openaiConfig: {
            apiKey: 'gh-key',
            baseURL: 'https://models.github.ai/inference',
            isOpenRouter: false,
            useChatCompletions: true,
          },
          signal: new AbortController().signal,
        }),
      ).rejects.toThrow(/OpenAI API error \(403\)/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('surfaces GitHub Models 429 errors with rate-limit guidance', async () => {
    const originalFetch = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ error: 'rate_limited' }, { status: 429 })),
    );
    try {
      await expect(
        completeOpenAiText({
          context: { messages: [{ content: 'hello', role: 'user' }], systemPrompt: null },
          modelId: 'openai/gpt-5.4-mini',
          openaiConfig: {
            apiKey: 'gh-key',
            baseURL: 'https://models.github.ai/inference',
            isOpenRouter: false,
            useChatCompletions: true,
          },
          signal: new AbortController().signal,
        }),
      ).rejects.toThrow(/GitHub Models rate limit exceeded \(429\)/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
