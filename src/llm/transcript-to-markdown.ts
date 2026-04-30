import type { OutputLanguage } from '../language';
import { formatOutputLanguageInstruction } from '../language';
import type { LlmTokenUsage } from './generate-text';
import { generateTextWithModelId } from './generate-text';
import type { LlmProvider } from './model-id';
import type { ModelRequestOptions } from './model-options';

const MAX_TRANSCRIPT_INPUT_CHARACTERS = 200_000;

function buildTranscriptToMarkdownPrompt({
  title,
  source,
  transcript,
  outputLanguage,
}: {
  title: string | null;
  source: string | null;
  transcript: string;
  outputLanguage?: OutputLanguage | null;
}): { system: string; prompt: string } {
  const languageInstruction = formatOutputLanguageInstruction(outputLanguage ?? { kind: 'auto' });

  const system = `You convert raw transcripts into clean GitHub-Flavored Markdown.

Rules:
- Add paragraph breaks at natural topic transitions
- Add headings (##) for major topic changes
- Format lists, quotes, and emphasis where appropriate
- Light cleanup: remove filler words (um, uh, you know) and false starts
- Do not invent content or change meaning
- Preserve technical terms, names, and quotes accurately
- ${languageInstruction}
- Output ONLY Markdown (no JSON, no explanations, no code fences wrapping the output)`;

  const prompt = `Title: ${title ?? 'unknown'}
Source: ${source ?? 'unknown'}

Transcript:
"""
${transcript}
"""`;

  return { prompt, system };
}

export type ConvertTranscriptToMarkdown = (args: {
  title: string | null;
  source: string | null;
  transcript: string;
  timeoutMs: number;
  outputLanguage?: OutputLanguage | null;
}) => Promise<string>;

export function createTranscriptToMarkdownConverter({
  modelId,
  forceOpenRouter,
  openaiBaseUrlOverride,
  openrouterApiKey,
  fetchImpl,
  forceChatCompletions,
  requestOptions,
  retries = 0,
  onRetry,
  onUsage,
}: {
  modelId: string;
  forceOpenRouter?: boolean;
  openaiBaseUrlOverride?: string | null;
  fetchImpl: typeof fetch;
  openrouterApiKey: string | null;
  forceChatCompletions?: boolean;
  requestOptions?: ModelRequestOptions;
  retries?: number;
  onRetry?: (notice: {
    attempt: number;
    maxRetries: number;
    delayMs: number;
    error: unknown;
  }) => void;
  onUsage?: (usage: { model: string; provider: LlmProvider; usage: LlmTokenUsage | null }) => void;
}): ConvertTranscriptToMarkdown {
  return async ({ title, source, transcript, timeoutMs, outputLanguage }) => {
    const trimmedTranscript =
      transcript.length > MAX_TRANSCRIPT_INPUT_CHARACTERS
        ? transcript.slice(0, MAX_TRANSCRIPT_INPUT_CHARACTERS)
        : transcript;
    const { system, prompt } = buildTranscriptToMarkdownPrompt({
      outputLanguage,
      source,
      title,
      transcript: trimmedTranscript,
    });

    const result = await generateTextWithModelId({
      apiKeys: { openrouterApiKey },
      fetchImpl,
      forceChatCompletions,
      forceOpenRouter,

      modelId,
      onRetry,
      openaiBaseUrlOverride,
      prompt: { system, userText: prompt },
      requestOptions,
      retries,
      timeoutMs,
    });
    onUsage?.({
      model: result.canonicalModelId,
      provider: result.provider,
      usage: result.usage ?? null,
    });
    return result.text;
  };
}
