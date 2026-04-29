import { runCliMain } from './cli-main.js';

void runCliMain({
  argv: process.argv.slice(2),
  env: process.env,
  exit: (code) => process.exit(code),
  fetch: globalThis.fetch.bind(globalThis),
  setExitCode: (code) => {
    process.exitCode = code;
  },
  stderr: process.stderr,
  stdout: process.stdout,
}).catch((error) => {
  // Last-resort fallback; runCliMain should already format errors nicely.
  const message = error instanceof Error ? error.message : (error ? String(error) : 'Unknown error');
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
