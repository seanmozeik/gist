import { describe, expect, it } from 'vitest';

import { parseOutputLanguage } from '../src/language';
import {
  buildLinkSummaryPrompt,
  estimateMaxCompletionTokensForCharacters,
  pickSummaryLengthForCharacters,
} from '../src/prompts/link-summary.js';

describe('prompts/link-summary - more branches', () => {
  it('picks summary length presets by character targets', () => {
    expect(pickSummaryLengthForCharacters(100)).toBe('short');
    expect(pickSummaryLengthForCharacters(2000)).toBe('medium');
    expect(pickSummaryLengthForCharacters(5000)).toBe('long');
    expect(pickSummaryLengthForCharacters(10_000)).toBe('xl');
    expect(pickSummaryLengthForCharacters(50_000)).toBe('xxl');
    expect(estimateMaxCompletionTokensForCharacters(1000)).toBeGreaterThan(0);
  });

  it('builds prompts with metadata, truncation notes, transcript hints, and share context', () => {
    const prompt = buildLinkSummaryPrompt({
      content: 'Hello world',
      description: 'Desc',
      hasTranscript: true,
      outputLanguage: parseOutputLanguage('de'),
      shares: [
        {
          author: 'A',
          handle: '@a',
          likeCount: 12_345,
          replyCount: null,
          reshareCount: 0,
          text: 'Hot take',
          timestamp: '2025-12-24',
        },
        {
          author: 'B',
          likeCount: null,
          replyCount: null,
          reshareCount: null,
          text: 'Second',
          timestamp: null,
        },
      ],
      siteName: 'Site',
      summaryLength: { maxCharacters: 1200 },
      title: 'Title',
      truncated: true,
      url: 'https://example.com',
    });

    expect(prompt).toContain('<instructions>');
    expect(prompt).toContain('<context>');
    expect(prompt).toContain('<content>');
    expect(prompt).toContain('Source URL: https://example.com');
    expect(prompt).toContain('Page name: Title');
    expect(prompt).toContain('Site: Site');
    expect(prompt).toContain('Page description: Desc');
    expect(prompt).toContain('Note: Content truncated');
    expect(prompt).toContain('12,345');
    expect(prompt).toContain('Write the answer in German.');
    expect(prompt).toContain('online videos');
  });

  it('builds prompts without shares and without truncation', () => {
    const prompt = buildLinkSummaryPrompt({
      content: '',
      description: null,
      hasTranscript: false,
      outputLanguage: { kind: 'auto' },
      shares: [],
      siteName: null,
      summaryLength: 'short',
      title: null,
      truncated: false,
      url: 'https://example.com',
    });
    expect(prompt).toContain('You are not given any quotes');
    expect(prompt).toContain('online articles');
  });

  it('respects explicit maxCharacters when below content length', () => {
    const content = 'x'.repeat(2000);
    const prompt = buildLinkSummaryPrompt({
      content,
      description: null,
      hasTranscript: false,
      outputLanguage: { kind: 'auto' },
      shares: [],
      siteName: null,
      summaryLength: { maxCharacters: 1000 },
      title: null,
      truncated: false,
      url: 'https://example.com',
    });
    expect(prompt).toContain('Target length: up to 1,000 characters');
    expect(prompt).toContain('Extracted content length: 2,000 characters');
  });
});
