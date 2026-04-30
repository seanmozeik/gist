import type { Prompt } from '../../src/llm/prompt';

export function buildDocumentPrompt({
  text,
  bytes,
  mediaType = 'application/pdf',
  filename = 'document.pdf',
}: {
  text: string;
  bytes: Uint8Array;
  mediaType?: string;
  filename?: string;
}): Prompt {
  return { attachments: [{ bytes, filename, kind: 'document', mediaType }], userText: text };
}
