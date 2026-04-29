import type { AssistantMessage } from '@mariozechner/pi-ai';

import { parseSseEvent } from './runtime-contracts';
import { parseSseStream } from './sse';

interface AgentJsonResponse { ok?: boolean; assistant?: AssistantMessage; error?: string }

export type AgentStreamEvent =
  | { type: 'chunk'; text: string }
  | { type: 'assistant'; assistant: AssistantMessage };

export async function* readAgentResponse(res: Response): AsyncGenerator<AgentStreamEvent> {
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const json = (await res.json().catch(() => null)) as AgentJsonResponse | null;
    if (!json?.ok || !json.assistant) {
      throw new Error(json?.error || 'Agent failed');
    }
    yield { assistant: json.assistant, type: 'assistant' };
    return;
  }

  if (!res.body) {
    throw new Error('Missing agent response body');
  }

  for await (const raw of parseSseStream(res.body)) {
    const event = parseSseEvent(raw);
    if (!event) {continue;}
    if (event.event === 'chunk') {
      yield { text: event.data.text, type: 'chunk' };
    } else if (event.event === 'assistant') {
      yield { assistant: event.data, type: 'assistant' };
    } else if (event.event === 'error') {
      throw new Error(event.data.message);
    }
  }
}
