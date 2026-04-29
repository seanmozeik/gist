import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';

import { encodeSseEvent } from '../shared/sse-events.js';
import { resolveSlideImagePath, type SlideExtractionResult } from '../slides/index.js';
import { json } from './server-http.js';
import type { Session } from './server-session.js';
import { attachBufferedSseSession } from './server-sse.js';
import { buildSlidesPayload } from './server-summarize-execution.js';
import { resolveHomeDir } from './server-summarize-request.js';

export async function handleSessionRoutes(options: {
  req: import('node:http').IncomingMessage;
  res: import('node:http').ServerResponse<import('node:http').IncomingMessage>;
  pathname: string;
  cors: Record<string, string>;
  env: Record<string, string | undefined>;
  port: number;
  sessions: Map<string, Session>;
  refreshSessions: Map<string, Session>;
}) {
  const { req, res, pathname, cors, env, port, sessions, refreshSessions } = options;

  const slidesMatch = /^\/v1\/summarize\/([^/]+)\/slides$/.exec(pathname);
  if (req.method === 'GET' && slidesMatch) {
    const id = slidesMatch[1];
    const session = id ? sessions.get(id) : null;
    if (!session?.slides) {
      json(res, 200, { error: 'not found', ok: false }, cors);
      return true;
    }
    json(
      res,
      200,
      { ok: true, slides: buildSlidesPayload({ port, slides: session.slides }) },
      cors,
    );
    return true;
  }

  const slideImageMatch = /^\/v1\/summarize\/([^/]+)\/slides\/(\d+)$/.exec(pathname);
  if (req.method === 'GET' && slideImageMatch) {
    const id = slideImageMatch[1];
    const index = Number(slideImageMatch[2]);
    const session = id ? sessions.get(id) : null;
    if (!session?.slides || !Number.isFinite(index)) {
      json(res, 404, { error: 'not found', ok: false }, cors);
      return true;
    }
    const slide = session.slides.slides.find((item) => item.index === index);
    if (!slide) {
      json(res, 404, { error: 'not found', ok: false }, cors);
      return true;
    }
    try {
      const stat = await fs.stat(slide.imagePath);
      res.writeHead(200, {
        'cache-control': 'no-cache',
        'content-length': stat.size.toString(),
        'content-type': 'image/png',
        ...cors,
      });
      const stream = createReadStream(slide.imagePath);
      stream.pipe(res);
      stream.on('error', () => res.end());
    } catch {
      json(res, 404, { error: 'not found', ok: false }, cors);
    }
    return true;
  }

  const stableSlideImageMatch = /^\/v1\/slides\/([^/]+)\/(\d+)$/.exec(pathname);
  if (req.method === 'GET' && stableSlideImageMatch) {
    const sourceId = stableSlideImageMatch[1];
    const index = Number(stableSlideImageMatch[2]);
    if (!sourceId || !Number.isFinite(index) || index <= 0) {
      json(res, 404, { error: 'not found', ok: false }, cors);
      return true;
    }

    const slidesRoot = path.resolve(resolveHomeDir(env), '.summarize', 'slides');
    const slidesDir = path.join(slidesRoot, sourceId);
    const payloadPath = path.join(slidesDir, 'slides.json');

    const resolveFromDisk = async (): Promise<string | null> => {
      const raw = await fs.readFile(payloadPath, 'utf8').catch(() => null);
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as SlideExtractionResult;
          const slide = parsed?.slides?.find?.((item) => item?.index === index);
          if (slide?.imagePath) {
            const resolved = resolveSlideImagePath(slidesDir, slide.imagePath);
            if (resolved) {return resolved;}
          }
        } catch {
          // Fall through
        }
      }
      const prefix = `slide_${String(index).padStart(4, '0')}`;
      const entries = await fs.readdir(slidesDir).catch(() => null);
      if (!entries) {return null;}
      const candidates = entries
        .filter((name) => name.startsWith(prefix) && name.endsWith('.png'))
        .map((name) => path.join(slidesDir, name));
      if (candidates.length === 0) {return null;}
      let best: { filePath: string; mtimeMs: number } | null = null;
      for (const filePath of candidates) {
        const stat = await fs.stat(filePath).catch(() => null);
        if (!stat?.isFile()) {continue;}
        const {mtimeMs} = stat;
        if (!best || mtimeMs > best.mtimeMs) {best = { filePath, mtimeMs };}
      }
      return best?.filePath ?? null;
    };

    const filePath = await resolveFromDisk();
    if (!filePath) {
      const placeholder = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO3kq0cAAAAASUVORK5CYII=',
        'base64',
      );
      res.writeHead(200, {
        'cache-control': 'no-store',
        'content-length': placeholder.length.toString(),
        'content-type': 'image/png',
        'x-summarize-slide-ready': '0',
        ...cors,
      });
      res.end(placeholder);
      return true;
    }

    try {
      const stat = await fs.stat(filePath);
      res.writeHead(200, {
        'cache-control': 'no-store',
        'content-length': stat.size.toString(),
        'content-type': 'image/png',
        'x-summarize-slide-ready': '1',
        ...cors,
      });
      const stream = createReadStream(filePath);
      stream.pipe(res);
      stream.on('error', () => res.end());
    } catch {
      json(res, 404, { error: 'not found', ok: false }, cors);
    }
    return true;
  }

  const eventsMatch = /^\/v1\/summarize\/([^/]+)\/events$/.exec(pathname);
  if (req.method === 'GET' && eventsMatch) {
    const id = eventsMatch[1];
    if (!id) {
      json(res, 404, { ok: false }, cors);
      return true;
    }
    const session = sessions.get(id);
    if (!session) {
      json(res, 404, { error: 'not found', ok: false }, cors);
      return true;
    }
    attachBufferedSseSession({
      buffer: session.buffer,
      clients: session.clients,
      cors,
      done: session.done,
      res,
    });
    return true;
  }

  const slidesEventsMatch = /^\/v1\/summarize\/([^/]+)\/slides\/events$/.exec(pathname);
  if (req.method === 'GET' && slidesEventsMatch) {
    const id = slidesEventsMatch[1];
    if (!id) {
      json(res, 404, { ok: false }, cors);
      return true;
    }
    const session = sessions.get(id);
    if (!session || !session.slidesRequested) {
      json(res, 404, { error: 'not found', ok: false }, cors);
      return true;
    }

    attachBufferedSseSession({
      afterReplay: () => {
        const hasSlidesEvent = session.slidesBuffer.some((entry) => entry.event.event === 'slides');
        if (!hasSlidesEvent && session.slides) {
          res.write(
            encodeSseEvent({
              event: 'slides',
              data: buildSlidesPayload({ slides: session.slides, port }),
            }),
          );
        }

        const hasStatusEvent = session.slidesBuffer.some((entry) => entry.event.event === 'status');
        if (!hasStatusEvent && session.slidesLastStatus) {
          res.write(encodeSseEvent({ event: 'status', data: { text: session.slidesLastStatus } }));
        }
      },
      buffer: session.slidesBuffer,
      clients: session.slidesClients,
      cors,
      done: session.slidesDone,
      res,
    });
    return true;
  }

  const refreshEventsMatch = /^\/v1\/refresh-free\/([^/]+)\/events$/.exec(pathname);
  if (req.method === 'GET' && refreshEventsMatch) {
    const id = refreshEventsMatch[1];
    if (!id) {
      json(res, 404, { ok: false }, cors);
      return true;
    }
    const session = refreshSessions.get(id);
    if (!session) {
      json(res, 404, { error: 'not found', ok: false }, cors);
      return true;
    }

    attachBufferedSseSession({
      buffer: session.buffer,
      clients: session.clients,
      cors,
      done: session.done,
      res,
    });
    return true;
  }

  return false;
}
