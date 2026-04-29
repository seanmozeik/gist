import { stripHiddenHtml } from './visibility.js';

export interface ReadabilityResult {
  text: string;
  html: string | null;
  title: string | null;
  excerpt: string | null;
}

export async function extractReadabilityFromHtml(
  html: string,
  url?: string,
): Promise<ReadabilityResult | null> {
  try {
    const cleanedHtml = stripCssFromHtml(stripHiddenHtml(html));
    const { Readability } = await import('@mozilla/readability');
    const { JSDOM, VirtualConsole } = await import('jsdom');
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', (err) => {
      const message =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message?: unknown }).message ?? '')
          : '';
      if (message.includes('Could not parse CSS stylesheet')) {
        return;
      }
    });

    const dom = new JSDOM(cleanedHtml, { ...(url ? { url } : undefined), virtualConsole });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    if (!article) {
      return null;
    }

    const text = (article.textContent ?? '').replaceAll(/\s+/g, ' ').trim();
    return {
      excerpt: article.excerpt ?? null,
      html: article.content ?? null,
      text,
      title: article.title ?? null,
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
  // Readability doesn't need CSS; jsdom's CSS parsing can be extremely slow on some pages.
  return html.replaceAll(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
}
