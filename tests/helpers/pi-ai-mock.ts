import type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  Provider,
  StopReason,
} from '@mariozechner/pi-ai';

type UsageOverrides = Partial<{
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
}>;

export function makeAssistantMessage({
  text = 'OK',
  provider = 'openai',
  model = 'gpt-5.2',
  api = 'openai-responses',
  usage,
  stopReason = 'stop',
}: {
  text?: string;
  provider?: Provider;
  model?: string;
  api?: Api;
  usage?: UsageOverrides;
  stopReason?: StopReason;
}): AssistantMessage {
  const input = usage?.input ?? 1;
  const output = usage?.output ?? 1;
  const cacheRead = usage?.cacheRead ?? 0;
  const cacheWrite = usage?.cacheWrite ?? 0;
  const totalTokens = usage?.totalTokens ?? input + output + cacheRead + cacheWrite;

  return {
    api,
    content: [{ type: 'text' as const, text }],
    model,
    provider,
    role: 'assistant' as const,
    stopReason,
    timestamp: Date.now(),
    usage: {
      cacheRead,
      cacheWrite,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
      input,
      output,
      totalTokens,
    },
  };
}

export function makeTextDeltaStream(
  deltas: string[],
  finalMessage: ReturnType<typeof makeAssistantMessage>,
  { error }: { error?: unknown } = {},
) {
  const stream = {
    async *[Symbol.asyncIterator]() {
      for (const delta of deltas) {
        yield { contentIndex: 0, delta, partial: finalMessage, type: 'text_delta' as const };
      }
      if (error) {
        yield {
          error: error as unknown as AssistantMessage,
          reason: 'error' as const,
          type: 'error' as const,
        };
        return;
      }
      yield { message: finalMessage, reason: 'stop' as const, type: 'done' as const };
    },
    async result() {
      if (error) {throw error;}
      return finalMessage;
    },
  } satisfies AsyncIterable<AssistantMessageEvent> & { result: () => Promise<AssistantMessage> };

  return stream;
}
