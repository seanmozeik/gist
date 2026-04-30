import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import JSON5 from 'json5';

import { generateTextWithModelId } from './llm/generate-text.js';

interface RefreshFreeOptions {
  runs: number;
  smart: number;
  maxCandidates: number;
  concurrency: number;
  timeoutMs: number;
  minParamB: number;
  maxAgeDays: number;
  setDefault: boolean;
}

interface OpenRouterModelEntry {
  id: string;
  contextLength: number | null;
  maxCompletionTokens: number | null;
  supportedParametersCount: number;
  modality: string | null;
  inferredParamB: number | null;
  createdAtMs: number | null;
}

interface WorkingModel extends OpenRouterModelEntry {
  initialLatencyMs: number;
  medianLatencyMs: number;
  successCount: number;
  totalLatencyMs: number;
}

function supportsColor(
  stream: NodeJS.WritableStream,
  env: Record<string, string | undefined>,
): boolean {
  if (env.NO_COLOR) {
    return false;
  }
  if (env.FORCE_COLOR && env.FORCE_COLOR !== '0') {
    return true;
  }
  if (!(stream as unknown as { isTTY?: boolean }).isTTY) {
    return false;
  }
  const term = env.TERM?.toLowerCase();
  return Boolean(term && term !== 'dumb');
}

function ansi(code: string, input: string, enabled: boolean): string {
  return enabled ? `\u001B[${code}m${input}\u001B[0m` : input;
}

function formatMs(ms: number): string {
  if (!Number.isFinite(ms)) {
    return `${ms}`;
  }
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  return `${Math.round(ms / 100) / 10}s`;
}

function formatTokenK(value: number): string {
  if (!Number.isFinite(value)) {
    return `${value}`;
  }
  if (value < 1024) {
    return `${Math.round(value)}`;
  }
  return `${Math.round(value / 1024)}k`;
}

function inferParamBFromIdOrName(text: string): number | null {
  const matches = text
    .toLowerCase()
    .matchAll(/(?:^|[^a-z0-9])[a-z]?(\d+(?:\.\d+)?)b(?:[^a-z0-9]|$)/g);
  let best: number | null = null;
  for (const match of matches) {
    const value = Number(match[1]);
    if (!Number.isFinite(value) || value <= 0) {
      continue;
    }
    if (best === null || value > best) {
      best = value;
    }
  }
  return best;
}

function resolveConfigPath(env: Record<string, string | undefined>): string {
  const home = env.HOME?.trim() ?? homedir();
  if (!home) {
    throw new Error('Missing HOME');
  }
  return join(home, '.gist', 'config.json');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertNoComments(raw: string, path: string): void {
  let inString: '"' | "'" | null = null;
  let escaped = false;
  let line = 1;
  let col = 1;

  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw.charAt(i);
    const next = raw.charAt(i + 1);

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === inString) {
        inString = null;
      }
    } else if (ch === '"' || ch === "'") {
      inString = ch;
    } else if (ch === '/' && (next === '/' || next === '*')) {
      throw new Error(
        `Invalid config file ${path}: comments are not allowed (found /${next} at ${line}:${col}).`,
      );
    }

    if (ch === '\n') {
      line += 1;
      col = 1;
    } else {
      col += 1;
    }
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const worker = async () => {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= items.length) {
        return;
      }
      const item = items[current];
      if (item === undefined) {
        return;
      }
      results[current] = await fn(item, current);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, () => worker()),
  );
  return results;
}

function parseOpenRouterModel(entry: unknown): OpenRouterModelEntry | null {
  if (!isRecord(entry)) {
    return null;
  }
  const id = typeof entry.id === 'string' ? entry.id.trim() : '';
  if (!id.endsWith(':free')) {
    return null;
  }
  const name = typeof entry.name === 'string' ? entry.name.trim() : '';
  const topProvider = isRecord(entry.top_provider) ? entry.top_provider : null;
  const architecture = isRecord(entry.architecture) ? entry.architecture : null;
  const created =
    typeof entry.created === 'number' && Number.isFinite(entry.created) ? entry.created : null;
  const supportedParameters = Array.isArray(entry.supported_parameters)
    ? entry.supported_parameters
    : [];
  return {
    contextLength:
      typeof entry.context_length === 'number' && Number.isFinite(entry.context_length)
        ? entry.context_length
        : null,
    createdAtMs: created && created > 0 ? Math.round(created * 1000) : null,
    id,
    inferredParamB: inferParamBFromIdOrName(`${id} ${name}`),
    maxCompletionTokens:
      typeof topProvider?.max_completion_tokens === 'number' &&
      Number.isFinite(topProvider.max_completion_tokens)
        ? topProvider.max_completion_tokens
        : null,
    modality:
      typeof architecture?.modality === 'string' && architecture.modality.trim().length > 0
        ? architecture.modality.trim()
        : null,
    supportedParametersCount: supportedParameters.filter(
      (value) => typeof value === 'string' && value.trim().length > 0,
    ).length,
  };
}

function sortSmart(a: OpenRouterModelEntry, b: OpenRouterModelEntry): number {
  const aCreated = a.createdAtMs ?? -1;
  const bCreated = b.createdAtMs ?? -1;
  if (aCreated !== bCreated) {
    return bCreated - aCreated;
  }
  const aContext = a.contextLength ?? -1;
  const bContext = b.contextLength ?? -1;
  if (aContext !== bContext) {
    return bContext - aContext;
  }
  const aOut = a.maxCompletionTokens ?? -1;
  const bOut = b.maxCompletionTokens ?? -1;
  if (aOut !== bOut) {
    return bOut - aOut;
  }
  if (a.supportedParametersCount !== b.supportedParametersCount) {
    return b.supportedParametersCount - a.supportedParametersCount;
  }
  return a.id.localeCompare(b.id);
}

function selectModels(
  working: WorkingModel[],
  smartCount: number,
  maxCandidates: number,
): WorkingModel[] {
  const smartFirst = [...working].toSorted(sortSmart);
  const fastFirst = [...working].toSorted((a, b) => {
    if (a.successCount !== b.successCount) {
      return b.successCount - a.successCount;
    }
    if (a.medianLatencyMs !== b.medianLatencyMs) {
      return a.medianLatencyMs - b.medianLatencyMs;
    }
    return a.id.localeCompare(b.id);
  });
  const picked = new Set<string>();
  const out: WorkingModel[] = [];

  for (const model of smartFirst) {
    if (out.length >= Math.min(smartCount, maxCandidates)) {
      break;
    }
    picked.add(model.id);
    out.push(model);
  }
  for (const model of fastFirst) {
    if (out.length >= maxCandidates) {
      break;
    }
    if (!picked.has(model.id)) {
      picked.add(model.id);
      out.push(model);
    }
  }
  return out;
}

async function readConfig(configPath: string): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(configPath, 'utf8');
    assertNoComments(raw, configPath);
    const parsed = JSON5.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      throw new Error(`Invalid config file ${configPath}: expected an object at the top level`);
    }
    return parsed;
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

export async function refreshFree({
  env,
  fetchImpl,
  stdout,
  stderr,
  verbose = false,
  options = {},
}: {
  env: Record<string, string | undefined>;
  fetchImpl: typeof fetch;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  verbose?: boolean;
  options?: Partial<RefreshFreeOptions>;
}): Promise<void> {
  const openrouterApiKey = env.OPENROUTER_API_KEY?.trim() ?? null;
  if (!openrouterApiKey) {
    throw new Error('Missing OPENROUTER_API_KEY (required for refresh-free)');
  }

  const resolved: RefreshFreeOptions = {
    concurrency: 4,
    maxAgeDays: 180,
    maxCandidates: 10,
    minParamB: 27,
    runs: 2,
    setDefault: false,
    smart: 3,
    timeoutMs: 10_000,
    ...options,
  };
  const runs = Math.max(0, Math.floor(resolved.runs));
  const smart = Math.max(0, Math.floor(resolved.smart));
  const maxCandidates = Math.max(1, Math.floor(resolved.maxCandidates));
  const concurrency = Math.max(1, Math.floor(resolved.concurrency));
  const timeoutMs = Math.max(1, Math.floor(resolved.timeoutMs));
  const minParamB = Math.max(0, Math.floor(resolved.minParamB));
  const maxAgeDays = Math.max(0, Math.floor(resolved.maxAgeDays));
  const color = supportsColor(stderr, env);
  const heading = (text: string) => ansi('1;36', text, color);
  const okLabel = (text: string) => ansi('1;32', text, color);
  const failLabel = (text: string) => ansi('1;31', text, color);
  const dim = (text: string) => ansi('2', text, color);
  const cmdName = heading('Refresh Free');

  stderr.write(`${cmdName}: fetching OpenRouter models...\n`);
  const response = await fetchImpl('https://openrouter.ai/api/v1/models', {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`OpenRouter /models failed: HTTP ${response.status}`);
  }
  const payload = (await response.json()) as { data?: unknown };
  const now = Date.now();
  const models = (Array.isArray(payload.data) ? payload.data : [])
    .map(parseOpenRouterModel)
    .filter((model): model is OpenRouterModelEntry => {
      if (!model) {
        return false;
      }
      if (
        maxAgeDays > 0 &&
        (!model.createdAtMs ||
          now - model.createdAtMs < 0 ||
          now - model.createdAtMs > maxAgeDays * 24 * 60 * 60 * 1000)
      ) {
        return false;
      }
      return model.inferredParamB === null || model.inferredParamB >= minParamB;
    })
    .toSorted(sortSmart);

  if (models.length === 0) {
    throw new Error(
      maxAgeDays > 0
        ? `OpenRouter /models returned no :free models from the last ${maxAgeDays} days`
        : 'OpenRouter /models returned no :free models',
    );
  }

  stderr.write(
    `${cmdName}: found ${models.length} candidates; testing (runs=${runs + 1}, concurrency=${concurrency}, timeout=${formatMs(timeoutMs)})...\n`,
  );

  const testModel = async (model: OpenRouterModelEntry): Promise<WorkingModel | null> => {
    const latencies: number[] = [];
    let totalLatencyMs = 0;
    let successCount = 0;
    let lastError: unknown = null;

    for (let run = 0; run <= runs; run += 1) {
      const startedAt = Date.now();
      try {
        await generateTextWithModelId({
          apiKeys: { openrouterApiKey },
          fetchImpl,
          forceOpenRouter: true,
          maxOutputTokens: 16,
          modelId: `openrouter/${model.id}`,
          prompt: { userText: 'Reply with a single word: OK' },
          retries: 0,
          temperature: 0,
          timeoutMs,
        });
        const latency = Date.now() - startedAt;
        latencies.push(latency);
        totalLatencyMs += latency;
        successCount += 1;
      } catch (error) {
        lastError = error;
        break;
      }
    }

    if (successCount === 0) {
      if (verbose) {
        const message = lastError instanceof Error ? lastError.message : String(lastError);
        stderr.write(`${failLabel('fail')} ${model.id}: ${message}\n`);
      }
      return null;
    }

    latencies.sort((a, b) => a - b);
    const medianLatencyMs = latencies[Math.floor(latencies.length / 2)] ?? latencies[0] ?? 0;
    stderr.write(`${okLabel('ok')} ${model.id} ${dim(`(${formatMs(medianLatencyMs)})`)}\n`);
    return {
      ...model,
      initialLatencyMs: latencies[0] ?? medianLatencyMs,
      medianLatencyMs,
      successCount,
      totalLatencyMs,
    };
  };

  const tested = await mapWithConcurrency(models, concurrency, (model) => testModel(model));
  const working = tested.filter((model): model is WorkingModel => Boolean(model));
  if (working.length === 0) {
    throw new Error(`No working :free models found (tested ${models.length})`);
  }

  const selected = selectModels(working, smart, maxCandidates);
  const configPath = resolveConfigPath(env);
  const root = await readConfig(configPath);
  const configModelsRaw = root.models;
  if (configModelsRaw !== undefined && !isRecord(configModelsRaw)) {
    throw new Error(`Invalid config file ${configPath}: "models" must be an object.`);
  }
  const configModels = { ...(isRecord(configModelsRaw) ? configModelsRaw : {}) };
  configModels.free = {
    mode: 'auto',
    rules: [{ candidates: selected.map((model) => `openrouter/${model.id}`) }],
  };
  root.models = configModels;
  if (resolved.setDefault) {
    root.model = 'free';
  }

  await mkdir(dirname(configPath), { recursive: true });
  const tmp = `${configPath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, `${JSON.stringify(root, null, 2)}\n`, 'utf8');
  await rename(tmp, configPath);
  stdout.write(`Wrote ${configPath} (models.free)\n`);

  stderr.write(`\n${heading('Selected')}\n`);
  for (const model of selected) {
    const avg = model.successCount > 0 ? model.totalLatencyMs / model.successCount : 0;
    const params = typeof model.inferredParamB === 'number' ? `~${model.inferredParamB}B` : null;
    const ctx =
      typeof model.contextLength === 'number' ? `ctx=${formatTokenK(model.contextLength)}` : null;
    const out =
      typeof model.maxCompletionTokens === 'number'
        ? `out=${formatTokenK(model.maxCompletionTokens)}`
        : null;
    const meta = [params, ctx, out, model.modality].filter(Boolean).join(' ');
    stderr.write(
      `- ${model.id} ${dim(`Delta ${formatMs(avg)} (n=${model.successCount})`)} ${dim(meta)}\n`,
    );
  }
}
