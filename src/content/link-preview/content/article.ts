import { load } from 'cheerio';
import sanitizeHtml from 'sanitize-html';

import { decodeHtmlEntities, normalizeWhitespace } from './cleaner';
import { stripHiddenHtml } from './visibility';

const MIN_SEGMENT_LENGTH = 30;

export function sanitizeHtmlForMarkdownConversion(html: string): string {
  return sanitizeHtml(stripHiddenHtml(html), {
    allowedAttributes: { a: ['href'] },
    allowedTags: [
      'article',
      'section',
      'div',
      'p',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'ol',
      'ul',
      'li',
      'blockquote',
      'pre',
      'code',
      'span',
      'strong',
      'em',
      'br',
      'a',
    ],
    nonTextTags: [
      'style',
      'script',
      'noscript',
      'template',
      'svg',
      'canvas',
      'iframe',
      'object',
      'embed',
    ],
    textFilter(text: string) {
      return decodeHtmlEntities(text);
    },
  });
}

export function extractArticleContent(html: string): string {
  const segments = collectSegmentsFromHtml(html);
  if (segments.length > 0) {
    return segments.join('\n');
  }
  const fallback = normalizeWhitespace(extractPlainText(html));
  return fallback ?? '';
}

export function collectSegmentsFromHtml(html: string): string[] {
  const sanitized = sanitizeHtml(stripHiddenHtml(html), {
    allowedAttributes: {},
    allowedTags: [
      'article',
      'section',
      'div',
      'p',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'ol',
      'ul',
      'li',
      'blockquote',
      'pre',
      'code',
      'span',
      'strong',
      'em',
      'br',
    ],
    nonTextTags: [
      'style',
      'script',
      'noscript',
      'template',
      'svg',
      'canvas',
      'iframe',
      'object',
      'embed',
    ],
    textFilter(text: string) {
      return decodeHtmlEntities(text);
    },
  });

  const $ = load(sanitized);
  const segments: string[] = [];

  $('h1,h2,h3,h4,h5,h6,li,p,blockquote,pre').each((_, element) => {
    if (!('tagName' in element) || typeof element.tagName !== 'string') {
      return;
    }

    const tag = element.tagName.toLowerCase();

    const raw = $(element).text();
    const text = normalizeWhitespace(raw).replaceAll(/\n+/g, ' ');
    if (!text || text.length === 0) {
      return;
    }

    if (tag.startsWith('h')) {
      if (text.length >= 10) {
        segments.push(text);
      }
      return;
    }

    if (tag === 'li') {
      if (text.length >= 20) {
        segments.push(`• ${text}`);
      }
      return;
    }

    if (text.length < MIN_SEGMENT_LENGTH) {
      return;
    }

    segments.push(text);
  });

  if (segments.length === 0) {
    const fallback = normalizeWhitespace($('body').text() ?? sanitized);
    return fallback ? [fallback] : [];
  }

  return mergeConsecutiveSegments(segments);
}

export function extractPlainText(html: string): string {
  const stripped = sanitizeHtml(stripHiddenHtml(html), {
    allowedAttributes: {},
    allowedTags: [],
    nonTextTags: [
      'style',
      'script',
      'noscript',
      'template',
      'svg',
      'canvas',
      'iframe',
      'object',
      'embed',
    ],
  });
  return decodeHtmlEntities(stripped);
}

function mergeConsecutiveSegments(segments: string[]): string[] {
  // Keep headings as separate segments; merging short segments mostly collapses headings into the
  // Previous paragraph ("... Conclusion"), which reads worse than a standalone heading line.
  return segments.filter(Boolean);
}
