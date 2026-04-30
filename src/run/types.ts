import type { CliProvider } from '../config';
import type { LlmProvider } from '../llm/model-id';
import type { ModelRequestOptions } from '../llm/model-options';

export type ModelAttemptRequiredEnv =
  | 'OPENROUTER_API_KEY'
  | 'CLI_CLAUDE'
  | 'CLI_CODEX'
  | 'CLI_GEMINI'
  | 'CLI_AGENT'
  | null;

export interface ModelAttempt {
  transport: 'native' | 'openrouter' | 'cli';
  userModelId: string;
  llmModelId: string | null;
  openrouterProviders: string[] | null;
  forceOpenRouter: boolean;
  requiredEnv: ModelAttemptRequiredEnv;
  openaiBaseUrlOverride?: string | null;
  openaiApiKeyOverride?: string | null;
  forceChatCompletions?: boolean;
  requestOptions?: ModelRequestOptions;
  cliProvider?: CliProvider;
  cliModel?: string | null;
}

export interface ModelMeta {
  provider: LlmProvider | 'cli';
  canonical: string;
}

export interface MarkdownModel {
  llmModelId: string;
  forceOpenRouter: boolean;
  openaiApiKeyOverride?: string | null;
  openaiBaseUrlOverride?: string | null;
  forceChatCompletions?: boolean;
  requestOptions?: ModelRequestOptions;
  requiredEnv?: ModelAttemptRequiredEnv;
}
