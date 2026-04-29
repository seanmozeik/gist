import type { Command } from 'commander';

import { attachRichHelp, buildProgram } from './help.js';

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
