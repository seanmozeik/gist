import type { CliProvider } from '../config.js';
import type { LengthArg, MarkdownMode, PreprocessMode, VideoMode, YoutubeMode } from '../flags.js';
import {
  parseDurationMs,
  parseLengthArg,
  parseMarkdownMode,
  parseMaxOutputTokensArg,
  parsePreprocessMode,
  parseRetriesArg,
  parseVideoMode,
  parseYoutubeMode,
} from '../flags.js';
import type { OutputLanguage } from '../language.js';
import { resolveOutputLanguage } from '../language.js';
import { formatPresetLengthGuidance, type SummaryLengthTarget } from '../prompts/index.js';
import {
  parseOptionalBoolean,
  parseOptionalCliProviderOrder,
  parseOptionalSetting,
} from './run-settings-parse.js';

export interface ResolvedRunSettings {
  lengthArg: LengthArg;
  markdownMode: MarkdownMode;
  preprocessMode: PreprocessMode;
  youtubeMode: YoutubeMode;
  timeoutMs: number;
  retries: number;
  maxOutputTokensArg: number | null;
}

export interface RunOverrides {
  markdownMode: MarkdownMode | null;
  preprocessMode: PreprocessMode | null;
  youtubeMode: YoutubeMode | null;
  videoMode: VideoMode | null;
  transcriptTimestamps: boolean | null;
  forceSummary: boolean | null;
  timeoutMs: number | null;
  retries: number | null;
  maxOutputTokensArg: number | null;
  autoCliFallbackEnabled: boolean | null;
  autoCliOrder: CliProvider[] | null;
}

export interface RunOverridesInput {
  markdownMode?: unknown;
  preprocess?: unknown;
  youtube?: unknown;
  videoMode?: unknown;
  timestamps?: unknown;
  forceSummary?: unknown;
  timeout?: unknown;
  retries?: unknown;
  maxOutputTokens?: unknown;
  autoCliFallback?: unknown;
  autoCliOrder?: unknown;
  autoCliRememberLastSuccess?: unknown;
  // Legacy aliases (kept for compatibility with older configs).
  magicCliAuto?: unknown;
  magicCliOrder?: unknown;
  magicCliRememberLastSuccess?: unknown;
}

export function resolveSummaryLength(
  raw: unknown,
  fallback = 'xl',
): { lengthArg: LengthArg; summaryLength: SummaryLengthTarget } {
  const value = typeof raw === 'string' ? raw.trim() : '';
  const lengthArg = parseLengthArg(value || fallback);
  const summaryLength =
    lengthArg.kind === 'preset' ? lengthArg.preset : { maxCharacters: lengthArg.maxCharacters };
  return { lengthArg, summaryLength };
}

export function buildPromptLengthInstruction(lengthArg: LengthArg): string {
  return lengthArg.kind === 'chars'
    ? `Output is ${lengthArg.maxCharacters.toLocaleString()} characters.`
    : formatPresetLengthGuidance(lengthArg.preset);
}

export function resolveOutputLanguageSetting({
  raw,
  fallback,
}: {
  raw: unknown;
  fallback: OutputLanguage;
}): OutputLanguage {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) {
    return fallback;
  }
  return resolveOutputLanguage(value);
}

export function resolveCliRunSettings({
  length,
  markdownMode,
  markdown,
  format,
  preprocess,
  youtube,
  timeout,
  retries,
  maxOutputTokens,
}: {
  length: string;
  markdownMode?: string | undefined;
  markdown?: string | undefined;
  format: 'text' | 'markdown';
  preprocess: string;
  youtube: string;
  timeout: string;
  retries: string;
  maxOutputTokens?: string | undefined;
}): ResolvedRunSettings {
  const strictOverrides = resolveRunOverrides(
    {
      markdownMode: format === 'markdown' ? (markdownMode ?? markdown ?? 'readability') : 'off',
      maxOutputTokens,
      preprocess,
      retries,
      timeout,
      youtube,
    },
    { strict: true },
  );
  const requireOverride = <T>(value: T | null, label: string): T => {
    if (value == null) {
      throw new Error(`Missing ${label} override value.`);
    }
    return value;
  };

  return {
    lengthArg: parseLengthArg(length),
    markdownMode: requireOverride(strictOverrides.markdownMode, '--markdown-mode'),
    maxOutputTokensArg: strictOverrides.maxOutputTokensArg,
    preprocessMode: requireOverride(strictOverrides.preprocessMode, '--preprocess'),
    retries: requireOverride(strictOverrides.retries, '--retries'),
    timeoutMs: requireOverride(strictOverrides.timeoutMs, '--timeout'),
    youtubeMode: requireOverride(strictOverrides.youtubeMode, '--youtube'),
  };
}

export function resolveRunOverrides(
  {
    markdownMode,
    preprocess,
    youtube,
    videoMode,
    timestamps,
    forceSummary,
    timeout,
    retries,
    maxOutputTokens,
    autoCliFallback,
    autoCliOrder,
    magicCliAuto,
    magicCliOrder,
  }: RunOverridesInput,
  options: { strict?: boolean } = {},
): RunOverrides {
  const strict = options.strict ?? false;
  const timeoutMs = (() => {
    if (typeof timeout === 'number') {
      if (Number.isFinite(timeout) && timeout > 0) {
        return Math.floor(timeout);
      }
      if (strict) {
        throw new Error(`Unsupported --timeout: ${String(timeout)}`);
      }
      return null;
    }
    if (typeof timeout !== 'string') {
      return null;
    }
    try {
      return parseDurationMs(timeout);
    } catch (error) {
      if (strict) {
        throw error;
      }
      return null;
    }
  })();

  const retriesResolved = (() => {
    if (typeof retries === 'number') {
      if (Number.isFinite(retries) && Number.isInteger(retries)) {
        try {
          return parseRetriesArg(String(retries));
        } catch (error) {
          if (strict) {
            throw error;
          }
          return null;
        }
      }
      if (strict) {
        throw new Error(`Unsupported --retries: ${String(retries)}`);
      }
      return null;
    }
    if (typeof retries !== 'string') {
      return null;
    }
    try {
      return parseRetriesArg(retries);
    } catch (error) {
      if (strict) {
        throw error;
      }
      return null;
    }
  })();

  const maxOutputTokensArg = (() => {
    if (typeof maxOutputTokens === 'number') {
      if (Number.isFinite(maxOutputTokens) && maxOutputTokens > 0) {
        try {
          return parseMaxOutputTokensArg(String(maxOutputTokens));
        } catch (error) {
          if (strict) {
            throw error;
          }
          return null;
        }
      }
      if (strict) {
        throw new Error(`Unsupported --max-output-tokens: ${String(maxOutputTokens)}`);
      }
      return null;
    }
    if (typeof maxOutputTokens !== 'string') {
      return null;
    }
    try {
      return parseMaxOutputTokensArg(maxOutputTokens);
    } catch (error) {
      if (strict) {
        throw error;
      }
      return null;
    }
  })();

  const forceSummaryResolved = parseOptionalBoolean(forceSummary, strict, '--force-summary');
  const autoCliFallbackEnabled = parseOptionalBoolean(
    autoCliFallback !== undefined ? autoCliFallback : magicCliAuto,
    strict,
    '--auto-cli-fallback',
  );
  const autoCliOrderResolved = parseOptionalCliProviderOrder(
    autoCliOrder !== undefined ? autoCliOrder : magicCliOrder,
    strict,
  );

  return {
    autoCliFallbackEnabled,
    autoCliOrder: autoCliOrderResolved,
    forceSummary: forceSummaryResolved,
    markdownMode: parseOptionalSetting(markdownMode, parseMarkdownMode, strict),
    maxOutputTokensArg,
    preprocessMode: parseOptionalSetting(preprocess, parsePreprocessMode, strict),
    retries: retriesResolved,
    timeoutMs,
    transcriptTimestamps: parseOptionalBoolean(timestamps, strict, '--timestamps'),
    videoMode: parseOptionalSetting(videoMode, parseVideoMode, strict),
    youtubeMode: parseOptionalSetting(youtube, parseYoutubeMode, strict),
  };
}
