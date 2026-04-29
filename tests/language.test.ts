import { describe, expect, it } from 'vitest';

import {
  formatOutputLanguageForJson,
  formatOutputLanguageInstruction,
  parseOutputLanguage,
  resolveOutputLanguage,
} from '../src/language.js';

describe('output language', () => {
  it('parses auto', () => {
    expect(parseOutputLanguage('auto')).toEqual({ kind: 'auto' });
  });

  it('parses common aliases', () => {
    expect(parseOutputLanguage('en')).toEqual({ kind: 'fixed', label: 'English', tag: 'en' });
    expect(parseOutputLanguage('English')).toEqual({ kind: 'fixed', label: 'English', tag: 'en' });
    expect(parseOutputLanguage('de')).toEqual({ kind: 'fixed', label: 'German', tag: 'de' });
    expect(parseOutputLanguage('Deutsch')).toEqual({ kind: 'fixed', label: 'German', tag: 'de' });
    expect(parseOutputLanguage('pt-BR')).toEqual({
      kind: 'fixed',
      label: 'Portuguese (Brazil)',
      tag: 'pt-BR',
    });
  });

  it('normalizes BCP-47-ish tags', () => {
    expect(parseOutputLanguage('EN-us')).toEqual({ kind: 'fixed', label: 'English', tag: 'en-US' });
    expect(parseOutputLanguage('pt_br')).toEqual({
      kind: 'fixed',
      label: 'Portuguese (Brazil)',
      tag: 'pt-BR',
    });
    expect(parseOutputLanguage('sr-latn_rs')).toEqual({
      kind: 'fixed',
      label: 'sr-Latn-RS',
      tag: 'sr-Latn-RS',
    });
  });

  it('keeps natural language hints', () => {
    expect(parseOutputLanguage('German, formal')).toEqual({
      kind: 'fixed',
      label: 'German, formal',
      tag: 'German, formal',
    });
  });

  it('sanitizes free-form hints (collapse + truncate)', () => {
    expect(parseOutputLanguage('German     (formal)')).toEqual({
      kind: 'fixed',
      label: 'German (formal)',
      tag: 'German (formal)',
    });

    const long = 'german very formal polite writing style with extra constraints please';
    const parsed = parseOutputLanguage(long);
    expect(parsed.kind).toBe('fixed');
    if (parsed.kind === 'fixed') {
      expect(parsed.tag.length).toBeLessThanOrEqual(64);
      expect(parsed.label.length).toBeLessThanOrEqual(64);
    }
  });

  it('formats prompt instruction', () => {
    expect(formatOutputLanguageInstruction({ kind: 'auto' })).toMatch(/dominant source language/i);
    expect(formatOutputLanguageInstruction({ kind: 'fixed', label: 'English', tag: 'en' })).toBe(
      'Write the answer in English.',
    );
  });

  it('formats JSON output language', () => {
    expect(formatOutputLanguageForJson({ kind: 'auto' })).toEqual({ mode: 'auto' });
    expect(formatOutputLanguageForJson({ kind: 'fixed', label: 'English', tag: 'en' })).toEqual({
      label: 'English',
      mode: 'fixed',
      tag: 'en',
    });
  });

  it('resolves missing/empty to auto', () => {
    expect(resolveOutputLanguage(null)).toEqual({ kind: 'auto' });
    expect(resolveOutputLanguage()).toEqual({ kind: 'auto' });
    expect(resolveOutputLanguage('   ')).toEqual({ kind: 'auto' });
  });

  it('rejects empty', () => {
    expect(() => parseOutputLanguage('  ')).toThrow(/must not be empty/i);
  });
});
