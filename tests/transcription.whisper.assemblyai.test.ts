import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

describe('transcription/whisper assemblyai', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('transcribes bytes via AssemblyAI upload and polling', async () => {
    let polls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/upload')) {
        expect(new Headers(init?.headers).get('authorization')).toBe('AAI');
        expect(new Headers(init?.headers).get('content-type')).toBe('audio/mpeg');
        return Response.json(
          { upload_url: 'https://upload.example/audio' },
          { headers: { 'content-type': 'application/json' }, status: 200 },
        );
      }
      if (url.endsWith('/transcript')) {
        expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body))).toMatchObject({
          audio_url: 'https://upload.example/audio',
          speech_models: ['universal-2'],
        });
        return Response.json(
          { id: 'tr_123', status: 'queued' },
          { headers: { 'content-type': 'application/json' }, status: 200 },
        );
      }
      if (url.endsWith('/transcript/tr_123')) {
        polls += 1;
        return Response.json(
          polls === 1
            ? { id: 'tr_123', status: 'processing' }
            : { id: 'tr_123', status: 'completed', text: 'AssemblyAI transcript' },
          { headers: { 'content-type': 'application/json' }, status: 200 },
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubEnv('SUMMARIZE_DISABLE_LOCAL_WHISPER_CPP', '1');
    vi.stubGlobal('fetch', fetchMock);
    const { transcribeMediaWithWhisper } =
      await import('../packages/core/src/transcription/whisper.js');

    const result = await transcribeMediaWithWhisper({
      assemblyaiApiKey: 'AAI',
      bytes: new Uint8Array([1, 2, 3]),
      falApiKey: null,
      filename: 'audio.mp3',
      groqApiKey: null,
      mediaType: 'audio/mpeg',
      openaiApiKey: null,
    });

    expect(result.text).toBe('AssemblyAI transcript');
    expect(result.provider).toBe('assemblyai');
    expect(result.error).toBeNull();
    expect(polls).toBe(2);
  });

  it('transcribes files via AssemblyAI file upload flow', async () => {
    const root = await mkdtemp(join(tmpdir(), 'summarize-assemblyai-'));
    const audioPath = join(root, 'clip.mp3');
    await writeFile(audioPath, new Uint8Array([1, 2, 3]));

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/upload')) {
        return Response.json(
          { upload_url: 'https://upload.example/file' },
          { headers: { 'content-type': 'application/json' }, status: 200 },
        );
      }
      if (url.endsWith('/transcript')) {
        return Response.json(
          { id: 'tr_file', status: 'completed', text: 'File transcript' },
          { headers: { 'content-type': 'application/json' }, status: 200 },
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    try {
      vi.stubEnv('SUMMARIZE_DISABLE_LOCAL_WHISPER_CPP', '1');
      vi.stubGlobal('fetch', fetchMock);
      const { transcribeMediaFileWithWhisper } =
        await import('../packages/core/src/transcription/whisper.js');

      const result = await transcribeMediaFileWithWhisper({
        assemblyaiApiKey: 'AAI',
        falApiKey: null,
        filePath: audioPath,
        filename: 'clip.mp3',
        groqApiKey: null,
        mediaType: 'audio/mpeg',
        openaiApiKey: null,
      });

      expect(result.text).toBe('File transcript');
      expect(result.provider).toBe('assemblyai');
      expect(result.error).toBeNull();
    } finally {
      await rm(root, { force: true, recursive: true }).catch(() => {
        /* empty */
      });
    }
  });

  it('falls back to OpenAI when AssemblyAI fails', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/upload')) {
        return new Response('nope', { headers: { 'content-type': 'text/plain' }, status: 500 });
      }
      if (url.endsWith('/audio/transcriptions')) {
        expect(init?.body).toBeInstanceOf(FormData);
        return Response.json(
          { text: 'OpenAI transcript' },
          { headers: { 'content-type': 'application/json' }, status: 200 },
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubEnv('SUMMARIZE_DISABLE_LOCAL_WHISPER_CPP', '1');
    vi.stubGlobal('fetch', fetchMock);
    const { transcribeMediaWithWhisper } =
      await import('../packages/core/src/transcription/whisper.js');

    const result = await transcribeMediaWithWhisper({
      assemblyaiApiKey: 'AAI',
      bytes: new Uint8Array([1, 2, 3]),
      falApiKey: null,
      filename: 'audio.mp3',
      groqApiKey: null,
      mediaType: 'audio/mpeg',
      openaiApiKey: 'OPENAI',
    });

    expect(result.text).toBe('OpenAI transcript');
    expect(result.provider).toBe('openai');
    expect(result.notes.join(' ')).toContain(
      'AssemblyAI transcription failed; falling back to OpenAI',
    );
  });
});
