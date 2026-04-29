import { getModels } from '@mariozechner/pi-ai';
import { isOpenRouterBaseUrl } from '@steipete/summarize-core';

import type { SummarizeConfig } from '../config.js';
import { resolveCliAvailability } from '../run/env.js';
import { resolveEnvState } from '../run/run-env.js';

export interface ModelPickerOption { id: string; label: string }

function uniqById(options: ModelPickerOption[]): ModelPickerOption[] {
  const seen = new Set<string>();
  const out: ModelPickerOption[] = [];
  for (const opt of options) {
    const id = opt.id.trim();
    if (!id) {continue;}
    if (seen.has(id)) {continue;}
    seen.add(id);
    out.push({ id, label: opt.label.trim() || id });
  }
  return out;
}

function isProbablyOpenRouterBaseUrl(baseUrl: string): boolean {
  return isOpenRouterBaseUrl(baseUrl);
}

function isProbablyZaiBaseUrl(baseUrl: string): boolean {
  return /api\.z\.ai/i.test(baseUrl);
}

function describeBaseUrlHost(baseUrl: string): string | null {
  try {
    const url = new URL(baseUrl);
    const host = url.host.trim();
    return host.length > 0 ? host : null;
  } catch {
    return null;
  }
}

function pushPiAiModels({
  options,
  provider,
  prefix,
  labelPrefix,
}: {
  options: ModelPickerOption[];
  provider: Parameters<typeof getModels>[0];
  prefix: string;
  labelPrefix: string;
}) {
  const models = [...getModels(provider)]
    .toSorted((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id));
  for (const m of models) {
    const id = `${prefix}${m.id}`;
    const label = `${labelPrefix}${m.name ?? m.id}`;
    options.push({ id, label });
  }
}

async function discoverOpenAiCompatibleModelIds({
  baseUrl,
  apiKey,
  fetchImpl,
  timeoutMs,
}: {
  baseUrl: string;
  apiKey: string | null;
  fetchImpl: typeof fetch;
  timeoutMs: number;
}): Promise<string[]> {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const modelsUrl = new URL('models', base).toString();

  const controller = new AbortController();
  const timeout = setTimeout(() =>{  controller.abort(); }, timeoutMs);
  try {
    const res = await fetchImpl(modelsUrl, {
      headers: apiKey ? { authorization: `Bearer ${apiKey}` } : undefined,
      method: 'GET',
      signal: controller.signal,
    });
    if (!res.ok) {return [];}
    const json = (await res.json()) as unknown;
    if (!json || typeof json !== 'object') {return [];}

    const obj = json as Record<string, unknown>;
    const {data} = obj;
    if (Array.isArray(data)) {
      const ids = data
        .map((item) => (item && typeof item === 'object' ? (item as { id?: unknown }).id : null))
        .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
        .map((id) => id.trim());
      return [...new Set(ids)].toSorted((a, b) => a.localeCompare(b));
    }

    const {models} = obj;
    if (Array.isArray(models)) {
      const ids = models
        .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
        .map((id) => id.trim());
      return [...new Set(ids)].toSorted((a, b) => a.localeCompare(b));
    }

    return [];
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

export async function buildModelPickerOptions({
  env,
  envForRun,
  configForCli,
  fetchImpl,
}: {
  env: Record<string, string | undefined>;
  envForRun: Record<string, string | undefined>;
  configForCli: SummarizeConfig | null;
  fetchImpl: typeof fetch;
}): Promise<{
  ok: true;
  options: ModelPickerOption[];
  providers: {
    xai: boolean;
    openai: boolean;
    nvidia: boolean;
    google: boolean;
    anthropic: boolean;
    openrouter: boolean;
    zai: boolean;
    cliClaude: boolean;
    cliGemini: boolean;
    cliCodex: boolean;
    cliAgent: boolean;
    cliOpenclaw: boolean;
    cliOpencode: boolean;
  };
  openaiBaseUrl: string | null;
  localModelsSource: { kind: 'openai-compatible'; baseUrlHost: string } | null;
}> {
  const envState = resolveEnvState({ configForCli, env, envForRun });

  const providers = {
    anthropic: envState.anthropicConfigured,
    cliAgent: false,
    cliClaude: false,
    cliCodex: false,
    cliGemini: false,
    cliOpenclaw: false,
    cliOpencode: false,
    google: envState.googleConfigured,
    nvidia: Boolean(envState.nvidiaApiKey),
    openai: Boolean(envState.apiKey),
    openrouter: envState.openrouterConfigured,
    xai: Boolean(envState.xaiApiKey),
    zai: Boolean(envState.zaiApiKey),
  };
  const cliAvailability = resolveCliAvailability({ config: configForCli, env: envForRun });
  providers.cliClaude = Boolean(cliAvailability.claude);
  providers.cliGemini = Boolean(cliAvailability.gemini);
  providers.cliCodex = Boolean(cliAvailability.codex);
  providers.cliAgent = Boolean(cliAvailability.agent);
  providers.cliOpenclaw = Boolean(cliAvailability.openclaw);
  providers.cliOpencode = Boolean(cliAvailability.opencode);

  const options: ModelPickerOption[] = [
    { id: 'auto', label: 'Auto' },
    { id: 'fast', label: 'OpenAI GPT-5.5 Fast' },
    { id: 'codex-fast', label: 'GPT Fast (Codex)' },
  ];

  if (providers.cliClaude) {
    options.push({ id: 'cli/claude', label: 'CLI: Claude' });
  }
  if (providers.cliGemini) {
    options.push({ id: 'cli/gemini', label: 'CLI: Gemini' });
  }
  if (providers.cliCodex) {
    options.push({ id: 'cli/codex', label: 'CLI: Codex' });
  }
  if (providers.cliAgent) {
    options.push({ id: 'cli/agent', label: 'CLI: Cursor Agent' });
  }
  if (providers.cliOpenclaw) {
    options.push({ id: 'cli/openclaw', label: 'CLI: OpenClaw' });
  }
  if (providers.cliOpencode) {
    options.push({ id: 'cli/opencode', label: 'CLI: OpenCode' });
  }

  if (providers.openrouter) {
    options.push({ id: 'free', label: 'Free (OpenRouter)' });
    pushPiAiModels({
      labelPrefix: 'OpenRouter: ',
      options,
      prefix: 'openrouter/',
      provider: 'openrouter',
    });
  }

  if (providers.openai) {
    pushPiAiModels({ labelPrefix: 'OpenAI: ', options, prefix: 'openai/', provider: 'openai' });
  }

  if (providers.anthropic) {
    pushPiAiModels({
      labelPrefix: 'Anthropic: ',
      options,
      prefix: 'anthropic/',
      provider: 'anthropic',
    });
  }

  if (providers.google) {
    pushPiAiModels({ labelPrefix: 'Google: ', options, prefix: 'google/', provider: 'google' });
  }

  if (providers.xai) {
    pushPiAiModels({ labelPrefix: 'xAI: ', options, prefix: 'xai/', provider: 'xai' });
  }

  if (providers.zai) {
    pushPiAiModels({ labelPrefix: 'Z.AI: ', options, prefix: 'zai/', provider: 'zai' });
  }

  if (providers.nvidia) {
    const baseUrl = envState.nvidiaBaseUrl;
    const baseUrlHost = describeBaseUrlHost(baseUrl);
    if (baseUrlHost) {
      const discovered = await discoverOpenAiCompatibleModelIds({
        apiKey: envState.nvidiaApiKey,
        baseUrl,
        fetchImpl,
        timeoutMs: 1200,
      });
      for (const id of discovered) {
        options.push({ id: `nvidia/${id}`, label: `NVIDIA (${baseUrlHost}): ${id}` });
      }
    }
  }

  const openaiBaseUrl = (() => {
    return envState.providerBaseUrls.openai;
  })();

  let localModelsSource: { kind: 'openai-compatible'; baseUrlHost: string } | null = null;

  if (
    openaiBaseUrl &&
    !isProbablyOpenRouterBaseUrl(openaiBaseUrl) &&
    !isProbablyZaiBaseUrl(openaiBaseUrl)
  ) {
    const baseUrlHost = describeBaseUrlHost(openaiBaseUrl);
    if (baseUrlHost) {
      const discovered = await discoverOpenAiCompatibleModelIds({
        apiKey: envState.apiKey,
        baseUrl: openaiBaseUrl,
        fetchImpl,
        timeoutMs: 900,
      });
      if (discovered.length > 0) {
        localModelsSource = { baseUrlHost, kind: 'openai-compatible' };
        for (const id of discovered) {
          options.push({ id: `openai/${id}`, label: `Local (${baseUrlHost}): ${id}` });
        }
      }
    }
  }

  return { localModelsSource, ok: true, openaiBaseUrl, options: uniqById(options), providers };
}
