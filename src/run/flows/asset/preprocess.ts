import type { OutputLanguage } from '../../../language.js';
import type { Attachment } from '../../../llm/attachments.js';
import { resolveOpenAiClientConfig } from '../../../llm/providers/openai.js';
import { convertToMarkdownWithMarkitdown } from '../../../markitdown.js';
import type { FixedModelSpec } from '../../../model-spec.js';
import { buildFileSummaryPrompt, buildFileTextSummaryPrompt } from '../../../prompts/index.js';
import type { SummaryLength } from '../../../shared/contracts.js';
import { formatBytes } from '../../../tty/format.js';
import {
  type AssetAttachment,
  getFileBytesFromAttachment,
  getTextContentFromAttachment,
  MAX_DOCUMENT_BYTES_DEFAULT,
  shouldMarkitdownConvertMediaType,
  supportsNativeFileAttachment,
} from '../../attachments.js';
import { MAX_TEXT_BYTES_DEFAULT } from '../../constants.js';
import { hasUvxCli } from '../../env.js';
import { withUvxTip } from '../../tips.js';

export interface AssetPreprocessContext {
  env: Record<string, string | undefined>;
  envForRun: Record<string, string | undefined>;
  execFileImpl: Parameters<typeof convertToMarkdownWithMarkitdown>[0]['execFileImpl'];
  timeoutMs: number;
  preprocessMode: 'off' | 'auto' | 'always';
  format: 'text' | 'markdown';
  lengthArg: { kind: 'preset'; preset: SummaryLength } | { kind: 'chars'; maxCharacters: number };
  outputLanguage: OutputLanguage;
  fixedModelSpec: FixedModelSpec | null;
  promptOverride?: string | null;
  lengthInstruction?: string | null;
  languageInstruction?: string | null;
  openaiApiKey?: string | null;
  openrouterApiKey?: string | null;
  openaiBaseUrl?: string | null;
}

export interface AssetPreprocessResult {
  promptText: string;
  attachments: Attachment[];
  assetFooterParts: string[];
  textContent: { content: string; bytes: number } | null;
}

export type DocumentHandlingDecision =
  | { mode: 'inline' }
  | { mode: 'attach' }
  | { mode: 'preprocess' }
  | { mode: 'error'; error: Error };

export function resolveDocumentHandling({
  attachment,
  textContent,
  fileBytes,
  preprocessMode,
  fixedModelSpec,
  openaiApiKey,
  openrouterApiKey,
  openaiBaseUrl,
}: {
  attachment: AssetAttachment;
  textContent: { content: string; bytes: number } | null;
  fileBytes: Uint8Array | null;
  preprocessMode: 'off' | 'auto' | 'always';
  fixedModelSpec: FixedModelSpec | null;
  openaiApiKey?: string | null;
  openrouterApiKey?: string | null;
  openaiBaseUrl?: string | null;
}): DocumentHandlingDecision {
  if (attachment.kind !== 'file') {
    return { mode: 'inline' };
  }
  if (textContent) {
    return { mode: 'inline' };
  }
  if (!fileBytes) {
    return {
      error: new Error('Internal error: missing file bytes for binary attachment'),
      mode: 'error',
    };
  }

  const canAttachDocument = (() => {
    if (preprocessMode === 'always') {
      return false;
    }
    if (fixedModelSpec?.transport !== 'native') {
      return false;
    }
    if (
      !supportsNativeFileAttachment({
        attachment: { kind: attachment.kind, mediaType: attachment.mediaType },
        provider: fixedModelSpec.provider,
      })
    ) {
      return false;
    }
    if (fixedModelSpec.provider !== 'openai') {
      return true;
    }
    const resolvedOpenAiBaseUrl = fixedModelSpec.openaiBaseUrlOverride ?? openaiBaseUrl ?? null;
    try {
      const openaiConfig = resolveOpenAiClientConfig({
        apiKeys: { openaiApiKey: openaiApiKey ?? null, openrouterApiKey: openrouterApiKey ?? null },
        forceChatCompletions: fixedModelSpec.forceChatCompletions,
        forceOpenRouter: fixedModelSpec.forceOpenRouter,
        openaiBaseUrlOverride: resolvedOpenAiBaseUrl,
      });
      if (openaiConfig.isOpenRouter) {
        return false;
      }
      const host = new URL(openaiConfig.baseURL ?? 'https://api.openai.com/v1').host.toLowerCase();
      return host === 'api.openai.com';
    } catch {
      if (!resolvedOpenAiBaseUrl) {
        return true;
      }
      try {
        return new URL(resolvedOpenAiBaseUrl).host.toLowerCase() === 'api.openai.com';
      } catch {
        return false;
      }
    }
  })();

  if (canAttachDocument && fileBytes.byteLength <= MAX_DOCUMENT_BYTES_DEFAULT) {
    return { mode: 'attach' };
  }

  if (canAttachDocument && fileBytes.byteLength > MAX_DOCUMENT_BYTES_DEFAULT) {
    if (preprocessMode === 'off') {
      return {
        error: new Error(
          `PDF is too large to attach (${formatBytes(fileBytes.byteLength)}). Max is ${formatBytes(MAX_DOCUMENT_BYTES_DEFAULT)}. Enable preprocessing or use a smaller file.`,
        ),
        mode: 'error',
      };
    }
    return { mode: 'preprocess' };
  }

  if (preprocessMode === 'off') {
    return {
      error: new Error(
        `This build does not support attaching binary files (${attachment.mediaType}). Enable preprocessing (e.g. --preprocess auto) and install uvx/markitdown.`,
      ),
      mode: 'error',
    };
  }

  return { mode: 'preprocess' };
}

export async function prepareAssetPrompt({
  ctx,
  attachment,
}: {
  ctx: AssetPreprocessContext;
  attachment: AssetAttachment;
}): Promise<AssetPreprocessResult> {
  const textContent = getTextContentFromAttachment(attachment);
  if (textContent && textContent.bytes > MAX_TEXT_BYTES_DEFAULT) {
    throw new Error(
      `Text file too large (${formatBytes(textContent.bytes)}). Limit is ${formatBytes(MAX_TEXT_BYTES_DEFAULT)}.`,
    );
  }

  const fileBytes = getFileBytesFromAttachment(attachment);

  const summaryLengthTarget =
    ctx.lengthArg.kind === 'preset'
      ? ctx.lengthArg.preset
      : { maxCharacters: ctx.lengthArg.maxCharacters };

  let promptText = '';
  let attachments: Attachment[] = [];
  const assetFooterParts: string[] = [];

  const buildImageAttachment = () => {
    if (attachment.kind !== 'image') {
      throw new Error('Internal error: tried to attach non-image as image');
    }
    promptText = buildFileSummaryPrompt({
      contentLength: textContent?.content.length ?? null,
      filename: attachment.filename,
      languageInstruction: ctx.languageInstruction ?? null,
      lengthInstruction: ctx.lengthInstruction ?? null,
      mediaType: attachment.mediaType,
      outputLanguage: ctx.outputLanguage,
      promptOverride: ctx.promptOverride ?? null,
      summaryLength: summaryLengthTarget,
    });
    attachments = [
      {
        bytes: attachment.bytes,
        filename: attachment.filename,
        kind: 'image',
        mediaType: attachment.mediaType,
      },
    ];
  };

  const buildInlinePromptText = ({
    content,
    contentMediaType,
    originalMediaType,
  }: {
    content: string;
    contentMediaType: string;
    originalMediaType: string | null;
  }) => {
    promptText = buildFileTextSummaryPrompt({
      content,
      contentLength: content.length,
      contentMediaType,
      filename: attachment.filename,
      languageInstruction: ctx.languageInstruction ?? null,
      lengthInstruction: ctx.lengthInstruction ?? null,
      originalMediaType,
      outputLanguage: ctx.outputLanguage,
      promptOverride: ctx.promptOverride ?? null,
      summaryLength: summaryLengthTarget,
    });
  };

  let preprocessedMarkdown: string | null = null;
  let usingPreprocessedMarkdown = false;

  const documentHandling =
    attachment.kind === 'file'
      ? resolveDocumentHandling({
          attachment,
          fileBytes,
          fixedModelSpec: ctx.fixedModelSpec,
          openaiApiKey: ctx.openaiApiKey ?? ctx.envForRun.OPENAI_API_KEY?.trim() ?? null,
          openaiBaseUrl: ctx.openaiBaseUrl ?? ctx.envForRun.OPENAI_BASE_URL?.trim() ?? null,
          openrouterApiKey:
            ctx.openrouterApiKey ?? ctx.envForRun.OPENROUTER_API_KEY?.trim() ?? null,
          preprocessMode: ctx.preprocessMode,
          textContent,
        })
      : { mode: 'inline' as const };

  if (documentHandling.mode === 'error') {
    throw documentHandling.error;
  }

  if (documentHandling.mode === 'attach') {
    if (!fileBytes) {
      throw new Error('Internal error: missing file bytes for document attachment');
    }
    promptText = buildFileSummaryPrompt({
      contentLength: textContent?.content.length ?? null,
      filename: attachment.filename,
      languageInstruction: ctx.languageInstruction ?? null,
      lengthInstruction: ctx.lengthInstruction ?? null,
      mediaType: attachment.mediaType,
      outputLanguage: ctx.outputLanguage,
      promptOverride: ctx.promptOverride ?? null,
      summaryLength: summaryLengthTarget,
    });
    attachments = [
      {
        bytes: fileBytes,
        filename: attachment.filename,
        kind: 'document',
        mediaType: attachment.mediaType,
      },
    ];
    return { assetFooterParts, attachments, promptText, textContent };
  }

  // Non-text file attachments require preprocessing (pi-ai message format supports images, but not generic files).
  if (attachment.kind === 'file' && !textContent && documentHandling.mode === 'preprocess') {
    if (!fileBytes) {
      throw new Error('Internal error: missing file bytes for markitdown preprocessing');
    }
    if (!shouldMarkitdownConvertMediaType(attachment.mediaType)) {
      throw new Error(
        `Unsupported file type: ${attachment.filename ?? 'file'} (${attachment.mediaType})\n` +
          `This build can only send text or images to the model. Try a text-like file, an image, or convert this file to text first.`,
      );
    }
    if (!hasUvxCli(ctx.env)) {
      throw withUvxTip(
        new Error(`Missing uvx/markitdown for preprocessing ${attachment.mediaType}.`),
        ctx.env,
      );
    }

    try {
      preprocessedMarkdown = await convertToMarkdownWithMarkitdown({
        bytes: fileBytes,
        env: ctx.env,
        execFileImpl: ctx.execFileImpl,
        filenameHint: attachment.filename,
        mediaTypeHint: attachment.mediaType,
        timeoutMs: ctx.timeoutMs,
        uvxCommand: ctx.envForRun.UVX_PATH,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to preprocess ${attachment.mediaType} with markitdown: ${message}.`, {
        cause: error,
      });
    }
    if (Buffer.byteLength(preprocessedMarkdown, 'utf8') > MAX_TEXT_BYTES_DEFAULT) {
      throw new Error(
        `Preprocessed Markdown too large (${formatBytes(Buffer.byteLength(preprocessedMarkdown, 'utf8'))}). Limit is ${formatBytes(MAX_TEXT_BYTES_DEFAULT)}.`,
      );
    }
    usingPreprocessedMarkdown = true;
    assetFooterParts.push(`markitdown(${attachment.mediaType})`);
  }

  if (attachment.kind === 'image') {
    buildImageAttachment();
  } else if (usingPreprocessedMarkdown) {
    if (!preprocessedMarkdown) {
      throw new Error('Internal error: missing markitdown content for preprocessing');
    }
    buildInlinePromptText({
      content: preprocessedMarkdown,
      contentMediaType: 'text/markdown',
      originalMediaType: attachment.mediaType,
    });
  } else if (textContent) {
    buildInlinePromptText({
      content: textContent.content,
      contentMediaType: attachment.mediaType,
      originalMediaType: attachment.mediaType,
    });
  } else {
    throw new Error('Internal error: no prompt text could be built for asset');
  }

  void ctx.fixedModelSpec;

  return { assetFooterParts, attachments, promptText, textContent };
}
