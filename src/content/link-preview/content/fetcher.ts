import {
  isBunCompressedResponseError,
  withBunCompressionHeaders,
  withBunIdentityEncoding,
} from '../../bun.js';
import type { LinkPreviewProgressEvent } from '../deps';

const REQUEST_HEADERS: Record<string, string> = {
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
};

const DEFAULT_REQUEST_TIMEOUT_MS = 5000;

export interface HtmlDocumentFetchResult {
  html: string;
  finalUrl: string;
}

async function fetchHtmlOnce(
  fetchImpl: typeof fetch,
  url: string,
  headers: Record<string, string>,
  {
    timeoutMs,
    onProgress,
  }: { timeoutMs?: number; onProgress?: ((event: LinkPreviewProgressEvent) => void) | null } = {},
): Promise<HtmlDocumentFetchResult> {
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
    const response = await fetchImpl(url, {
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
  fetchImpl: typeof fetch,
  url: string,
  options: {
    timeoutMs?: number;
    onProgress?: ((event: LinkPreviewProgressEvent) => void) | null;
  } = {},
): Promise<HtmlDocumentFetchResult> {
  try {
    return await fetchHtmlOnce(fetchImpl, url, withBunCompressionHeaders(REQUEST_HEADERS), options);
  } catch (error) {
    // Bun's fetch has known bugs where its streaming zlib decompression throws
    // ZlibError / ShortRead on certain chunked+compressed responses. Retry the
    // Request asking the server to skip compression entirely.
    // https://github.com/oven-sh/bun/issues/23149
    if (isBunCompressedResponseError(error)) {
      const uncompressedHeaders = withBunIdentityEncoding(REQUEST_HEADERS);
      return fetchHtmlOnce(fetchImpl, url, uncompressedHeaders, options);
    }
    throw error;
  }
}
