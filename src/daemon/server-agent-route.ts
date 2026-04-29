import type http from 'node:http';

import type { Message } from '@mariozechner/pi-ai';

import { runWithProcessContext } from '../processes.js';
import { encodeSseEvent, type SseEvent } from '../shared/sse-events.js';
import { completeAgentResponse, streamAgentResponse } from './agent.js';
import { json, readJsonBody, wantsJsonResponse } from './server-http.js';

export async function handleAgentRoute({
  req,
  res,
  url,
  cors,
  env,
  createRunId,
}: {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  cors: Record<string, string>;
  env: Record<string, string | undefined>;
  createRunId: () => string;
}) {
  if (!(req.method === 'POST' && url.pathname === '/v1/agent')) {
    return false;
  }

  let body: unknown;
  try {
    body = await readJsonBody(req, 4_000_000);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    json(res, 400, { error: message, ok: false }, cors);
    return true;
  }
  if (!body || typeof body !== 'object') {
    json(res, 400, { error: 'invalid json', ok: false }, cors);
    return true;
  }

  const obj = body as Record<string, unknown>;
  const pageUrl = typeof obj.url === 'string' ? obj.url.trim() : '';
  const pageTitle = typeof obj.title === 'string' ? obj.title.trim() : null;
  const pageContent = typeof obj.pageContent === 'string' ? obj.pageContent : '';
  const {messages} = obj;
  const modelOverride = typeof obj.model === 'string' ? obj.model.trim() : null;
  const tools = Array.isArray(obj.tools)
    ? obj.tools.filter((tool): tool is string => typeof tool === 'string')
    : [];
  const automationEnabled = Boolean(obj.automationEnabled);

  if (!pageUrl) {
    json(res, 400, { error: 'missing url', ok: false }, cors);
    return true;
  }

  const normalizedModelOverride =
    modelOverride && modelOverride.toLowerCase() !== 'auto' ? modelOverride : null;
  const runId = `agent-${createRunId()}`;
  const wantsJson = wantsJsonResponse(req, url);
  if (wantsJson) {
    try {
      const assistant = await runWithProcessContext({ runId, source: 'agent' }, async () =>
        completeAgentResponse({
          automationEnabled,
          env,
          messages,
          modelOverride: normalizedModelOverride,
          pageContent,
          pageTitle,
          pageUrl,
          tools,
        }),
      );
      json(res, 200, { assistant, ok: true }, cors);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[summarize-daemon] agent failed', error);
      json(res, 500, { error: message, ok: false }, cors);
    }
    return true;
  }

  res.writeHead(200, {
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'content-type': 'text/event-stream; charset=utf-8',
    'x-accel-buffering': 'no',
    ...cors,
  });

  const controller = new AbortController();
  const abort = () =>{  controller.abort(); };
  req.on('close', abort);
  res.on('close', abort);

  const writeEvent = (event: SseEvent) => {
    if (res.writableEnded) {return;}
    res.write(encodeSseEvent(event));
  };

  try {
    await runWithProcessContext({ runId, source: 'agent' }, async () =>
      streamAgentResponse({
        automationEnabled,
        env,
        messages: messages as Message[],
        modelOverride: normalizedModelOverride,
        onAssistant: (assistant) =>{  writeEvent({ event: 'assistant', data: assistant }); },
        onChunk: (text) =>{  writeEvent({ event: 'chunk', data: { text } }); },
        pageContent,
        pageTitle,
        pageUrl,
        signal: controller.signal,
        tools,
      }),
    );
    writeEvent({ data: {}, event: 'done' });
    res.end();
  } catch (error) {
    if (controller.signal.aborted) {return true;}
    const message = error instanceof Error ? error.message : String(error);
    console.error('[summarize-daemon] agent failed', error);
    writeEvent({ data: { message }, event: 'error' });
    writeEvent({ data: {}, event: 'done' });
    res.end();
  }

  return true;
}
