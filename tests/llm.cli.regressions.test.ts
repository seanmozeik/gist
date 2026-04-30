import type { ChildProcess } from 'node:child_process';
import { writeFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { runCliModel } from '../src/llm/cli.js';
import type { ExecFileFn } from '../src/markitdown.js';

describe('runCliModel regressions', () => {
  it('passes OpenClaw prompts with --message for current OpenClaw CLI', async () => {
    const seenArgs: string[][] = [];
    const stdinWrites: string[] = [];
    const execFileImpl: ExecFileFn = ((_cmd, args, _opts, cb) => {
      seenArgs.push(args);
      cb?.(null, JSON.stringify({ result: { payloads: [{ text: 'hello from openclaw' }] } }), '');
      return {
        stdin: {
          end() {
            /* Empty */
          },
          write(value: string) {
            stdinWrites.push(value);
          },
        },
      } as unknown as ChildProcess;
    }) as ExecFileFn;

    const prompt = 'Large prompt body that should not become a CLI argument.';
    const result = await runCliModel({
      allowTools: false,
      config: null,
      env: {},
      execFileImpl,
      model: 'main',
      prompt,
      provider: 'openclaw',
      timeoutMs: 1000,
    });

    expect(result.text).toBe('hello from openclaw');
    expect(seenArgs[0]).toContain('-m');
    expect(seenArgs[0]).toContain(prompt);
    expect(seenArgs[0]).not.toContain('-');
    expect(stdinWrites.join('')).toBe('');
  });

  it('rejects oversized OpenClaw prompts before passing them through argv', async () => {
    const execFileImpl = vi.fn(((_cmd, _args, _opts, cb) => {
      cb?.(null, '', '');
      return {
        stdin: {
          end() {
            /* Empty */
          },
          write() {
            /* Empty */
          },
        },
      } as unknown as ChildProcess;
    }) as ExecFileFn);

    await expect(
      runCliModel({
        allowTools: false,
        config: null,
        env: {},
        execFileImpl,
        model: 'main',
        prompt: 'x'.repeat(121 * 1024),
        provider: 'openclaw',
        timeoutMs: 1000,
      }),
    ).rejects.toThrow(/cannot safely receive large prompts over argv/);
    expect(execFileImpl).not.toHaveBeenCalled();
  });

  it('codex extracts assistant text from JSONL stdout when last-message is blank', async () => {
    const result = await runCliModel({
      allowTools: false,
      config: null,
      env: {},
      execFileImpl: (_cmd, args, _opts, cb) => {
        const outputIndex = args.indexOf('--output-last-message');
        const outputPath = outputIndex !== -1 ? args[outputIndex + 1] : null;
        if (!outputPath) {
          throw new Error('missing output path');
        }
        writeFileSync(outputPath, '   ', 'utf8');
        cb(
          null,
          [
            '{"type":"thread.started","thread_id":"abc"}',
            '{"type":"response.output_text.delta","delta":"Hello"}',
            '{"type":"response.output_text.delta","delta":" world"}',
          ].join('\n'),
          '',
        );
        return {
          stdin: {
            end() {
              /* Empty */
            },
            write() {
              /* Empty */
            },
          },
        } as unknown as ChildProcess;
      },
      model: null,
      prompt: 'hi',
      provider: 'codex',
      timeoutMs: 1000,
    });

    expect(result.text).toBe('Hello world');
  });

  it('codex does not leak lifecycle JSONL when no assistant text was produced', async () => {
    await expect(
      runCliModel({
        allowTools: false,
        config: null,
        env: {},
        execFileImpl: (_cmd, args, _opts, cb) => {
          const outputIndex = args.indexOf('--output-last-message');
          const outputPath = outputIndex !== -1 ? args[outputIndex + 1] : null;
          if (!outputPath) {
            throw new Error('missing output path');
          }
          writeFileSync(outputPath, '   ', 'utf8');
          cb(
            null,
            [
              '{"type":"thread.started","thread_id":"abc"}',
              '{"usage":{"input_tokens":1,"output_tokens":2,"total_tokens":3}}',
            ].join('\n'),
            '',
          );
          return {
            stdin: {
              end() {
                /* Empty */
              },
              write() {
                /* Empty */
              },
            },
          } as unknown as ChildProcess;
        },
        model: null,
        prompt: 'hi',
        provider: 'codex',
        timeoutMs: 1000,
      }),
    ).rejects.toThrow('CLI returned empty output');
  });
});
