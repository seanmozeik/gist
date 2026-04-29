interface RecoveryCheck { isReady: boolean; currentUrlMatches: boolean; isIdle: boolean }

export function createDaemonRecovery() {
  let lastReady: boolean | null = null;
  let pendingUrl: string | null = null;

  return {
    clearPending() {
      pendingUrl = null;
    },
    getPendingUrl() {
      return pendingUrl;
    },
    maybeRecover({ isReady, currentUrlMatches, isIdle }: RecoveryCheck) {
      const prev = lastReady;
      lastReady = isReady;

      if (!pendingUrl) return false;

      if (!currentUrlMatches) {
        pendingUrl = null;
        return false;
      }

      if (prev === false && isReady && isIdle) {
        pendingUrl = null;
        return true;
      }

      return false;
    },
    recordFailure(url: string) {
      lastReady = false;
      pendingUrl = url;
    },
    updateStatus(isReady: boolean) {
      lastReady = isReady;
    },
  };
}

export function isDaemonUnreachableError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  const normalized = message.toLowerCase();
  return (
    normalized.includes('failed to fetch') ||
    normalized.includes('networkerror') ||
    normalized.includes('econnrefused')
  );
}
