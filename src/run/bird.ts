import { spawn } from 'node:child_process';

import { parseBirdTweetPayload } from './bird/parse.js';
import type { BirdTweetMedia } from './bird/types.js';
import { BIRD_TIP, TWITTER_HOSTS } from './constants.js';

export interface BirdTweetPayload {
  id?: string;
  text: string;
  author?: { username?: string; name?: string };
  createdAt?: string;
  media?: BirdTweetMedia | null;
}

function parseTweetId(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  if (/^\d+$/.test(trimmed)) {
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (!TWITTER_HOSTS.has(host)) {
      return null;
    }
    const match = /\/status\/(\d+)/.exec(parsed.pathname);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function isTwitterStatusUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (!TWITTER_HOSTS.has(host)) {
      return false;
    }
    return /\/status\/\d+/.test(parsed.pathname);
  } catch {
    return false;
  }
}

async function execBirdCli(
  args: string[],
  timeoutMs: number,
  env: Record<string, string | undefined>,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('bird', args, { env: { ...process.env, ...env }, timeout: timeoutMs });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('error', (err: Error) => {
      reject(new Error(`Failed to start bird CLI: ${err.message}`));
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`bird CLI exited with code ${code}: ${stderr.slice(0, 500)}`));
      }
    });
  });
}

export async function readTweet(args: {
  url: string;
  timeoutMs: number;
  env?: Record<string, string | undefined>;
}): Promise<BirdTweetPayload> {
  const tweetId = parseTweetId(args.url);
  if (!tweetId) {
    throw new Error('bird read requires a tweet status URL or id');
  }

  const stdout = await execBirdCli(
    ['read', args.url, '--json-full'],
    args.timeoutMs,
    args.env ?? {},
  );

  if (!stdout) {
    throw new Error('bird read returned empty output');
  }

  try {
    return parseBirdTweetPayload(JSON.parse(stdout));
  } catch (parseError) {
    const message = parseError instanceof Error ? parseError.message : String(parseError);
    throw new Error(`bird read returned invalid JSON: ${message}`, { cause: parseError });
  }
}

export async function readTweetWithPreferredClient(args: {
  url: string;
  timeoutMs: number;
  env: Record<string, string | undefined>;
}): Promise<BirdTweetPayload> {
  return readTweet({ env: args.env, timeoutMs: args.timeoutMs, url: args.url });
}

export function withBirdTip(error: unknown, url: string | null): Error {
  if (!url || !isTwitterStatusUrl(url)) {
    return error instanceof Error ? error : new Error(String(error));
  }
  const message = error instanceof Error ? error.message : String(error);
  const combined = `${message}\n${BIRD_TIP}`;
  return error instanceof Error ? new Error(combined, { cause: error }) : new Error(combined);
}
