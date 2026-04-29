export function parseClockDuration(value: string): number | null {
  const parts = value
    .trim()
    .split(':')
    .map((part) => Number.parseInt(part.trim(), 10));
  if (parts.some((part) => !Number.isFinite(part))) {return null;}
  if (parts.length === 2) {
    const [minutes, seconds] = parts;
    return minutes * 60 + seconds;
  }
  if (parts.length === 3) {
    const [hours, minutes, seconds] = parts;
    return hours * 3600 + minutes * 60 + seconds;
  }
  return null;
}

export function parseIsoDuration(value: string): number | null {
  const match = value.trim().match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
  if (!match) {return null;}
  const hours = Number.parseInt(match[1] ?? '0', 10);
  const minutes = Number.parseInt(match[2] ?? '0', 10);
  const seconds = Number.parseInt(match[3] ?? '0', 10);
  if (![hours, minutes, seconds].every((part) => Number.isFinite(part))) {return null;}
  const total = hours * 3600 + minutes * 60 + seconds;
  return total > 0 ? total : null;
}

export function resolveMediaDurationSecondsFromData({
  metaDuration,
  uiDuration,
  videoDuration,
}: {
  metaDuration?: string | null;
  uiDuration?: string | null;
  videoDuration?: number | null;
}): number | null {
  if (metaDuration) {
    const parsed = parseIsoDuration(metaDuration);
    if (parsed) {return parsed;}
  }

  if (uiDuration) {
    const parsed = parseClockDuration(uiDuration);
    if (parsed) {return parsed;}
  }

  if (typeof videoDuration === 'number' && Number.isFinite(videoDuration) && videoDuration > 0) {
    return Math.round(videoDuration);
  }

  return null;
}
