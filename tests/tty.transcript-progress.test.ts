import { describe, expect, it, vi } from 'vitest';

import { createTranscriptProgressRenderer } from '../src/tty/progress/transcript.js';

describe('tty transcript progress renderer', () => {
  it('renders download line with total + rate and throttles rapid updates', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);

    const setText = vi.fn();
    const { onProgress, stop } = createTranscriptProgressRenderer({ spinner: { setText } });

    onProgress({
      kind: 'transcript-media-download-start',
      mediaUrl: 'https://cdn.example/episode.mp3',
      service: 'podcast',
      totalBytes: 4096,
      url: 'https://example.com',
    });
    expect(setText).toHaveBeenLastCalledWith('Downloading audio…');

    vi.setSystemTime(3000);
    onProgress({
      downloadedBytes: 2048,
      kind: 'transcript-media-download-progress',
      service: 'podcast',
      totalBytes: 4096,
      url: 'https://example.com',
    });
    expect(setText).toHaveBeenLastCalledWith(expect.stringContaining('2.0 KB/4.0 KB'));
    expect(setText).toHaveBeenLastCalledWith(expect.stringContaining('2.0s'));
    expect(setText).toHaveBeenLastCalledWith(expect.stringContaining('KB/s'));

    // Throttle: <100ms should skip spinner updates.
    const callsBefore = setText.mock.calls.length;
    vi.setSystemTime(3050);
    onProgress({
      downloadedBytes: 3072,
      kind: 'transcript-media-download-progress',
      service: 'podcast',
      totalBytes: 4096,
      url: 'https://example.com',
    });
    expect(setText.mock.calls.length).toBe(callsBefore);

    stop();
    vi.useRealTimers();
  });

  it('renders whisper line with duration-only and part counters', () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);

    const setText = vi.fn();
    const { onProgress } = createTranscriptProgressRenderer({ spinner: { setText } });

    onProgress({
      kind: 'transcript-whisper-start',
      modelId: 'whisper-1->fal-ai/wizper',
      parts: 3,
      providerHint: 'openai->fal',
      service: 'podcast',
      totalDurationSeconds: 44,
      url: 'https://example.com',
    });

    const first = setText.mock.calls.at(-1)?.[0] ?? '';
    expect(first).toContain('Whisper/OpenAI, whisper-1');
    expect(first).not.toContain('FAL');
    expect(first).toContain('44s');

    vi.setSystemTime(12_000);
    onProgress({
      kind: 'transcript-whisper-progress',
      partIndex: 1,
      parts: 3,
      processedDurationSeconds: 10,
      service: 'podcast',
      totalDurationSeconds: 44,
      url: 'https://example.com',
    });
    const next = setText.mock.calls.at(-1)?.[0] ?? '';
    expect(next).toContain('10s/44s');
    expect(next).toContain('1/3');
    expect(next).toContain('2.0s');

    vi.useRealTimers();
  });

  it('handles progress events before start (elapsed=0, no rate) and service variants', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);

    const setText = vi.fn();
    const { onProgress } = createTranscriptProgressRenderer({ spinner: { setText } });

    onProgress({
      downloadedBytes: 0,
      kind: 'transcript-media-download-progress',
      service: 'youtube',
      totalBytes: null,
      url: 'https://example.com',
    });
    const download = setText.mock.calls.at(-1)?.[0] ?? '';
    expect(download).toContain('Downloading audio (youtube, 0 B');
    expect(download).toContain('0.0s');
    expect(download).not.toContain('B/s');

    vi.setSystemTime(2000);
    onProgress({
      kind: 'transcript-whisper-progress',
      partIndex: null,
      parts: null,
      processedDurationSeconds: null,
      service: 'generic',
      totalDurationSeconds: null,
      url: 'https://example.com',
    });
    const whisper = setText.mock.calls.at(-1)?.[0] ?? '';
    expect(whisper).toContain('Transcribing (media, Whisper');
    expect(whisper).toContain('0.0s');

    vi.useRealTimers();
  });

  it('renders whisper.cpp label with model name', () => {
    vi.useFakeTimers();
    vi.setSystemTime(5000);

    const setText = vi.fn();
    const { onProgress } = createTranscriptProgressRenderer({ spinner: { setText } });

    onProgress({
      kind: 'transcript-whisper-start',
      modelId: 'base',
      parts: null,
      providerHint: 'cpp',
      service: 'podcast',
      totalDurationSeconds: 10,
      url: 'https://example.com',
    });
    const line = setText.mock.calls.at(-1)?.[0] ?? '';
    expect(line).toContain('Whisper.cpp, base');

    vi.useRealTimers();
  });

  it('shows the active cloud transcriber instead of the fallback chain', () => {
    vi.useFakeTimers();
    vi.setSystemTime(5000);

    const setText = vi.fn();
    const { onProgress } = createTranscriptProgressRenderer({ spinner: { setText } });

    onProgress({
      kind: 'transcript-whisper-start',
      modelId:
        'groq/whisper-large-v3-turbo->assemblyai/universal-2->google/gemini-2.5-flash->whisper-1',
      parts: null,
      providerHint: 'groq->assemblyai->gemini->openai',
      service: 'podcast',
      totalDurationSeconds: 10,
      url: 'https://example.com',
    });
    const line = setText.mock.calls.at(-1)?.[0] ?? '';
    expect(line).toContain('Whisper/Groq, groq/whisper-large-v3-turbo');
    expect(line).not.toContain('AssemblyAI');
    expect(line).not.toContain('->');

    vi.useRealTimers();
  });

  it('updates OSC progress determinately when totals are known', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);

    const setText = vi.fn();
    const setPercent = vi.fn();
    const setIndeterminate = vi.fn();
    const clear = vi.fn();
    const oscProgress = { clear, setIndeterminate, setPercent };
    const { onProgress, stop } = createTranscriptProgressRenderer({
      oscProgress,
      spinner: { setText },
    });

    onProgress({
      kind: 'transcript-media-download-start',
      mediaUrl: 'https://cdn.example/episode.mp3',
      service: 'podcast',
      totalBytes: 100,
      url: 'https://example.com',
    });
    expect(setPercent).toHaveBeenCalledWith('Downloading audio', 0);

    onProgress({
      kind: 'transcript-whisper-start',
      modelId: 'whisper-1',
      parts: 10,
      providerHint: 'openai',
      service: 'podcast',
      totalDurationSeconds: 100,
      url: 'https://example.com',
    });
    expect(setPercent).toHaveBeenCalledWith('Transcribing', 0);

    onProgress({
      kind: 'transcript-whisper-progress',
      partIndex: 4,
      parts: 10,
      processedDurationSeconds: 40,
      service: 'podcast',
      totalDurationSeconds: 100,
      url: 'https://example.com',
    });
    expect(setPercent).toHaveBeenLastCalledWith('Transcribing', 40);

    stop();
    vi.useRealTimers();
  });
});
