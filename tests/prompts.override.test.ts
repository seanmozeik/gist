import { describe, expect, it } from 'vitest';

import { parseOutputLanguage } from '../src/language.js';
import {
  buildFileTextSummaryPrompt,
  buildLinkSummaryPrompt,
  buildPathSummaryPrompt,
} from '../src/prompts/index.js';

describe('prompt overrides', () => {
  it('replaces link instructions but keeps context/content tags', () => {
    const prompt = buildLinkSummaryPrompt({
      content: 'Body',
      description: null,
      hasTranscript: false,
      languageInstruction: 'Output should be English.',
      lengthInstruction: 'Output is 120 characters.',
      outputLanguage: parseOutputLanguage('en'),
      promptOverride: 'Custom instruction.',
      shares: [],
      siteName: 'Example',
      summaryLength: { maxCharacters: 120 },
      title: 'Hello',
      truncated: false,
      url: 'https://example.com',
    });

    expect(prompt).toContain('<instructions>');
    expect(prompt).toContain('Custom instruction.');
    expect(prompt).toContain('Output is 120 characters.');
    expect(prompt).toContain('Output should be English.');
    expect(prompt).toContain('<context>');
    expect(prompt).toContain('Source URL: https://example.com');
    expect(prompt).toContain('<content>');
    expect(prompt).toContain('Body');
    expect(prompt).not.toContain('You gist online articles');
  });

  it('replaces file-text instructions and keeps inline content', () => {
    const prompt = buildFileTextSummaryPrompt({
      content: 'Hello world!',
      contentLength: 12,
      contentMediaType: 'text/plain',
      filename: 'notes.txt',
      languageInstruction: 'Output should be English.',
      lengthInstruction: null,
      originalMediaType: 'text/plain',
      outputLanguage: parseOutputLanguage('en'),
      promptOverride: 'Gist in two bullets.',
      summaryLength: 'short',
    });

    expect(prompt).toContain('<instructions>');
    expect(prompt).toContain('Gist in two bullets.');
    expect(prompt).toContain('Output should be English.');
    expect(prompt).toContain('<content>');
    expect(prompt).toContain('Hello world!');
    expect(prompt).not.toContain('You gist files');
  });

  it('replaces path prompt instructions for CLI attachments', () => {
    const prompt = buildPathSummaryPrompt({
      filePath: '/tmp/sample.pdf',
      filename: 'sample.pdf',
      kindLabel: 'file',
      languageInstruction: 'Output should be English.',
      lengthInstruction: 'Output is 500 characters.',
      mediaType: 'application/pdf',
      outputLanguage: parseOutputLanguage('en'),
      promptOverride: 'Custom file instructions.',
      summaryLength: { maxCharacters: 500 },
    });

    expect(prompt).toContain('<instructions>');
    expect(prompt).toContain('Custom file instructions.');
    expect(prompt).toContain('Output is 500 characters.');
    expect(prompt).toContain('<context>');
    expect(prompt).toContain('Path: /tmp/sample.pdf');
    expect(prompt).not.toContain('You gist files');
  });

  it('does not add length/language lines when instructions are null', () => {
    const prompt = buildLinkSummaryPrompt({
      content: 'Body',
      description: null,
      hasTranscript: false,
      languageInstruction: null,
      lengthInstruction: null,
      outputLanguage: parseOutputLanguage('en'),
      promptOverride: 'Custom prompt only.',
      shares: [],
      siteName: 'Example',
      summaryLength: { maxCharacters: 200 },
      title: 'None',
      truncated: false,
      url: 'https://example.com/none',
    });

    expect(prompt).toContain('Custom prompt only.');
    expect(prompt).not.toContain('Output is');
    expect(prompt).not.toContain('Output should be');
  });

  it('keeps file metadata in context with custom instructions', () => {
    const prompt = buildPathSummaryPrompt({
      filePath: '/Users/peter/Docs/report.md',
      filename: 'report.md',
      kindLabel: 'attachment',
      languageInstruction: null,
      lengthInstruction: null,
      mediaType: 'text/markdown',
      outputLanguage: parseOutputLanguage('en'),
      promptOverride: 'Gist in one sentence.',
      summaryLength: 'short',
    });

    expect(prompt).toContain('<context>');
    expect(prompt).toContain('Path: /Users/peter/Docs/report.md');
    expect(prompt).toContain('Filename: report.md');
    expect(prompt).toContain('Media type: text/markdown');
  });

  it('keeps required slide marker instructions with custom link prompts', () => {
    const prompt = buildLinkSummaryPrompt({
      content: 'Transcript:\nhello',
      description: null,
      hasTranscript: true,
      hasTranscriptTimestamps: true,
      languageInstruction: null,
      lengthInstruction: null,
      outputLanguage: parseOutputLanguage('en'),
      promptOverride: 'Answer only what they say about Peter.',
      shares: [],
      siteName: 'YouTube',
      slides: { count: 2, text: '[slide:1] [0:00-0:10]\nhello' },
      summaryLength: 'short',
      title: 'Video',
      truncated: false,
      url: 'https://example.com/video',
    });

    expect(prompt).toContain('Answer only what they say about Peter.');
    expect(prompt).toContain(
      'Required markers (use each exactly once, in order): [slide:1] [slide:2]',
    );
    expect(prompt).toContain('Every slide must include a headline line that starts with "## ".');
    expect(prompt).toContain(
      'Final check for slides: every [slide:N] must be immediately followed by a line that starts with "## ".',
    );
    expect(prompt).not.toContain('You gist online videos');
  });
});
