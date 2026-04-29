export interface ExtractRequest { type: 'extract'; maxChars: number }
export interface SeekRequest { type: 'seek'; seconds: number }

export type ExtractResponse =
  | {
      ok: true;
      url: string;
      title: string | null;
      text: string;
      truncated: boolean;
      mediaDurationSeconds?: number | null;
      media?: { hasVideo: boolean; hasAudio: boolean; hasCaptions: boolean };
    }
  | { ok: false; error: string };

export type SeekResponse = { ok: true } | { ok: false; error: string };

function contentAccessError(message: string) {
  return (
    message.toLowerCase().includes('cannot access') || message.toLowerCase().includes('denied')
  );
}

function formatInjectionError(message: string) {
  return contentAccessError(message)
    ? `Chrome blocked content access (${message}). Check extension “Site access” → “On all sites” (or allow this domain), then reload the tab.`
    : `Failed to inject content script (${message}). Check extension “Site access”, then reload the tab.`;
}

async function injectExtractScript(
  tabId: number,
  opts?: { log?: (event: string, detail?: Record<string, unknown>) => void },
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await chrome.scripting.executeScript({
      files: ['content-scripts/extract.js'],
      target: { tabId },
    });
    opts?.log?.('extract:inject:ok');
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    opts?.log?.('extract:inject:error', { error: message });
    return { error: formatInjectionError(message), ok: false };
  }
}

export function canSummarizeUrl(url: string | undefined): url is string {
  if (!url) {return false;}
  if (url.startsWith('chrome://')) {return false;}
  if (url.startsWith('chrome-extension://')) {return false;}
  if (url.startsWith('moz-extension://')) {return false;}
  if (url.startsWith('edge://')) {return false;}
  if (url.startsWith('about:')) {return false;}
  return true;
}

export async function extractFromTab(
  tabId: number,
  maxChars: number,
  opts?: { timeoutMs?: number; log?: (event: string, detail?: Record<string, unknown>) => void },
): Promise<{ ok: true; data: ExtractResponse & { ok: true } } | { ok: false; error: string }> {
  const req = { maxChars, type: 'extract' } satisfies ExtractRequest;
  const timeoutMs = opts?.timeoutMs ?? 6000;

  const sendMessageWithTimeout = async (): Promise<ExtractResponse> => {
    const start = Date.now();
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      const res = (await Promise.race([
        chrome.tabs.sendMessage(tabId, req) as Promise<ExtractResponse>,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error(`extract timed out after ${timeoutMs}ms`)),
            timeoutMs,
          );
        }),
      ])) as ExtractResponse;
      if (timer) {clearTimeout(timer);}
      opts?.log?.('extract:message:ok', { elapsedMs: Date.now() - start });
      return res;
    } catch (error) {
      if (timer) clearTimeout(timer);
      opts?.log?.('extract:message:error', {
        elapsedMs: Date.now() - start,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      opts?.log?.('extract:attempt', { attempt: attempt + 1, timeoutMs });
      const res = await sendMessageWithTimeout();
      if (!res.ok) {return { ok: false, error: res.error };}
      return { data: res, ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const noReceiver =
        message.includes('Receiving end does not exist') ||
        message.includes('Could not establish connection');
      const didTimeout = message.includes('extract timed out');
      if (noReceiver || didTimeout) {
        const injected = await injectExtractScript(tabId, opts);
        if (!injected.ok) {return injected;}
        if (didTimeout && attempt === 2) {
          return {
            error:
              'Page extraction timed out. Reload the tab (or “Summarize → Refresh”), then retry.',
            ok: false,
          };
        }
        await new Promise((resolve) => setTimeout(resolve, 120));
        continue;
      }

      if (attempt === 2) {
        return {
          error: noReceiver
            ? 'Content script not ready. Check extension “Site access” → “On all sites”, then reload the tab.'
            : message,
          ok: false,
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }

  return { error: 'Content script not ready', ok: false };
}

export async function seekInTab(
  tabId: number,
  seconds: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const req = { seconds, type: 'seek' } satisfies SeekRequest;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = (await chrome.tabs.sendMessage(tabId, req)) as SeekResponse;
      if (!res.ok) {return { ok: false, error: res.error };}
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const noReceiver =
        message.includes('Receiving end does not exist') ||
        message.includes('Could not establish connection');
      if (noReceiver) {
        const injected = await injectExtractScript(tabId);
        if (!injected.ok) {return injected;}
        await new Promise((resolve) => setTimeout(resolve, 120));
        continue;
      }

      if (attempt === 2) {
        return {
          error: noReceiver
            ? 'Content script not ready. Check extension “Site access” → “On all sites”, then reload the tab.'
            : message,
          ok: false,
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }

  return { error: 'Content script not ready', ok: false };
}
