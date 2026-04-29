const DAEMON_STATUS_TIMEOUT_MS = 5000;
const DAEMON_STATUS_RETRY_DELAY_MS = 400;
const DAEMON_STATUS_MAX_ATTEMPTS = 2;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const shouldRetryDaemon = (err: unknown) => {
  if (err instanceof DOMException && err.name === 'AbortError') {return true;}
  const message = err instanceof Error ? err.message : '';
  return message.toLowerCase() === 'failed to fetch';
};

async function withDaemonRetry(
  run: (signal: AbortSignal) => Promise<Response>,
  labels: { timeout: string; fetchFailed: string; fallback: string },
): Promise<{ ok: boolean; error?: string }> {
  for (let attempt = 0; attempt < DAEMON_STATUS_MAX_ATTEMPTS; attempt += 1) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DAEMON_STATUS_TIMEOUT_MS);
      const res = await run(controller.signal);
      clearTimeout(timeout);
      if (!res.ok) {return { ok: false, error: `${res.status} ${res.statusText}` };}
      return { ok: true };
    } catch (error) {
      const shouldRetry = attempt < DAEMON_STATUS_MAX_ATTEMPTS - 1 && shouldRetryDaemon(error);
      if (shouldRetry) {
        await sleep(DAEMON_STATUS_RETRY_DELAY_MS * (attempt + 1));
        continue;
      }
      if (error instanceof DOMException && error.name === 'AbortError') {
        return { ok: false, error: labels.timeout };
      }
      const message = error instanceof Error ? error.message : labels.fallback;
      if (message.toLowerCase() === 'failed to fetch') {
        return { error: labels.fetchFailed, ok: false };
      }
      return { error: message, ok: false };
    }
  }
  return { error: labels.timeout, ok: false };
}

export async function daemonHealth(): Promise<{ ok: boolean; error?: string }> {
  return await withDaemonRetry(
    async (signal) => {
      return await fetch('http://127.0.0.1:8787/health', { signal });
    },
    {
      fallback: 'health failed',
      fetchFailed:
        'Failed to fetch (daemon unreachable or blocked by Chrome; try `summarize daemon status` and check ~/.summarize/logs/daemon.err.log)',
      timeout: 'Timed out',
    },
  );
}

export async function daemonPing(token: string): Promise<{ ok: boolean; error?: string }> {
  return await withDaemonRetry(
    async (signal) => {
      return await fetch('http://127.0.0.1:8787/v1/ping', {
        headers: { Authorization: `Bearer ${token}` },
        signal,
      });
    },
    {
      fallback: 'ping failed',
      fetchFailed:
        'Failed to fetch (daemon unreachable or blocked by Chrome; try `summarize daemon status`)',
      timeout: 'Timed out',
    },
  );
}

export function friendlyFetchError(err: unknown, context: string): string {
  const message = err instanceof Error ? err.message : String(err);
  if (message.toLowerCase() === 'failed to fetch') {
    return `${context}: Failed to fetch (daemon unreachable or blocked by Chrome; try \`summarize daemon status\` and check ~/.summarize/logs/daemon.err.log)`;
  }
  return `${context}: ${message}`;
}
