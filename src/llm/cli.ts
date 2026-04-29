import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { CliConfig, CliProvider } from '../config.js';
import type { ExecFileFn } from '../markitdown.js';
import { execCliWithInput } from './cli-exec.js';
import {
  parseCodexOutputFromJsonl,
  isJsonCliProvider,
  parseCodexUsageFromJsonl,
  parseJsonProviderOutput,
  type JsonCliProvider,
} from './cli-provider-output.js';
import type { LlmTokenUsage } from './generate-text.js';

const DEFAULT_BINARIES: Record<CliProvider, string> = {
  agent: 'agent',
  claude: 'claude',
  codex: 'codex',
  gemini: 'gemini',
};

const CODEX_GPT_FAST_MODEL = 'gpt-5.5';
const CODEX_GPT_FAST_ALIASES = new Set(['gpt-fast', 'gpt-5.5-fast']);

const PROVIDER_PATH_ENV: Record<CliProvider, string> = {
  agent: 'AGENT_PATH',
  claude: 'CLAUDE_PATH',
  codex: 'CODEX_PATH',
  gemini: 'GEMINI_PATH',
};

interface RunCliModelOptions {
  provider: CliProvider;
  prompt: string;
  model: string | null;
  allowTools: boolean;
  timeoutMs: number;
  env: Record<string, string | undefined>;
  execFileImpl?: ExecFileFn;
  config: CliConfig | null;
  cwd?: string;
  extraArgs?: string[];
}

interface CliRunResult {
  text: string;
  usage: LlmTokenUsage | null;
  costUsd: number | null;
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

function getCliProviderConfig(
  provider: CliProvider,
  config: CliConfig | null | undefined,
): CliConfig[CliProvider] | undefined {
  if (!config) {
    return undefined;
  }
  if (provider === 'claude') {
    return config.claude;
  }
  if (provider === 'codex') {
    return config.codex;
  }
  if (provider === 'gemini') {
    return config.gemini;
  }
  if (provider === 'agent') {
    return config.agent;
  }
  return undefined;
}

export function isCliDisabled(
  provider: CliProvider,
  config: CliConfig | null | undefined,
): boolean {
  if (!config) {
    return false;
  }
  if (Array.isArray(config.enabled) && !config.enabled.includes(provider)) {
    return true;
  }
  return false;
}

export function resolveCliBinary(
  provider: CliProvider,
  config: CliConfig | null | undefined,
  env: Record<string, string | undefined>,
): string {
  const providerConfig = getCliProviderConfig(provider, config);
  if (isNonEmptyString(providerConfig?.binary)) {
    return providerConfig.binary.trim();
  }
  const pathKey = PROVIDER_PATH_ENV[provider];
  if (isNonEmptyString(env[pathKey])) {
    return env[pathKey].trim();
  }
  const envKey = `SUMMARIZE_CLI_${provider.toUpperCase()}`;
  if (isNonEmptyString(env[envKey])) {
    return env[envKey].trim();
  }
  return DEFAULT_BINARIES[provider];
}

function hasCodexConfigOverride(args: string[], key: string): boolean {
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] !== '-c' && args[i] !== '--config') {
      continue;
    }
    const next = args[i + 1] ?? '';
    if (next.trim().startsWith(`${key}=`)) {
      return true;
    }
  }
  return false;
}

function resolveCodexModelAndArgs(
  requestedModel: string | null,
  providerExtraArgs: string[],
): { model: string | null; extraArgs: string[] } {
  const normalized = requestedModel?.trim().toLowerCase() ?? '';
  if (!CODEX_GPT_FAST_ALIASES.has(normalized)) {
    return { extraArgs: providerExtraArgs, model: requestedModel };
  }

  const extraArgs = [...providerExtraArgs];
  if (!hasCodexConfigOverride(extraArgs, 'service_tier')) {
    extraArgs.push('-c', 'service_tier="fast"');
  }
  return { extraArgs, model: CODEX_GPT_FAST_MODEL };
}

function appendJsonProviderArgs({
  provider,
  args,
  allowTools,
  model,
  prompt,
}: {
  provider: JsonCliProvider;
  args: string[];
  allowTools: boolean;
  model: string | null;
  prompt: string;
}): string {
  if (provider === 'claude' || provider === 'agent') {
    args.push('--print');
  }
  args.push('--output-format', 'json');
  if (provider === 'agent' && !allowTools) {
    args.push('--mode', 'ask');
  }
  if (model && model.trim().length > 0) {
    args.push('--model', model.trim());
  }
  if (allowTools) {
    if (provider === 'claude') {
      args.push('--tools', 'Read', '--dangerously-skip-permissions');
    }
    if (provider === 'gemini') {
      args.push('--yolo');
    }
  }
  if (provider === 'agent') {
    args.push(prompt);
    return '';
  }
  if (provider === 'gemini') {
    args.push('--prompt', prompt);
    return '';
  }
  return prompt;
}

export async function runCliModel({
  provider,
  prompt,
  model,
  allowTools,
  timeoutMs,
  env,
  execFileImpl,
  config,
  cwd,
  extraArgs,
}: RunCliModelOptions): Promise<CliRunResult> {
  const execFileFn = execFileImpl ?? execFile;
  const binary = resolveCliBinary(provider, config, env);
  const args: string[] = [];

  const effectiveEnv =
    provider === 'gemini' && !isNonEmptyString(env.GEMINI_CLI_NO_RELAUNCH)
      ? { ...env, GEMINI_CLI_NO_RELAUNCH: 'true' }
      : env;

  const providerConfig = getCliProviderConfig(provider, config);
  const requestedModel = isNonEmptyString(model)
    ? model.trim()
    : (isNonEmptyString(providerConfig?.model)
      ? providerConfig.model.trim()
      : null);
  const providerExtraArgs: string[] = [];
  if (providerConfig?.extraArgs?.length) {
    providerExtraArgs.push(...providerConfig.extraArgs);
  }
  if (extraArgs?.length) {
    providerExtraArgs.push(...extraArgs);
  }

  if (provider === 'codex') {
    const { model: codexModel, extraArgs: codexExtraArgs } = resolveCodexModelAndArgs(
      requestedModel,
      providerExtraArgs,
    );
    const outputDir = await fs.mkdtemp(path.join(tmpdir(), 'summarize-codex-'));
    const outputPath = path.join(outputDir, 'last-message.txt');
    args.push(...codexExtraArgs);
    args.push('exec', '--output-last-message', outputPath, '--skip-git-repo-check', '--json');
    if (codexModel) {
      args.push('-m', codexModel);
    }
    const hasVerbosityOverride = args.some((arg) => arg.includes('text.verbosity'));
    if (!hasVerbosityOverride) {
      args.push('-c', 'text.verbosity="medium"');
    }
    const { stdout } = await execCliWithInput({
      args,
      cmd: binary,
      cwd,
      env: effectiveEnv,
      execFileImpl: execFileFn,
      input: prompt,
      timeoutMs,
    });
    const { usage, costUsd } = parseCodexUsageFromJsonl(stdout);
    let fileText = '';
    try {
      fileText = (await fs.readFile(outputPath, 'utf8')).trim();
    } catch {
      fileText = '';
    }
    if (fileText) {
      return { costUsd, text: fileText, usage };
    }
    const parsedStdout = parseCodexOutputFromJsonl(stdout);
    if (parsedStdout.text) {
      return { costUsd, text: parsedStdout.text, usage };
    }
    if (parsedStdout.sawStructuredEvent) {
      throw new Error('CLI returned empty output');
    }
    const stdoutText = stdout.trim();
    if (stdoutText) {
      return { costUsd, text: stdoutText, usage };
    }
    throw new Error('CLI returned empty output');
  }

  if (!isJsonCliProvider(provider)) {
    throw new Error(`Unsupported CLI provider "${provider}".`);
  }
  args.push(...providerExtraArgs);
  const input = appendJsonProviderArgs({
    allowTools,
    args,
    model: requestedModel,
    prompt,
    provider,
  });

  const { stdout } = await execCliWithInput({
    args,
    cmd: binary,
    cwd,
    env: effectiveEnv,
    execFileImpl: execFileFn,
    input,
    timeoutMs,
  });
  return parseJsonProviderOutput({ provider, stdout });
}
