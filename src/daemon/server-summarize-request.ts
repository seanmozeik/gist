import type http from 'node:http';

import { resolveRunOverrides } from '../run/run-settings.js';
import type { SlideSettings } from '../slides/index.js';
import { resolveSlideSettings } from '../slides/index.js';
import type { DaemonRequestedMode } from './auto-mode.js';
import { json, readJsonBody } from './server-http.js';

export function parseDiagnostics(raw: unknown): { includeContent: boolean } {
  if (!raw || typeof raw !== 'object') {
    return { includeContent: false };
  }
  const obj = raw as Record<string, unknown>;
  return { includeContent: Boolean(obj.includeContent) };
}

export function resolveHomeDir(env: Record<string, string | undefined>): string {
  const home = env.HOME?.trim() ?? env.USERPROFILE?.trim();
  if (!home) {return process.cwd();}
  return home;
}

function resolveRequestSlidesSettings({
  env,
  request,
  resolveToolPath,
}: {
  env: Record<string, string | undefined>;
  request: Record<string, unknown>;
  resolveToolPath: (
    binary: string,
    env: Record<string, string | undefined>,
    explicitEnvKey?: string,
  ) => string | null;
}): SlideSettings | null {
  const slidesValue = request.slides;
  const tesseractAvailable = resolveToolPath('tesseract', env, 'TESSERACT_PATH') !== null;
  const slidesOcrValue = tesseractAvailable ? request.slidesOcr : false;
  return resolveSlideSettings({
    cwd: resolveHomeDir(env),
    slides: slidesValue,
    slidesDir: request.slidesDir ?? '.summarize/slides',
    slidesMax: request.slidesMax,
    slidesMinDuration: request.slidesMinDuration,
    slidesOcr: slidesOcrValue,
    slidesSceneThreshold: request.slidesSceneThreshold,
    slidesSceneThresholdExplicit: typeof request.slidesSceneThreshold !== 'undefined',
  });
}

export interface ParsedSummarizeRequest {
  pageUrl: string;
  title: string | null;
  textContent: string;
  truncated: boolean;
  modelOverride: string | null;
  lengthRaw: string;
  languageRaw: string;
  promptOverride: string | null;
  noCache: boolean;
  extractOnly: boolean;
  mode: DaemonRequestedMode;
  maxCharacters: number | null;
  format: 'text' | 'markdown';
  overrides: ReturnType<typeof resolveRunOverrides>;
  slidesSettings: SlideSettings | null;
  diagnostics: { includeContent: boolean };
  hasText: boolean;
}

export async function parseSummarizeRequest({
  req,
  res,
  cors,
  env,
  resolveToolPath,
}: {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  cors: Record<string, string>;
  env: Record<string, string | undefined>;
  resolveToolPath: (
    binary: string,
    env: Record<string, string | undefined>,
    explicitEnvKey?: string,
  ) => string | null;
}): Promise<ParsedSummarizeRequest | null> {
  let body: unknown;
  try {
    body = await readJsonBody(req, 2_000_000);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    json(res, 400, { error: message, ok: false }, cors);
    return null;
  }
  if (!body || typeof body !== 'object') {
    json(res, 400, { error: 'invalid json', ok: false }, cors);
    return null;
  }

  const obj = body as Record<string, unknown>;
  const pageUrl = typeof obj.url === 'string' ? obj.url.trim() : '';
  const title = typeof obj.title === 'string' ? obj.title.trim() : null;
  const textContent = typeof obj.text === 'string' ? obj.text : '';
  const truncated = Boolean(obj.truncated);
  const modelOverride = typeof obj.model === 'string' ? obj.model.trim() : null;
  const lengthRaw = typeof obj.length === 'string' ? obj.length.trim() : '';
  const languageRaw = typeof obj.language === 'string' ? obj.language.trim() : '';
  const promptRaw = typeof obj.prompt === 'string' ? obj.prompt : '';
  const promptOverride = promptRaw.trim() || null;
  const noCache = Boolean(obj.noCache);
  const extractOnly = Boolean(obj.extractOnly);
  const modeRaw = typeof obj.mode === 'string' ? obj.mode.trim().toLowerCase() : '';
  const mode: DaemonRequestedMode =
    modeRaw === 'url' ? 'url' : (modeRaw === 'page' ? 'page' : 'auto');
  const maxCharactersCandidate =
    typeof obj.maxExtractCharacters === 'number' && Number.isFinite(obj.maxExtractCharacters)
      ? obj.maxExtractCharacters
      : (typeof obj.maxCharacters === 'number' && Number.isFinite(obj.maxCharacters)
        ? obj.maxCharacters
        : null);
  const maxCharacters =
    maxCharactersCandidate && maxCharactersCandidate > 0 ? maxCharactersCandidate : null;
  const formatRaw = typeof obj.format === 'string' ? obj.format.trim().toLowerCase() : '';
  const format: 'text' | 'markdown' =
    formatRaw === 'markdown' || formatRaw === 'md' ? 'markdown' : 'text';
  const overrides = resolveRunOverrides({
    autoCliFallback: obj.autoCliFallback,
    autoCliOrder: obj.autoCliOrder,
    firecrawl: obj.firecrawl,
    forceSummary: obj.forceSummary,
    magicCliAuto: obj.magicCliAuto,
    magicCliOrder: obj.magicCliOrder,
    markdownMode: obj.markdownMode,
    maxOutputTokens: obj.maxOutputTokens,
    preprocess: obj.preprocess,
    retries: obj.retries,
    timeout: obj.timeout,
    timestamps: obj.timestamps,
    videoMode: obj.videoMode,
    youtube: obj.youtube,
  });
  const slidesSettings = resolveRequestSlidesSettings({ env, request: obj, resolveToolPath });
  const diagnostics = parseDiagnostics(obj.diagnostics);
  const hasText = Boolean(textContent.trim());

  if (!pageUrl || !/^https?:\/\//i.test(pageUrl)) {
    json(res, 400, { error: 'missing url', ok: false }, cors);
    return null;
  }

  if (extractOnly && mode === 'page') {
    json(res, 400, { error: 'extractOnly requires mode=url', ok: false }, cors);
    return null;
  }

  if (mode === 'page' && !hasText) {
    json(res, 400, { error: 'missing text', ok: false }, cors);
    return null;
  }

  return {
    diagnostics,
    extractOnly,
    format,
    hasText,
    languageRaw,
    lengthRaw,
    maxCharacters,
    mode,
    modelOverride,
    noCache,
    overrides,
    pageUrl,
    promptOverride,
    slidesSettings,
    textContent,
    title,
    truncated,
  };
}
