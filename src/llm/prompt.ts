import type { ImageContent, TextContent, UserMessage } from '@mariozechner/pi-ai';

import type { Attachment } from './attachments.js';

export interface Prompt { system?: string; userText: string; attachments?: Attachment[] }

export function userTextMessage(text: string, timestamp = Date.now()): UserMessage {
  return { content: text, role: 'user', timestamp };
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

export function userTextAndImageMessage({
  text,
  imageBytes,
  mimeType,
  timestamp = Date.now(),
}: {
  text: string;
  imageBytes: Uint8Array;
  mimeType: string;
  timestamp?: number;
}): UserMessage {
  const parts: (TextContent | ImageContent)[] = [
    { text, type: 'text' },
    { data: bytesToBase64(imageBytes), mimeType, type: 'image' },
  ];
  return { content: parts, role: 'user', timestamp };
}
