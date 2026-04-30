import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { toNitterUrls } from '../src/content/link-preview/content/twitter-utils';
import { runCli } from '../src/run';

const noopStream = () =>
  new Writable({
    write(chunk, encoding, callback) {
      undefined;
      undefined;
      callback();
    },
  });

describe('cli error handling', () => {
  const home = mkdtempSync(join(tmpdir(), 'gist-tests-errors-'));

  it('errors when url is missing', async () => {
    await expect(
      runCli([], {
        env: { HOME: home },
        fetch: globalThis.fetch.bind(globalThis),
        stderr: noopStream(),
        stdout: noopStream(),
      }),
    ).rejects.toThrow(/Usage: gist/);
  });

  it('errors when url is not http(s)', async () => {
    await expect(
      runCli(['ftp://example.com'], {
        env: { HOME: home },
        fetch: vi.fn() as unknown as typeof fetch,
        stderr: noopStream(),
        stdout: noopStream(),
      }),
    ).rejects.toThrow('Only HTTP and HTTPS URLs can be gisted');
  });

  it('errors when --firecrawl always is set without a key', async () => {
    await expect(
      runCli(['--firecrawl', 'always', '--extract', 'https://example.com'], {
        env: { HOME: home },
        fetch: vi.fn(
          async () => new Response('<html></html>', { status: 200 }),
        ) as unknown as typeof fetch,
        stderr: noopStream(),
        stdout: noopStream(),
      }),
    ).rejects.toThrow('--firecrawl always requires FIRECRAWL_API_KEY');
  });

  it('errors when --firecrawl always is set for a YouTube URL', async () => {
    await expect(
      runCli(
        ['--firecrawl', 'always', '--extract', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
        {
          env: { FIRECRAWL_API_KEY: 'fc-test', HOME: home },
          fetch: vi.fn() as unknown as typeof fetch,
          stderr: noopStream(),
          stdout: noopStream(),
        },
      ),
    ).rejects.toThrow(
      '--firecrawl always is not supported for YouTube URLs; use --youtube auto|web|yt-dlp|apify instead',
    );
  });

  it('errors when --markdown llm is set without any LLM keys', async () => {
    await expect(
      runCli(['--format', 'md', '--markdown-mode', 'llm', '--extract', 'https://example.com'], {
        env: { HOME: home },
        fetch: vi.fn(
          async () => new Response('<html></html>', { status: 200 }),
        ) as unknown as typeof fetch,
        stderr: noopStream(),
        stdout: noopStream(),
      }),
    ).rejects.toThrow(/--markdown-mode llm requires GEMINI_API_KEY/);
  });

  it('does not error for --markdown auto without keys', async () => {
    const html = `<!doctype html><html><head><title>Ok</title></head><body><article><p>${'A'.repeat(
      260,
    )}</p></article></body></html>`;

    const fetchMock = vi.fn(async () => new Response(html, { status: 200 }));

    let stdoutText = '';
    const stdout = new Writable({
      write(chunk, _encoding, callback) {
        stdoutText += chunk.toString();
        callback();
      },
    });

    await runCli(
      ['--format', 'md', '--markdown-mode', 'auto', '--extract', 'https://example.com'],
      {
        env: { HOME: home },
        fetch: fetchMock as unknown as typeof fetch,
        stderr: noopStream(),
        stdout,
      },
    );

    expect(stdoutText.length).toBeGreaterThan(0);
  });

  it('errors when --markdown-mode is used without --format md', async () => {
    await expect(
      runCli(['--markdown-mode', 'auto', 'https://example.com'], {
        env: { HOME: home },
        fetch: vi.fn(
          async () => new Response('<html></html>', { status: 200 }),
        ) as unknown as typeof fetch,
        stderr: noopStream(),
        stdout: noopStream(),
      }),
    ).rejects.toThrow('--markdown-mode is only supported with --format md');
  });

  it('errors when --format md conflicts with --markdown-mode off', async () => {
    await expect(
      runCli(['--extract', '--format', 'md', '--markdown-mode', 'off', 'https://example.com'], {
        env: { HOME: home },
        fetch: vi.fn() as unknown as typeof fetch,
        stderr: noopStream(),
        stdout: noopStream(),
      }),
    ).rejects.toThrow('--format md conflicts with --markdown-mode off');
  });

  it('errors when --cli and --model are both set', async () => {
    await expect(
      runCli(['--cli', 'gemini', '--model', 'openai/gpt-5.2', 'https://example.com'], {
        env: { HOME: home },
        fetch: vi.fn() as unknown as typeof fetch,
        stderr: noopStream(),
        stdout: noopStream(),
      }),
    ).rejects.toThrow('Use either --model or --cli');
  });

  it('prints extracted content when gisting without any model API keys (default auto)', async () => {
    const html = `<!doctype html><html><head><title>Ok</title></head><body><article><p>${'A'.repeat(
      260,
    )}</p></article></body></html>`;

    const fetchMock = vi.fn(async () => new Response(html, { status: 200 }));

    let stdoutText = '';
    const stdout = new Writable({
      write(chunk, _encoding, callback) {
        stdoutText += chunk.toString();
        callback();
      },
    });

    await runCli(['--timeout', '2s', 'https://example.com'], {
      env: { HOME: home },
      fetch: fetchMock as unknown as typeof fetch,
      stderr: noopStream(),
      stdout,
    });

    expect(stdoutText).toContain('A'.repeat(50));
  });

  it('adds an X CLI tip when Twitter fetch fails and no X CLI is installed', async () => {
    const fetchMock = vi.fn(async () => new Response('nope', { status: 404 }));

    await expect(
      runCli(['--extract-only', 'https://x.com/user/status/123'], {
        env: { HOME: home, PATH: '' },
        fetch: fetchMock as unknown as typeof fetch,
        stderr: noopStream(),
        stdout: noopStream(),
      }),
    ).rejects.toThrow(/Tip: Install xurl \(preferred\) or bird for better X support/);
  });

  it('fails gracefully when Twitter content is unavailable after bird and nitter', async () => {
    const tweetUrl = 'https://x.com/user/status/123';
    const nitterUrls = toNitterUrls(tweetUrl);
    const blockedHtml = `<!doctype html><html><body><p>Something went wrong, but don’t fret — let’s give it another shot.</p></body></html>`;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === tweetUrl || nitterUrls.includes(url)) {
        return new Response(blockedHtml, { headers: { 'Content-Type': 'text/html' }, status: 200 });
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });

    await expect(
      runCli(['--extract-only', tweetUrl], {
        env: { HOME: home, PATH: '' },
        fetch: fetchMock as unknown as typeof fetch,
        stderr: noopStream(),
        stdout: noopStream(),
      }),
    ).rejects.toThrow(/Unable to fetch tweet content from X/);
  });
});
