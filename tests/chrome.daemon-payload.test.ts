import { describe, expect, it } from 'vitest';

import {
  buildDaemonRequestBody,
  buildGistRequestBody,
} from '../apps/chrome-extension/src/lib/daemon-payload.js';
import { defaultSettings } from '../apps/chrome-extension/src/lib/settings.js';

describe('chrome/daemon-payload', () => {
  it('builds a stable daemon request body', () => {
    const body = buildDaemonRequestBody({
      extracted: {
        text: 'Content',
        title: 'Hello',
        truncated: false,
        url: 'https://example.com/article',
      },
      settings: { ...defaultSettings, language: 'auto', length: 'xl', model: 'auto', token: 't' },
    });

    expect(body).toEqual({
      autoCliFallback: true,
      autoCliOrder: 'claude,gemini,codex,agent,openclaw,opencode',
      language: 'auto',
      length: 'xl',
      maxCharacters: defaultSettings.maxChars,
      model: 'auto',
      text: 'Content',
      title: 'Hello',
      truncated: false,
      url: 'https://example.com/article',
    });
  });

  it('includes advanced overrides when set', () => {
    const body = buildDaemonRequestBody({
      extracted: {
        text: 'Content',
        title: 'Hello',
        truncated: false,
        url: 'https://example.com/article',
      },
      settings: {
        ...defaultSettings,
        firecrawlMode: 'auto',
        markdownMode: 'llm',
        maxOutputTokens: '2k',
        preprocessMode: 'always',
        requestMode: 'url',
        retries: 2,
        timeout: '90s',
        token: 't',
        youtubeMode: 'no-auto',
      },
    });

    expect(body).toEqual({
      autoCliFallback: true,
      autoCliOrder: 'claude,gemini,codex,agent,openclaw,opencode',
      firecrawl: 'auto',
      language: 'auto',
      length: 'xl',
      markdownMode: 'llm',
      maxCharacters: defaultSettings.maxChars,
      maxOutputTokens: '2k',
      mode: 'url',
      model: 'auto',
      preprocess: 'always',
      retries: 2,
      text: 'Content',
      timeout: '90s',
      title: 'Hello',
      truncated: false,
      url: 'https://example.com/article',
      youtube: 'no-auto',
    });
  });

  it('forces transcript video mode when inputMode=video', () => {
    const body = buildGistRequestBody({
      extracted: { text: '', title: 'Video', truncated: false, url: 'https://example.com/video' },
      inputMode: 'video',
      settings: defaultSettings,
    });

    expect(body.mode).toBe('url');
    expect(body.videoMode).toBe('transcript');
  });

  it('forces page mode when inputMode=page', () => {
    const body = buildGistRequestBody({
      extracted: {
        text: 'Hello',
        title: 'Article',
        truncated: false,
        url: 'https://example.com/article',
      },
      inputMode: 'page',
      settings: defaultSettings,
    });

    expect(body.mode).toBe('page');
    expect(body.videoMode).toBeUndefined();
  });

  it('adds timestamps when requested', () => {
    const body = buildGistRequestBody({
      extracted: { text: '', title: 'Video', truncated: false, url: 'https://example.com/video' },
      settings: defaultSettings,
      timestamps: true,
    });

    expect(body.timestamps).toBe(true);
  });

  it('includes auto CLI fallback settings', () => {
    const body = buildDaemonRequestBody({
      extracted: {
        text: 'Content',
        title: 'Hello',
        truncated: false,
        url: 'https://example.com/article',
      },
      settings: { ...defaultSettings, autoCliFallback: false, autoCliOrder: 'gemini,claude' },
    });

    expect(body.autoCliFallback).toBe(false);
    expect(body.autoCliOrder).toBe('gemini,claude');
  });

  it('requests slides when enabled', () => {
    const body = buildGistRequestBody({
      extracted: {
        text: '',
        title: 'Video',
        truncated: false,
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      },
      settings: defaultSettings,
      slides: { enabled: true, ocr: true },
    });

    expect(body.slides).toBe(true);
    expect(body.slidesOcr).toBe(true);
    expect(body.mode).not.toBe('page');
  });
});
