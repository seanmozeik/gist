import fs from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import type { CliProvider } from '../src/config.js';
import { isCliDisabled, resolveCliBinary, runCliModel } from '../src/llm/cli.js';
import type { ExecFileFn } from '../src/markitdown.js';

const makeStub = (handler: (args: string[]) => { stdout?: string; stderr?: string }) => {
  const execFileStub: ExecFileFn = ((_cmd, args, _options, cb) => {
    const result = handler(args);
    const stdout = result.stdout ?? '';
    const stderr = result.stderr ?? '';
    if (cb) {cb(null, stdout, stderr);}
    return { stdin: { end: () => {}, write: () => {} } } as unknown as ReturnType<ExecFileFn>;
  }) as ExecFileFn;
  return execFileStub;
};

describe('runCliModel', () => {
  it('handles Claude JSON output and tool flags', async () => {
    const seen: string[][] = [];
    const execFileImpl = makeStub((args) => {
      seen.push(args);
      return {
        stdout: JSON.stringify({
          result: 'ok',
          total_cost_usd: 0.0125,
          usage: {
            cache_creation_input_tokens: 1,
            cache_read_input_tokens: 2,
            input_tokens: 4,
            output_tokens: 3,
          },
        }),
      };
    });
    const result = await runCliModel({
      allowTools: true,
      config: null,
      env: {},
      execFileImpl,
      model: 'sonnet',
      prompt: 'Test',
      provider: 'claude',
      timeoutMs: 1000,
    });
    expect(result.text).toBe('ok');
    expect(result.costUsd).toBe(0.0125);
    expect(result.usage).toEqual({ completionTokens: 3, promptTokens: 7, totalTokens: 10 });
    expect(seen[0]?.includes('--tools')).toBe(true);
    expect(seen[0]?.includes('--dangerously-skip-permissions')).toBe(true);
  });

  it('handles Gemini JSON output and yolo flag', async () => {
    const seen: string[][] = [];
    const execFileImpl = makeStub((args) => {
      seen.push(args);
      return {
        stdout: JSON.stringify({
          response: 'ok',
          stats: {
            models: {
              'gemini-3-flash-preview': { tokens: { candidates: 7, prompt: 5, total: 12 } },
            },
          },
        }),
      };
    });
    const result = await runCliModel({
      allowTools: true,
      config: null,
      env: {},
      execFileImpl,
      model: 'gemini-3-flash-preview',
      prompt: 'Test',
      provider: 'gemini',
      timeoutMs: 1000,
    });
    expect(result.text).toBe('ok');
    expect(result.usage).toEqual({ completionTokens: 7, promptTokens: 5, totalTokens: 12 });
    expect(seen[0]?.includes('--yolo')).toBe(true);
    expect(seen[0]?.includes('--prompt')).toBe(true);
    expect(seen[0]?.includes('Test')).toBe(true);
  });

  it('sets GEMINI_CLI_NO_RELAUNCH by default for Gemini', async () => {
    let seenEnv: Record<string, unknown> | null = null;

    const execFileImpl: ExecFileFn = ((_cmd, _args, options, cb) => {
      seenEnv = (options as { env?: Record<string, unknown> } | null)?.env ?? null;
      cb?.(null, JSON.stringify({ response: 'ok' }), '');
      return { stdin: { end: () => {}, write: () => {} } } as unknown as ReturnType<ExecFileFn>;
    }) as ExecFileFn;

    await runCliModel({
      allowTools: false,
      config: null,
      env: {},
      execFileImpl,
      model: 'gemini-3-flash-preview',
      prompt: 'Test',
      provider: 'gemini',
      timeoutMs: 1000,
    });

    expect(seenEnv?.GEMINI_CLI_NO_RELAUNCH).toBe('true');
  });

  it('adds provider and call-site extra args', async () => {
    const seen: string[][] = [];
    const execFileImpl = makeStub((args) => {
      seen.push(args);
      return { stdout: JSON.stringify({ result: 'ok' }) };
    });
    const result = await runCliModel({
      allowTools: false,
      config: { claude: { extraArgs: ['--foo'] } },
      env: {},
      execFileImpl,
      extraArgs: ['--bar'],
      model: null,
      prompt: 'Test',
      provider: 'claude',
      timeoutMs: 1000,
    });
    expect(result.text).toBe('ok');
    expect(seen[0]).toContain('--foo');
    expect(seen[0]).toContain('--bar');
  });

  it('adds Agent provider extra args', async () => {
    const seen: string[][] = [];
    const execFileImpl = makeStub((args) => {
      seen.push(args);
      return { stdout: JSON.stringify({ result: 'ok' }) };
    });
    const result = await runCliModel({
      allowTools: false,
      config: { agent: { extraArgs: ['--header', 'x-test: 1'] } },
      env: {},
      execFileImpl,
      model: 'gpt-5.2',
      prompt: 'Test',
      provider: 'agent',
      timeoutMs: 1000,
    });
    expect(result.text).toBe('ok');
    expect(seen[0]).toContain('--header');
    expect(seen[0]).toContain('x-test: 1');
  });

  it('uses OpenClaw provider config and parses payload text', async () => {
    const seen: string[][] = [];
    const result = await runCliModel({
      allowTools: false,
      config: { openclaw: { binary: '/custom/openclaw', extraArgs: ['--profile', 'dev'] } },
      env: { OPENCLAW_PATH: '/env/openclaw' },
      execFileImpl: makeStub((args) => {
        seen.push(args);
        return {
          stdout: JSON.stringify({
            result: {
              payloads: [{ text: 'hello' }, { text: 'world' }],
              meta: {
                agentMeta: { usage: { promptTokens: 4, completionTokens: 5, totalTokens: 9 } },
              },
            },
          }),
        };
      }),
      model: 'main',
      prompt: 'Test',
      provider: 'openclaw',
      timeoutMs: 2500,
    });
    expect(result.text).toBe('hello\n\nworld');
    expect(result.usage).toEqual({ completionTokens: 5, promptTokens: 4, totalTokens: 9 });
    expect(seen[0]?.slice(0, 2)).toEqual(['--profile', 'dev']);
    expect(seen[0]).toContain('--agent');
    expect(seen[0]).toContain('main');
    expect(seen[0]).toContain('-m');
    expect(seen[0]).toContain('Test');
    expect(seen[0]).toContain('--timeout');
    expect(seen[0]).toContain('3');
  });

  it('handles Agent CLI JSON output in ask mode', async () => {
    const seen: string[][] = [];
    const execFileImpl = makeStub((args) => {
      seen.push(args);
      return { stdout: JSON.stringify({ result: 'ok' }) };
    });
    const result = await runCliModel({
      allowTools: false,
      config: null,
      env: {},
      execFileImpl,
      model: 'gpt-5.2',
      prompt: 'Test',
      provider: 'agent',
      timeoutMs: 1000,
    });
    expect(result.text).toBe('ok');
    expect(seen[0]).toContain('--print');
    expect(seen[0]).toContain('--output-format');
    expect(seen[0]).toContain('json');
    expect(seen[0]).toContain('--mode');
    expect(seen[0]).toContain('ask');
    expect(seen[0]).toContain('--model');
    expect(seen[0]).toContain('gpt-5.2');
    expect(seen[0].at(-1)).toBe('Test');
  });

  it('handles OpenCode JSONL output via stdin', async () => {
    const seen: string[][] = [];
    let stdinText = '';
    let seenCwd = '';
    const execFileImpl: ExecFileFn = ((_cmd, args, options, cb) => {
      seen.push(args);
      seenCwd = ((options as { cwd?: string } | undefined)?.cwd ?? '');
      cb?.(
        null,
        [
          JSON.stringify({ part: { type: 'step-start' }, type: 'step_start' }),
          JSON.stringify({ part: { text: 'ok from opencode', type: 'text' }, type: 'text' }),
          JSON.stringify({
            part: { cost: 0.25, tokens: { input: 7, output: 3, total: 10 }, type: 'step-finish' },
            type: 'step_finish',
          }),
        ].join('\n'),
        '',
      );
      return {
        stdin: {
          end: () => {},
          write: (chunk: string | Buffer) => {
            stdinText += String(chunk);
          },
        },
      } as unknown as ReturnType<ExecFileFn>;
    }) as ExecFileFn;

    const result = await runCliModel({
      allowTools: false,
      config: null,
      env: {},
      execFileImpl,
      model: 'openai/gpt-5.4',
      prompt: 'Test',
      provider: 'opencode',
      timeoutMs: 1000,
    });

    expect(result.text).toBe('ok from opencode');
    expect(result.costUsd).toBe(0.25);
    expect(result.usage).toEqual({ completionTokens: 3, promptTokens: 7, totalTokens: 10 });
    expect(seen[0]).toContain('run');
    expect(seen[0]).toContain('--format');
    expect(seen[0]).toContain('json');
    expect(seen[0]).toContain('--model');
    expect(seen[0]).toContain('openai/gpt-5.4');
    expect(stdinText).toBe('Test');
    expect(seenCwd).toContain('summarize-opencode-');
  });

  it('uses configured OpenCode model when none is passed explicitly', async () => {
    const seen: string[][] = [];
    const execFileImpl: ExecFileFn = ((_cmd, args, _options, cb) => {
      seen.push(args);
      cb?.(
        null,
        JSON.stringify({ part: { text: 'ok from config model', type: 'text' }, type: 'text' }),
        '',
      );
      return { stdin: { end: () => {}, write: () => {} } } as unknown as ReturnType<ExecFileFn>;
    }) as ExecFileFn;

    const result = await runCliModel({
      allowTools: false,
      config: { opencode: { model: 'openai/gpt-5.2' } },
      env: {},
      execFileImpl,
      model: null,
      prompt: 'Test',
      provider: 'opencode',
      timeoutMs: 1000,
    });

    expect(result.text).toBe('ok from config model');
    expect(seen[0]).toContain('--model');
    expect(seen[0]).toContain('openai/gpt-5.2');
  });

  it('reuses the provided cwd for OpenCode when tools are allowed', async () => {
    const seen: string[][] = [];
    let stdinText = '';
    let seenCwd = '';
    const execFileImpl: ExecFileFn = ((_cmd, args, options, cb) => {
      seen.push(args);
      seenCwd = ((options as { cwd?: string } | undefined)?.cwd ?? '');
      cb?.(null, JSON.stringify({ part: { text: 'ok', type: 'text' }, type: 'text' }), '');
      return {
        stdin: {
          end: () => {},
          write: (chunk: string | Buffer) => {
            stdinText += String(chunk);
          },
        },
      } as unknown as ReturnType<ExecFileFn>;
    }) as ExecFileFn;

    const result = await runCliModel({
      allowTools: true,
      config: { opencode: { extraArgs: ['--config', 'fast'] } },
      cwd: '/tmp/opencode-cwd',
      env: {},
      execFileImpl,
      extraArgs: ['--approval-mode', 'never'],
      model: null,
      prompt: 'Test',
      provider: 'opencode',
      timeoutMs: 1000,
    });

    expect(result.text).toBe('ok');
    expect(seen[0]).toEqual([
      'run',
      '--config',
      'fast',
      '--approval-mode',
      'never',
      '--format',
      'json',
    ]);
    expect(stdinText).toBe('Test');
    expect(seenCwd).toBe('/tmp/opencode-cwd');
  });
  it('accepts common JSON output fields across JSON CLI providers', async () => {
    const providers: { provider: CliProvider; model: string }[] = [
      { model: 'sonnet', provider: 'claude' },
      { model: 'gemini-3-flash-preview', provider: 'gemini' },
      { model: 'gpt-5.2', provider: 'agent' },
    ];
    for (const { provider, model } of providers) {
      const result = await runCliModel({
        allowTools: false,
        config: null,
        env: {},
        execFileImpl: makeStub(() => ({ stdout: JSON.stringify({ message: 'ok' }) })),
        model,
        prompt: 'Test',
        provider,
        timeoutMs: 1000,
      });
      expect(result.text).toBe('ok');
    }
  });

  it('extracts result payloads from JSON array output', async () => {
    const result = await runCliModel({
      allowTools: false,
      config: null,
      env: {},
      execFileImpl: makeStub(() => ({
        stdout: JSON.stringify([
          { type: 'status', message: 'working' },
          { type: 'result', result: 'ok from array' },
        ]),
      })),
      model: 'gpt-5.2',
      prompt: 'Test',
      provider: 'agent',
      timeoutMs: 1000,
    });

    expect(result.text).toBe('ok from array');
  });

  it('reads the Codex output file', async () => {
    const execFileImpl: ExecFileFn = ((_cmd, args, _options, cb) => {
      const outputIndex = args.indexOf('--output-last-message');
      const outputPath = outputIndex === -1 ? null : args[outputIndex + 1];
      if (!outputPath) {
        cb?.(new Error('missing output path'), '', '');
        return { stdin: { end: () => {}, write: () => {} } } as unknown as ReturnType<ExecFileFn>;
      }
      void fs.writeFile(outputPath, 'ok', 'utf8').then(
        () => cb?.(null, '', ''),
        (error) => cb?.(error as Error, '', ''),
      );
      return { stdin: { end: () => {}, write: () => {} } } as unknown as ReturnType<ExecFileFn>;
    }) as ExecFileFn;

    const result = await runCliModel({
      allowTools: false,
      config: null,
      env: {},
      execFileImpl,
      model: 'gpt-5.2',
      prompt: 'Test',
      provider: 'codex',
      timeoutMs: 1000,
    });
    expect(result.text).toBe('ok');
  });

  it('maps Codex GPT fast alias to GPT-5.5 fast service tier', async () => {
    let seenArgs: string[] = [];
    const execFileImpl: ExecFileFn = ((_cmd, args, _options, cb) => {
      seenArgs = [...args];
      const outputIndex = args.indexOf('--output-last-message');
      const outputPath = outputIndex === -1 ? null : args[outputIndex + 1];
      if (!outputPath) {
        cb?.(new Error('missing output path'), '', '');
        return { stdin: { end: () => {}, write: () => {} } } as unknown as ReturnType<ExecFileFn>;
      }
      void fs.writeFile(outputPath, 'ok', 'utf8').then(
        () => cb?.(null, '', ''),
        (error) => cb?.(error as Error, '', ''),
      );
      return { stdin: { end: () => {}, write: () => {} } } as unknown as ReturnType<ExecFileFn>;
    }) as ExecFileFn;

    const result = await runCliModel({
      allowTools: false,
      config: null,
      env: {},
      execFileImpl,
      model: 'gpt-fast',
      prompt: 'Test',
      provider: 'codex',
      timeoutMs: 1000,
    });

    expect(result.text).toBe('ok');
    expect(seenArgs).toContain('-c');
    expect(seenArgs).toContain('service_tier="fast"');
    expect(seenArgs).toContain('-m');
    expect(seenArgs[seenArgs.indexOf('-m') + 1]).toBe('gpt-5.5');
  });

  it('returns Codex stdout when present', async () => {
    const execFileImpl = makeStub(() => ({ stdout: 'from stdout' }));
    const result = await runCliModel({
      allowTools: false,
      config: null,
      env: {},
      execFileImpl,
      model: 'gpt-5.2',
      prompt: 'Test',
      provider: 'codex',
      timeoutMs: 1000,
    });
    expect(result.text).toBe('from stdout');
  });

  it('parses Codex JSONL usage + cost even when stdout has no assistant text', async () => {
    const execFileImpl = makeStub(() => ({
      stdout: [
        JSON.stringify({ usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 } }),
        JSON.stringify({
          cost_usd: 0.5,
          response: { usage: { completion_tokens: 3, prompt_tokens: 1, total_tokens: 4 } },
        }),
        JSON.stringify({
          metrics: { usage: { inputTokens: 5, outputTokens: 6, totalTokens: 11 } },
        }),
      ].join('\n'),
    }));

    await expect(
      runCliModel({
        allowTools: false,
        config: null,
        env: {},
        execFileImpl,
        model: 'gpt-5.2',
        prompt: 'Test',
        provider: 'codex',
        timeoutMs: 1000,
      }),
    ).rejects.toThrow('CLI returned empty output');
  });

  it('throws when Codex returns no output file and empty stdout', async () => {
    const execFileImpl = makeStub(() => ({ stdout: '' }));
    await expect(
      runCliModel({
        allowTools: false,
        config: null,
        env: {},
        execFileImpl,
        model: 'gpt-5.2',
        prompt: 'Test',
        provider: 'codex',
        timeoutMs: 1000,
      }),
    ).rejects.toThrow(/empty output/i);
  });

  it('falls back to plain text output', async () => {
    const execFileImpl = makeStub(() => ({ stdout: 'plain text' }));
    const result = await runCliModel({
      allowTools: false,
      config: null,
      env: {},
      execFileImpl,
      model: 'sonnet',
      prompt: 'Test',
      provider: 'claude',
      timeoutMs: 1000,
    });
    expect(result.text).toBe('plain text');
  });

  it('falls back to plain text when JSON lacks result', async () => {
    const execFileImpl = makeStub(() => ({ stdout: JSON.stringify({ ok: true }) }));
    const result = await runCliModel({
      allowTools: false,
      config: null,
      env: {},
      execFileImpl,
      model: 'sonnet',
      prompt: 'Test',
      provider: 'claude',
      timeoutMs: 1000,
    });
    expect(result.text).toBe('{"ok":true}');
  });

  it('throws on empty output', async () => {
    const execFileImpl = makeStub(() => ({ stdout: '   ' }));
    await expect(
      runCliModel({
        allowTools: false,
        config: null,
        env: {},
        execFileImpl,
        model: 'gemini-3-flash-preview',
        prompt: 'Test',
        provider: 'gemini',
        timeoutMs: 1000,
      }),
    ).rejects.toThrow(/empty output/);
  });

  it('surfaces exec errors with stderr', async () => {
    const execFileImpl: ExecFileFn = ((_cmd, _args, _options, cb) => {
      cb?.(new Error('boom'), '', 'nope');
      return { stdin: { end: () => {}, write: () => {} } } as unknown as ReturnType<ExecFileFn>;
    }) as ExecFileFn;

    await expect(
      runCliModel({
        allowTools: false,
        config: null,
        env: {},
        execFileImpl,
        model: 'sonnet',
        prompt: 'Test',
        provider: 'claude',
        timeoutMs: 1000,
      }),
    ).rejects.toThrow(/boom: nope/);
  });
});

describe('cli helpers', () => {
  it('resolves disabled providers', () => {
    expect(isCliDisabled('claude', null)).toBe(false);
    expect(isCliDisabled('codex', { enabled: ['claude'] })).toBe(true);
    expect(isCliDisabled('gemini', { enabled: ['gemini'] })).toBe(false);
  });

  it('resolves binaries', () => {
    expect(resolveCliBinary('claude', { claude: { binary: '/opt/claude' } }, {})).toBe(
      '/opt/claude',
    );
    expect(resolveCliBinary('codex', null, { SUMMARIZE_CLI_CODEX: '/opt/codex' })).toBe(
      '/opt/codex',
    );
    expect(resolveCliBinary('agent', null, { AGENT_PATH: '/opt/agent' })).toBe('/opt/agent');
    expect(resolveCliBinary('openclaw', null, { OPENCLAW_PATH: '/opt/openclaw' })).toBe(
      '/opt/openclaw',
    );
    expect(resolveCliBinary('opencode', null, { OPENCODE_PATH: '/opt/opencode' })).toBe(
      '/opt/opencode',
    );
    expect(resolveCliBinary('gemini', null, {})).toBe('gemini');
  });
});
