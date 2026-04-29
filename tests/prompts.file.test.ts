import { describe, expect, it } from 'vitest';

import {
  buildFileSummaryPrompt,
  buildFileTextSummaryPrompt,
} from '../packages/core/src/prompts/index.js';
import { parseOutputLanguage } from '../src/language.js';

describe('buildFileSummaryPrompt', () => {
  it('builds a prompt for preset length', () => {
    const prompt = buildFileSummaryPrompt({
      filename: 'paper.pdf',
      mediaType: 'application/pdf',
      outputLanguage: parseOutputLanguage('English'),
      summaryLength: 'short',
    });

    expect(prompt).toContain('<instructions>');
    expect(prompt).toContain('<context>');
    expect(prompt).toContain('Filename: paper.pdf');
    expect(prompt).toContain('Media type: application/pdf');
    expect(prompt).toContain('Target length: around 900 characters');
  });

  it('builds a prompt for soft character targets', () => {
    const prompt = buildFileSummaryPrompt({
      contentLength: 120,
      filename: null,
      mediaType: null,
      outputLanguage: parseOutputLanguage('English'),
      summaryLength: { maxCharacters: 20_000 },
    });

    expect(prompt).toContain('Target length:');
    expect(prompt).toContain('Hard limit');
    expect(prompt).toContain('Extracted content length: 120 characters');
    expect(prompt).not.toContain('Filename:');
    expect(prompt).not.toContain('Media type:');
  });

  it('clamps max characters to content length', () => {
    const prompt = buildFileSummaryPrompt({
      contentLength: 120,
      filename: 'report.txt',
      mediaType: 'text/plain',
      outputLanguage: parseOutputLanguage('English'),
      summaryLength: { maxCharacters: 10_000 },
    });

    expect(prompt).toContain('Target length: up to 120 characters total');
    expect(prompt).toContain('Extracted content length: 120 characters');
  });

  it('omits header lines when filename and media type are missing', () => {
    const prompt = buildFileSummaryPrompt({
      contentLength: 0,
      filename: null,
      mediaType: null,
      outputLanguage: parseOutputLanguage('English'),
      summaryLength: 'short',
    });

    expect(prompt).not.toContain('Filename:');
    expect(prompt).not.toContain('Media type:');
    expect(prompt).not.toContain('Extracted content length:');
  });
});

describe('buildFileTextSummaryPrompt', () => {
  it('clamps length to extracted content', () => {
    const prompt = buildFileTextSummaryPrompt({
      content: 'Hello world',
      contentLength: 300,
      contentMediaType: 'text/markdown',
      filename: 'notes.txt',
      originalMediaType: 'text/plain',
      outputLanguage: parseOutputLanguage('English'),
      summaryLength: { maxCharacters: 10_000 },
    });

    expect(prompt).toContain('<content>');
    expect(prompt).toContain('Target length: up to 300 characters total');
    expect(prompt).toContain('Original media type: text/plain');
    expect(prompt).toContain('Provided as: text/markdown');
    expect(prompt).toContain('Extracted content length: 300 characters');
  });

  it('omits original media type when missing', () => {
    const prompt = buildFileTextSummaryPrompt({
      content: 'Hello',
      contentLength: 120,
      contentMediaType: 'text/plain',
      filename: null,
      originalMediaType: null,
      outputLanguage: parseOutputLanguage('English'),
      summaryLength: 'short',
    });

    expect(prompt).not.toContain('Original media type:');
    expect(prompt).toContain('Provided as: text/plain');
  });
});
