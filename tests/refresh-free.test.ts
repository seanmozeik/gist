import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

const llmMocks = vi.hoisted(() => ({ generateTextWithModelId: vi.fn() }));

vi.mock('../src/llm/generate-text.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/llm/generate-text.js')>();
  return { ...actual, generateTextWithModelId: llmMocks.generateTextWithModelId };
});

function createCaptureStream() {
  let out = '';
  const stream = new Writable({
    write(chunk, _enc, cb) {
      out += chunk.toString();
      cb();
    },
  });
  return { read: () => out, stream };
}

function buildModelsPayload(ids: string[]) {
  return {
    data: ids.map((id, index) => ({
      architecture: { modality: 'text' },
      context_length: 8192,
      created: Math.floor((Date.now() - index * 24 * 60 * 60 * 1000) / 1000),
      id,
      name: id,
      supported_parameters: ['temperature', 'max_tokens'],
      top_provider: { max_completion_tokens: 1024 },
    })),
  };
}

describe('refresh-free', () => {
  it('throws when OPENROUTER_API_KEY is missing', async () => {
    const { refreshFree } = await import('../src/refresh-free.js');
    const { stream: stdout } = createCaptureStream();
    const { stream: stderr } = createCaptureStream();
    await expect(
      refreshFree({ env: {}, fetchImpl: vi.fn() as unknown as typeof fetch, stderr, stdout }),
    ).rejects.toThrow(/Missing OPENROUTER_API_KEY/);
  });

  it('throws when OpenRouter /models returns non-OK', async () => {
    llmMocks.generateTextWithModelId.mockReset();

    const home = await mkdtemp(join(tmpdir(), 'summarize-refresh-free-'));
    const { refreshFree } = await import('../src/refresh-free.js');
    const { stream: stdout } = createCaptureStream();
    const { stream: stderr } = createCaptureStream();

    const fetchImpl = vi.fn(async () => {
      return new Response('nope', { headers: { 'content-type': 'text/plain' }, status: 500 });
    });

    await expect(
      refreshFree({
        env: { HOME: home, OPENROUTER_API_KEY: 'KEY' },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        stderr,
        stdout,
      }),
    ).rejects.toThrow('OpenRouter /models failed: HTTP 500');
  });

  it('writes models.free and optionally sets model=free', async () => {
    llmMocks.generateTextWithModelId.mockReset().mockResolvedValue({ text: 'OK' });

    const home = await mkdtemp(join(tmpdir(), 'summarize-refresh-free-'));
    const { refreshFree } = await import('../src/refresh-free.js');
    const { stream: stdout, read: readStdout } = createCaptureStream();
    const { stream: stderr } = createCaptureStream();

    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url =
        typeof input === 'string' ? input : (input instanceof URL ? input.toString() : input.url);
      if (url === 'https://openrouter.ai/api/v1/models') {
        return new Response(JSON.stringify(buildModelsPayload(['a/model:free', 'b/model:free'])), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    await refreshFree({
      env: { HOME: home, OPENROUTER_API_KEY: 'KEY' },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      options: { maxCandidates: 1, runs: 0, setDefault: true, smart: 1 },
      stderr,
      stdout,
    });

    expect(readStdout()).toContain('Wrote');
    const configPath = join(home, '.summarize', 'config.json');
    const raw = await readFile(configPath, 'utf8');
    const parsed = JSON.parse(raw) as unknown as {
      model?: string;
      models?: { free?: { rules?: { candidates?: string[] }[] } };
    };
    expect(parsed.model).toBe('free');
    expect(parsed.models?.free?.rules?.[0]?.candidates?.[0]).toMatch(/^openrouter\//);
  });

  it('fails when /models returns no :free models (with and without age filter)', async () => {
    llmMocks.generateTextWithModelId.mockReset();
    const home = await mkdtemp(join(tmpdir(), 'summarize-refresh-free-'));
    const { refreshFree } = await import('../src/refresh-free.js');
    const { stream: stdout } = createCaptureStream();
    const { stream: stderr } = createCaptureStream();

    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify(buildModelsPayload(['a/model:paid'])), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      });
    });

    await expect(
      refreshFree({
        env: { HOME: home, OPENROUTER_API_KEY: 'KEY' },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        options: { maxAgeDays: 180 },
        stderr,
        stdout,
      }),
    ).rejects.toThrow(/no :free models from the last 180 days/i);

    await expect(
      refreshFree({
        env: { HOME: home, OPENROUTER_API_KEY: 'KEY' },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        options: { maxAgeDays: 0 },
        stderr,
        stdout,
      }),
    ).rejects.toThrow(/returned no :free models$/i);
  });

  it('surfaces invalid config comments and models shape errors', async () => {
    llmMocks.generateTextWithModelId.mockReset().mockResolvedValue({ text: 'OK' });

    const home = await mkdtemp(join(tmpdir(), 'summarize-refresh-free-'));
    const configPath = join(home, '.summarize', 'config.json');
    await mkdir(join(home, '.summarize'), { recursive: true });
    await writeFile(configPath, '{\n// nope\n}\n', 'utf8');

    const { refreshFree } = await import('../src/refresh-free.js');
    const { stream: stdout } = createCaptureStream();
    const { stream: stderr } = createCaptureStream();

    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify(buildModelsPayload(['a/model:free'])), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      });
    });

    await expect(
      refreshFree({
        env: { HOME: home, OPENROUTER_API_KEY: 'KEY' },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        options: { maxCandidates: 1, runs: 0 },
        stderr,
        stdout,
      }),
    ).rejects.toThrow(/comments are not allowed/i);

    await writeFile(configPath, JSON.stringify({ models: 'nope' }), 'utf8');
    await expect(
      refreshFree({
        env: { HOME: home, OPENROUTER_API_KEY: 'KEY' },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        options: { maxCandidates: 1, runs: 0 },
        stderr,
        stdout,
      }),
    ).rejects.toThrow(/"models" must be an object/i);
  });

  it('filters old + small models and prints verbose skip lines', async () => {
    llmMocks.generateTextWithModelId.mockReset().mockResolvedValue({ text: 'OK' });

    const home = await mkdtemp(join(tmpdir(), 'summarize-refresh-free-'));
    const { refreshFree } = await import('../src/refresh-free.js');
    const { stream: stdout } = createCaptureStream();
    const { stream: stderr, read: readStderr } = createCaptureStream();

    const nowSec = Math.floor(Date.now() / 1000);
    const tooOldSec = nowSec - 400 * 24 * 60 * 60;

    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          data: [
            { created: nowSec, id: 'a/model-70b:free', name: 'A 70B' },
            { created: nowSec, id: 'b/model-1b:free', name: 'B 1B' },
            { created: tooOldSec, id: 'c/model-70b:free', name: 'C 70B old' },
            { id: 'd/model-70b:free', name: 'D 70B missing created' },
          ],
        }),
        { headers: { 'content-type': 'application/json' }, status: 200 },
      );
    });

    await refreshFree({
      env: { HOME: home, OPENROUTER_API_KEY: 'KEY' },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      options: { maxAgeDays: 180, maxCandidates: 1, minParamB: 27, runs: 0, smart: 1 },
      stderr,
      stdout,
      verbose: true,
    });

    const out = readStderr();
    expect(out).toContain('filtered');
    expect(out).toContain('skip');
  });

  it('classifies common failure types and prints per-day quota note', async () => {
    const home = await mkdtemp(join(tmpdir(), 'summarize-refresh-free-'));
    const { refreshFree } = await import('../src/refresh-free.js');
    const { stream: stdout } = createCaptureStream();
    const { stream: stderr, read: readStderr } = createCaptureStream();

    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify(buildModelsPayload(['a/model:free', 'b/model:free', 'c/model:free'])),
        { headers: { 'content-type': 'application/json' }, status: 200 },
      );
    });

    llmMocks.generateTextWithModelId
      .mockReset()
      .mockImplementation(async ({ modelId }: { modelId: string }) => {
        if (modelId.includes('a/model:free'))
          {throw new Error('Rate limit exceeded: per-day free-models-per-day');}
        if (modelId.includes('b/model:free')) {throw new Error('No allowed providers are available');}
        if (modelId.includes('c/model:free')) {return { text: 'OK' };}
        throw new Error('unexpected');
      });

    await refreshFree({
      env: { HOME: home, OPENROUTER_API_KEY: 'KEY' },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      options: { concurrency: 1, maxCandidates: 1, runs: 0, smart: 1 },
      stderr,
      stdout,
    });

    const out = readStderr();
    expect(out).toContain('results');
    expect(out).toContain('per-day');
  });

  it('handles TTY progress rendering without throwing', async () => {
    llmMocks.generateTextWithModelId.mockReset().mockResolvedValue({ text: 'OK' });

    const home = await mkdtemp(join(tmpdir(), 'summarize-refresh-free-'));
    const { refreshFree } = await import('../src/refresh-free.js');
    const { stream: stdout } = createCaptureStream();
    const { stream: stderr } = createCaptureStream();
    (stderr as unknown as { isTTY?: boolean }).isTTY = true;

    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify(buildModelsPayload(['a/model:free'])), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      });
    });

    await refreshFree({
      env: { FORCE_COLOR: '1', HOME: home, OPENROUTER_API_KEY: 'KEY' },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      options: { concurrency: 1, maxCandidates: 1, runs: 0, smart: 1 },
      stderr,
      stdout,
    });
  });

  it('refines candidates over extra runs', async () => {
    const home = await mkdtemp(join(tmpdir(), 'summarize-refresh-free-'));
    const { refreshFree } = await import('../src/refresh-free.js');
    const { stream: stdout } = createCaptureStream();
    const { stream: stderr } = createCaptureStream();

    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify(buildModelsPayload(['a/model:free', 'b/model:free'])), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      });
    });

    let seen = 0;
    llmMocks.generateTextWithModelId
      .mockReset()
      .mockImplementation(async ({ modelId }: { modelId: string }) => {
        seen += 1;
        // Fail one of the refine runs for b/model.
        if (modelId.includes('b/model:free') && seen > 2) {throw new Error('provider error');}
        return { text: 'OK' };
      });

    await refreshFree({
      env: { HOME: home, OPENROUTER_API_KEY: 'KEY' },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      options: { concurrency: 1, maxCandidates: 2, runs: 1, smart: 1 },
      stderr,
      stdout,
    });
  });

  it('rejects a config file that is not a top-level object', async () => {
    llmMocks.generateTextWithModelId.mockReset().mockResolvedValue({ text: 'OK' });

    const home = await mkdtemp(join(tmpdir(), 'summarize-refresh-free-'));
    const configPath = join(home, '.summarize', 'config.json');
    await mkdir(join(home, '.summarize'), { recursive: true });
    await writeFile(configPath, '[]', 'utf8');

    const { refreshFree } = await import('../src/refresh-free.js');
    const { stream: stdout } = createCaptureStream();
    const { stream: stderr } = createCaptureStream();
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify(buildModelsPayload(['a/model:free'])), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      });
    });

    await expect(
      refreshFree({
        env: { HOME: home, OPENROUTER_API_KEY: 'KEY' },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        options: { maxCandidates: 1, runs: 0 },
        stderr,
        stdout,
      }),
    ).rejects.toThrow(/expected an object at the top level/i);
  });

  it('retries once after per-minute rate limit and uses a global cooldown', async () => {
    vi.useFakeTimers();
    try {
      llmMocks.generateTextWithModelId.mockReset();

      const home = await mkdtemp(join(tmpdir(), 'summarize-refresh-free-'));
      const { refreshFree } = await import('../src/refresh-free.js');
      const { stream: stdout } = createCaptureStream();
      const { stream: stderr, read: readStderr } = createCaptureStream();

      const fetchImpl = vi.fn(async () => {
        return new Response(JSON.stringify(buildModelsPayload(['a/model:free'])), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        });
      });

      let calls = 0;
      llmMocks.generateTextWithModelId.mockImplementation(async () => {
        calls += 1;
        if (calls === 1) {
          throw new Error('Rate limit exceeded: free-models-per-min');
        }
        return { text: 'OK' };
      });

      const promise = refreshFree({
        env: { HOME: home, OPENROUTER_API_KEY: 'KEY' },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        options: { concurrency: 1, maxCandidates: 1, runs: 0, timeoutMs: 10 },
        stderr,
        stdout,
      });

      await vi.advanceTimersByTimeAsync(70_000);
      await promise;

      expect(calls).toBe(2);
      expect(readStderr()).toContain('rate limit hit; sleeping');
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects /* */ comments in the config file', async () => {
    llmMocks.generateTextWithModelId.mockReset().mockResolvedValue({ text: 'OK' });

    const home = await mkdtemp(join(tmpdir(), 'summarize-refresh-free-'));
    const configPath = join(home, '.summarize', 'config.json');
    await mkdir(join(home, '.summarize'), { recursive: true });
    await writeFile(configPath, '{\n/* nope */\n}\n', 'utf8');

    const { refreshFree } = await import('../src/refresh-free.js');
    const { stream: stdout } = createCaptureStream();
    const { stream: stderr } = createCaptureStream();
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify(buildModelsPayload(['a/model:free'])), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      });
    });

    await expect(
      refreshFree({
        env: { HOME: home, OPENROUTER_API_KEY: 'KEY' },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        options: { concurrency: 1, maxCandidates: 1, runs: 0 },
        stderr,
        stdout,
      }),
    ).rejects.toThrow(/comments are not allowed/i);
  });

  it('fails when no candidate works (all attempts error)', async () => {
    llmMocks.generateTextWithModelId.mockReset().mockImplementation(async () => {
      throw new Error('provider error');
    });

    const home = await mkdtemp(join(tmpdir(), 'summarize-refresh-free-'));
    const { refreshFree } = await import('../src/refresh-free.js');
    const { stream: stdout } = createCaptureStream();
    const { stream: stderr } = createCaptureStream();
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify(buildModelsPayload(['a/model:free', 'b/model:free'])), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      });
    });

    await expect(
      refreshFree({
        env: { HOME: home, OPENROUTER_API_KEY: 'KEY' },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        options: { concurrency: 1, maxCandidates: 2, runs: 0, smart: 1 },
        stderr,
        stdout,
      }),
    ).rejects.toThrow(/No working :free models found/i);
  });

  it('defaults unknown OpenRouter rate limits to per-minute and retries once', async () => {
    vi.useFakeTimers();
    try {
      llmMocks.generateTextWithModelId.mockReset();

      const home = await mkdtemp(join(tmpdir(), 'summarize-refresh-free-'));
      const { refreshFree } = await import('../src/refresh-free.js');
      const { stream: stdout } = createCaptureStream();
      const { stream: stderr, read: readStderr } = createCaptureStream();

      const fetchImpl = vi.fn(async () => {
        return new Response(JSON.stringify(buildModelsPayload(['a/model:free'])), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        });
      });

      let calls = 0;
      llmMocks.generateTextWithModelId.mockImplementation(async () => {
        calls += 1;
        if (calls === 1) {throw new Error('Rate limit exceeded');}
        return { text: 'OK' };
      });

      const promise = refreshFree({
        env: { HOME: home, OPENROUTER_API_KEY: 'KEY' },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        options: { concurrency: 1, maxCandidates: 1, runs: 0, timeoutMs: 10 },
        stderr,
        stdout,
      });
      await vi.advanceTimersByTimeAsync(70_000);
      await promise;

      expect(calls).toBe(2);
      expect(readStderr()).toContain('rate limit hit; sleeping');
    } finally {
      vi.useRealTimers();
    }
  });

  it('infers param size from model IDs (e2b, decimals) and filters by minParamB', async () => {
    llmMocks.generateTextWithModelId.mockReset().mockResolvedValue({ text: 'OK' });

    const home = await mkdtemp(join(tmpdir(), 'summarize-refresh-free-'));
    const { refreshFree } = await import('../src/refresh-free.js');
    const { stream: stdout } = createCaptureStream();
    const { stream: stderr } = createCaptureStream();

    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify(
          buildModelsPayload(['x/model-e2b:free', 'y/model-1.5b:free', 'z/model-3b:free']),
        ),
        { headers: { 'content-type': 'application/json' }, status: 200 },
      );
    });

    await refreshFree({
      env: { HOME: home, OPENROUTER_API_KEY: 'KEY' },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      options: {
        concurrency: 1,
        maxAgeDays: 0,
        maxCandidates: 10,
        minParamB: 2,
        runs: 0,
        smart: 10,
      },
      stderr,
      stdout,
    });

    const configPath = join(home, '.summarize', 'config.json');
    const raw = await readFile(configPath, 'utf8');
    const parsed = JSON.parse(raw) as unknown as {
      models?: { free?: { rules?: { candidates?: string[] }[] } };
    };
    const candidates = parsed.models?.free?.rules?.[0]?.candidates ?? [];
    expect(candidates.some((c: string) => c.includes('y/model-1.5b:free'))).toBe(false);
    expect(candidates.some((c: string) => c.includes('x/model-e2b:free'))).toBe(true);
  });
});
