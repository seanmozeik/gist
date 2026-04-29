import { execFileTracked } from '../../processes.js';

const stripAnsi = (value: string): string => value.replaceAll(/\u001B\[[0-9;]*m/g, '');

export function execTweetCli(
  binary: string,
  args: string[],
  timeoutMs: number,
  env: Record<string, string | undefined>,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const toText = (value: string | Buffer | null | undefined) =>
      typeof value === 'string' ? value : (value ? value.toString('utf8') : '');

    execFileTracked(
      binary,
      args,
      { env: { ...process.env, ...env }, maxBuffer: 1024 * 1024, timeout: timeoutMs },
      (error, stdout, stderr) => {
        const stdoutText = toText(stdout).trim();
        const stderrText = stripAnsi(toText(stderr)).trim();
        if (error) {
          const detail = stderrText || stdoutText;
          const suffix = detail ? `: ${detail}` : '';
          reject(new Error(`${binary} read failed${suffix}`));
          return;
        }
        resolve(stdoutText);
      },
    );
  });
}
