import {
  type LengthArg,
  type MarkdownMode,
  type PreprocessMode,
  parseExtractFormat,
  parseMaxExtractCharactersArg,
  parseMetricsMode,
  parseStreamMode,
  type YoutubeMode,
} from '../flags.js';
import { resolveCliRunSettings } from './run-settings.js';

export interface RunnerFlagResolution {
  videoModeExplicitlySet: boolean;
  lengthExplicitlySet: boolean;
  languageExplicitlySet: boolean;
  noCacheFlag: boolean;
  noMediaCacheFlag: boolean;
  extractMode: boolean;
  json: boolean;
  forceSummary: boolean;
  streamMode: ReturnType<typeof parseStreamMode>;
  plain: boolean;
  debug: boolean;
  verbose: boolean;
  maxExtractCharacters: ReturnType<typeof parseMaxExtractCharactersArg>;
  isYoutubeUrl: boolean;
  format: ReturnType<typeof parseExtractFormat>;
  youtubeMode: YoutubeMode;
  lengthArg: LengthArg;
  maxOutputTokensArg: number | null;
  timeoutMs: number;
  retries: number;
  preprocessMode: PreprocessMode;
  markdownMode: MarkdownMode;
  metricsMode: ReturnType<typeof parseMetricsMode>;
  metricsEnabled: boolean;
  metricsDetailed: boolean;
  shouldComputeReport: boolean;
  markdownModeExplicitlySet: boolean;
}

const hasFlag = (normalizedArgv: readonly string[], ...names: readonly string[]) =>
  normalizedArgv.some((arg) => names.some((name) => arg === name || arg.startsWith(`${name}=`)));

export function resolveRunnerFlags({
  normalizedArgv,
  programOpts,
  url,
}: {
  normalizedArgv: readonly string[];
  programOpts: Record<string, unknown>;
  url: string | null;
}): RunnerFlagResolution {
  const videoModeExplicitlySet = hasFlag(normalizedArgv, '--video-mode');
  const lengthExplicitlySet = hasFlag(normalizedArgv, '--length');
  const languageExplicitlySet = hasFlag(normalizedArgv, '--language', '--lang');
  const noCacheFlag = programOpts.cache === false;
  const noMediaCacheFlag = programOpts.mediaCache === false;
  const extractMode = Boolean(programOpts.extract) || Boolean(programOpts.extractOnly);
  const json = Boolean(programOpts.json);
  const forceSummary = Boolean(programOpts.forceSummary);
  const streamMode = parseStreamMode(String(programOpts.stream));
  const plain = Boolean(programOpts.plain);
  const debug = Boolean(programOpts.debug);
  const verbose = Boolean(programOpts.verbose) || debug;

  const maxExtractCharacters = parseMaxExtractCharactersArg(
    typeof programOpts.maxExtractCharacters === 'string'
      ? programOpts.maxExtractCharacters
      : programOpts.maxExtractCharacters != null
        ? String(programOpts.maxExtractCharacters)
        : undefined,
  );

  const isYoutubeUrl = typeof url === 'string' ? /youtube\.com|youtu\.be/i.test(url) : false;
  const formatExplicitlySet = hasFlag(normalizedArgv, '--format');
  const rawFormatOpt = typeof programOpts.format === 'string' ? programOpts.format : null;
  const format = parseExtractFormat(
    formatExplicitlySet ? (rawFormatOpt ?? 'text') : extractMode && !isYoutubeUrl ? 'md' : 'text',
  );

  const runSettings = resolveCliRunSettings({
    format,
    length: String(programOpts.length),
    markdown: typeof programOpts.markdown === 'string' ? programOpts.markdown : undefined,
    markdownMode:
      typeof programOpts.markdownMode === 'string' ? programOpts.markdownMode : undefined,
    maxOutputTokens:
      typeof programOpts.maxOutputTokens === 'string'
        ? programOpts.maxOutputTokens
        : programOpts.maxOutputTokens != null
          ? String(programOpts.maxOutputTokens)
          : undefined,
    preprocess: String(programOpts.preprocess),
    retries: String(programOpts.retries),
    timeout: String(programOpts.timeout),
    youtube: String(programOpts.youtube),
  });

  const metricsExplicitlySet = hasFlag(normalizedArgv, '--metrics');
  const metricsMode = parseMetricsMode(
    debug && !metricsExplicitlySet ? 'detailed' : String(programOpts.metrics),
  );
  const metricsEnabled = metricsMode !== 'off';
  const metricsDetailed = metricsMode === 'detailed';

  return {
    debug,
    extractMode,
    forceSummary,
    format,
    isYoutubeUrl,
    json,
    languageExplicitlySet,
    lengthArg: runSettings.lengthArg,
    lengthExplicitlySet,
    markdownMode: runSettings.markdownMode,
    markdownModeExplicitlySet: hasFlag(normalizedArgv, '--markdown-mode', '--markdown'),
    maxExtractCharacters,
    maxOutputTokensArg: runSettings.maxOutputTokensArg,
    metricsDetailed,
    metricsEnabled,
    metricsMode,
    noCacheFlag,
    noMediaCacheFlag,
    plain,
    preprocessMode: runSettings.preprocessMode,
    retries: runSettings.retries,
    shouldComputeReport: metricsEnabled,
    streamMode,
    timeoutMs: runSettings.timeoutMs,
    verbose,
    videoModeExplicitlySet,
    youtubeMode: runSettings.youtubeMode,
  };
}
