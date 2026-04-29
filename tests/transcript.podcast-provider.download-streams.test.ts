import { describe, expect, it, vi } from 'vitest';

import { MAX_OPENAI_UPLOAD_BYTES } from '../packages/core/src/transcription/whisper.js';

type SpawnPlan = 'ffmpeg-ok' | 'ffmpeg-missing';

async function importPodcastProviderWithFfmpeg(plan: SpawnPlan) {
  vi.resetModules();
  vi.doMock('node:child_process', () => ({
    spawn: (_cmd: string, args: string[]) => {
      if (_cmd === 'ffprobe') {
        const handlers = new Map<string, (value?: unknown) => void>();
        const proc = {
          on(event: string, handler: (value?: unknown) => void) {
            handlers.set(event, handler);
            return proc;
          },
          stdout: { on: (_event: string, _handler: unknown) => proc, setEncoding: () => proc },
        } as unknown;
        queueMicrotask(() => handlers.get('error')?.(new Error('spawn ENOENT')));
        return proc;
      }

      if (_cmd !== 'ffmpeg' || !args.includes('-version')) {
        throw new Error(`Unexpected spawn: ${_cmd} ${args.join(' ')}`);
      }
      const handlers = new Map<string, (value?: unknown) => void>();
      const proc = {
        on(event: string, handler: (value?: unknown) => void) {
          handlers.set(event, handler);
          return proc;
        },
      } as unknown;
      queueMicrotask(() => {
        if (plan === 'ffmpeg-ok') {handlers.get('close')?.(0);}
        else {handlers.get('error')?.(new Error('spawn ENOENT'));}
      });
      return proc;
    },
  }));

  return  import('../packages/core/src/content/transcript/providers/podcast.js');
}

const baseOptions = {
  apifyApiToken: null,
  falApiKey: null,
  fetch: vi.fn() as unknown as typeof fetch,
  groqApiKey: null,
  openaiApiKey: 'OPENAI',
  scrapeWithFirecrawl: null as unknown as ((...args: unknown[]) => unknown) | null,
  youtubeTranscriptMode: 'auto' as const,
  ytDlpPath: null,
};

describe('podcast transcript provider - streaming download branches', () => {
  it('handles downloadCappedBytes stream edge cases (undefined chunks, slice, cancel errors)', async () => {
    const { fetchTranscript } = await importPodcastProviderWithFfmpeg('ffmpeg-missing');
    const enclosureUrl = 'https://example.com/episode.mp3';
    const xml = `<rss><channel><item><enclosure url="${enclosureUrl}" type="audio/mpeg"/></item></channel></rss>`;

    const reader = (() => {
      let i = 0;
      return {
        async cancel() {
          throw new Error('cancel failed');
        },
        async read() {
          i += 1;
          if (i === 1) return { done: false, value: undefined as unknown as Uint8Array };
          if (i === 2) return { done: false, value: new Uint8Array(MAX_OPENAI_UPLOAD_BYTES + 10) };
          return { done: true, value: undefined as unknown as Uint8Array };
        },
      };
    })();

    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'HEAD') {
        return new Response(null, {
          headers: { 'content-length': String(30 * 1024 * 1024), 'content-type': 'audio/mpeg' },
          status: 200,
        });
      }
      return {
        body: { getReader: () => reader },
        headers: new Headers({ 'content-type': 'audio/mpeg' }),
        ok: true,
        status: 200,
      } as unknown as Response;
    });

    const openaiFetch = vi.fn(async () => {
      return new Response(JSON.stringify({ text: 'ok' }), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      });
    });

    try {
      vi.stubGlobal('fetch', openaiFetch);
      const result = await fetchTranscript(
        { html: xml, resourceKey: null, url: 'https://example.com/feed.xml' },
        { ...baseOptions, fetch: fetchImpl as unknown as typeof fetch },
      );
      expect(result.source).toBe('whisper');
      expect(result.text).toBe('ok');
    } finally {
      vi.unstubAllGlobals();
      vi.doUnmock('node:child_process');
    }
  });

  it('handles downloadToFile stream edge cases (undefined chunks, cancel errors)', async () => {
    const { fetchTranscript } = await importPodcastProviderWithFfmpeg('ffmpeg-ok');
    const enclosureUrl = 'https://example.com/episode.mp3';
    const xml = `<rss><channel><item><enclosure url="${enclosureUrl}" type="audio/mpeg"/></item></channel></rss>`;

    const reader = (() => {
      let i = 0;
      return {
        async cancel() {
          throw new Error('cancel failed');
        },
        async read() {
          i += 1;
          if (i === 1) return { done: false, value: undefined as unknown as Uint8Array };
          if (i === 2) return { done: false, value: new Uint8Array([1, 2, 3]) };
          return { done: true, value: undefined as unknown as Uint8Array };
        },
      };
    })();

    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'HEAD') {
        throw new Error('no head');
      }
      return {
        async arrayBuffer() {
          return new Uint8Array([1, 2, 3]).buffer;
        },
        body: { getReader: () => reader },
        headers: new Headers({ 'content-type': 'audio/mpeg' }),
        ok: true,
        status: 200,
      } as unknown as Response;
    });

    const openaiFetch = vi.fn(async () => {
      return new Response(JSON.stringify({ text: 'ok' }), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      });
    });

    try {
      vi.stubGlobal('fetch', openaiFetch);
      const result = await fetchTranscript(
        { html: xml, resourceKey: null, url: 'https://example.com/feed.xml' },
        { ...baseOptions, fetch: fetchImpl as unknown as typeof fetch },
      );
      expect(result.source).toBe('whisper');
      expect(result.text).toBe('ok');
    } finally {
      vi.unstubAllGlobals();
      vi.doUnmock('node:child_process');
    }
  });
});
