import type { AssistantMessage, Message } from '@mariozechner/pi-ai';

import { readAgentResponse } from '../../lib/agent-response';
import { buildChatPageContent } from '../../lib/chat-context';
import type { Settings } from '../../lib/settings';
import type { CachedExtract } from './extract-cache';

interface BackgroundChatSession { agentController: AbortController | null }

type SendFn = (
  msg:
    | { type: 'run:error'; message: string }
    | { type: 'agent:chunk'; requestId: string; text: string }
    | {
        type: 'agent:response';
        requestId: string;
        ok: boolean;
        assistant?: AssistantMessage;
        error?: string;
      }
    | {
        type: 'chat:history';
        requestId: string;
        ok: boolean;
        messages?: Message[];
        error?: string;
      },
) => void;

function buildChatRequestContext({
  cachedExtract,
  settings,
  summaryText,
  slidesText,
}: {
  cachedExtract: CachedExtract;
  settings: Settings;
  summaryText: string;
  slidesText?: { count: number; text: string } | null;
}) {
  return {
    cacheContent: cachedExtract.transcriptTimedText ?? cachedExtract.text,
    pageContent: buildChatPageContent({
      transcript: cachedExtract.transcriptTimedText ?? cachedExtract.text,
      summary: summaryText,
      summaryCap: settings.maxChars,
      ...(slidesText ? { slides: slidesText } : {}),
      metadata: {
        url: cachedExtract.url,
        title: cachedExtract.title,
        source: cachedExtract.source,
        extractionStrategy:
          cachedExtract.source === 'page'
            ? 'readability (content script)'
            : (cachedExtract.diagnostics?.strategy ?? null),
        markdownProvider: cachedExtract.diagnostics?.markdown?.used
          ? (cachedExtract.diagnostics?.markdown?.provider ?? 'unknown')
          : null,
        firecrawlUsed: cachedExtract.diagnostics?.firecrawl?.used ?? null,
        transcriptSource: cachedExtract.transcriptSource,
        transcriptionProvider: cachedExtract.transcriptionProvider,
        transcriptCache: cachedExtract.diagnostics?.transcript?.cacheStatus ?? null,
        attemptedTranscriptProviders:
          cachedExtract.diagnostics?.transcript?.attemptedProviders ?? null,
        mediaDurationSeconds: cachedExtract.mediaDurationSeconds,
        totalCharacters: cachedExtract.totalCharacters,
        wordCount: cachedExtract.wordCount,
        transcriptCharacters: cachedExtract.transcriptCharacters,
        transcriptWordCount: cachedExtract.transcriptWordCount,
        transcriptLines: cachedExtract.transcriptLines,
        transcriptHasTimestamps: Boolean(cachedExtract.transcriptTimedText),
        truncated: cachedExtract.truncated,
      },
    }),
  };
}

export async function handlePanelAgentRequest({
  session,
  requestId,
  messages,
  tools,
  summary,
  settings,
  cachedExtract,
  slidesText,
  send,
  sendStatus,
  fetchImpl,
  friendlyFetchError,
}: {
  session: BackgroundChatSession;
  requestId: string;
  messages: Message[];
  tools: string[];
  summary?: string | null;
  settings: Settings;
  cachedExtract: CachedExtract;
  slidesText?: { count: number; text: string } | null;
  send: SendFn;
  sendStatus: (status: string) => void;
  fetchImpl: typeof fetch;
  friendlyFetchError: (error: unknown, fallback: string) => string;
}) {
  session.agentController?.abort();
  const agentController = new AbortController();
  session.agentController = agentController;
  const isStillActive = () =>
    session.agentController === agentController && !agentController.signal.aborted;

  const summaryText = typeof summary === 'string' ? summary.trim() : '';
  const { pageContent, cacheContent } = buildChatRequestContext({
    cachedExtract,
    settings,
    slidesText,
    summaryText,
  });

  sendStatus('Sending to AI…');

  try {
    const res = await fetchImpl('http://127.0.0.1:8787/v1/agent', {
      body: JSON.stringify({
        url: cachedExtract.url,
        title: cachedExtract.title,
        pageContent,
        cacheContent,
        messages,
        model: settings.model,
        length: settings.length,
        language: settings.language,
        tools,
        automationEnabled: settings.automationEnabled,
      }),
      headers: {
        Accept: 'text/event-stream',
        Authorization: `Bearer ${settings.token.trim()}`,
        'content-type': 'application/json',
      },
      method: 'POST',
      signal: agentController.signal,
    });
    if (!res.ok) {
      const rawText = await res.text().catch(() => '');
      const isMissingAgent = res.status === 404 || rawText.trim().toLowerCase() === 'not found';
      const error = isMissingAgent
        ? 'Daemon does not support /v1/agent. Restart the daemon after updating (summarize daemon restart).'
        : rawText.trim() || `${res.status} ${res.statusText}`;
      throw new Error(error);
    }

    let sawAssistant = false;
    for await (const event of readAgentResponse(res)) {
      if (!isStillActive()) {return;}
      if (event.type === 'chunk') {
        send({ requestId, text: event.text, type: 'agent:chunk' });
      } else if (event.type === 'assistant') {
        sawAssistant = true;
        send({ assistant: event.assistant, ok: true, requestId, type: 'agent:response' });
      }
    }

    if (!sawAssistant) {
      throw new Error('Agent stream ended without a response.');
    }

    sendStatus('');
  } catch (error) {
    if (agentController.signal.aborted) return;
    const message = friendlyFetchError(error, 'Chat request failed');
    send({ error: message, ok: false, requestId, type: 'agent:response' });
    sendStatus(`Error: ${message}`);
  } finally {
    if (session.agentController === agentController) {
      session.agentController = null;
    }
  }
}

export async function handlePanelChatHistoryRequest({
  requestId,
  summary,
  settings,
  cachedExtract,
  send,
  fetchImpl,
  friendlyFetchError,
}: {
  requestId: string;
  summary?: string | null;
  settings: Settings;
  cachedExtract: CachedExtract;
  send: SendFn;
  fetchImpl: typeof fetch;
  friendlyFetchError: (error: unknown, fallback: string) => string;
}) {
  const summaryText = typeof summary === 'string' ? summary.trim() : '';
  const { pageContent, cacheContent } = buildChatRequestContext({
    cachedExtract,
    settings,
    summaryText,
  });

  try {
    const res = await fetchImpl('http://127.0.0.1:8787/v1/agent/history', {
      body: JSON.stringify({
        url: cachedExtract.url,
        title: cachedExtract.title,
        pageContent,
        cacheContent,
        model: settings.model,
        length: settings.length,
        language: settings.language,
        automationEnabled: settings.automationEnabled,
      }),
      headers: {
        Authorization: `Bearer ${settings.token.trim()}`,
        'content-type': 'application/json',
      },
      method: 'POST',
    });
    const rawText = await res.text();
    let json: { ok?: boolean; messages?: Message[]; error?: string } | null = null;
    if (rawText) {
      try {
        json = JSON.parse(rawText) as typeof json;
      } catch {
        json = null;
      }
    }
    if (!res.ok || !json?.ok) {
      const error = json?.error ?? (rawText.trim() || `${res.status} ${res.statusText}`);
      throw new Error(error);
    }
    send({
      messages: Array.isArray(json?.messages) ? json.messages : undefined,
      ok: true,
      requestId,
      type: 'chat:history',
    });
  } catch (error) {
    const message = friendlyFetchError(error, 'Chat history request failed');
    send({ error: message, ok: false, requestId, type: 'chat:history' });
  }
}
