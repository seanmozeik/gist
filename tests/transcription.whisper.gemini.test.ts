import { mkdtemp, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

describe('transcription/whisper gemini', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('uses Gemini inline transcription before OpenAI', async () => {
    vi.stubEnv('SUMMARIZE_DISABLE_LOCAL_WHISPER_CPP', '1');
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      expect(url).toContain('/models/gemini-2.5-flash:generateContent');
      const body = JSON.parse(String(init?.body)) as {
        contents?: { parts?: { inline_data?: { mime_type?: string; data?: string } }[] }[];
      };
      expect(body.contents?.[0]?.parts?.[1]?.inline_data?.mime_type).toBe('audio/mpeg');
      expect(body.contents?.[0]?.parts?.[1]?.inline_data?.data).toBeTypeOf('string');
      return Response.json(
        { candidates: [{ content: { parts: [{ text: 'gemini transcript' }] } }] },
        { headers: { 'content-type': 'application/json' }, status: 200 },
      );
    });

    vi.stubGlobal('fetch', fetchMock);
    const { transcribeMediaWithWhisper } =
      await import('../packages/core/src/transcription/whisper.js');
    const result = await transcribeMediaWithWhisper({
      bytes: new Uint8Array([1, 2, 3]),
      env: { SUMMARIZE_DISABLE_LOCAL_WHISPER_CPP: '1' },
      falApiKey: null,
      filename: 'clip.mp3',
      geminiApiKey: 'GEMINI',
      groqApiKey: null,
      mediaType: 'audio/mpeg',
      openaiApiKey: 'OPENAI',
    });

    expect(result.text).toBe('gemini transcript');
    expect(result.provider).toBe('gemini');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back from Gemini to OpenAI when Gemini fails', async () => {
    vi.stubEnv('SUMMARIZE_DISABLE_LOCAL_WHISPER_CPP', '1');
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('generativelanguage.googleapis.com')) {
        return Response.json({ error: { message: 'boom' } }, { status: 500 });
      }
      if (url.includes('/audio/transcriptions')) {
        return Response.json(
          { text: 'openai fallback' },
          { headers: { 'content-type': 'application/json' }, status: 200 },
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);
    const { transcribeMediaWithWhisper } =
      await import('../packages/core/src/transcription/whisper.js');
    const result = await transcribeMediaWithWhisper({
      bytes: new Uint8Array([1, 2, 3]),
      env: { SUMMARIZE_DISABLE_LOCAL_WHISPER_CPP: '1' },
      falApiKey: null,
      filename: 'clip.mp3',
      geminiApiKey: 'GEMINI',
      groqApiKey: null,
      mediaType: 'audio/mpeg',
      openaiApiKey: 'OPENAI',
    });

    expect(result.text).toBe('openai fallback');
    expect(result.provider).toBe('openai');
    expect(result.notes.join(' ')).toContain('Gemini transcription failed');
  });

  it('uses the Gemini Files API for oversized local files', async () => {
    vi.stubEnv('SUMMARIZE_DISABLE_LOCAL_WHISPER_CPP', '1');
    const root = await mkdtemp(join(tmpdir(), 'summarize-gemini-file-'));
    const audioPath = join(root, 'audio.mp3');
    await writeFile(audioPath, new Uint8Array([1, 2, 3]));
    await truncate(audioPath, 21 * 1024 * 1024);

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/upload/v1beta/files')) {
        return Response.json(
          {},
          { headers: { 'x-goog-upload-url': 'https://upload.example/files/123' }, status: 200 },
        );
      }
      if (url === 'https://upload.example/files/123') {
        return Response.json(
          {
            file: {
              mimeType: 'audio/mpeg',
              name: 'files/123',
              state: 'ACTIVE',
              uri: 'https://files.example/audio',
            },
          },
          { headers: { 'content-type': 'application/json' }, status: 200 },
        );
      }
      if (url.includes('/models/gemini-2.5-flash:generateContent')) {
        const body = JSON.parse(String(init?.body)) as {
          contents?: { parts?: { file_data?: { file_uri?: string } }[] }[];
        };
        expect(body.contents?.[0]?.parts?.[1]?.file_data?.file_uri).toBe(
          'https://files.example/audio',
        );
        return Response.json(
          { candidates: [{ content: { parts: [{ text: 'uploaded transcript' }] } }] },
          { headers: { 'content-type': 'application/json' }, status: 200 },
        );
      }
      if (url.endsWith('/v1beta/files/123')) {
        return new Response('', { status: 204 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    try {
      vi.stubGlobal('fetch', fetchMock);
      const { transcribeMediaFileWithWhisper } =
        await import('../packages/core/src/transcription/whisper.js');
      const result = await transcribeMediaFileWithWhisper({
        env: { SUMMARIZE_DISABLE_LOCAL_WHISPER_CPP: '1' },
        falApiKey: null,
        filePath: audioPath,
        filename: 'audio.mp3',
        geminiApiKey: 'GEMINI',
        groqApiKey: null,
        mediaType: 'audio/mpeg',
        openaiApiKey: null,
      });

      expect(result.text).toBe('uploaded transcript');
      expect(result.provider).toBe('gemini');
      expect(
        fetchMock.mock.calls.some(([input]) => String(input).includes('/upload/v1beta/files')),
      ).toBe(true);
    } finally {
      await rm(root, { force: true, recursive: true }).catch(() => {
        /* empty */
      });
    }
  });
});
