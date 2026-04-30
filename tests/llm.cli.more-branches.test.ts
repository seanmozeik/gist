import type { ChildProcess } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { runCliModel } from '../src/llm/cli.js';

describe('llm/cli extra branches', () => {
  it('parses the last JSON object when stdout includes a preface', async () => {
    const result = await runCliModel({
      allowTools: false,
      config: null,
      env: {},
      execFileImpl: (_cmd, _args, _opts, cb) => {
        cb(
          null,
          [
            'some debug output',
            '{"result":"OK","stats":{"models":{"x":{"tokens":{"prompt":2,"candidates":3,"total":5}}}}}',
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
      model: 'gemini-2.0',
      prompt: 'hi',
      provider: 'gemini',
      timeoutMs: 1000,
    });

    expect(result.text).toBe('OK');
    expect(result.usage?.promptTokens).toBe(2);
    expect(result.usage?.completionTokens).toBe(3);
    expect(result.usage?.totalTokens).toBe(5);
  });

  it('falls back to the last JSON object when the first looks like JSON but is invalid', async () => {
    const result = await runCliModel({
      allowTools: false,
      config: null,
      env: {},
      execFileImpl: (_cmd, _args, _opts, cb) => {
        cb(
          null,
          [
            '{ this is not json',
            '{"result":"OK","usage":{"input_tokens":1,"output_tokens":2}}',
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
      model: 'claude-sonnet',
      prompt: 'hi',
      provider: 'claude',
      timeoutMs: 1000,
    });

    expect(result.text).toBe('OK');
    expect(result.usage?.promptTokens).toBe(1);
    expect(result.usage?.completionTokens).toBe(2);
    expect(result.usage?.totalTokens).toBe(3);
  });
});
