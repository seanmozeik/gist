import { describe, expect, it, vi } from 'vitest';

const generateTextWithModelIdMock = vi.fn(async () => ({
  canonicalModelId: 'openai/gpt-5.2',
  provider: 'openai',
  text: '# Hello',
}));

vi.mock('../src/llm/generate-text.js', () => ({
  generateTextWithModelId: generateTextWithModelIdMock,
}));

describe('HTML→Markdown converter', async () => {
  const { createHtmlToMarkdownConverter } = await import('../src/llm/html-to-markdown.js');

  it('passes system + prompt to generateTextWithModelId', async () => {
    generateTextWithModelIdMock.mockClear();

    const converter = createHtmlToMarkdownConverter({
      fetchImpl: globalThis.fetch.bind(globalThis),
      googleApiKey: null,
      modelId: 'openai/gpt-5.2',
      openaiApiKey: 'test',
      openrouterApiKey: null,
      xaiApiKey: null,
    });

    const result = await converter({
      html: '<html><body><h1>Hello</h1></body></html>',
      siteName: 'Example',
      timeoutMs: 2000,
      title: 'Example',
      url: 'https://example.com',
    });

    expect(result).toBe('# Hello');
    expect(generateTextWithModelIdMock).toHaveBeenCalledTimes(1);
    const args = generateTextWithModelIdMock.mock.calls[0]?.[0] as {
      prompt: { system?: string; userText: string };
      modelId: string;
    };
    expect(args.modelId).toBe('openai/gpt-5.2');
    expect(args.prompt.system).toContain('You convert HTML');
    expect(args.prompt.userText).toContain('URL: https://example.com');
    expect(args.prompt.userText).toContain('<h1>Hello</h1>');
  });

  it('truncates very large HTML inputs', async () => {
    generateTextWithModelIdMock.mockClear();

    const converter = createHtmlToMarkdownConverter({
      fetchImpl: globalThis.fetch.bind(globalThis),
      googleApiKey: null,
      modelId: 'openai/gpt-5.2',
      openaiApiKey: 'test',
      openrouterApiKey: null,
      xaiApiKey: null,
    });

    const html = `<html><body>${'A'.repeat(200_005)}MARKER</body></html>`;
    await converter({
      html,
      siteName: null,
      timeoutMs: 2000,
      title: null,
      url: 'https://example.com',
    });

    const args = generateTextWithModelIdMock.mock.calls[0]?.[0] as { prompt: { userText: string } };
    expect(args.prompt.userText).not.toContain('MARKER');
  });

  it('does not forward OpenRouter provider options to generateTextWithModelId', async () => {
    generateTextWithModelIdMock.mockClear();

    const converter = createHtmlToMarkdownConverter({
      fetchImpl: globalThis.fetch.bind(globalThis),
      googleApiKey: null,
      modelId: 'openai/openai/gpt-oss-20b',
      openaiApiKey: null,
      openrouterApiKey: 'test',
      xaiApiKey: null,
    });

    await converter({
      html: '<html><body><h1>Hello</h1></body></html>',
      siteName: 'Example',
      timeoutMs: 2000,
      title: 'Example',
      url: 'https://example.com',
    });

    const args = generateTextWithModelIdMock.mock.calls[0]?.[0] as { openrouter?: unknown };
    expect(args.openrouter).toBeUndefined();
  });
});
