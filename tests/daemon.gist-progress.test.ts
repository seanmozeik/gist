import { describe, expect, it } from 'vitest';

import { type LinkPreviewProgressEvent, ProgressKind } from '../src/content/index.js';
import { formatProgress } from '../src/daemon/gist-progress.js';

describe('daemon/gist-progress', () => {
  it('formats link preview progress events', () => {
    const service = 'YouTube';

    const cases: [LinkPreviewProgressEvent, string | null][] = [
      [{ kind: ProgressKind.FetchHtmlStart } as LinkPreviewProgressEvent, 'Fetching…'],
      [
        { kind: ProgressKind.FirecrawlStart, reason: 'blocked' } as LinkPreviewProgressEvent,
        'Firecrawl… (blocked)',
      ],
      [
        { kind: ProgressKind.FirecrawlDone, ok: true } as LinkPreviewProgressEvent,
        'Firecrawl: done',
      ],
      [
        { kind: ProgressKind.FirecrawlDone, ok: false } as LinkPreviewProgressEvent,
        'Firecrawl: failed',
      ],
      [
        { hint: 'Captions…', kind: ProgressKind.TranscriptStart } as LinkPreviewProgressEvent,
        'Captions…',
      ],
      [{ hint: '', kind: ProgressKind.TranscriptStart } as LinkPreviewProgressEvent, 'Transcript…'],
      [
        { kind: ProgressKind.TranscriptMediaDownloadStart, service } as LinkPreviewProgressEvent,
        `${service}: downloading audio…`,
      ],
      [
        { kind: ProgressKind.TranscriptMediaDownloadProgress, service } as LinkPreviewProgressEvent,
        `${service}: downloading audio…`,
      ],
      [
        {
          downloadedBytes: 50,
          kind: ProgressKind.TranscriptMediaDownloadProgress,
          service,
          totalBytes: 100,
        } as LinkPreviewProgressEvent,
        `${service}: downloading audio… 50%`,
      ],
      [
        { kind: ProgressKind.TranscriptWhisperStart, service } as LinkPreviewProgressEvent,
        `${service}: transcribing…`,
      ],
      [
        { kind: ProgressKind.TranscriptWhisperProgress, service } as LinkPreviewProgressEvent,
        `${service}: transcribing…`,
      ],
      [
        {
          kind: ProgressKind.TranscriptWhisperProgress,
          processedDurationSeconds: 5,
          service,
          totalDurationSeconds: 10,
        } as LinkPreviewProgressEvent,
        `${service}: transcribing… 50%`,
      ],
      [
        { kind: ProgressKind.TranscriptDone, ok: true, service } as LinkPreviewProgressEvent,
        `${service}: transcript ready`,
      ],
      [
        { kind: ProgressKind.TranscriptDone, ok: false, service } as LinkPreviewProgressEvent,
        `${service}: transcript unavailable`,
      ],
      [{ kind: ProgressKind.BirdStart } as LinkPreviewProgressEvent, 'X: extracting tweet…'],
      [
        { client: 'xurl', kind: ProgressKind.BirdStart } as LinkPreviewProgressEvent,
        'X: extracting tweet (xurl)…',
      ],
      [{ kind: ProgressKind.BirdDone, ok: true } as LinkPreviewProgressEvent, 'X: extracted tweet'],
      [{ kind: ProgressKind.BirdDone, ok: false } as LinkPreviewProgressEvent, 'X: extract failed'],
      [
        { kind: ProgressKind.NitterStart } as LinkPreviewProgressEvent,
        'X: extracting tweet (nitter)…',
      ],
      [
        { kind: ProgressKind.NitterDone, ok: true } as LinkPreviewProgressEvent,
        'X: extracted tweet',
      ],
      [
        { kind: ProgressKind.NitterDone, ok: false } as LinkPreviewProgressEvent,
        'X: extract failed',
      ],
      [{ kind: 'unknown' as unknown as ProgressKind } as LinkPreviewProgressEvent, null],
    ];

    for (const [evt, expected] of cases) {
      expect(formatProgress(evt)).toBe(expected);
    }
  });
});
