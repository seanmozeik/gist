import { Command, Option } from 'commander';

import {
  CLI_THEME_NAMES,
  createThemeRenderer,
  resolveThemeNameFromSources,
  resolveTrueColor,
} from '../tty/theme.js';
import { SUPPORT_URL } from './constants';
import { supportsColor } from './terminal';

export function buildProgram() {
  return new Command()
    .name('gist')
    .description('Extract or summarize links, media, local files, and stdin for agents.')
    .argument('[input]', 'URL, local file path, or - for stdin')
    .option(
      '--youtube <mode>',
      'YouTube transcript source: auto, web, no-auto (skip auto-generated captions), yt-dlp',
      'auto',
    )
    .addOption(
      new Option(
        '--video-mode <mode>',
        'Video/audio handling: auto, transcript, understand. Transcription uses the local sidecar first, then OpenRouter when configured.',
      )
        .choices(['auto', 'transcript', 'understand'])
        .default('auto'),
    )
    .option('--timestamps', 'Include timestamps in transcripts when available.', false)
    .option(
      '--format <format>',
      'Extracted content format: md|text. For URLs: controls the extraction format. For files/stdin: controls whether we try to preprocess to Markdown for model compatibility. (default: text; default in --extract mode for URLs: md)',
    )
    .addOption(
      new Option(
        '--preprocess <mode>',
        'Preprocess inputs for model compatibility: off, auto (fallback), always.',
      )
        .choices(['off', 'auto', 'always'])
        .default('auto'),
    )
    .addOption(
      new Option(
        '--markdown-mode <mode>',
        'Markdown conversion: off, auto, llm (force LLM), readability. For web pages: converts HTML→Markdown. For transcripts: llm mode formats raw transcripts into clean markdown with headings and paragraphs.',
      ).default('readability'),
    )
    .addOption(
      new Option(
        '--markdown <mode>',
        'Deprecated alias for --markdown-mode (use --extract --format md --markdown-mode ...)',
      ).hideHelp(),
    )
    .option(
      '--length <length>',
      'Summary length: short|medium|long|xl|xxl (or s/m/l) or a character limit like 20000, 20k (default: xl; configurable via ~/.gist/config.json output.length)',
      'xl',
    )
    .option(
      '--max-extract-characters <count>',
      'Maximum characters to print in --extract (default: unlimited).',
    )
    .option(
      '--language, --lang <language>',
      'Output language: auto (match source), en, de, english, german, ... (default: auto; configurable in ~/.gist/config.json via output.language)',
    )
    .option(
      '--max-output-tokens <count>',
      'Hard cap for LLM output tokens (e.g. 2000, 2k). Overrides provider defaults.',
    )
    .option(
      '--force-summary',
      'Force LLM summary even when extracted content is shorter than the requested length.',
      false,
    )
    .option(
      '--timeout <duration>',
      'Timeout for content fetching and LLM request: 30 (seconds), 30s, 2m, 5000ms',
      '2m',
    )
    .option('--retries <count>', 'LLM retry attempts on timeout (default: 1).', '1')
    .option(
      '--model <model>',
      'LLM model id: auto, <name>, <author>/<slug> via OpenRouter, cli/<provider>/<model>, or local/<model> (default: auto)',
    )
    .option(
      '--fast',
      'Use the OpenAI fast service tier for OpenAI models (sends service_tier=priority).',
      false,
    )
    .option(
      '--service-tier <tier>',
      'OpenAI service tier: default, fast, priority, flex.',
      'default',
    )
    .option(
      '--thinking <effort>',
      'OpenAI reasoning effort: none, low, medium, high, xhigh (aliases: off, min, mid).',
    )
    .option(
      '--prompt <text>',
      'Override the summary prompt (instruction prefix; context/content still appended).',
    )
    .option('--prompt-file <path>', 'Read the prompt override from a file.')
    .option('--no-cache', 'Bypass summary cache (LLM). Media/transcript caches stay enabled.')
    .option('--no-media-cache', 'Disable media download cache (yt-dlp).')
    .option('--cache-stats', 'Print cache stats and exit.')
    .option('--clear-cache', 'Delete the cache database and exit.', false)
    .addOption(
      new Option(
        '--cli [provider]',
        'Use a CLI provider: claude, gemini, codex, agent (equivalent to --model cli/<provider>). If omitted, use auto selection with CLI enabled.',
      ),
    )
    .option('--extract', 'Print extracted content and exit (no LLM summary)', false)
    .addOption(new Option('--extract-only', 'Deprecated alias for --extract').hideHelp())
    .option('--json', 'Output structured JSON (includes prompt + metrics)', false)
    .option(
      '--stream <mode>',
      'Stream LLM output: auto (TTY only), on, off. Note: streaming is disabled in --json mode.',
      'auto',
    )
    .option(
      '--width <columns>',
      'Override terminal width for markdown rendering (default: auto-detect, max 120)',
    )
    .option('--plain', 'Keep raw text/markdown output (no ANSI/OSC rendering)', false)
    .option('--no-color', 'Disable ANSI colors in output', false)
    .addOption(
      new Option('--theme <name>', `CLI theme (${CLI_THEME_NAMES.join(', ')})`).choices(
        CLI_THEME_NAMES,
      ),
    )
    .option('--verbose', 'Print detailed progress info to stderr', false)
    .option('--debug', 'Alias for --verbose (and defaults --metrics to detailed)', false)
    .option('--skill', 'Print the gist CLI skill markdown', false)
    .addOption(
      new Option('--metrics <mode>', 'Metrics output: off, on, detailed')
        .choices(['off', 'on', 'detailed'])
        .default('on'),
    )
    .option('-V, --version', 'Print version and exit', false)
    .allowExcessArguments(false);
}

export function applyHelpStyle(
  program: Command,
  env: Record<string, string | undefined>,
  stdout: NodeJS.WritableStream,
) {
  const color = supportsColor(stdout, env);
  const theme = createThemeRenderer({
    enabled: color,
    themeName: resolveThemeNameFromSources({ env: env.GIST_THEME }),
    trueColor: resolveTrueColor(env),
  });
  program.configureHelp({
    styleArgumentText: (text) => theme.code(text),
    styleCommandText: (text) => theme.accentStrong(text),
    styleDescriptionText: (text) => theme.dim(text),
    styleOptionText: (text) => theme.label(text),
    styleSubcommandText: (text) => theme.accent(text),
    styleTitle: (text) => theme.heading(text),
  });
}

export function attachRichHelp(
  program: Command,
  env: Record<string, string | undefined>,
  stdout: NodeJS.WritableStream,
) {
  applyHelpStyle(program, env, stdout);
  const color = supportsColor(stdout, env);
  const theme = createThemeRenderer({
    enabled: color,
    themeName: resolveThemeNameFromSources({ env: env.GIST_THEME }),
    trueColor: resolveTrueColor(env),
  });
  const heading = (text: string) => theme.heading(text);
  const cmd = (text: string) => theme.accentStrong(text);
  const dim = (text: string) => theme.dim(text);

  program.addHelpText(
    'after',
    () => `
${heading('Commands')}
  ${cmd('gist <input> [flags]')} ${dim('# extract or summarize a URL, file, or stdin')}
  ${cmd('gist refresh-free [flags]')} ${dim('# refresh OpenRouter :free model candidates')}
  ${cmd('gist auth [provider]')} ${dim('# manage stored API keys')}
  ${cmd('gist help <command>')} ${dim('# show command-specific help')}

${heading('Examples')}
  ${cmd('gist "https://example.com"')}
  ${cmd('gist "https://example.com" --extract')} ${dim('# extracted plain text')}
  ${cmd('gist "https://example.com" --extract --format md')} ${dim('# extracted markdown')}
  ${cmd('gist "https://example.com" --extract --format md --markdown-mode llm')} ${dim('# extracted markdown via LLM')}
  ${cmd('gist "https://x.com/user/status/123" --extract')} ${dim('# tweet text via bird CLI when available')}
  ${cmd('gist "https://www.youtube.com/watch?v=..." --extract --format md --markdown-mode llm')} ${dim('# transcript as formatted markdown')}
  ${cmd('gist "https://www.youtube.com/watch?v=I845O57ZSy4&t=11s" --extract --youtube web')}
  ${cmd('gist "https://podcasts.apple.com/.../id123?i=456" --extract')} ${dim('# podcast transcript')}
  ${cmd('gist "/path/to/audio.mp3" --extract')} ${dim('# local media transcript')}
  ${cmd('gist "https://example.com" --length 20k --max-output-tokens 2k --timeout 2m --model openai/gpt-5-mini')}
  ${cmd('gist "https://example.com" --model local/qwen-smol')} ${dim('# local sidecar')}
  ${cmd('gist "https://example.com" --model mymodel')} ${dim('# config preset')}
  ${cmd('gist "https://example.com" --json --verbose')}
  ${cmd('pbpaste | gist -')} ${dim('# gist clipboard content')}
  ${cmd('gist refresh-free')} ${dim('# scan/update working OpenRouter :free models')}

${heading('Env Vars')}
  OPENROUTER_API_KEY                required for OpenRouter models and OpenRouter transcription
  GIST_LOCAL_BASE_URL               optional local sidecar URL for local/... models and local transcription
  GIST_TRANSCRIPTION_MODEL          optional OpenRouter transcription model (default: openai/whisper-1)
  CLAUDE_PATH                       optional (path to Claude CLI binary)
  CODEX_PATH                        optional (path to Codex CLI binary)
  GEMINI_PATH                       optional (path to Gemini CLI binary)
  AGENT_PATH                        optional (path to Cursor Agent CLI binary)
  GIST_MODEL                        optional (overrides default model selection)
  GIST_THEME                        optional (${CLI_THEME_NAMES.join(', ')})
  GIST_TRUECOLOR                    optional (force 24-bit color)
  GIST_NO_TRUECOLOR                 optional (disable 24-bit color)
  YT_DLP_PATH                       optional yt-dlp binary for audio/video fallback
  GIST_YT_DLP_COOKIES_FROM_BROWSER optional yt-dlp cookies source

${heading('Hint')}
  ${cmd('gist refresh-free')} ${dim('# refresh free-model candidates into ~/.gist/config.json')}
  ${cmd('gist --model openai/gpt-5-mini "https://example.com"')}
  ${cmd('gist --model local/qwen-smol "https://example.com"')}

${heading('Support')}
  ${SUPPORT_URL}
`,
  );
}

export function buildConciseHelp(): string {
  return [
    'gist - Extract or summarize links, media, local files, and stdin.',
    '',
    'Usage: gist <input> [flags]',
    '',
    'Commands:',
    '  gist <input> [flags]',
    '  gist refresh-free [flags]',
    '  gist auth [provider]',
    '  gist help <command>',
    '',
    'Examples:',
    '  gist "https://example.com"',
    '  gist "/path/to/file.pdf" --model openai/gpt-5-mini',
    '  pbpaste | gist -',
    '',
    'Run gist --help for full options.',
    `Support: ${SUPPORT_URL}`,
  ].join('\n');
}
