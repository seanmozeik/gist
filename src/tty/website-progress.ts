import type { LinkPreviewProgressEvent } from '../content/index';
import { formatBytes } from './format';
import type { OscProgressController } from './osc-progress';
import { createFetchHtmlProgressRenderer } from './progress/fetch-html';
import { createTranscriptProgressRenderer } from './progress/transcript';
import type { ThemeRenderer } from './theme';

export function createWebsiteProgress({
  enabled,
  spinner,
  oscProgress,
  theme,
}: {
  enabled: boolean;
  spinner: { setText: (text: string) => void };
  oscProgress?: OscProgressController | null;
  theme?: ThemeRenderer | null;
}): { stop: () => void; onProgress: (event: LinkPreviewProgressEvent) => void } | null {
  if (!enabled) {
    return null;
  }

  const fetchRenderer = createFetchHtmlProgressRenderer({ oscProgress, spinner, theme });
  const transcriptRenderer = createTranscriptProgressRenderer({ oscProgress, spinner, theme });

  const styleLabel = (text: string) => (theme ? theme.label(text) : text);
  const styleDim = (text: string) => (theme ? theme.dim(text) : text);
  const renderStatus = (label: string, detail: string) =>
    theme ? `${styleLabel(label)}${styleDim(detail)}` : `${label}${detail}`;
  const renderTweetCliLabel = (client?: 'bird' | null) => (client === 'bird' ? 'Bird' : 'X');

  const stopAll = () => {
    fetchRenderer.stop();
    transcriptRenderer.stop();
  };

  return {
    onProgress: (event) => {
      fetchRenderer.onProgress(event);
      transcriptRenderer.onProgress(event);

      if (event.kind === 'bird-start') {
        stopAll();
        spinner.setText(renderStatus(renderTweetCliLabel(event.client), ': reading tweet…'));
        return;
      }

      if (event.kind === 'bird-done') {
        stopAll();
        const label = renderTweetCliLabel(event.client);
        if (event.ok && typeof event.textBytes === 'number') {
          spinner.setText(renderStatus(label, `: got ${formatBytes(event.textBytes)}…`));
          return;
        }
        spinner.setText(renderStatus(label, ': failed; fallback…'));
        return;
      }

      if (event.kind === 'transcript-start') {
        stopAll();
        const label = event.hint?.trim();
        const text = label && label.length > 0 ? label : 'Transcribing';
        spinner.setText(theme ? `${styleLabel(text)}${styleDim('…')}` : `${text}…`);
        return;
      }

      if (event.kind === 'transcript-done') {
        stopAll();
        if (event.ok) {
          spinner.setText(theme ? `${styleLabel('Transcribed')}${styleDim('…')}` : 'Transcribed…');
          return;
        }
        spinner.setText(
          theme
            ? `${styleLabel('Transcript unavailable')}${styleDim('…')}`
            : 'Transcript unavailable…',
        );
      }
    },
    stop: stopAll,
  };
}
