export interface LlmCall {
  model: string;
  provider: 'openrouter' | 'local' | 'cli';
  promptTokens?: number;
  completionTokens?: number;
  costUsd?: number | null;
}

export interface RunMetricsReport {
  llmCalls: LlmCall[];
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCostUsd: number;
  durationMs: number;
}
