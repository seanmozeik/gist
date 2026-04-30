import type { StreamMode } from '../flags';
import { isRichTty } from './terminal';

export interface StreamSettings {
  effectiveStreamMode: 'on' | 'off';
  streamingEnabled: boolean;
}

export function resolveStreamSettings({
  streamMode,
  stdout,
  json,
  extractMode,
}: {
  streamMode: StreamMode;
  stdout: NodeJS.WritableStream;
  json: boolean;
  extractMode: boolean;
}): StreamSettings {
  const effectiveStreamMode = (() => {
    if (streamMode !== 'auto') {
      return streamMode;
    }
    return isRichTty(stdout) ? 'on' : 'off';
  })();
  const streamingEnabled = effectiveStreamMode === 'on' && !json && !extractMode;

  return { effectiveStreamMode, streamingEnabled };
}
