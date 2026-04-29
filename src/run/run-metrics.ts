import type { LlmCall, RunMetricsReport } from '../costs.js';

export interface RunMetrics {
  llmCalls: LlmCall[];
  trackedFetch: typeof fetch;
  buildReport: () => Promise<RunMetricsReport>;
  estimateCostUsd: () => Promise<number | null>;
  resolveMaxOutputTokensForCall: (modelId: string) => Promise<number | null>;
  resolveMaxInputTokensForCall: (modelId: string) => Promise<number | null>;
  setTranscriptionCost: (costUsd: number | null, label: string | null) => void;
}

export function createRunMetrics({
  maxOutputTokensArg,
}: {
  maxOutputTokensArg: number | null;
}): RunMetrics {
  const llmCalls: LlmCall[] = [];
  let firecrawlRequests = 0;
  let apifyRequests = 0;
  const transcriptionCost = { label: null as string | null, value: null as number | null };

  const setTranscriptionCost = (costUsd: number | null, label: string | null) => {
    transcriptionCost.value = costUsd;
    transcriptionCost.label = label;
  };

  const resolveMaxOutputTokensForCall = async (modelId: string): Promise<number | null> => {
    if (typeof maxOutputTokensArg !== 'number') {
      return null;
    }
    return maxOutputTokensArg;
  };

  const resolveMaxInputTokensForCall = async (_modelId: string): Promise<number | null> => {
    // No token limit catalog — return null to let the model decide
    return null;
  };

  const estimateCostUsd = async (): Promise<number | null> => {
    const extraCosts = [
      typeof transcriptionCost.value === 'number' && Number.isFinite(transcriptionCost.value)
        ? transcriptionCost.value
        : null,
    ].filter((value): value is number => typeof value === 'number');
    const extraTotal =
      extraCosts.length > 0 ? extraCosts.reduce((sum, value) => sum + value, 0) : 0;

    const explicitCosts = llmCalls
      .map((call) =>
        typeof call.costUsd === 'number' && Number.isFinite(call.costUsd) ? call.costUsd : null,
      )
      .filter((value): value is number => typeof value === 'number');
    const explicitTotal =
      explicitCosts.length > 0 ? explicitCosts.reduce((sum, value) => sum + value, 0) : 0;

    const total = explicitTotal + extraTotal;
    return total > 0 ? total : null;
  };

  const buildReport = async () => {
    const promptTokens = llmCalls.reduce((sum, c) => sum + (c.usage?.promptTokens ?? 0), 0);
    const completionTokens = llmCalls.reduce((sum, c) => sum + (c.usage?.completionTokens ?? 0), 0);
    const costUsd = (await estimateCostUsd()) ?? 0;
    return {
      durationMs: 0,
      llmCalls,
      totalCompletionTokens: completionTokens,
      totalCostUsd: costUsd,
      totalPromptTokens: promptTokens,
    };
  };

  const trackedFetch: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : (input instanceof URL ? input.toString() : input.url);
    let hostname: string | null = null;
    try {
      hostname = new URL(url).hostname.toLowerCase();
    } catch {
      hostname = null;
    }
    if (hostname === 'api.firecrawl.dev') {
      firecrawlRequests += 1;
    } else if (hostname === 'api.apify.com') {
      apifyRequests += 1;
    }
    return fetch(input as RequestInfo, init);
  };

  return {
    buildReport,
    estimateCostUsd,
    llmCalls,
    resolveMaxInputTokensForCall,
    resolveMaxOutputTokensForCall,
    setTranscriptionCost,
    trackedFetch,
  };
}
