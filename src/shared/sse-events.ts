import type { AssistantMessage } from '@mariozechner/pi-ai';

export interface SseMetaData {
  model: string | null;
  modelLabel: string | null;
  inputSummary: string | null;
  summaryFromCache?: boolean | null;
}

export interface SseMetricsData {
  elapsedMs: number;
  summary: string;
  details: string | null;
  summaryDetailed: string;
  detailsDetailed: string | null;
}

export type SseEvent =
  | { event: 'meta'; data: SseMetaData }
  | { event: 'status'; data: { text: string } }
  | { event: 'chunk'; data: { text: string } }
  | { event: 'assistant'; data: AssistantMessage }
  | { event: 'metrics'; data: SseMetricsData }
  | { event: 'done'; data: Record<string, never> }
  | { event: 'error'; data: { message: string } };

export interface RawSseMessage {
  event: string;
  data: string;
}

export function encodeSseEvent(event: SseEvent): string {
  return `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

export function parseSseEvent(message: RawSseMessage): SseEvent | null {
  switch (message.event) {
    case 'meta': {
      return { data: JSON.parse(message.data) as SseMetaData, event: 'meta' };
    }
    case 'status': {
      return { data: JSON.parse(message.data) as { text: string }, event: 'status' };
    }
    case 'chunk': {
      return { data: JSON.parse(message.data) as { text: string }, event: 'chunk' };
    }
    case 'assistant': {
      return { data: JSON.parse(message.data) as AssistantMessage, event: 'assistant' };
    }
    case 'metrics': {
      return { data: JSON.parse(message.data) as SseMetricsData, event: 'metrics' };
    }
    case 'done': {
      return { data: JSON.parse(message.data) as Record<string, never>, event: 'done' };
    }
    case 'error': {
      return { data: JSON.parse(message.data) as { message: string }, event: 'error' };
    }
    default: {
      return null;
    }
  }
}
