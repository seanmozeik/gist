import { formatOutputLanguageForJson } from '../../../language.js';
import type { UrlFlowContext } from './types.js';

export function buildUrlJsonInput(options: {
  flags: UrlFlowContext['flags'];
  url: string;
  effectiveMarkdownMode: 'off' | 'auto' | 'llm' | 'readability';
  modelLabel: string | null;
}) {
  const { flags, url, effectiveMarkdownMode, modelLabel } = options;
  return {
    firecrawl: flags.firecrawlMode,
    format: flags.format,
    kind: 'url' as const,
    language: formatOutputLanguageForJson(flags.outputLanguage),
    length:
      flags.lengthArg.kind === 'preset'
        ? { kind: 'preset' as const, preset: flags.lengthArg.preset }
        : { kind: 'chars' as const, maxCharacters: flags.lengthArg.maxCharacters },
    markdown: effectiveMarkdownMode,
    maxOutputTokens: flags.maxOutputTokensArg,
    model: modelLabel,
    timeoutMs: flags.timeoutMs,
    timestamps: flags.transcriptTimestamps,
    url,
    youtube: flags.youtubeMode,
  };
}

export function buildUrlJsonEnv(apiStatus: {
  xaiApiKey: string | null;
  apiKey: string | null;
  openrouterApiKey: string | null;
  apifyToken: string | null;
  firecrawlConfigured: boolean;
  googleConfigured: boolean;
  anthropicConfigured: boolean;
}) {
  return {
    hasAnthropicKey: apiStatus.anthropicConfigured,
    hasApifyToken: Boolean(apiStatus.apifyToken),
    hasFirecrawlKey: apiStatus.firecrawlConfigured,
    hasGoogleKey: apiStatus.googleConfigured,
    hasOpenAIKey: Boolean(apiStatus.apiKey),
    hasOpenRouterKey: Boolean(apiStatus.openrouterApiKey),
    hasXaiKey: Boolean(apiStatus.xaiApiKey),
  };
}
