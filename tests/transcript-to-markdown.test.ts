import { describe, expect, it, vi } from 'vitest';

const generateTextWithModelIdMock = vi.fn(async () => ({
  canonicalModelId: 'openai/gpt-5.2',
  provider: 'openai',
  text: '# Formatted Transcript\n\nThis is a well-structured transcript.',
  usage: null,
}));

vi.mock('../src/llm/generate-text.js', () => ({
  generateTextWithModelId: generateTextWithModelIdMock,
}));

describe('Transcript→Markdown converter', async () => {
  const { createTranscriptToMarkdownConverter } =
    await import('../src/llm/transcript-to-markdown.js');

  it('passes system + prompt to generateTextWithModelId', async () => {
    generateTextWithModelIdMock.mockClear();

    const converter = createTranscriptToMarkdownConverter({
      anthropicApiKey: null,
      fetchImpl: globalThis.fetch.bind(globalThis),
      googleApiKey: null,
      modelId: 'openai/gpt-5.2',
      openaiApiKey: 'test',
      openrouterApiKey: null,
      xaiApiKey: null,
    });

    const result = await converter({
      source: 'YouTube',
      timeoutMs: 2000,
      title: 'How to Speak',
      transcript: 'SPEAKER: Hello everyone. Um, today we will talk about speaking.',
    });

    expect(result).toBe('# Formatted Transcript\n\nThis is a well-structured transcript.');
    expect(generateTextWithModelIdMock).toHaveBeenCalledTimes(1);
    const args = generateTextWithModelIdMock.mock.calls[0]?.[0] as {
      prompt: { system?: string; userText: string };
      modelId: string;
    };
    expect(args.modelId).toBe('openai/gpt-5.2');
    expect(args.prompt.system).toContain('You convert raw transcripts');
    expect(args.prompt.system).toContain('filler words');
    expect(args.prompt.userText).toContain('Title: How to Speak');
    expect(args.prompt.userText).toContain('Source: YouTube');
    expect(args.prompt.userText).toContain('Hello everyone');
  });

  it('handles null title and source gracefully', async () => {
    generateTextWithModelIdMock.mockClear();

    const converter = createTranscriptToMarkdownConverter({
      anthropicApiKey: null,
      fetchImpl: globalThis.fetch.bind(globalThis),
      googleApiKey: null,
      modelId: 'openai/gpt-5.2',
      openaiApiKey: 'test',
      openrouterApiKey: null,
      xaiApiKey: null,
    });

    await converter({
      source: null,
      timeoutMs: 2000,
      title: null,
      transcript: 'Some transcript content',
    });

    const args = generateTextWithModelIdMock.mock.calls[0]?.[0] as { prompt: { userText: string } };
    expect(args.prompt.userText).toContain('Title: unknown');
    expect(args.prompt.userText).toContain('Source: unknown');
  });

  it('includes output language instructions when provided', async () => {
    generateTextWithModelIdMock.mockClear();

    const converter = createTranscriptToMarkdownConverter({
      anthropicApiKey: null,
      fetchImpl: globalThis.fetch.bind(globalThis),
      googleApiKey: null,
      modelId: 'openai/gpt-5.2',
      openaiApiKey: 'test',
      openrouterApiKey: null,
      xaiApiKey: null,
    });

    await converter({
      outputLanguage: { kind: 'fixed', label: 'French', tag: 'fr' },
      source: 'YouTube',
      timeoutMs: 2000,
      title: 'Test',
      transcript: 'Bonjour le monde.',
    });

    const args = generateTextWithModelIdMock.mock.calls[0]?.[0] as { prompt: { system?: string } };
    expect(args.prompt.system).toContain('Write the answer in French.');
  });

  it('truncates very large transcript inputs', async () => {
    generateTextWithModelIdMock.mockClear();

    const converter = createTranscriptToMarkdownConverter({
      anthropicApiKey: null,
      fetchImpl: globalThis.fetch.bind(globalThis),
      googleApiKey: null,
      modelId: 'openai/gpt-5.2',
      openaiApiKey: 'test',
      openrouterApiKey: null,
      xaiApiKey: null,
    });

    const transcript = `${'A'.repeat(200_005)}MARKER`;
    await converter({ source: 'Test', timeoutMs: 2000, title: 'Test', transcript });

    const args = generateTextWithModelIdMock.mock.calls[0]?.[0] as { prompt: { userText: string } };
    expect(args.prompt.userText).not.toContain('MARKER');
  });

  it('calls onUsage callback with model info', async () => {
    generateTextWithModelIdMock.mockClear();

    const onUsageMock = vi.fn();

    const converter = createTranscriptToMarkdownConverter({
      anthropicApiKey: null,
      fetchImpl: globalThis.fetch.bind(globalThis),
      googleApiKey: null,
      modelId: 'openai/gpt-5.2',
      onUsage: onUsageMock,
      openaiApiKey: 'test',
      openrouterApiKey: null,
      xaiApiKey: null,
    });

    await converter({
      source: 'Test',
      timeoutMs: 2000,
      title: 'Test',
      transcript: 'Test transcript',
    });

    expect(onUsageMock).toHaveBeenCalledTimes(1);
    expect(onUsageMock).toHaveBeenCalledWith({
      model: 'openai/gpt-5.2',
      provider: 'openai',
      usage: null,
    });
  });

  it('works with OpenRouter API key', async () => {
    generateTextWithModelIdMock.mockClear();

    const converter = createTranscriptToMarkdownConverter({
      anthropicApiKey: null,
      fetchImpl: globalThis.fetch.bind(globalThis),
      forceOpenRouter: true,
      googleApiKey: null,
      modelId: 'openrouter/anthropic/claude-3-haiku',
      openaiApiKey: null,
      openrouterApiKey: 'test-openrouter-key',
      xaiApiKey: null,
    });

    await converter({
      source: 'Test',
      timeoutMs: 2000,
      title: 'Test',
      transcript: 'Test transcript',
    });

    expect(generateTextWithModelIdMock).toHaveBeenCalledTimes(1);
    const args = generateTextWithModelIdMock.mock.calls[0]?.[0] as {
      modelId: string;
      forceOpenRouter?: boolean;
    };
    expect(args.modelId).toBe('openrouter/anthropic/claude-3-haiku');
    expect(args.forceOpenRouter).toBe(true);
  });
});
