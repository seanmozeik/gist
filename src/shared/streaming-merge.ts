function normalizeStreamText(input: string): string {
  return input.replaceAll(/\r\n?/g, '\n');
}

function commonPrefixLength(a: string, b: string, limit = 4096): number {
  const max = Math.min(a.length, b.length, limit);
  let i = 0;
  for (; i < max; i += 1) {
    if (a[i] !== b[i]) {
      break;
    }
  }
  return i;
}

// Streaming APIs sometimes resend partial output; stitch using prefix/overlap heuristics.
export function mergeStreamingChunk(
  previous: string,
  chunk: string,
): { next: string; appended: string } {
  if (!chunk) {
    return { appended: '', next: previous };
  }
  const prev = normalizeStreamText(previous);
  const nextChunk = normalizeStreamText(chunk);
  if (!prev) {
    return { appended: nextChunk, next: nextChunk };
  }
  if (nextChunk.startsWith(prev)) {
    return { appended: nextChunk.slice(prev.length), next: nextChunk };
  }
  if (prev.startsWith(nextChunk)) {
    return { appended: '', next: prev };
  }
  if (nextChunk.length >= prev.length) {
    const prefixLen = commonPrefixLength(prev, nextChunk);
    if (prefixLen > 0) {
      const minPrefix = Math.max(prev.length - 64, Math.floor(prev.length * 0.9));
      if (prefixLen >= minPrefix) {
        return { appended: nextChunk.slice(prefixLen), next: nextChunk };
      }
    }
  }
  const maxOverlap = Math.min(prev.length, nextChunk.length, 2048);
  for (let len = maxOverlap; len > 0; len -= 1) {
    if (prev.slice(-len) === nextChunk.slice(0, len)) {
      return { appended: nextChunk.slice(len), next: prev + nextChunk.slice(len) };
    }
  }
  return { appended: nextChunk, next: prev + nextChunk };
}
