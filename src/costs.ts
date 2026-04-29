import type { LlmTokenUsage } from './llm/generate-text.js';

export type LlmProvider =
  | 'xai'
  | 'openai'
  | 'google'
  | 'anthropic'
  | 'zai'
  | 'nvidia'
  | 'github-copilot'
  | 'cli';

export interface LlmCall {
  provider: LlmProvider;
  model: string;
  usage: LlmTokenUsage | null;
  costUsd?: number | null;
  purpose: 'summary' | 'markdown';
}

export interface RunMetricsReport {
  llm: Array<{
    provider: LlmProvider;
    model: string;
    calls: number;
    promptTokens: number | null;
    completionTokens: number | null;
    totalTokens: number | null;
  }>;
  services: { firecrawl: { requests: number }; apify: { requests: number } };
}

function sumOrNull(values: (number | null)[]): number | null {
  let sum = 0;
  let any = false;
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      sum += value;
      any = true;
    }
  }
  return any ? sum : null;
}

export function buildRunMetricsReport({
  llmCalls,
  firecrawlRequests,
  apifyRequests,
}: {
  llmCalls: LlmCall[];
  firecrawlRequests: number;
  apifyRequests: number;
}): RunMetricsReport {
  const llmMap = new Map<
    string,
    {
      provider: LlmProvider;
      model: string;
      calls: number;
      promptTokens: (number | null)[];
      completionTokens: (number | null)[];
      totalTokens: (number | null)[];
    }
  >();

  for (const call of llmCalls) {
    const key = `${call.provider}:${call.model}`;
    const existing = llmMap.get(key);
    const promptTokens = call.usage?.promptTokens ?? null;
    const completionTokens = call.usage?.completionTokens ?? null;
    const totalTokens = call.usage?.totalTokens ?? null;
    if (!existing) {
      llmMap.set(key, {
        calls: 1,
        completionTokens: [completionTokens],
        model: call.model,
        promptTokens: [promptTokens],
        provider: call.provider,
        totalTokens: [totalTokens],
      });
      continue;
    }
    existing.calls += 1;
    existing.promptTokens.push(promptTokens);
    existing.completionTokens.push(completionTokens);
    existing.totalTokens.push(totalTokens);
  }

  const llm = [...llmMap.values()].map((row) => {
    const promptTokens = sumOrNull(row.promptTokens);
    const completionTokens = sumOrNull(row.completionTokens);
    const totalTokens = sumOrNull(row.totalTokens);
    return {
      calls: row.calls,
      completionTokens,
      model: row.model,
      promptTokens,
      provider: row.provider,
      totalTokens,
    };
  });

  return {
    llm,
    services: { apify: { requests: apifyRequests }, firecrawl: { requests: firecrawlRequests } },
  };
}
