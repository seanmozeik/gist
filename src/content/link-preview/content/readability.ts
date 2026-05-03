import { extractReadableContent } from '@seanmozeik/magic-fetch';

import { stripHiddenHtml } from './visibility';

export interface ReadabilityResult {
  text: string;
  /** Inner HTML from Readability when available (magic-fetch path leaves this null). */
  html: string | null;
  title: string | null;
  excerpt: string | null;
  /** Markdown from Readability article HTML via magic-fetch (when extraction succeeds). */
  magicMarkdown?: string;
}

export async function extractReadabilityFromHtml(
  html: string,
  url?: string,
): Promise<ReadabilityResult | null> {
  try {
    const cleanedHtml = stripCssFromHtml(stripHiddenHtml(html));
    const extracted = extractReadableContent(cleanedHtml, url ?? 'about:blank');
    if (!extracted) {
      return null;
    }

    const text = extracted.markdown.replaceAll(/\s+/g, ' ').trim();
    return {
      excerpt: null,
      html: null,
      magicMarkdown: extracted.markdown,
      text,
      title: extracted.title ?? null,
    };
  } catch {
    return null;
  }
}

export function toReadabilityHtml(result: ReadabilityResult | null): string | null {
  if (!result) {
    return null;
  }
  if (result.html) {
    return result.html;
  }
  if (!result.text) {
    return null;
  }
  return `<article><p>${escapeHtml(result.text)}</p></article>`;
}

function escapeHtml(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function stripCssFromHtml(html: string): string {
  return html.replaceAll(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
}
