import { magicFetch, type MagicFetchTransport } from '@seanmozeik/magic-fetch';

import { withBunCompressionHeaders } from '../../bun.js';
import type { LinkPreviewProgressEvent } from '../deps';

/** Extra headers merged into magic-fetch defaults (negotiated `Accept` comes from the profile). */
const REQUEST_HEADERS_SUPPLEMENTAL: Record<string, string> = {
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache',
};

const DEFAULT_REQUEST_TIMEOUT_MS = 5000;

export interface HtmlDocumentFetchResult {
  html: string;
  finalUrl: string;
}

async function fetchHtmlOnce(
  url: string,
  options: {
    acceptProfile: 'markdown-first' | 'html-first';
    fetchImplementation?: typeof fetch;
    headers: Record<string, string>;
    onProgress?: ((event: LinkPreviewProgressEvent) => void) | null;
    timeoutMs?: number;
  },
): Promise<HtmlDocumentFetchResult> {
  const { acceptProfile, fetchImplementation, headers, onProgress, timeoutMs } = options;
  onProgress?.({ kind: 'fetch-html-start', url });

  const controller = new AbortController();
  const effectiveTimeoutMs =
    typeof timeoutMs === 'number' && Number.isFinite(timeoutMs)
      ? timeoutMs
      : DEFAULT_REQUEST_TIMEOUT_MS;
  const timeout = setTimeout(() => {
    controller.abort();
  }, effectiveTimeoutMs);

  try {
    const response = await magicFetch(url, {
      acceptProfile,
      ...(fetchImplementation !== undefined
        ? { fetchImplementation: fetchImplementation as unknown as MagicFetchTransport }
        : {}),
      headerMerge: 'defaults-win-accept',
      headers,
      redirect: 'follow',
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch HTML document (status ${response.status})`);
    }

    const finalUrl = response.url?.trim() || url;

    const contentType = response.headers.get('content-type')?.toLowerCase() ?? null;
    if (
      contentType &&
      !contentType.includes('text/html') &&
      !contentType.includes('application/xhtml+xml') &&
      !contentType.includes('application/xml') &&
      !contentType.includes('text/xml') &&
      !contentType.includes('application/rss+xml') &&
      !contentType.includes('application/atom+xml') &&
      !contentType.startsWith('text/')
    ) {
      throw new Error(`Unsupported content-type for HTML document fetch: ${contentType}`);
    }

    const totalBytes = (() => {
      const raw = response.headers.get('content-length');
      if (!raw) {
        return null;
      }
      const parsed = Number(raw);
      return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
    })();

    const { body } = response;
    if (!body) {
      const text = await response.text();
      const bytes = new TextEncoder().encode(text).byteLength;
      onProgress?.({ downloadedBytes: bytes, kind: 'fetch-html-done', totalBytes, url });
      return { finalUrl, html: text };
    }

    const reader = body.getReader();
    const decoder = new TextDecoder();
    let downloadedBytes = 0;
    let text = '';

    onProgress?.({ downloadedBytes: 0, kind: 'fetch-html-progress', totalBytes, url });

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      if (!value) {
        continue;
      }
      downloadedBytes += value.byteLength;
      text += decoder.decode(value, { stream: true });
      onProgress?.({ downloadedBytes, kind: 'fetch-html-progress', totalBytes, url });
    }

    text += decoder.decode();
    onProgress?.({ downloadedBytes, kind: 'fetch-html-done', totalBytes, url });
    return { finalUrl, html: text };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Fetching HTML document timed out', { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchHtmlDocument(
  url: string,
  options: {
    fetchImplementation?: typeof fetch;
    markdownExtractFetch?: boolean;
    timeoutMs?: number;
    onProgress?: ((event: LinkPreviewProgressEvent) => void) | null;
  } = {},
): Promise<HtmlDocumentFetchResult> {
  const markdownExtractFetch = options.markdownExtractFetch === true;
  const headers = withBunCompressionHeaders(REQUEST_HEADERS_SUPPLEMENTAL);

  return fetchHtmlOnce(url, {
    acceptProfile: markdownExtractFetch ? 'markdown-first' : 'html-first',
    fetchImplementation: options.fetchImplementation,
    headers,
    onProgress: options.onProgress ?? null,
    timeoutMs: options.timeoutMs,
  });
}
