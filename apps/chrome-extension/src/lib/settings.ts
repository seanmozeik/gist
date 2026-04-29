import {
  type ColorMode,
  type ColorScheme,
  defaultColorMode,
  defaultColorScheme,
  normalizeColorMode,
  normalizeColorScheme,
} from './theme';

export interface Settings {
  token: string;
  autoSummarize: boolean;
  hoverSummaries: boolean;
  chatEnabled: boolean;
  automationEnabled: boolean;
  slidesEnabled: boolean;
  slidesParallel: boolean;
  slidesOcrEnabled: boolean;
  slidesLayout: SlidesLayout;
  summaryTimestamps: boolean;
  extendedLogging: boolean;
  autoCliFallback: boolean;
  autoCliOrder: string;
  hoverPrompt: string;
  transcriber: string;
  model: string;
  length: string;
  language: string;
  promptOverride: string;
  maxChars: number;
  requestMode: string;
  firecrawlMode: string;
  markdownMode: string;
  preprocessMode: string;
  youtubeMode: string;
  timeout: string;
  retries: number | null;
  maxOutputTokens: string;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  colorScheme: ColorScheme;
  colorMode: ColorMode;
}

export type SlidesLayout = 'strip' | 'gallery';

const storageKey = 'settings';

const legacyFontFamilyMap = new Map<string, string>([
  [
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif',
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
  ],
]);

function normalizeFontFamily(value: unknown): string {
  if (typeof value !== 'string') {return defaultSettings.fontFamily;}
  const trimmed = value.trim();
  if (!trimmed) {return defaultSettings.fontFamily;}
  return legacyFontFamilyMap.get(trimmed) ?? trimmed;
}

function normalizeModel(value: unknown): string {
  if (typeof value !== 'string') {return defaultSettings.model;}
  const trimmed = value.trim();
  if (!trimmed) {return defaultSettings.model;}
  const lowered = trimmed.toLowerCase();
  if (lowered === 'auto' || lowered === 'free') {return lowered;}
  return trimmed;
}

function normalizeLength(value: unknown): string {
  if (typeof value !== 'string') {return defaultSettings.length;}
  const trimmed = value.trim();
  if (!trimmed) {return defaultSettings.length;}
  const lowered = trimmed.toLowerCase();
  if (lowered === 's') {return 'short';}
  if (lowered === 'm') {return 'medium';}
  if (lowered === 'l') {return 'long';}
  return lowered;
}

function normalizeLanguage(value: unknown): string {
  if (typeof value !== 'string') {return defaultSettings.language;}
  const trimmed = value.trim();
  if (!trimmed) {return defaultSettings.language;}
  return trimmed;
}

function normalizePromptOverride(value: unknown): string {
  if (typeof value !== 'string') {return defaultSettings.promptOverride;}
  return value;
}

function normalizeHoverPrompt(value: unknown): string {
  if (typeof value !== 'string') {return defaultSettings.hoverPrompt;}
  const trimmed = value.trim();
  if (!trimmed) {return defaultSettings.hoverPrompt;}
  return value;
}

function normalizeAutoCliOrder(value: unknown): string {
  const source =
    typeof value === 'string'
      ? value
      : (Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === 'string').join(',')
        : defaultSettings.autoCliOrder);
  const items = source
    .split(/[,\s]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  const out: string[] = [];
  for (const item of items) {
    if (
      item !== 'claude' &&
      item !== 'gemini' &&
      item !== 'codex' &&
      item !== 'agent' &&
      item !== 'openclaw' &&
      item !== 'opencode'
    ) {
      continue;
    }
    if (!out.includes(item)) {out.push(item);}
  }
  return out.length > 0 ? out.join(',') : defaultSettings.autoCliOrder;
}

function normalizeTranscriber(value: unknown): string {
  if (typeof value !== 'string') {return defaultSettings.transcriber;}
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {return defaultSettings.transcriber;}
  if (trimmed === 'whisper' || trimmed === 'parakeet' || trimmed === 'canary') {return trimmed;}
  return defaultSettings.transcriber;
}

function normalizeRequestMode(value: unknown): string {
  if (typeof value !== 'string') {return defaultSettings.requestMode;}
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {return defaultSettings.requestMode;}
  if (trimmed === 'page' || trimmed === 'url') {return trimmed;}
  return defaultSettings.requestMode;
}

function normalizeSlidesLayout(value: unknown): SlidesLayout {
  if (typeof value !== 'string') {return defaultSettings.slidesLayout;}
  const trimmed = value.trim().toLowerCase();
  if (trimmed === 'strip' || trimmed === 'summary') {return 'strip';}
  if (trimmed === 'gallery' || trimmed === 'slides') {return 'gallery';}
  return defaultSettings.slidesLayout;
}

function normalizeFirecrawlMode(value: unknown): string {
  if (typeof value !== 'string') {return defaultSettings.firecrawlMode;}
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {return defaultSettings.firecrawlMode;}
  if (trimmed === 'off' || trimmed === 'auto' || trimmed === 'always') {return trimmed;}
  return defaultSettings.firecrawlMode;
}

function normalizeMarkdownMode(value: unknown): string {
  if (typeof value !== 'string') {return defaultSettings.markdownMode;}
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {return defaultSettings.markdownMode;}
  if (trimmed === 'off' || trimmed === 'auto' || trimmed === 'llm' || trimmed === 'readability') {
    return trimmed;
  }
  return defaultSettings.markdownMode;
}

function normalizePreprocessMode(value: unknown): string {
  if (typeof value !== 'string') {return defaultSettings.preprocessMode;}
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {return defaultSettings.preprocessMode;}
  if (trimmed === 'off' || trimmed === 'auto' || trimmed === 'always') {return trimmed;}
  return defaultSettings.preprocessMode;
}

function normalizeYoutubeMode(value: unknown): string {
  if (typeof value !== 'string') {return defaultSettings.youtubeMode;}
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {return defaultSettings.youtubeMode;}
  if (
    trimmed === 'auto' ||
    trimmed === 'web' ||
    trimmed === 'apify' ||
    trimmed === 'yt-dlp' ||
    trimmed === 'no-auto'
  ) {
    return trimmed;
  }
  return defaultSettings.youtubeMode;
}

function normalizeTimeout(value: unknown): string {
  if (typeof value !== 'string') {return defaultSettings.timeout;}
  const trimmed = value.trim();
  if (!trimmed) {return defaultSettings.timeout;}
  return trimmed;
}

function normalizeRetries(value: unknown): number | null {
  if (value == null || value === '') {return defaultSettings.retries;}
  const numeric =
    typeof value === 'number'
      ? value
      : (typeof value === 'string'
        ? Number(value.trim())
        : Number.NaN);
  if (!Number.isFinite(numeric)) {return defaultSettings.retries;}
  const intValue = Math.trunc(numeric);
  if (intValue < 0 || intValue > 5) {return defaultSettings.retries;}
  return intValue;
}

function normalizeMaxOutputTokens(value: unknown): string {
  if (typeof value !== 'string') {return defaultSettings.maxOutputTokens;}
  return value.trim();
}

function normalizeLineHeight(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {return defaultSettings.lineHeight;}
  if (value < 1.1 || value > 2.2) {return defaultSettings.lineHeight;}
  return Math.round(value * 100) / 100;
}

export const defaultSettings: Settings = {
  autoCliFallback: true,
  autoCliOrder: 'claude,gemini,codex,agent,openclaw,opencode',
  autoSummarize: true,
  automationEnabled: false,
  chatEnabled: true,
  colorMode: defaultColorMode,
  colorScheme: defaultColorScheme,
  extendedLogging: false,
  firecrawlMode: '',
  fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
  fontSize: 14,
  hoverPrompt:
    'Plain text only (no Markdown). Summarize the linked page concisely in 1-2 sentences; aim for 100-200 characters.',
  hoverSummaries: false,
  language: 'auto',
  length: 'xl',
  lineHeight: 1.45,
  markdownMode: '',
  maxChars: 120_000,
  maxOutputTokens: '',
  model: 'auto',
  preprocessMode: '',
  promptOverride: '',
  requestMode: '',
  retries: null,
  slidesEnabled: true,
  slidesLayout: 'gallery',
  slidesOcrEnabled: false,
  slidesParallel: true,
  summaryTimestamps: true,
  timeout: '',
  token: '',
  transcriber: '',
  youtubeMode: '',
};

export async function loadSettings(): Promise<Settings> {
  const res = await new Promise<Record<string, unknown>>((resolve, reject) => {
    let settled = false;
    const maybePromise = chrome.storage.local.get(storageKey, (result) => {
      settled = true;
      resolve(result as Record<string, unknown>);
    });
    if (maybePromise && typeof (maybePromise as Promise<unknown>).then === 'function') {
      (maybePromise as Promise<Record<string, unknown>>)
        .then((result) => {
          if (settled) {return;}
          resolve(result as Record<string, unknown>);
        })
        .catch(reject);
    }
  });
  const raw = (res[storageKey] ?? {}) as Partial<Settings>;
  return {
    ...defaultSettings,
    ...raw,
    autoCliFallback:
      typeof raw.autoCliFallback === 'boolean'
        ? raw.autoCliFallback
        : typeof (raw as Record<string, unknown>).magicCliAuto === 'boolean'
          ? ((raw as Record<string, unknown>).magicCliAuto as boolean)
          : defaultSettings.autoCliFallback,
    autoCliOrder: normalizeAutoCliOrder(
      typeof raw.autoCliOrder !== 'undefined'
        ? raw.autoCliOrder
        : (raw as Record<string, unknown>).magicCliOrder,
    ),
    autoSummarize:
      typeof raw.autoSummarize === 'boolean' ? raw.autoSummarize : defaultSettings.autoSummarize,
    automationEnabled:
      typeof raw.automationEnabled === 'boolean'
        ? raw.automationEnabled
        : defaultSettings.automationEnabled,
    chatEnabled:
      typeof raw.chatEnabled === 'boolean' ? raw.chatEnabled : defaultSettings.chatEnabled,
    colorMode: normalizeColorMode(raw.colorMode),
    colorScheme: normalizeColorScheme(raw.colorScheme),
    extendedLogging:
      typeof raw.extendedLogging === 'boolean'
        ? raw.extendedLogging
        : defaultSettings.extendedLogging,
    firecrawlMode: normalizeFirecrawlMode(raw.firecrawlMode),
    fontFamily: normalizeFontFamily(raw.fontFamily),
    fontSize: typeof raw.fontSize === 'number' ? raw.fontSize : defaultSettings.fontSize,
    hoverPrompt: normalizeHoverPrompt(raw.hoverPrompt),
    hoverSummaries:
      typeof raw.hoverSummaries === 'boolean' ? raw.hoverSummaries : defaultSettings.hoverSummaries,
    language: normalizeLanguage(raw.language),
    length: normalizeLength(raw.length),
    lineHeight: normalizeLineHeight(raw.lineHeight),
    markdownMode: normalizeMarkdownMode(raw.markdownMode),
    maxChars: typeof raw.maxChars === 'number' ? raw.maxChars : defaultSettings.maxChars,
    maxOutputTokens: normalizeMaxOutputTokens(raw.maxOutputTokens),
    model: normalizeModel(raw.model),
    preprocessMode: normalizePreprocessMode(raw.preprocessMode),
    promptOverride: normalizePromptOverride(raw.promptOverride),
    requestMode: normalizeRequestMode(raw.requestMode),
    retries: normalizeRetries(raw.retries),
    slidesEnabled:
      typeof raw.slidesEnabled === 'boolean' ? raw.slidesEnabled : defaultSettings.slidesEnabled,
    slidesLayout: normalizeSlidesLayout(raw.slidesLayout),
    slidesOcrEnabled:
      typeof raw.slidesOcrEnabled === 'boolean'
        ? raw.slidesOcrEnabled
        : defaultSettings.slidesOcrEnabled,
    slidesParallel:
      typeof raw.slidesParallel === 'boolean' ? raw.slidesParallel : defaultSettings.slidesParallel,
    summaryTimestamps:
      typeof raw.summaryTimestamps === 'boolean'
        ? raw.summaryTimestamps
        : defaultSettings.summaryTimestamps,
    timeout: normalizeTimeout(raw.timeout),
    token: typeof raw.token === 'string' ? raw.token : defaultSettings.token,
    transcriber: normalizeTranscriber(raw.transcriber),
    youtubeMode: normalizeYoutubeMode(raw.youtubeMode),
  };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({
    [storageKey]: {
      ...settings,
      autoCliOrder: normalizeAutoCliOrder(settings.autoCliOrder),
      colorMode: normalizeColorMode(settings.colorMode),
      colorScheme: normalizeColorScheme(settings.colorScheme),
      firecrawlMode: normalizeFirecrawlMode(settings.firecrawlMode),
      fontFamily: normalizeFontFamily(settings.fontFamily),
      hoverPrompt: normalizeHoverPrompt(settings.hoverPrompt),
      language: normalizeLanguage(settings.language),
      length: normalizeLength(settings.length),
      lineHeight: normalizeLineHeight(settings.lineHeight),
      markdownMode: normalizeMarkdownMode(settings.markdownMode),
      maxOutputTokens: normalizeMaxOutputTokens(settings.maxOutputTokens),
      model: normalizeModel(settings.model),
      preprocessMode: normalizePreprocessMode(settings.preprocessMode),
      promptOverride: normalizePromptOverride(settings.promptOverride),
      requestMode: normalizeRequestMode(settings.requestMode),
      retries: normalizeRetries(settings.retries),
      slidesLayout: normalizeSlidesLayout(settings.slidesLayout),
      timeout: normalizeTimeout(settings.timeout),
      transcriber: normalizeTranscriber(settings.transcriber),
      youtubeMode: normalizeYoutubeMode(settings.youtubeMode),
    },
  });
}

export async function patchSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await loadSettings();
  const next = { ...current, ...patch };
  await saveSettings(next);
  return next;
}
