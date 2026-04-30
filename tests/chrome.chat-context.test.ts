import { describe, expect, it } from 'vitest';

import { buildChatPageContent } from '../apps/chrome-extension/src/lib/chat-context';

describe('chrome/chat-context', () => {
  it('includes summary when transcript is within cap', () => {
    const content = buildChatPageContent({
      metadata: {
        extractionStrategy: 'html',
        mediaDurationSeconds: 120,
        source: 'url',
        title: 'Example',
        transcriptHasTimestamps: true,
        transcriptSource: 'yt-dlp',
        url: 'https://example.com',
      },
      summary: 'Short summary',
      summaryCap: 50,
      transcript: 'Hello transcript',
    });

    expect(content).toContain('Metadata:');
    expect(content).toContain('URL: https://example.com');
    expect(content).toContain('Page name: Example');
    expect(content).toContain('Source: URL extraction (daemon)');
    expect(content).toContain('Extraction strategy: html');
    expect(content).toContain('URL: https://example.com (duration 2m 00s)');
    expect(content).toContain('Transcription method: yt-dlp');
    expect(content).toContain('Transcript timestamps: yes');
    expect(content).toContain('Summary (auto-generated):');
  });

  it('skips summary when transcript exceeds cap', () => {
    const content = buildChatPageContent({
      metadata: { source: 'url' },
      summary: 'Short summary',
      summaryCap: 50,
      transcript: 'x'.repeat(60),
    });

    expect(content).toContain('Full transcript:');
    expect(content).not.toContain('Summary (auto-generated)');
  });

  it('skips summary when summary is empty', () => {
    const content = buildChatPageContent({
      metadata: { source: 'page' },
      summary: '   ',
      summaryCap: 50,
      transcript: 'Hello transcript',
    });

    expect(content).toContain('Full transcript:');
    expect(content).not.toContain('Summary (auto-generated)');
  });
});
