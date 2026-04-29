import { parseModelConfig, parseModelsConfig } from './config/model.js';
import { readParsedConfigFile, resolveSummarizeConfigPath } from './config/read.js';
import {
  parseApiKeysConfig,
  parseCacheConfig,
  parseCliConfig,
  parseEnvConfig,
  parseLocalConfig,
  parseLoggingConfig,
  parseMediaConfig,
  parseOpenAiConfig,
  parseOutputConfig,
  parseUiConfig,
} from './config/sections.js';
import type { SummarizeConfig } from './config/types.js';

export type {
  ApiKeysConfig,
  AutoRule,
  AutoRuleKind,
  CliAutoFallbackConfig,
  CliConfig,
  CliMagicAutoConfig,
  CliProvider,
  CliProviderConfig,
  EnvConfig,
  LocalConfig,
  LoggingConfig,
  LoggingFormat,
  LoggingLevel,
  MediaCacheConfig,
  MediaCacheVerifyMode,
  ModelConfig,
  OpenAiConfig,
  SummarizeConfig,
  VideoMode,
} from './config/types.js';

export { mergeConfigEnv, resolveConfigEnv } from './config/env.js';

export function loadSummarizeConfig({ env }: { env: Record<string, string | undefined> }): {
  config: SummarizeConfig | null;
  path: string | null;
} {
  const path = resolveSummarizeConfigPath(env);
  if (!path) {
    return { config: null, path: null };
  }
  const parsed = readParsedConfigFile(path);
  if (!parsed) {
    return { config: null, path };
  }

  const model = parseModelConfig(parsed.model, path, 'model');

  const language = (() => {
    const value = parsed.language;
    if (value === undefined) {
      return;
    }
    if (typeof value !== 'string') {
      throw new TypeError(`Invalid config file ${path}: "language" must be a string.`);
    }
    const trimmed = value.trim();
    if (!trimmed) {
      throw new Error(`Invalid config file ${path}: "language" must not be empty.`);
    }
    return trimmed;
  })();

  const prompt = (() => {
    const value = parsed.prompt;
    if (value === undefined) {
      return;
    }
    if (typeof value !== 'string') {
      throw new TypeError(`Invalid config file ${path}: "prompt" must be a string.`);
    }
    const trimmed = value.trim();
    if (!trimmed) {
      throw new Error(`Invalid config file ${path}: "prompt" must not be empty.`);
    }
    return trimmed;
  })();

  const models = parseModelsConfig(parsed, path);
  const cache = parseCacheConfig(parsed, path);
  const media = parseMediaConfig(parsed);
  const cli = parseCliConfig(parsed, path);
  const output = parseOutputConfig(parsed, path);
  const ui = parseUiConfig(parsed, path);
  const logging = parseLoggingConfig(parsed, path);
  const openai = parseOpenAiConfig(parsed, path);
  const local = parseLocalConfig(parsed, path);
  const configEnv = parseEnvConfig(parsed, path);
  const apiKeys = parseApiKeysConfig(parsed, path);

  return {
    config: {
      ...(model ? { model } : {}),
      ...(language ? { language } : {}),
      ...(prompt ? { prompt } : {}),
      ...(cache ? { cache } : {}),
      ...(models ? { models } : {}),
      ...(media ? { media } : {}),
      ...(output ? { output } : {}),
      ...(ui ? { ui } : {}),
      ...(cli ? { cli } : {}),
      ...(openai ? { openai } : {}),
      ...(local ? { local } : {}),
      ...(logging ? { logging } : {}),
      ...(configEnv ? { env: configEnv } : {}),
      ...(apiKeys ? { apiKeys } : {}),
    },
    path,
  };
}
