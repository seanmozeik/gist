import { logExtensionEvent } from '../../lib/extension-logs';
import { parseSseEvent } from '../../lib/runtime-contracts';
import { loadSettings } from '../../lib/settings';
import { parseSseStream } from '../../lib/sse';
import { friendlyFetchError } from './daemon-client';

export type HoverToBg =
  | {
      type: 'hover:summarize';
      requestId: string;
      url: string;
      title: string | null;
      token?: string;
    }
  | { type: 'hover:abort'; requestId: string };

type BgToHover =
  | { type: 'hover:chunk'; requestId: string; url: string; text: string }
  | { type: 'hover:done'; requestId: string; url: string }
  | { type: 'hover:error'; requestId: string; url: string; message: string };

function safeSendResponse(sendResponse: (response?: unknown) => void, value: unknown) {
  try {
    sendResponse(value);
  } catch {
    // Ignore
  }
}

async function sendHover(tabId: number, msg: BgToHover) {
  try {
    await chrome.tabs.sendMessage(tabId, msg);
  } catch {
    // Ignore
  }
}

async function resolveHoverTabId(sender: chrome.runtime.MessageSender): Promise<number | null> {
  if (sender.tab?.id) {return sender.tab.id;}
  const senderUrl = typeof sender.url === 'string' ? sender.url : null;
  const tabs = await chrome.tabs.query({});
  if (senderUrl) {
    const match = tabs.find((tab) => tab.url === senderUrl);
    if (match?.id) {return match.id;}
  }
  const active = tabs.find((tab) => tab.active);
  return active?.id ?? null;
}

export function createHoverController({
  hoverControllersByTabId,
  buildDaemonRequestBody,
  resolveLogLevel,
}: {
  hoverControllersByTabId: Map<number, { requestId: string; controller: AbortController }>;
  buildDaemonRequestBody: typeof import('../../lib/daemon-payload').buildDaemonRequestBody;
  resolveLogLevel: (event: string) => 'verbose' | 'warn' | 'error';
}) {
  const abortHoverForTab = (tabId: number, requestId?: string) => {
    const existing = hoverControllersByTabId.get(tabId);
    if (!existing) {return;}
    if (requestId && existing.requestId !== requestId) {return;}
    existing.controller.abort();
    hoverControllersByTabId.delete(tabId);
  };

  const runHoverSummarize = async (
    tabId: number,
    msg: HoverToBg & { type: 'hover:summarize' },
    opts?: { onStart?: (result: { ok: boolean; error?: string }) => void },
  ) => {
    abortHoverForTab(tabId);
    let didNotifyStart = false;
    const notifyStart = (result: { ok: boolean; error?: string }) => {
      if (didNotifyStart) {return;}
      didNotifyStart = true;
      opts?.onStart?.(result);
    };

    const controller = new AbortController();
    hoverControllersByTabId.set(tabId, { controller, requestId: msg.requestId });

    const isStillActive = () => {
      const current = hoverControllersByTabId.get(tabId);
      return Boolean(current && current.requestId === msg.requestId && !controller.signal.aborted);
    };

    const settings = await loadSettings();
    const logHover = (event: string, detail?: Record<string, unknown>) => {
      if (!settings.extendedLogging) {return;}
      const payload = detail ? { event, ...detail } : { event };
      logExtensionEvent({
        detail: detail ?? {},
        event,
        level: resolveLogLevel(event),
        scope: 'hover:bg',
      });
      console.debug('[summarize][hover:bg]', payload);
    };
    const token = msg.token?.trim() || settings.token.trim();
    if (!token) {
      notifyStart({ error: 'Setup required (missing token)', ok: false });
      await sendHover(tabId, {
        message: 'Setup required (missing token)',
        requestId: msg.requestId,
        type: 'hover:error',
        url: msg.url,
      });
      return;
    }

    try {
      logHover('start', { requestId: msg.requestId, tabId, url: msg.url });
      const base = buildDaemonRequestBody({
        extracted: { text: '', title: msg.title, truncated: false, url: msg.url },
        settings,
      });
      const body = {
        ...base,
        length: 'short',
        mode: 'url',
        prompt: settings.hoverPrompt,
        timeout: '30s',
      };

      const res = await fetch('http://127.0.0.1:8787/v1/summarize', {
        body: JSON.stringify(body),
        headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        method: 'POST',
        signal: controller.signal,
      });

      const json = (await res.json()) as { ok?: boolean; id?: string; error?: string };
      if (!res.ok || !json?.ok || !json.id) {
        throw new Error(json?.error || `${res.status} ${res.statusText}`);
      }

      if (!isStillActive()) {return;}
      notifyStart({ ok: true });
      logHover('stream-start', { requestId: msg.requestId, runId: json.id, tabId, url: msg.url });

      const streamRes = await fetch(`http://127.0.0.1:8787/v1/summarize/${json.id}/events`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      if (!streamRes.ok) {throw new Error(`${streamRes.status} ${streamRes.statusText}`);}
      if (!streamRes.body) {throw new Error('Missing stream body');}

      for await (const raw of parseSseStream(streamRes.body)) {
        if (!isStillActive()) {return;}
        const event = parseSseEvent(raw);
        if (!event) {continue;}
        if (event.event === 'chunk') {
          if (!event.data.text) {continue;}
          await sendHover(tabId, {
            requestId: msg.requestId,
            text: event.data.text,
            type: 'hover:chunk',
            url: msg.url,
          });
        } else if (event.event === 'error') {
          throw new Error(event.data.message);
        } else if (event.event === 'done') {
          break;
        }
      }

      if (!isStillActive()) {return;}
      logHover('done', { requestId: msg.requestId, tabId, url: msg.url });
      await sendHover(tabId, { requestId: msg.requestId, type: 'hover:done', url: msg.url });
    } catch (error) {
      if (!isStillActive()) return;
      notifyStart({ ok: false, error: friendlyFetchError(error, 'Hover summarize failed') });
      logHover('error', {
        tabId,
        requestId: msg.requestId,
        url: msg.url,
        message: error instanceof Error ? error.message : String(error),
      });
      await sendHover(tabId, {
        type: 'hover:error',
        requestId: msg.requestId,
        url: msg.url,
        message: friendlyFetchError(error, 'Hover summarize failed'),
      });
    } finally {
      notifyStart({ error: 'Hover summarize aborted', ok: false });
      abortHoverForTab(tabId, msg.requestId);
    }
  };

  const handleRuntimeMessage = (
    raw: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): boolean | undefined => {
    if (!raw || typeof raw !== 'object' || typeof (raw as { type?: unknown }).type !== 'string') {
      return;
    }

    const message = raw as HoverToBg;

    if (message.type === 'hover:summarize') {
      void (async () => {
        const tabId = await resolveHoverTabId(sender);
        if (!tabId) {
          safeSendResponse(sendResponse, { error: 'Missing sender tab', ok: false });
          return;
        }

        const startResult = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
          void runHoverSummarize(tabId, message, { onStart: resolve });
        });
        safeSendResponse(sendResponse, startResult);
      })();
      return true;
    }

    if (message.type === 'hover:abort') {
      const tabId = sender.tab?.id;
      if (!tabId) {return;}
      abortHoverForTab(tabId, message.requestId);
      return;
    }
  };

  return { abortHoverForTab, handleRuntimeMessage };
}
