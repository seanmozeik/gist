import type { YoutubeMode } from '../flags';

export type AutoRuleKind = 'text' | 'website' | 'youtube' | 'image' | 'video' | 'file';
export type VideoMode = 'auto' | 'transcript' | 'understand';
export type CliProvider = 'claude' | 'codex' | 'gemini' | 'agent';
export type OpenAiReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh';
export type OpenAiTextVerbosity = 'low' | 'medium' | 'high';
export interface ModelRequestOptions {
  serviceTier?: string;
  reasoningEffort?: OpenAiReasoningEffort;
  textVerbosity?: OpenAiTextVerbosity;
}
export interface CliProviderConfig {
  binary?: string;
  extraArgs?: string[];
  model?: string;
}
export interface CliAutoFallbackConfig {
  enabled?: boolean;
  onlyWhenNoApiKeys?: boolean;
  order?: CliProvider[];
}
export type CliMagicAutoConfig = CliAutoFallbackConfig;
export interface CliConfig {
  enabled?: CliProvider[];
  claude?: CliProviderConfig;
  codex?: CliProviderConfig;
  gemini?: CliProviderConfig;
  agent?: CliProviderConfig;
  autoFallback?: CliAutoFallbackConfig;
  magicAuto?: CliAutoFallbackConfig;
  promptOverride?: string;
  allowTools?: boolean;
  cwd?: string;
  extraArgs?: string[];
}

export interface OpenAiConfig {
  /**
   * Override the OpenAI-compatible API base URL (e.g. a proxy, or local sidecar).
   */
  baseUrl?: string;
  useChatCompletions?: boolean;
  serviceTier?: string;
  reasoningEffort?: OpenAiReasoningEffort;
  thinking?: OpenAiReasoningEffort;
  textVerbosity?: OpenAiTextVerbosity;
}

export interface LocalConfig {
  /**
   * Base URL of the local sidecar server (e.g. http://localhost:8000).
   * Also controlled by GIST_LOCAL_BASE_URL env var.
   */
  baseUrl?: string;
}

export type MediaCacheVerifyMode = 'none' | 'size' | 'hash';
export interface MediaCacheConfig {
  enabled?: boolean;
  maxMb?: number;
  ttlDays?: number;
  path?: string;
  verify?: MediaCacheVerifyMode;
}

export type EnvConfig = Record<string, string>;

export type LoggingLevel = 'debug' | 'info' | 'warn' | 'error';
export type LoggingFormat = 'json' | 'pretty';
export interface LoggingConfig {
  enabled?: boolean;
  level?: LoggingLevel;
  format?: LoggingFormat;
  file?: string;
  maxMb?: number;
  maxFiles?: number;
}

export interface AutoRule {
  /**
   * Input kinds this rule applies to.
   *
   * Omit for "catch-all".
   */
  when?: AutoRuleKind[];

  /**
   * Candidate model ids (ordered).
   *
   * - OpenRouter: `openrouter/<provider>/<model>` (e.g. `openrouter/meta/llama-3.1-8b-instruct`)
   * - Local sidecar: `local/<model-name>` (e.g. `local/qwen2.5-7b`)
   */
  candidates?: string[];

  /**
   * Token-based candidate selection (ordered).
   *
   * First matching band wins.
   */
  bands?: { token?: { min?: number; max?: number }; candidates: string[] }[];
}

export type ModelConfig =
  | {
      id: string;
      serviceTier?: string;
      reasoningEffort?: OpenAiReasoningEffort;
      thinking?: OpenAiReasoningEffort;
      textVerbosity?: OpenAiTextVerbosity;
    }
  | { mode: 'auto'; rules?: AutoRule[] }
  | { name: string };

export interface ApiKeysConfig {
  anthropic?: string;
  apify?: string;
  assemblyai?: string;
  fal?: string;
  gemini?: string;
  google?: string;
  groq?: string;
  nvidia?: string;
  openai?: string;
  openrouter?: string;
  xai?: string;
  zai?: string;
}

export interface GistConfig {
  model?: ModelConfig;
  /**
   * Output language for summaries (default: auto = match source content language).
   */
  language?: string;
  /**
   * Summary prompt override (replaces the built-in instruction block).
   */
  prompt?: string;
  /**
   * Cache settings for extracted content, transcripts, and summaries.
   */
  cache?: {
    enabled?: boolean;
    maxMb?: number;
    ttlDays?: number;
    path?: string;
    media?: MediaCacheConfig;
  };
  /**
   * Named model presets selectable via `--model <name>`.
   *
   * Note: `auto` is reserved and cannot be defined here.
   */
  models?: Record<string, ModelConfig>;
  media?: { videoMode?: VideoMode; youtubeMode?: YoutubeMode };
  output?: { language?: string; length?: string };
  ui?: { theme?: string };
  cli?: CliConfig;
  openai?: OpenAiConfig;
  local?: LocalConfig;
  logging?: LoggingConfig;
  /**
   * Generic environment variable defaults.
   */
  env?: EnvConfig;
  /**
   * Legacy API key shortcuts. Prefer `env` for new configs.
   */
  apiKeys?: ApiKeysConfig;
}
