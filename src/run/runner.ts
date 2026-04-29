import { execFile } from 'node:child_process';

import { CommanderError, type Command } from 'commander';

import type { ExecFileFn } from '../markitdown.js';
import { handleHelpRequest } from './cli-preflight.js';
import { attachRichHelp, buildProgram } from './help.js';
import { createRunnerPlan } from './runner-plan.js';
import {
  applyWidthOverride,
  handleCacheUtilityFlags,
  handleVersionFlag,
  prepareRunEnvironment,
  resolvePromptOverride,
} from './runner-setup.js';

interface RunEnv {
  env: Record<string, string | undefined>;
  fetch: typeof fetch;
  execFile?: ExecFileFn;
  stdin?: NodeJS.ReadableStream;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}

export async function runCli(
  argv: string[],
  { env: inputEnv, execFile: execFileOverride, stdin, stdout, stderr }: RunEnv,
): Promise<void> {
  (globalThis as unknown as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false;

  const { normalizedArgv, envForRun } = prepareRunEnvironment(argv, inputEnv);
  const env = envForRun;

  if (await handleImmediateCliRequests({ envForRun, normalizedArgv, stderr, stdout })) {
    return;
  }
  const execFileImpl = execFileOverride ?? execFile;
  const program = buildCliProgram({ envForRun, normalizedArgv, stderr, stdout });
  if (!program) {
    return;
  }

  if (handleVersionFlag({ stdout, versionRequested: Boolean(program.opts().version) })) {
    return;
  }

  applyWidthOverride({ env, width: program.opts().width });

  const promptOverride = await resolvePromptOverride({
    prompt: program.opts().prompt,
    promptFile: program.opts().promptFile,
  });

  if (await handleCacheUtilityFlags({ envForRun, normalizedArgv, stdout })) {
    return;
  }
  const plan = await createRunnerPlan({
    env,
    envForRun,
    execFileImpl,
    fetchImpl: fetch,
    normalizedArgv,
    program,
    promptOverride,
    stderr,
    stdin,
    stdout,
  });

  try {
    await plan.execute();
  } finally {
    plan.cacheState.store?.close();
  }
}

async function handleImmediateCliRequests(options: {
  normalizedArgv: string[];
  envForRun: Record<string, string | undefined>;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}) {
  const { normalizedArgv, envForRun, stdout, stderr } = options;
  if (handleHelpRequest({ envForRun, normalizedArgv, stderr, stdout })) {
    return true;
  }
  return false;
}

function buildCliProgram(options: {
  normalizedArgv: string[];
  envForRun: Record<string, string | undefined>;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}): Command | null {
  const { normalizedArgv, envForRun, stdout, stderr } = options;
  const program = buildProgram();
  program.configureOutput({
    writeErr(str) {
      stderr.write(str);
    },
    writeOut(str) {
      stdout.write(str);
    },
  });
  program.exitOverride();
  attachRichHelp(program, envForRun, stdout);

  try {
    program.parse(normalizedArgv, { from: 'user' });
    return program;
  } catch (error) {
    if (error instanceof CommanderError && error.code === 'commander.helpDisplayed') {
      return null;
    }
    throw error;
  }
}
