import { createMarkdownStreamer, render as renderMarkdownAnsi } from 'markdansi';

import { prepareMarkdownForTerminalStreaming } from '../../markdown.js';
import { createStreamOutputGate, type StreamOutputMode } from '../../stream-output.js';
import type { SummaryStreamHandler } from '../../summary-engine.js';
import { isRichTty, markdownRenderWidth, supportsColor } from '../../terminal.js';
import { splitSlideTitleFromText } from './slides-text.js';

export function createSlidesSummaryStreamHandler({
  stdout,
  env,
  envForRun,
  plain,
  outputMode,
  clearProgressForStdout,
  restoreProgressAfterStdout,
  renderSlide,
  getSlideIndexOrder,
  getSlideMeta,
  debugWrite,
}: {
  stdout: NodeJS.WritableStream;
  env: Record<string, string | undefined>;
  envForRun: Record<string, string | undefined>;
  plain: boolean;
  outputMode: StreamOutputMode;
  clearProgressForStdout: () => void;
  restoreProgressAfterStdout?: (() => void) | null;
  renderSlide: (index: number, title?: string | null) => Promise<void>;
  getSlideIndexOrder: () => number[];
  getSlideMeta?: ((index: number) => { total: number; timestamp: number | null }) | null;
  debugWrite?: ((text: string) => void) | null;
}): SummaryStreamHandler {
  const shouldRenderMarkdown = !plain && isRichTty(stdout);
  const outputGate = !shouldRenderMarkdown
    ? createStreamOutputGate({
        clearProgressForStdout,
        outputMode,
        restoreProgressAfterStdout: restoreProgressAfterStdout ?? null,
        richTty: isRichTty(stdout),
        stdout,
      })
    : null;
  const streamer = shouldRenderMarkdown
    ? createMarkdownStreamer({
        render: (markdown) =>
          renderMarkdownAnsi(prepareMarkdownForTerminalStreaming(markdown), {
            color: supportsColor(stdout, envForRun),
            hyperlinks: true,
            width: markdownRenderWidth(stdout, env),
            wrap: true,
          }),
        spacing: 'single',
      })
    : null;

  let wroteLeadingBlankLine = false;
  let buffered = '';
  const renderedSlides = new Set<number>();
  let visible = '';
  let pendingSlide: { index: number; buffer: string } | null = null;
  const slideTagRegex = /\[[^\]]*slide[^\d\]]*(\d+)[^\]]*\]/i;
  const slideLabelRegex =
    /(^|\n)[\t ]*slide\s+(\d+)(?:\s*(?:\/|of)\s*\d+)?(?:\s*[\u00B7:-].*)?(?=\n|$)/i;
  const bareSlideTagRegex = /(?<=^|\n)[\t ]*slide\s*:\s*(\d+)\](?=\s*(?:\n|$))/i;
  const slideStripRegex = /\[[^\]]*slide[^\]]*\]/gi;
  const bareSlideStripRegex = /(?<=^|\n)[\t ]*slide\s*:\s*\d+\](?=\s*(?:\n|$))/gi;

  const stripSlideMarkers = (segment: string) =>
    segment.replace(slideStripRegex, '').replace(bareSlideStripRegex, '');

  const handleMarkdownChunk = (nextVisible: string, prevVisible: string) => {
    if (!streamer) {return;}
    const appended = nextVisible.slice(prevVisible.length);
    if (!appended) {return;}
    const out = streamer.push(appended);
    if (!out) {return;}
    clearProgressForStdout();
    if (!wroteLeadingBlankLine) {
      stdout.write(`\n${out.replace(/^\n+/, '')}`);
      wroteLeadingBlankLine = true;
    } else {
      stdout.write(out);
    }
    restoreProgressAfterStdout?.();
  };

  const pushVisible = (segment: string) => {
    if (!segment) {return;}
    const sanitized = stripSlideMarkers(segment);
    if (!sanitized) {return;}
    const prevVisible = visible;
    visible += sanitized;
    if (outputGate) {
      outputGate.handleChunk(visible, prevVisible);
      return;
    }
    handleMarkdownChunk(visible, prevVisible);
  };

  const pushVisibleLines = (segment: string) => {
    if (!segment) {return;}
    const parts = segment.split('\n');
    for (let i = 0; i < parts.length; i += 1) {
      const line = parts[i] ?? '';
      const suffix = i < parts.length - 1 ? '\n' : '';
      if (!line && !suffix) {continue;}
      pushVisible(`${line}${suffix}`);
    }
  };

  const renderSlideBlock = async (index: number, title?: string | null) => {
    if (renderedSlides.has(index)) {return;}
    renderedSlides.add(index);
    await renderSlide(index, title);
  };

  const flushPendingSlide = async (force: boolean) => {
    if (!pendingSlide) {return;}
    const text = pendingSlide.buffer;
    if (!text.trim()) {
      if (force) {
        const {index} = pendingSlide;
        pendingSlide = null;
        await renderSlideBlock(index, null);
      }
      return;
    }

    const {index} = pendingSlide;
    const meta = getSlideMeta?.(index);
    const total = meta?.total ?? getSlideIndexOrder().length;
    const newlineIndex = text.indexOf('\n');
    const shouldResolve = force || newlineIndex !== -1 || text.length >= 160;
    if (!shouldResolve) {return;}

    const parsed = splitSlideTitleFromText({ slideIndex: index, text, total });
    if (parsed.title && !parsed.body && !force) {
      return;
    }
    const title = parsed.title ?? null;
    const {body} = parsed;
    pendingSlide = null;
    await renderSlideBlock(index, title);
    if (body.trim()) {pushVisibleLines(body);}
  };

  const appendVisible = async (segment: string) => {
    if (!segment) {return;}
    const sanitized = stripSlideMarkers(segment);
    if (!sanitized) {return;}
    if (pendingSlide) {
      pendingSlide.buffer += sanitized;
      await flushPendingSlide(false);
      return;
    }
    pushVisible(sanitized);
  };

  const flushBuffered = async ({ final }: { final: boolean }) => {
    while (buffered.length > 0) {
      const tagMatch = slideTagRegex.exec(buffered);
      const labelMatch = slideLabelRegex.exec(buffered);
      const bareTagMatch = bareSlideTagRegex.exec(buffered);
      const lower = buffered.toLowerCase();
      const fallbackStart = lower.indexOf('[slide');
      const fallbackEnd = fallbackStart !== -1 ? buffered.indexOf(']', fallbackStart) : -1;
      const fallbackMatch =
        fallbackStart !== -1 && fallbackEnd > fallbackStart
          ? { end: fallbackEnd, start: fallbackStart }
          : null;
      const nextMatch =
        [
          tagMatch ? { index: tagMatch.index ?? 0, kind: 'tag' as const, match: tagMatch } : null,
          labelMatch
            ? { index: labelMatch.index ?? 0, kind: 'label' as const, match: labelMatch }
            : null,
          bareTagMatch
            ? { index: bareTagMatch.index ?? 0, kind: 'bare' as const, match: bareTagMatch }
            : null,
          fallbackMatch
            ? { index: fallbackMatch.start, kind: 'fallback' as const, match: fallbackMatch }
            : null,
        ]
          .filter(Boolean)
          .toSorted((a, b) => (a?.index ?? 0) - (b?.index ?? 0))[0] ?? null;

      if (!nextMatch) {
        if (final) {
          await appendVisible(buffered);
          buffered = '';
          return;
        }
        let start = lower.lastIndexOf('[slide');
        if (start === -1) {
          const bracket = lower.lastIndexOf('[');
          if (bracket !== -1) {
            const tail = lower.slice(bracket + 1).replaceAll(/\s+/g, '');
            if (tail === '' || 'slide'.startsWith(tail)) {
              start = bracket;
            }
          }
        }
        if (start === -1) {
          await appendVisible(buffered);
          buffered = '';
          return;
        }
        const head = buffered.slice(0, start);
        await appendVisible(head);
        buffered = buffered.slice(start);
        return;
      }
      const matchIndex = nextMatch.kind === 'fallback' ? nextMatch.match.start : nextMatch.index;
      const matchLength =
        nextMatch.kind === 'fallback'
          ? nextMatch.match.end - nextMatch.match.start + 1
          : nextMatch.match[0].length;
      const rawTag = buffered.slice(matchIndex, matchIndex + matchLength);
      const before = buffered.slice(0, matchIndex);
      const after = buffered.slice(matchIndex + matchLength);
      if (pendingSlide) {
        await appendVisible(before);
        await flushPendingSlide(true);
      } else {
        await appendVisible(before);
      }
      buffered = after;
      let index: number | null = null;
      if (nextMatch.kind === 'fallback') {
        const digitMatch = /(\d+)/.exec(rawTag);
        index = digitMatch ? Number.parseInt(digitMatch[1] ?? '', 10) : null;
      } else {
        const rawIndex =
          nextMatch.kind === 'tag'
            ? nextMatch.match[1]
            : (nextMatch.kind === 'label'
              ? (nextMatch.match[2] ?? nextMatch.match[1])
              : nextMatch.match[1]);
        index = Number.parseInt(rawIndex ?? '', 10);
      }
      if (debugWrite) {
        debugWrite(
          `slides marker: ${nextMatch.kind} raw=${JSON.stringify(rawTag)} index=${index ?? 'null'}\n`,
        );
      }
      if (Number.isFinite(index) && (index ?? 0) > 0) {
        if (getSlideMeta) {
          pendingSlide = { buffer: '', index: index! };
        } else {
          await renderSlideBlock(index!, null);
        }
      }
    }
  };

  return {
    onChunk: async ({ appended }) => {
      if (!appended) {return;}
      buffered += appended;
      await flushBuffered({ final: false });
    },
    onDone: async () => {
      await flushBuffered({ final: true });
      if (pendingSlide) {
        await flushPendingSlide(true);
      }
      const ordered = getSlideIndexOrder();
      for (const index of ordered) {
        if (!renderedSlides.has(index)) {
          await renderSlideBlock(index, null);
        }
      }
      if (outputGate) {
        outputGate.finalize(visible);
        return;
      }
      const out = streamer?.finish();
      if (out) {
        clearProgressForStdout();
        if (!wroteLeadingBlankLine) {
          stdout.write(`\n${out.replace(/^\n+/, '')}`);
          wroteLeadingBlankLine = true;
        } else {
          stdout.write(out);
        }
        restoreProgressAfterStdout?.();
      } else if (visible && !wroteLeadingBlankLine) {
        clearProgressForStdout();
        stdout.write(`\n${visible.trim()}\n`);
        restoreProgressAfterStdout?.();
      }
    },
  };
}
