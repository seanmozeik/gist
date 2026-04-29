import { CommanderError } from 'commander';

import { loadSummarizeConfig } from '../config.js';
import { parseDurationMs } from '../flags.js';
import {
  extractSlidesForSource,
  resolveSlideSettings,
  resolveSlideSourceFromUrl,
  type SlideExtractionResult,
} from '../slides/index.js';
import { createOscProgressController } from '../tty/osc-progress.js';
import { startSpinner } from '../tty/spinner.js';
import {
  createThemeRenderer,
  resolveThemeNameFromSources,
  resolveTrueColor,
} from '../tty/theme.js';
import { formatVersionLine } from '../version.js';
import { applyHelpStyle, buildSlidesProgram } from './help.js';
import { writeVerbose } from './logging.js';
import { createMediaCacheFromConfig } from './media-cache-state.js';
import { resolveEnvState } from './run-env.js';
import { renderSlidesInline, type SlidesRenderMode } from './slides-render.js';
import { isRichTty, supportsColor } from './terminal.js';

interface SlidesCliContext {
  normalizedArgv: string[];
  envForRun: Record<string, string | undefined>;
  fetchImpl: typeof fetch;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}

function formatTimestamp(seconds: number): string {
  const clamped = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const secs = clamped % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  if (hours <= 0) {return `${minutes}:${ss}`;}
  const hh = String(hours).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function parseRenderMode(raw: unknown): SlidesRenderMode {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!value || value === 'none') {return 'none';}
  if (value === 'auto' || value === 'kitty' || value === 'iterm') {return value;}
  throw new Error(`Unsupported --render: ${String(raw)}`);
}

export async function handleSlidesCliRequest({
  normalizedArgv,
  envForRun,
  stdout,
  stderr,
}: SlidesCliContext): Promise<boolean> {
  if (normalizedArgv[0]?.toLowerCase() !== 'slides') {return false;}

  const program = buildSlidesProgram();
  program.configureOutput({
    writeErr(str) {
      stderr.write(str);
    },
    writeOut(str) {
      stdout.write(str);
    },
  });
  applyHelpStyle(program, envForRun, stdout);
  program.exitOverride();

  try {
    program.parse(normalizedArgv.slice(1), { from: 'user' });
  } catch (error) {
    if (error instanceof CommanderError && error.code === 'commander.helpDisplayed') {
      return true;
    }
    throw error;
  }

  if (program.opts().version) {
    stdout.write(`${formatVersionLine()}\n`);
    return true;
  }

  const url = program.args[0];
  if (!url) {
    throw new Error('summarize slides requires a URL or local video file.');
  }

  const opts = program.opts() as {
    slidesOcr?: boolean;
    slidesDir?: string;
    output?: string;
    slidesSceneThreshold?: string;
    slidesMax?: string;
    slidesMinDuration?: string;
    render?: string;
    timeout?: string;
    theme?: string;
    cache?: boolean;
    json?: boolean;
    verbose?: boolean;
    debug?: boolean;
  };

  const renderMode = parseRenderMode(opts.render);
  if (opts.json && renderMode !== 'none') {
    throw new Error('--render is not supported with --json output.');
  }

  const slidesSettings = resolveSlideSettings({
    cwd: process.cwd(),
    slides: true,
    slidesDir: opts.output ?? opts.slidesDir,
    slidesMax: opts.slidesMax,
    slidesMinDuration: opts.slidesMinDuration,
    slidesOcr: opts.slidesOcr ?? false,
    slidesSceneThreshold: opts.slidesSceneThreshold,
    slidesSceneThresholdExplicit: normalizedArgv.some(
      (arg) => arg === '--slides-scene-threshold' || arg.startsWith('--slides-scene-threshold='),
    ),
  });
  if (!slidesSettings) {
    throw new Error('Slides are disabled (enable --slides-ocr or check arguments).');
  }

  const timeoutRaw = typeof opts.timeout === 'string' && opts.timeout.trim() ? opts.timeout : '2m';
  const timeoutMs = parseDurationMs(timeoutRaw);
  const { config } = loadSummarizeConfig({ env: envForRun });
  const mediaCache = await createMediaCacheFromConfig({
    config,
    envForRun,
    noMediaCacheFlag: false,
  });
  const themeName = resolveThemeNameFromSources({
    cli: opts.theme,
    config: config?.ui?.theme,
    env: envForRun.SUMMARIZE_THEME,
  });
  (envForRun).SUMMARIZE_THEME = themeName;
  const envState = resolveEnvState({ configForCli: config, env: envForRun, envForRun });

  const source = resolveSlideSourceFromUrl(url);
  if (!source) {
    throw new Error(
      'Slides are only supported for YouTube, direct video URLs, or local video files.',
    );
  }

  const verboseEnabled = Boolean(opts.verbose ?? opts.debug);
  const progressEnabled = isRichTty(stderr) && !opts.json && !verboseEnabled;
  const theme = createThemeRenderer({
    enabled: progressEnabled,
    themeName,
    trueColor: resolveTrueColor(envForRun),
  });
  const renderStatus = (label: string, detail = '…') => `${theme.label(label)}${theme.dim(detail)}`;
  const renderStatusFromText = (text: string) => {
    const match = /^([^:]+):(.*)$/.exec(text);
    if (!match) {return renderStatus(text);}
    const [, prefix, rest] = match;
    return `${theme.label(prefix.trim())}${theme.dim(`:${rest}`)}`;
  };
  const oscProgress = progressEnabled
    ? createOscProgressController({
        env: envForRun,
        isTty: progressEnabled,
        label: 'Slides',
        write: (data: string) => stderr.write(data),
      })
    : null;
  const spinner = startSpinner({
    color: theme.palette.spinner,
    enabled: progressEnabled,
    stream: stderr,
    text: renderStatus('Extracting slides'),
  });
  const handleSignal = () => {
    try {
      spinner.stopAndClear();
    } catch {
      // Ignore
    }
    oscProgress?.clear();
  };
  const handleSigint = () => {
    handleSignal();
    process.exit(130);
  };
  const handleSigterm = () => {
    handleSignal();
    process.exit(143);
  };
  if (progressEnabled) {
    process.once('SIGINT', handleSigint);
    process.once('SIGTERM', handleSigterm);
  }
  const verboseColor = supportsColor(stderr, envForRun);
  const logSlides = (message: string) => {
    writeVerbose(stderr, verboseEnabled, `slides ${message}`, verboseColor, envForRun);
  };
  const onSlidesProgress = (text: string) => {
    if (progressEnabled) {
      spinner.setText(renderStatusFromText(text));
      const match = /(\d{1,3})%/.exec(text);
      const percent = match ? Number(match[1]) : null;
      if (Number.isFinite(percent) && percent !== null) {
        oscProgress?.setPercent('Slides', Math.max(0, Math.min(100, percent)));
      } else {
        oscProgress?.setIndeterminate('Slides');
      }
      spinner.refresh?.();
      return;
    }
    if (verboseEnabled) {
      stderr.write(`${text}\n`);
    }
  };

  let slidesExtracted: SlideExtractionResult;
  try {
    slidesExtracted = await extractSlidesForSource({
      env: envForRun,
      ffmpegPath: null,
      hooks: { onSlidesLog: logSlides, onSlidesProgress },
      mediaCache,
      noCache: opts.cache === false,
      settings: slidesSettings,
      source,
      tesseractPath: null,
      timeoutMs,
      ytDlpCookiesFromBrowser: envState.ytDlpCookiesFromBrowser,
      ytDlpPath: envState.ytDlpPath,
    });
  } finally {
    spinner.stopAndClear();
    oscProgress?.clear();
    if (progressEnabled) {
      process.off('SIGINT', handleSigint);
      process.off('SIGTERM', handleSigterm);
    }
  }

  if (opts.json) {
    stdout.write(`${JSON.stringify({ ok: true, slides: slidesExtracted }, null, 2)}\n`);
    return true;
  }

  const count = slidesExtracted.slides.length;
  stdout.write(`Slides extracted: ${count}\n`);
  stdout.write(`Slides dir: ${slidesExtracted.slidesDir}\n`);

  if (renderMode !== 'none') {
    if (!isRichTty(stdout)) {
      throw new Error('--render requires a TTY stdout.');
    }
    await renderSlidesInline({
      env: envForRun,
      labelForSlide: (slide) =>
        `Slide ${slide.index} · ${formatTimestamp(slide.timestamp)} (${slide.imagePath})`,
      mode: renderMode,
      slides: slidesExtracted.slides,
      stdout,
    });
    return true;
  }

  for (const slide of slidesExtracted.slides) {
    stdout.write(`${slide.index}\t${formatTimestamp(slide.timestamp)}\t${slide.imagePath}\n`);
  }
  return true;
}
