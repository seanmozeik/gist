import type { CliProvider, ModelConfig, GistConfig } from '../config.js';
import { mergeModelRequestOptions } from '../llm/model-options.js';
import type { RequestedModel } from '../model-spec.js';
import { parseRequestedModelId } from '../model-spec.js';
import { BUILTIN_MODELS } from './constants.js';

function resolveConfiguredCliModel(
  provider: CliProvider,
  config: GistConfig | null,
): string | null {
  const cli = config?.cli;
  const raw =
    provider === 'claude'
      ? cli?.claude?.model
      : provider === 'codex'
        ? cli?.codex?.model
        : provider === 'gemini'
          ? cli?.gemini?.model
          : provider === 'agent'
            ? cli?.agent?.model
            : null;
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
}

function resolveRequestedCliModelFromConfig(
  requestedModel: RequestedModel,
  config: GistConfig | null,
): RequestedModel {
  if (requestedModel.kind !== 'fixed' || requestedModel.transport !== 'cli') {
    return requestedModel;
  }
  if (requestedModel.cliModel) {
    return requestedModel;
  }

  const configuredModel = resolveConfiguredCliModel(requestedModel.cliProvider, config);
  if (!configuredModel) {
    return requestedModel;
  }

  return {
    ...requestedModel,
    cliModel: configuredModel,
    userModelId: `cli/${requestedModel.cliProvider}/${configuredModel}`,
  };
}

function applyModelConfigOptions(
  requestedModel: RequestedModel,
  modelConfig: ModelConfig | null,
): RequestedModel {
  if (requestedModel.kind !== 'fixed' || requestedModel.transport === 'cli') {
    return requestedModel;
  }
  if (!modelConfig || !('id' in modelConfig)) {
    return requestedModel;
  }
  const requestOptions = mergeModelRequestOptions(requestedModel.requestOptions, {
    ...(modelConfig.serviceTier ? { serviceTier: modelConfig.serviceTier } : {}),
    ...((modelConfig.reasoningEffort ?? modelConfig.thinking)
      ? { reasoningEffort: modelConfig.reasoningEffort ?? modelConfig.thinking }
      : {}),
    ...(modelConfig.textVerbosity ? { textVerbosity: modelConfig.textVerbosity } : {}),
  });
  return requestOptions ? { ...requestedModel, requestOptions } : requestedModel;
}

export interface ModelSelection {
  requestedModel: RequestedModel;
  requestedModelInput: string;
  requestedModelLabel: string;
  isNamedModelSelection: boolean;
  isImplicitAutoSelection: boolean;
  configForModelSelection: GistConfig | null;
  isFallbackModel: boolean;
}

export function resolveModelSelection({
  config,
  configForCli,
  configPath,
  envForRun,
  explicitModelArg,
}: {
  config: GistConfig | null;
  configForCli: GistConfig | null;
  configPath: string | null;
  envForRun: Record<string, string | undefined>;
  explicitModelArg: string | null;
}): ModelSelection {
  const modelMap = (() => {
    const out = new Map<string, { name: string; model: ModelConfig }>();

    for (const [name, model] of Object.entries(BUILTIN_MODELS)) {
      out.set(name.toLowerCase(), { model, name });
    }

    const raw = config?.models;
    if (!raw) {
      return out;
    }
    for (const [name, model] of Object.entries(raw)) {
      out.set(name.toLowerCase(), { model, name });
    }
    return out;
  })();

  const defaultModelResolution = (() => {
    if (typeof envForRun.GIST_MODEL === 'string' && envForRun.GIST_MODEL.trim().length > 0) {
      return { source: 'env' as const, value: envForRun.GIST_MODEL.trim() };
    }
    const modelFromConfig = config?.model;
    if (modelFromConfig) {
      if ('id' in modelFromConfig && typeof modelFromConfig.id === 'string') {
        const id = modelFromConfig.id.trim();
        if (id.length > 0) {
          return { source: 'config' as const, value: id };
        }
      }
      if ('name' in modelFromConfig && typeof modelFromConfig.name === 'string') {
        const name = modelFromConfig.name.trim();
        if (name.length > 0) {
          return { source: 'config' as const, value: name };
        }
      }
      if ('mode' in modelFromConfig && modelFromConfig.mode === 'auto') {
        return { source: 'config' as const, value: 'auto' };
      }
    }
    return { source: 'default' as const, value: 'auto' };
  })();

  const explicitModelInput = explicitModelArg?.trim() ?? '';
  const requestedModelInput = (explicitModelInput || defaultModelResolution.value).trim();
  const requestedModelSource =
    explicitModelInput.length > 0 ? ('explicit' as const) : defaultModelResolution.source;
  const requestedModelInputLower = requestedModelInput.toLowerCase();

  const namedModelMatch =
    requestedModelInputLower !== 'auto' ? (modelMap.get(requestedModelInputLower) ?? null) : null;
  const namedModelConfig = namedModelMatch?.model ?? null;
  const isNamedModelSelection = Boolean(namedModelMatch);
  const selectedModelConfig =
    isNamedModelSelection && namedModelConfig
      ? namedModelConfig
      : requestedModelSource === 'config'
        ? (config?.model ?? null)
        : null;

  const configForModelSelection =
    isNamedModelSelection && namedModelConfig
      ? ({ ...configForCli, model: namedModelConfig } as const)
      : configForCli;

  const requestedModel: RequestedModel = (() => {
    if (isNamedModelSelection && namedModelConfig) {
      if ('id' in namedModelConfig) {
        return applyModelConfigOptions(
          parseRequestedModelId(namedModelConfig.id),
          namedModelConfig,
        );
      }
      if ('mode' in namedModelConfig && namedModelConfig.mode === 'auto') {
        return { kind: 'auto' };
      }
      throw new Error(
        `Invalid model "${namedModelMatch?.name ?? requestedModelInput}": unsupported model config`,
      );
    }

    if (requestedModelInputLower !== 'auto' && !requestedModelInput.includes('/')) {
      throw new Error(
        `Unknown model "${requestedModelInput}". Define it in ${configPath ?? '~/.gist/config.json'} under "models", or use a provider-prefixed id like openai/...`,
      );
    }

    return applyModelConfigOptions(parseRequestedModelId(requestedModelInput), selectedModelConfig);
  })();

  const requestedModelResolved = resolveRequestedCliModelFromConfig(
    requestedModel,
    configForModelSelection,
  );

  const requestedModelLabel = isNamedModelSelection
    ? requestedModelInput
    : requestedModelResolved.kind === 'auto'
      ? 'auto'
      : requestedModelResolved.userModelId;

  const isFallbackModel = requestedModelResolved.kind === 'auto';
  const isImplicitAutoSelection =
    requestedModelResolved.kind === 'auto' && requestedModelSource === 'default';

  return {
    configForModelSelection,
    isFallbackModel,
    isImplicitAutoSelection,
    isNamedModelSelection,
    requestedModel: requestedModelResolved,
    requestedModelInput,
    requestedModelLabel,
  };
}
