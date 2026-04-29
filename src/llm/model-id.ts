export type LlmProvider = 'openrouter' | 'local';

export interface ParsedModelId {
  provider: LlmProvider;
  /**
   * Provider-native model id (no prefix), e.g. `meta/llama-3.1-8b-instruct`.
   */
  model: string;
  /**
   * Canonical gateway-style id, e.g. `openrouter/meta/llama-3.1-8b-instruct`.
   */
  canonical: string;
}

const PROVIDERS = new Set(['openrouter', 'local'] as LlmProvider[]);

/**
 * Parse a model ID into provider + model name.
 *
 * Formats:
 * - `openrouter/<author>/<model>` → openrouter provider
 * - `local/<model-name>` → local sidecar
 * - Bare model IDs without prefix → defaults to openrouter for backwards compat
 */
export function normalizeGatewayStyleModelId(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error('Missing model id');
  }

  const lower = trimmed.toLowerCase();
  const slash = trimmed.indexOf('/');

  if (slash === -1) {
    // No prefix — default to openrouter for backwards compatibility
    return `openrouter/${trimmed}`;
  }

  const provider = lower.slice(0, slash) as LlmProvider;
  const model = trimmed.slice(slash + 1);

  if (!PROVIDERS.has(provider)) {
    throw new Error(`Unsupported model provider "${provider}". Use openrouter/... or local/...`);
  }
  if (model.trim().length === 0) {
    throw new Error('Missing model id after provider prefix');
  }
  return `${provider}/${model}`;
}

export function parseGatewayStyleModelId(raw: string): ParsedModelId {
  const canonical = normalizeGatewayStyleModelId(raw);
  const slash = canonical.indexOf('/');
  const provider = canonical.slice(0, slash) as LlmProvider;
  const model = canonical.slice(slash + 1);
  return { canonical, model, provider };
}
