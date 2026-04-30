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
  openrouterApiKey: string | null;
  ytDlpPath: string | null;
  ytDlpCookiesFromBrowser: string | null;
  localBaseUrl: string | null;
}) {
  return { hasOpenRouterKey: Boolean(apiStatus.openrouterApiKey) };
}
