import type { LlmCall, RunMetricsReport } from '../costs';

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
  const transcriptionCost = { label: null as string | null, value: null as number | null };

  const setTranscriptionCost = (costUsd: number | null, label: string | null) => {
    transcriptionCost.value = costUsd;
    transcriptionCost.label = label;
  };

  const resolveMaxOutputTokensForCall = async (_modelId: string): Promise<number | null> => {
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
    const promptTokens = llmCalls.reduce((sum, c) => sum + (c.promptTokens ?? 0), 0);
    const completionTokens = llmCalls.reduce((sum, c) => sum + (c.completionTokens ?? 0), 0);
    const costUsd = (await estimateCostUsd()) ?? 0;
    return {
      durationMs: 0,
      llmCalls,
      totalCompletionTokens: completionTokens,
      totalCostUsd: costUsd,
      totalPromptTokens: promptTokens,
    };
  };

  const trackedFetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => fetch(input as RequestInfo, init),
    { preconnect: fetch.preconnect.bind(fetch) },
  );

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
