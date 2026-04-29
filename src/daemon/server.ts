import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { Writable } from 'node:stream';

import type { CacheState } from '../cache.js';
import { loadSummarizeConfig } from '../config.js';
import { createDaemonLogger } from '../logging/daemon.js';
import { setProcessObserver } from '../processes.js';
import { refreshFree } from '../refresh-free.js';
import { createCacheStateFromConfig, refreshCacheStoreIfMissing } from '../run/cache-state.js';
import { resolveExecutableInPath } from '../run/env.js';
import { createMediaCacheFromConfig } from '../run/media-cache-state.js';
import type { SseEvent } from '../shared/sse-events.js';
import type { SlideSettings } from '../slides/index.js';
import { resolvePackageVersion } from '../version.js';
import type { DaemonRequestedMode } from './auto-mode.js';
import { daemonConfigTokens, type DaemonConfig } from './config.js';
import { DAEMON_HOST, DAEMON_PORT_DEFAULT } from './constants.js';
import { resolveDaemonLogPaths } from './launchd.js';
import { ProcessRegistry } from './process-registry.js';
import { handleAdminRoutes } from './server-admin-routes.js';
import { handleAgentRoute } from './server-agent-route.js';
import {
  clampNumber,
  corsHeaders,
  json,
  readBearerToken,
  readCorsHeaders,
  text,
} from './server-http.js';
import { handleSessionRoutes } from './server-session-routes.js';
import {
  createSession,
  emitMeta,
  emitSlides,
  emitSlidesDone,
  emitSlidesStatus,
  endSession,
  pushSlidesToSession,
  pushToSession,
  scheduleSessionCleanup,
  type Session,
  type SessionEvent,
} from './server-session.js';
import {
  executeSummarizeSession,
  handleExtractOnlySummarizeRequest,
  toExtractOnlySlidesPayload,
} from './server-summarize-execution.js';
import { parseSummarizeRequest } from './server-summarize-request.js';
import { isWindowsContainerEnvironment } from './windows-container.js';

export { corsHeaders, isTrustedOrigin } from './server-http.js';

export function resolveDaemonListenHost(env: Record<string, string | undefined>): string {
  return process.platform === 'win32' && isWindowsContainerEnvironment(env)
    ? '0.0.0.0'
    : DAEMON_HOST;
}

function createLineWriter(onLine: (line: string) => void) {
  let buffer = '';
  return new Writable({
    final(callback) {
      const line = buffer.trim();
      if (line) onLine(line);
      buffer = '';
      callback();
    },
    write(chunk, _encoding, callback) {
      buffer += chunk.toString();
      let index = buffer.indexOf('\n');
      while (index >= 0) {
        const line = buffer.slice(0, index).trimEnd();
        buffer = buffer.slice(index + 1);
        if (line.trim().length > 0) onLine(line);
        index = buffer.indexOf('\n');
      }
      callback();
    },
  });
}

function resolveToolPath(
  binary: string,
  env: Record<string, string | undefined>,
  explicitEnvKey?: string,
): string | null {
  const explicit =
    explicitEnvKey && typeof env[explicitEnvKey] === 'string' ? env[explicitEnvKey]?.trim() : '';
  if (explicit) {return resolveExecutableInPath(explicit, env);}
  return resolveExecutableInPath(binary, env);
}

export function buildHealthPayload(importMetaUrl?: string) {
  return { ok: true, pid: process.pid, version: resolvePackageVersion(importMetaUrl) };
}

export async function runDaemonServer({
  env,
  fetchImpl,
  config,
  port = config.port ?? DAEMON_PORT_DEFAULT,
  signal,
  onListening,
  onSessionEvent,
}: {
  env: Record<string, string | undefined>;
  fetchImpl: typeof fetch;
  config: DaemonConfig;
  port?: number;
  signal?: AbortSignal;
  onListening?: ((port: number) => void) | null;
  onSessionEvent?: ((event: SessionEvent, sessionId: string) => void) | null;
}): Promise<void> {
  const { config: summarizeConfig } = loadSummarizeConfig({ env });
  const daemonLogger = createDaemonLogger({ config: summarizeConfig, env });
  const daemonLogPaths = resolveDaemonLogPaths(env);
  const daemonLogFile =
    daemonLogger.config?.file ?? path.join(daemonLogPaths.logDir, 'daemon.jsonl');
  const cacheState = await createCacheStateFromConfig({
    config: summarizeConfig,
    envForRun: env,
    noCacheFlag: false,
    transcriptNamespace: 'yt:auto',
  });
  const mediaCache = await createMediaCacheFromConfig({
    config: summarizeConfig,
    envForRun: env,
    noMediaCacheFlag: false,
  });

  const processRegistry = new ProcessRegistry();
  setProcessObserver(processRegistry.createObserver());
  const listenHost = resolveDaemonListenHost(env);

  const sessions = new Map<string, Session>();
  const refreshSessions = new Map<string, Session>();
  let activeRefreshSessionId: string | null = null;

  const server = http.createServer((req, res) => {
    void (async () => {
      const cors = readCorsHeaders(req);

      if (req.method === 'OPTIONS') {
        res.writeHead(204, cors);
        res.end();
        return;
      }

      const url = new URL(req.url ?? '/', `http://${DAEMON_HOST}:${port}`);
      const {pathname} = url;

      if (req.method === 'GET' && pathname === '/health') {
        json(res, 200, buildHealthPayload(import.meta.url), cors);
        return;
      }

      const token = readBearerToken(req);
      const authed = token ? daemonConfigTokens(config).includes(token) : false;
      if (pathname.startsWith('/v1/') && !authed) {
        json(res, 401, { error: 'unauthorized', ok: false }, cors);
        return;
      }

      if (
        await handleAdminRoutes({
          cors,
          daemonLogFile,
          daemonLogPaths,
          daemonLogger,
          env,
          fetchImpl,
          pathname,
          processRegistry,
          req,
          res,
          resolveToolPath,
          summarizeConfig,
          url,
        })
      ) {
        return;
      }

      if (req.method === 'POST' && pathname === '/v1/refresh-free') {
        if (activeRefreshSessionId) {
          json(res, 200, { id: activeRefreshSessionId, ok: true, running: true }, cors);
          return;
        }

        const session = createSession(() => randomUUID());
        refreshSessions.set(session.id, session);
        activeRefreshSessionId = session.id;
        json(res, 200, { id: session.id, ok: true }, cors);

        void (async () => {
          const pushStatus = (text: string) => {
            pushToSession(session, { data: { text }, event: 'status' }, onSessionEvent);
          };
          try {
            pushStatus('Refresh free: starting…');
            const stdout = createLineWriter(pushStatus);
            const stderr = createLineWriter(pushStatus);
            await refreshFree({ env, fetchImpl, stderr, stdout });
            pushToSession(session, { data: {}, event: 'done' }, onSessionEvent);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            pushToSession(session, { data: { message }, event: 'error' }, onSessionEvent);
            console.error('[summarize-daemon] refresh-free failed', error);
          } finally {
            if (activeRefreshSessionId === session.id) {
              activeRefreshSessionId = null;
            }
            setTimeout(() => {
              refreshSessions.delete(session.id);
              endSession(session);
            }, 60_000).unref();
          }
        })();
        return;
      }

      if (req.method === 'POST' && pathname === '/v1/summarize') {
        await refreshCacheStoreIfMissing({ cacheState, transcriptNamespace: 'yt:auto' });
        const request = await parseSummarizeRequest({ cors, env, req, res, resolveToolPath });
        if (!request) {
          return;
        }
        const {
          pageUrl,
          title,
          textContent,
          truncated,
          modelOverride,
          lengthRaw,
          languageRaw,
          promptOverride,
          noCache,
          extractOnly,
          mode,
          maxCharacters,
          format,
          overrides,
          slidesSettings,
          diagnostics,
          hasText,
        } = request;
        const includeContentLog = daemonLogger.enabled && diagnostics.includeContent;
        if (extractOnly) {
          try {
            const { extracted, slides } = await handleExtractOnlySummarizeRequest({
              cacheState,
              env,
              fetchImpl,
              mediaCache,
              request,
            });
            const slidesPayload = toExtractOnlySlidesPayload(slides);
            json(
              res,
              200,
              {
                extracted: {
                  content: extracted.content,
                  diagnostics: extracted.diagnostics,
                  mediaDurationSeconds: extracted.mediaDurationSeconds ?? null,
                  title: extracted.title,
                  totalCharacters: extracted.totalCharacters,
                  transcriptCharacters: extracted.transcriptCharacters ?? null,
                  transcriptLines: extracted.transcriptLines ?? null,
                  transcriptSegments: extracted.transcriptSegments ?? null,
                  transcriptSource: extracted.transcriptSource ?? null,
                  transcriptTimedText: extracted.transcriptTimedText ?? null,
                  transcriptWordCount: extracted.transcriptWordCount ?? null,
                  transcriptionProvider: extracted.transcriptionProvider ?? null,
                  truncated: extracted.truncated,
                  url: extracted.url,
                  wordCount: extracted.wordCount,
                },
                ok: true,
                ...(slidesPayload ? { slides: slidesPayload } : {}),
              },
              cors,
            );
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            json(res, 500, { error: message, ok: false }, cors);
          }
          return;
        }

        const session = createSession(() => randomUUID());
        session.slidesRequested = Boolean(slidesSettings);
        sessions.set(session.id, session);
        const requestLogger = daemonLogger.getSubLogger('daemon.summarize', {
          requestId: session.id,
        });
        const logStartedAt = Date.now();
        const logSummaryFromCache = false;
        const logInputSummary: string | null = null;
        const logSummaryText = '';
        const logExtracted: Record<string, unknown> | null = null;
        const logInput = includeContentLog
          ? {
              text: hasText ? textContent : null,
              title,
              truncated: hasText ? truncated : null,
              url: pageUrl,
            }
          : null;
        const logSlidesSettings =
          includeContentLog && slidesSettings
            ? {
                autoTuneThreshold: slidesSettings.autoTuneThreshold,
                enabled: slidesSettings.enabled,
                maxSlides: slidesSettings.maxSlides,
                minDurationSeconds: slidesSettings.minDurationSeconds,
                ocr: slidesSettings.ocr,
                outputDir: slidesSettings.outputDir,
                sceneThreshold: slidesSettings.sceneThreshold,
              }
            : null;
        requestLogger?.info({
          event: 'summarize.request',
          hasText,
          includeContent: includeContentLog,
          language: languageRaw,
          length: lengthRaw,
          mode,
          model: modelOverride,
          noCache,
          slides: Boolean(slidesSettings),
          url: pageUrl,
          ...(logSlidesSettings ? { slidesSettings: logSlidesSettings } : {}),
          ...(includeContentLog ? { diagnostics } : {}),
        });

        json(res, 200, { id: session.id, ok: true }, cors);

        void executeSummarizeSession({
          cacheState,
          env,
          fetchImpl,
          includeContentLog,
          logInput,
          logSlidesSettings,
          logStartedAt,
          mediaCache,
          onSessionEvent,
          port,
          refreshSessions,
          request,
          requestLogger,
          session,
          sessions,
        });
        return;
      }

      if (await handleAgentRoute({ cors, createRunId: randomUUID, env, req, res, url })) {
        return;
      }

      if (
        await handleSessionRoutes({
          cors,
          env,
          pathname,
          port,
          refreshSessions,
          req,
          res,
          sessions,
        })
      ) {
        return;
      }

      text(res, 404, 'Not found', cors);
    })().catch((error) => {
      const cors = readCorsHeaders(req);
      const message = error instanceof Error ? error.message : String(error);
      if (!res.headersSent) {
        json(res, 500, { error: message, ok: false }, cors);
        return;
      }
      try {
        res.end();
      } catch {
        // Ignore
      }
    });
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, listenHost, () => {
        const address = server.address();
        const actualPort =
          address && typeof address === 'object' && typeof address.port === 'number'
            ? address.port
            : port;
        onListening?.(actualPort);
        resolve();
      });
    });

    await new Promise<void>((resolve) => {
      let resolved = false;
      const onStop = () => {
        if (resolved) {return;}
        resolved = true;
        server.close(() =>{  resolve(); });
      };
      process.once('SIGTERM', onStop);
      process.once('SIGINT', onStop);
      if (signal) {
        if (signal.aborted) {
          onStop();
        } else {
          signal.addEventListener('abort', onStop, { once: true });
        }
      }
    });
  } finally {
    cacheState.store?.close();
  }
}
