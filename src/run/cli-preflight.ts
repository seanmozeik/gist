import type { Command } from 'commander';

import { refreshFree } from '../refresh-free';
import { authStatus, deleteSecret, saveSecret } from '../secrets';
import { attachRichHelp, buildProgram } from './help';

interface HelpContext {
  normalizedArgv: string[];
  envForRun: Record<string, string | undefined>;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}

export function handleHelpRequest({
  normalizedArgv,
  envForRun,
  stdout,
  stderr,
}: HelpContext): boolean {
  if (normalizedArgv[0]?.toLowerCase() !== 'help') {
    return false;
  }
  if (normalizedArgv[1]?.toLowerCase() === 'refresh-free') {
    stdout.write(`${buildRefreshFreeHelp()}\n`);
    return true;
  }
  if (normalizedArgv[1]?.toLowerCase() === 'auth') {
    stdout.write(`${buildAuthHelp()}\n`);
    return true;
  }

  const program: Command = buildProgram();
  program.configureOutput({
    writeErr(str) {
      stderr.write(str);
    },
    writeOut(str) {
      stdout.write(str);
    },
  });
  attachRichHelp(program, envForRun, stdout);
  program.outputHelp();
  return true;
}

interface AuthContext {
  normalizedArgv: string[];
  env: Record<string, string | undefined>;
  stdout: NodeJS.WritableStream;
}

export function buildAuthHelp(): string {
  return [
    'Usage: gist auth status',
    '       gist auth set <provider|ENV_KEY> <value>',
    '       gist auth unset <provider|ENV_KEY>',
    '',
    'Stores API keys in the OS keychain via Bun.secrets.',
    'Examples: gist auth set openai sk-... | gist auth set openrouter sk-or-...',
  ].join('\n');
}

export async function handleAuthRequest({
  normalizedArgv,
  env,
  stdout,
}: AuthContext): Promise<boolean> {
  if (normalizedArgv[0]?.toLowerCase() !== 'auth') {
    return false;
  }

  const action = normalizedArgv[1]?.toLowerCase() ?? 'status';
  if (action === '--help' || action === '-h' || action === 'help') {
    stdout.write(`${buildAuthHelp()}\n`);
    return true;
  }

  if (action === 'status' || action === 'list') {
    const configured = (await authStatus(env)).filter((entry) => entry.configured);
    if (configured.length === 0) {
      stdout.write('not configured\n');
      return true;
    }
    for (const entry of configured) {
      stdout.write(`${entry.key} ${entry.source ?? 'unknown'}\n`);
    }
    return true;
  }

  if (action === 'set') {
    const name = normalizedArgv[2];
    const value = normalizedArgv[3];
    if (!name || !value || normalizedArgv.length > 4) {
      throw new Error('Usage: gist auth set <provider|ENV_KEY> <value>');
    }
    const path = await saveSecret(name, value);
    stdout.write(`saved ${path}\n`);
    return true;
  }

  if (action === 'unset' || action === 'delete' || action === 'remove') {
    const name = normalizedArgv[2];
    if (!name || normalizedArgv.length > 3) {
      throw new Error('Usage: gist auth unset <provider|ENV_KEY>');
    }
    const deleted = await deleteSecret(name);
    stdout.write(deleted ? 'deleted\n' : 'not found\n');
    return true;
  }

  throw new Error(`Unknown auth command "${action}". Run gist help auth.`);
}

interface RefreshFreeContext {
  normalizedArgv: string[];
  envForRun: Record<string, string | undefined>;
  fetchImpl: typeof fetch;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}

export function buildRefreshFreeHelp(): string {
  return [
    'Usage: gist refresh-free [--runs 2] [--smart 3] [--min-params 27b] [--max-age-days 180] [--set-default] [--verbose]',
    '',
    'Writes ~/.gist/config.json (models.free) with working OpenRouter :free candidates.',
    'With --set-default: also sets `model` to "free".',
  ].join('\n');
}

export async function handleRefreshFreeRequest({
  normalizedArgv,
  envForRun,
  fetchImpl,
  stdout,
  stderr,
}: RefreshFreeContext): Promise<boolean> {
  if (normalizedArgv[0]?.toLowerCase() !== 'refresh-free') {
    return false;
  }

  const help =
    normalizedArgv.includes('--help') ||
    normalizedArgv.includes('-h') ||
    normalizedArgv.includes('help');
  if (help) {
    stdout.write(`${buildRefreshFreeHelp()}\n`);
    return true;
  }

  const readArgValue = (name: string): string | null => {
    const eq = normalizedArgv.find((arg) => arg.startsWith(`${name}=`));
    if (eq) {
      return eq.slice(`${name}=`.length).trim() || null;
    }
    const index = normalizedArgv.indexOf(name);
    if (index === -1) {
      return null;
    }
    const next = normalizedArgv[index + 1];
    if (!next || next.startsWith('-')) {
      return null;
    }
    return next.trim() || null;
  };

  const parseNonNegative = (raw: string | null, fallback: number, label: string): number => {
    const value = raw ? Number(raw.trim().toLowerCase().replace(/b$/, '')) : fallback;
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${label} must be >= 0`);
    }
    return value;
  };

  await refreshFree({
    env: envForRun,
    fetchImpl,
    options: {
      concurrency: 4,
      maxAgeDays: parseNonNegative(readArgValue('--max-age-days'), 180, '--max-age-days'),
      maxCandidates: 10,
      minParamB: parseNonNegative(readArgValue('--min-params'), 27, '--min-params'),
      runs: parseNonNegative(readArgValue('--runs'), 2, '--runs'),
      setDefault: normalizedArgv.includes('--set-default'),
      smart: parseNonNegative(readArgValue('--smart'), 3, '--smart'),
      timeoutMs: 10_000,
    },
    stderr,
    stdout,
    verbose: normalizedArgv.includes('--verbose') || normalizedArgv.includes('--debug'),
  });
  return true;
}
