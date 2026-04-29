import type { CacheState } from '../cache.js';
import { type ExtractedLinkContent, isYouTubeUrl, type MediaCache } from '../content/index.js';
import type { RunMetricsReport } from '../costs.js';
import { buildFinishLineVariants, buildLengthPartsForFinishLine } from '../run/finish-line.js';
import { deriveExtractionUi } from '../run/flows/url/extract.js';
import { runUrlFlow } from '../run/flows/url/flow.js';
import { buildUrlPrompt, summarizeExtractedUrl } from '../run/flows/url/summary.js';
import type { RunOverrides } from '../run/run-settings.js';
import type {
  SlideExtractionResult,
  SlideImage,
  SlideSettings,
  SlideSourceKind,
} from '../slides/index.js';
import { createDaemonUrlFlowContext } from './flow-context.js';
import { countWords, estimateDurationSecondsFromWords, formatInputSummary } from './meta.js';
import { formatProgress } from './summarize-progress.js';

export interface VisiblePageInput {
  url: string;
  title: string | null;
  text: string;
  truncated: boolean;
}

export interface UrlModeInput { url: string; title: string | null; maxCharacters: number | null }

export interface StreamSink {
  writeChunk: (text: string) => void;
  onModelChosen: (modelId: string) => void;
  writeStatus?: ((text: string) => void) | null;
  writeMeta?:
    | ((data: { inputSummary?: string | null; summaryFromCache?: boolean | null }) => void)
    | null;
}

export interface VisiblePageMetrics {
  elapsedMs: number;
  summary: string;
  details: string | null;
  summaryDetailed: string;
  detailsDetailed: string | null;
}

function buildDaemonMetrics({
  elapsedMs,
  summaryFromCache,
  label,
  modelLabel,
  report,
  costUsd,
  compactExtraParts,
  detailedExtraParts,
}: {
  elapsedMs: number;
  summaryFromCache: boolean;
  label: string | null;
  modelLabel: string;
  report: RunMetricsReport;
  costUsd: number | null;
  compactExtraParts: string[] | null;
  detailedExtraParts: string[] | null;
}): VisiblePageMetrics {
  const elapsedLabel = summaryFromCache ? 'Cached' : null;
  const { compact, detailed } = buildFinishLineVariants({
    compactExtraParts,
    costUsd,
    detailedExtraParts,
    elapsedLabel,
    elapsedMs,
    label,
    model: modelLabel,
    report,
  });

  return {
    details: compact.details,
    detailsDetailed: detailed.details,
    elapsedMs,
    summary: compact.line,
    summaryDetailed: detailed.line,
  };
}

function guessSiteName(url: string): string | null {
  try {
    const { hostname } = new URL(url);
    return hostname || null;
  } catch {
    return null;
  }
}

function buildInputSummaryForExtracted(extracted: ExtractedLinkContent): string | null {
  const isYouTube = extracted.siteName === 'YouTube' || isYouTubeUrl(extracted.url);

  const transcriptChars =
    typeof extracted.transcriptCharacters === 'number' && extracted.transcriptCharacters > 0
      ? extracted.transcriptCharacters
      : null;
  const hasTranscript = transcriptChars != null;

  const transcriptWords =
    hasTranscript && transcriptChars != null
      ? (extracted.transcriptWordCount ?? Math.max(0, Math.round(transcriptChars / 6)))
      : null;

  const exactDurationSeconds =
    typeof extracted.mediaDurationSeconds === 'number' && extracted.mediaDurationSeconds > 0
      ? extracted.mediaDurationSeconds
      : null;
  const estimatedDurationSeconds =
    transcriptWords != null && transcriptWords > 0
      ? estimateDurationSecondsFromWords(transcriptWords)
      : null;

  const durationSeconds = hasTranscript ? (exactDurationSeconds ?? estimatedDurationSeconds) : null;
  const isDurationApproximate =
    hasTranscript && durationSeconds != null && exactDurationSeconds == null;

  const kindLabel = (() => {
    if (isYouTube) {return 'YouTube';}
    if (!hasTranscript) {return null;}
    if (extracted.isVideoOnly || extracted.video) {return 'video';}
    return 'podcast';
  })();

  return formatInputSummary({
    characters: hasTranscript ? transcriptChars : extracted.totalCharacters,
    durationSeconds,
    isDurationApproximate,
    kindLabel,
    words: hasTranscript ? transcriptWords : extracted.wordCount,
  });
}

export async function streamSummaryForVisiblePage({
  env,
  fetchImpl,
  input,
  modelOverride,
  promptOverride,
  lengthRaw,
  languageRaw,
  format,
  sink,
  cache,
  mediaCache,
  overrides,
}: {
  env: Record<string, string | undefined>;
  fetchImpl: typeof fetch;
  input: VisiblePageInput;
  modelOverride: string | null;
  promptOverride: string | null;
  lengthRaw: unknown;
  languageRaw: unknown;
  format?: 'text' | 'markdown';
  sink: StreamSink;
  cache: CacheState;
  mediaCache: MediaCache | null;
  overrides: RunOverrides;
}): Promise<{ usedModel: string; metrics: VisiblePageMetrics }> {
  const startedAt = Date.now();
  let usedModel: string | null = null;
  let summaryFromCache = false;

  const writeStatus = typeof sink.writeStatus === 'function' ? sink.writeStatus : null;

  const ctx = createDaemonUrlFlowContext({
    cache,
    env,
    fetchImpl,
    format,
    hooks: {
      onModelChosen: (modelId) => {
        usedModel = modelId;
        sink.onModelChosen(modelId);
      },
      onSummaryCached: (cached) => {
        summaryFromCache = cached;
        sink.writeMeta?.({ summaryFromCache: cached });
      },
    },
    languageRaw,
    lengthRaw,
    maxExtractCharacters: null,
    mediaCache,
    modelOverride,
    overrides,
    promptOverride,
    runStartedAtMs: startedAt,
    stdoutSink: { writeChunk: sink.writeChunk },
  });

  const extracted: ExtractedLinkContent = {
    content: input.text,
    description: null,
    diagnostics: {
      strategy: 'html',
      firecrawl: { attempted: false, used: false, cacheMode: cache.mode, cacheStatus: 'unknown' },
      markdown: { requested: false, used: false, provider: null },
      transcript: {
        cacheMode: cache.mode,
        cacheStatus: 'unknown',
        textProvided: false,
        provider: null,
        attemptedProviders: [],
      },
    } satisfies ExtractedLinkContent['diagnostics'],
    isVideoOnly: false,
    mediaDurationSeconds: null,
    siteName: guessSiteName(input.url),
    title: input.title,
    totalCharacters: input.text.length,
    transcriptCharacters: null,
    transcriptLines: null,
    transcriptMetadata: null,
    transcriptSegments: null,
    transcriptSource: null,
    transcriptTimedText: null,
    transcriptWordCount: null,
    transcriptionProvider: null,
    truncated: input.truncated,
    url: input.url,
    video: null,
    wordCount: countWords(input.text),
  };

  sink.writeMeta?.({
    inputSummary: formatInputSummary({
      characters: extracted.totalCharacters,
      durationSeconds: null,
      kindLabel: null,
      words: extracted.wordCount,
    }),
  });
  writeStatus?.('Summarizing…');

  const extractionUi = deriveExtractionUi(extracted);
  const prompt = buildUrlPrompt({
    extracted,
    languageInstruction: ctx.flags.languageInstruction ?? null,
    lengthArg: ctx.flags.lengthArg,
    lengthInstruction: ctx.flags.lengthInstruction ?? null,
    outputLanguage: ctx.flags.outputLanguage,
    promptOverride: ctx.flags.promptOverride ?? null,
  });

  await summarizeExtractedUrl({
    ctx,
    effectiveMarkdownMode: 'off',
    extracted,
    extractionUi,
    onModelChosen: ctx.hooks.onModelChosen ?? null,
    prompt,
    transcriptionCostLabel: null,
    url: input.url,
  });

  const report = await ctx.hooks.buildReport();
  const costUsd = await ctx.hooks.estimateCostUsd();
  const elapsedMs = Date.now() - startedAt;

  const label = extracted.siteName ?? guessSiteName(extracted.url);
  const modelLabel = usedModel ?? ctx.model.requestedModelLabel;
  return {
    metrics: buildDaemonMetrics({
      elapsedMs,
      summaryFromCache,
      label,
      modelLabel,
      report,
      costUsd,
      compactExtraParts: null,
      detailedExtraParts: null,
    }),
    usedModel: modelLabel,
  };
}

export async function streamSummaryForUrl({
  env,
  fetchImpl,
  input,
  modelOverride,
  promptOverride,
  lengthRaw,
  languageRaw,
  format,
  sink,
  cache,
  mediaCache,
  overrides,
  slides,
  hooks,
}: {
  env: Record<string, string | undefined>;
  fetchImpl: typeof fetch;
  input: UrlModeInput;
  modelOverride: string | null;
  promptOverride: string | null;
  lengthRaw: unknown;
  languageRaw: unknown;
  format?: 'text' | 'markdown';
  sink: StreamSink;
  cache: CacheState;
  mediaCache: MediaCache | null;
  overrides: RunOverrides;
  slides?: SlideSettings | null;
  hooks?: {
    onExtracted?: ((extracted: ExtractedLinkContent) => void) | null;
    onSlidesExtracted?: ((slides: SlideExtractionResult) => void) | null;
    onSlidesProgress?: ((text: string) => void) | null;
    onSlidesDone?: ((result: { ok: boolean; error?: string | null }) => void) | null;
    onSlideChunk?: (chunk: {
      slide: SlideImage;
      meta: {
        slidesDir: string;
        sourceUrl: string;
        sourceId: string;
        sourceKind: SlideSourceKind;
        ocrAvailable: boolean;
      };
    }) => void;
  } | null;
}): Promise<{ usedModel: string; metrics: VisiblePageMetrics }> {
  const startedAt = Date.now();
  let usedModel: string | null = null;
  let summaryFromCache = false;
  const extractedRef = { value: null as ExtractedLinkContent | null };

  const writeStatus = typeof sink.writeStatus === 'function' ? sink.writeStatus : null;

  const ctx = createDaemonUrlFlowContext({
    cache,
    env,
    fetchImpl,
    format,
    hooks: {
      onExtracted: (content) => {
        extractedRef.value = content;
        hooks?.onExtracted?.(content);
        sink.writeMeta?.({ inputSummary: buildInputSummaryForExtracted(content) });
        writeStatus?.('Summarizing…');
      },
      onLinkPreviewProgress: (event) => {
        const msg = formatProgress(event);
        if (msg) writeStatus?.(msg);
      },
      onModelChosen: (modelId) => {
        usedModel = modelId;
        sink.onModelChosen(modelId);
      },
      onSlideChunk: hooks?.onSlideChunk ?? undefined,
      onSlidesDone: (result) => {
        hooks?.onSlidesDone?.(result);
      },
      onSlidesExtracted: (result) => {
        hooks?.onSlidesExtracted?.(result);
      },
      onSlidesProgress: (text: string) => {
        const trimmed = typeof text === 'string' ? text.trim() : '';
        if (!trimmed) return;
        hooks?.onSlidesProgress?.(trimmed);
        writeStatus?.(trimmed);
      },
      onSummaryCached: (cached) => {
        summaryFromCache = cached;
        sink.writeMeta?.({ summaryFromCache: cached });
      },
    },
    languageRaw,
    lengthRaw,
    maxExtractCharacters:
      input.maxCharacters && input.maxCharacters > 0 ? input.maxCharacters : null,
    mediaCache,
    modelOverride,
    overrides,
    promptOverride,
    runStartedAtMs: startedAt,
    slides,
    stdoutSink: { writeChunk: sink.writeChunk },
  });

  writeStatus?.('Extracting…');
  await runUrlFlow({ ctx, isYoutubeUrl: isYouTubeUrl(input.url), url: input.url });

  const extracted = extractedRef.value;
  if (!extracted) {
    throw new Error('Internal error: missing extracted content');
  }

  const report = await ctx.hooks.buildReport();
  const costUsd = await ctx.hooks.estimateCostUsd();
  const elapsedMs = Date.now() - startedAt;

  const label = extracted.siteName ?? guessSiteName(extracted.url);
  const modelLabel = usedModel ?? ctx.model.requestedModelLabel;
  const compactExtraParts = buildLengthPartsForFinishLine(extracted, false);
  const detailedExtraParts = buildLengthPartsForFinishLine(extracted, true);

  return {
    metrics: buildDaemonMetrics({
      elapsedMs,
      summaryFromCache,
      label,
      modelLabel,
      report,
      costUsd,
      compactExtraParts,
      detailedExtraParts,
    }),
    usedModel: modelLabel,
  };
}

export async function extractContentForUrl({
  env,
  fetchImpl,
  input,
  cache,
  mediaCache,
  overrides,
  format,
  slides,
  hooks,
}: {
  env: Record<string, string | undefined>;
  fetchImpl: typeof fetch;
  input: UrlModeInput;
  cache: CacheState;
  mediaCache: MediaCache | null;
  overrides: RunOverrides;
  format?: 'text' | 'markdown';
  slides?: SlideSettings | null;
  hooks?: { onSlidesExtracted?: ((slides: SlideExtractionResult) => void) | null } | null;
}): Promise<{ extracted: ExtractedLinkContent; slides: SlideExtractionResult | null }> {
  const extractedRef = { value: null as ExtractedLinkContent | null };
  const slidesRef = { value: null as SlideExtractionResult | null };

  const ctx = createDaemonUrlFlowContext({
    cache,
    env,
    extractOnly: true,
    fetchImpl,
    format,
    hooks: {
      onExtracted: (content) => {
        extractedRef.value = content;
      },
      onSlidesExtracted: (result) => {
        slidesRef.value = result;
        hooks?.onSlidesExtracted?.(result);
      },
    },
    languageRaw: '',
    lengthRaw: '',
    maxExtractCharacters:
      input.maxCharacters && input.maxCharacters > 0 ? input.maxCharacters : null,
    mediaCache,
    modelOverride: null,
    overrides,
    promptOverride: null,
    runStartedAtMs: Date.now(),
    slides,
    stdoutSink: { writeChunk: () => {} },
  });

  await runUrlFlow({ ctx, isYoutubeUrl: isYouTubeUrl(input.url), url: input.url });

  const extracted = extractedRef.value;
  if (!extracted) {
    throw new Error('Internal error: missing extracted content');
  }

  return { extracted, slides: slidesRef.value };
}
