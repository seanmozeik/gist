import type { CacheState } from '../../../cache';
import type { CliProvider, GistConfig } from '../../../config';
import type {
  ExtractedLinkContent,
  LinkPreviewProgressEvent,
  MediaCache,
} from '../../../content/index.js';
import type { LlmCall, RunMetricsReport } from '../../../costs';
import type { StreamMode } from '../../../flags';
import type { OutputLanguage } from '../../../language';
import type { ModelRequestOptions } from '../../../llm/model-options';
import type { ExecFileFn } from '../../../markitdown';
import type { FixedModelSpec, RequestedModel } from '../../../model-spec';
import type { SummaryLength } from '../../../shared/contracts';
import type { createSummaryEngine } from '../../summary-engine';
import type { GistAssetArgs } from '../asset/summary';

export interface UrlFlowIo {
  env: Record<string, string | undefined>;
  envForRun: Record<string, string | undefined>;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  execFileImpl: ExecFileFn;
  fetch: typeof fetch;
  /**
   * Explicit magic-fetch transport for link-preview HTML retrieval (overrides Vitest default).
   * Normally omit so Vitest reuses {@link fetch}.
   */
  linkPreviewFetchImplementation?: typeof fetch;
}

export interface UrlFlowFlags {
  timeoutMs: number;
  maxExtractCharacters?: number | null;
  retries: number;
  format: 'text' | 'markdown';
  markdownMode: 'off' | 'auto' | 'llm' | 'readability';
  preprocessMode: 'off' | 'auto' | 'always';
  youtubeMode: 'auto' | 'web' | 'yt-dlp' | 'no-auto';
  videoMode: 'auto' | 'transcript' | 'understand';
  transcriptTimestamps: boolean;
  outputLanguage: OutputLanguage;
  lengthArg: { kind: 'preset'; preset: SummaryLength } | { kind: 'chars'; maxCharacters: number };
  forceSummary: boolean;
  promptOverride?: string | null;
  lengthInstruction?: string | null;
  languageInstruction?: string | null;
  summaryCacheBypass: boolean;
  maxOutputTokensArg: number | null;
  json: boolean;
  extractMode: boolean;
  metricsEnabled: boolean;
  metricsDetailed: boolean;
  shouldComputeReport: boolean;
  runStartedAtMs: number;
  verbose: boolean;
  verboseColor: boolean;
  progressEnabled: boolean;
  streamMode: StreamMode;
  streamingEnabled: boolean;
  plain: boolean;
  configPath: string | null;
  configModelLabel: string | null;
}

export interface UrlFlowModel {
  requestedModel: RequestedModel;
  requestedModelInput: string;
  requestedModelLabel: string;
  fixedModelSpec: FixedModelSpec | null;
  isFallbackModel: boolean;
  isImplicitAutoSelection: boolean;
  allowAutoCliFallback: boolean;
  isNamedModelSelection: boolean;
  desiredOutputTokens: number | null;
  configForModelSelection: GistConfig | null;
  envForAuto: Record<string, string | undefined>;
  cliAvailability: Partial<Record<CliProvider, boolean>>;
  openaiUseChatCompletions: boolean;
  openaiRequestOptions?: ModelRequestOptions;
  openaiRequestOptionsOverride?: ModelRequestOptions;
  openaiWhisperUsdPerMinute: number;
  apiStatus: {
    openrouterApiKey: string | null;
    ytDlpPath: string | null;
    ytDlpCookiesFromBrowser: string | null;
    localBaseUrl: string | null;
  };
  summaryEngine: ReturnType<typeof createSummaryEngine>;

  llmCalls: LlmCall[];
}

export interface UrlFlowHooks {
  onModelChosen?: ((modelId: string) => void) | null;
  onExtracted?: ((extracted: ExtractedLinkContent) => void) | null;

  onLinkPreviewProgress?: ((event: LinkPreviewProgressEvent) => void) | null;
  onSummaryCached?: ((cached: boolean) => void) | null;
  setTranscriptionCost: (costUsd: number | null, label: string | null) => void;
  gistAsset: (args: GistAssetArgs) => Promise<void>;
  writeViaFooter: (parts: string[]) => void;
  clearProgressForStdout: () => void;
  restoreProgressAfterStdout?: (() => void) | null;
  setClearProgressBeforeStdout: (fn: (() => undefined | (() => void)) | null) => void;
  clearProgressIfCurrent: (fn: () => void) => void;
  buildReport: () => Promise<RunMetricsReport>;
  estimateCostUsd: () => Promise<number | null>;
}

export type UrlFlowEventHooks = Pick<
  UrlFlowHooks,
  'onModelChosen' | 'onExtracted' | 'onLinkPreviewProgress' | 'onSummaryCached'
>;

export type UrlFlowRuntimeHooks = Pick<
  UrlFlowHooks,
  | 'setTranscriptionCost'
  | 'gistAsset'
  | 'writeViaFooter'
  | 'clearProgressForStdout'
  | 'restoreProgressAfterStdout'
  | 'setClearProgressBeforeStdout'
  | 'clearProgressIfCurrent'
  | 'buildReport'
  | 'estimateCostUsd'
>;

export function createUrlFlowHooks(options: {
  runtime: UrlFlowRuntimeHooks;
  events?: Partial<UrlFlowEventHooks>;
}): UrlFlowHooks {
  return {
    onExtracted: null,
    onLinkPreviewProgress: null,
    onModelChosen: null,
    onSummaryCached: null,
    ...options.events,
    ...options.runtime,
  };
}

export function composeUrlFlowHooks(
  base: UrlFlowHooks,
  overrides: Partial<UrlFlowHooks>,
): UrlFlowHooks {
  return { ...base, ...overrides };
}

export function createUrlFlowContext(options: {
  io: UrlFlowIo;
  flags: UrlFlowFlags;
  model: UrlFlowModel;
  cache: CacheState;
  mediaCache: MediaCache | null;
  runtimeHooks: UrlFlowRuntimeHooks;
  eventHooks?: Partial<UrlFlowEventHooks>;
}): UrlFlowContext {
  const { io, flags, model, cache, mediaCache, runtimeHooks, eventHooks } = options;
  return {
    cache,
    flags,
    hooks: createUrlFlowHooks({ events: eventHooks, runtime: runtimeHooks }),
    io,
    mediaCache,
    model,
  };
}

/**
 * Wiring struct for `runUrlFlow`.
 * CLI runner populates the full surface for extraction/cache/model logic.
 */
export interface UrlFlowContext {
  io: UrlFlowIo;
  flags: UrlFlowFlags;
  model: UrlFlowModel;
  cache: CacheState;
  mediaCache: MediaCache | null;
  hooks: UrlFlowHooks;
}
