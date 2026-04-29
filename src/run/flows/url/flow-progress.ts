import { createOscProgressController } from '../../../tty/osc-progress.js';
import { startSpinner } from '../../../tty/spinner.js';
import type { createThemeRenderer } from '../../../tty/theme.js';
import { createWebsiteProgress } from '../../../tty/website-progress.js';
import { createUrlProgressStatus } from './progress-status.js';
import { type UrlFlowContext } from './types.js';

export function createUrlFlowProgress({
  ctx,
  theme,
}: {
  ctx: UrlFlowContext;
  theme: ReturnType<typeof createThemeRenderer>;
}) {
  const { io, flags, hooks } = ctx;
  const oscProgress = createOscProgressController({
    env: io.env,
    isTty: flags.progressEnabled,
    label: 'Fetching website',
    write: (data: string) => io.stderr.write(data),
  });
  oscProgress.setIndeterminate('Fetching website');
  const spinner = startSpinner({
    color: theme.palette.spinner,
    enabled: flags.progressEnabled,
    stream: io.stderr,
    text: `${theme.label('Fetching website')}${theme.dim(' (connecting)…')}`,
  });
  const styleLabel = (text: string) => theme.label(text);
  const styleDim = (text: string) => theme.dim(text);
  const renderStatus = (label: string, detail = '…') => `${styleLabel(label)}${styleDim(detail)}`;
  const renderStatusWithMeta = (label: string, meta: string, suffix = '…') =>
    `${styleLabel(label)} ${meta}${styleDim(suffix)}`;
  const progressStatus = createUrlProgressStatus({
    enabled: flags.progressEnabled,
    oscProgress,
    spinner,
  });
  const handleSignal = () => {
    try {
      spinner.stopAndClear();
    } catch {
      // Ignore
    }
    oscProgress.clear();
  };
  const handleSigint = () => {
    handleSignal();
    process.exit(130);
  };
  const handleSigterm = () => {
    handleSignal();
    process.exit(143);
  };
  if (flags.progressEnabled) {
    process.once('SIGINT', handleSigint);
    process.once('SIGTERM', handleSigterm);
  }
  const progressHooks = hooks;
  const websiteProgress = createWebsiteProgress({
    enabled: flags.progressEnabled,
    oscProgress,
    spinner,
    theme,
  });

  const stopProgress = () => {
    if (!flags.progressEnabled) {
      return;
    }
    websiteProgress?.stop?.();
    try {
      spinner.stopAndClear();
    } catch {
      // Ignore
    }
    oscProgress.clear();
    process.removeListener('SIGINT', handleSigint);
    process.removeListener('SIGTERM', handleSigterm);
  };

  return {
    handleSigint,
    handleSigterm,
    hooks: progressHooks,
    pauseProgress: () => {
      spinner.pause();
      return () => {
        spinner.resume();
      };
    },
    progressStatus,
    renderStatus,
    renderStatusWithMeta,
    spinner,
    stopProgress,
    styleDim,
    styleLabel,
    websiteProgress,
  };
}
