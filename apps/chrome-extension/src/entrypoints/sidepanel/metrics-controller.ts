import { buildMetricsParts, buildMetricsTokens } from '../../lib/metrics';

export type MetricsMode = 'summary' | 'chat';

interface MetricsState {
  summary: string | null;
  inputSummary: string | null;
  sourceUrl: string | null;
}

interface MetricsRenderState {
  summary: string | null;
  inputSummary: string | null;
  sourceUrl: string | null;
  shortened: boolean;
  rafId: number | null;
  observer: ResizeObserver | null;
}

function getLineHeightPx(el: HTMLElement, styles?: CSSStyleDeclaration): number {
  const resolved = styles ?? getComputedStyle(el);
  const lineHeightRaw = resolved.lineHeight;
  const fontSize = Number.parseFloat(resolved.fontSize) || 0;
  if (lineHeightRaw === 'normal') {return fontSize * 1.2;}
  const parsed = Number.parseFloat(lineHeightRaw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function elementWrapsToMultipleLines(el: HTMLElement): boolean {
  if (el.getClientRects().length === 0) {return false;}
  const styles = getComputedStyle(el);
  const lineHeight = getLineHeightPx(el, styles);
  if (!lineHeight) {return false;}

  const paddingTop = Number.parseFloat(styles.paddingTop) || 0;
  const paddingBottom = Number.parseFloat(styles.paddingBottom) || 0;
  const borderTop = Number.parseFloat(styles.borderTopWidth) || 0;
  const borderBottom = Number.parseFloat(styles.borderBottomWidth) || 0;
  const totalHeight = el.getBoundingClientRect().height;
  const contentHeight = Math.max(
    0,
    totalHeight - paddingTop - paddingBottom - borderTop - borderBottom,
  );

  return contentHeight > lineHeight * 1.4;
}

export function createMetricsController({
  metricsEl,
  metricsHomeEl,
  chatMetricsSlotEl,
}: {
  metricsEl: HTMLDivElement;
  metricsHomeEl: HTMLDivElement;
  chatMetricsSlotEl: HTMLDivElement;
}) {
  const renderState: MetricsRenderState = {
    inputSummary: null,
    observer: null,
    rafId: null,
    shortened: false,
    sourceUrl: null,
    summary: null,
  };

  const metricsByMode: Record<MetricsMode, MetricsState> = {
    chat: { inputSummary: null, sourceUrl: null, summary: null },
    summary: { inputSummary: null, sourceUrl: null, summary: null },
  };

  let activeMode: MetricsMode = 'summary';
  let metricsMeasureEl: HTMLDivElement | null = null;

  const ensureMetricsMeasureEl = (): HTMLDivElement => {
    if (metricsMeasureEl) {return metricsMeasureEl;}
    const el = document.createElement('div');
    el.style.position = 'absolute';
    el.style.visibility = 'hidden';
    el.style.pointerEvents = 'none';
    el.style.left = '-99999px';
    el.style.top = '0';
    el.style.padding = '0';
    el.style.border = '0';
    el.style.margin = '0';
    el.style.whiteSpace = 'normal';
    el.style.boxSizing = 'content-box';
    document.body.append(el);
    metricsMeasureEl = el;
    return el;
  };

  const syncMetricsMeasureStyles = () => {
    if (!metricsMeasureEl) {return;}
    const styles = getComputedStyle(metricsEl);
    metricsMeasureEl.style.fontFamily = styles.fontFamily;
    metricsMeasureEl.style.fontSize = styles.fontSize;
    metricsMeasureEl.style.fontWeight = styles.fontWeight;
    metricsMeasureEl.style.fontStyle = styles.fontStyle;
    metricsMeasureEl.style.fontVariant = styles.fontVariant;
    metricsMeasureEl.style.lineHeight = styles.lineHeight;
    metricsMeasureEl.style.letterSpacing = styles.letterSpacing;
    metricsMeasureEl.style.wordSpacing = styles.wordSpacing;
    metricsMeasureEl.style.textTransform = styles.textTransform;
    metricsMeasureEl.style.textIndent = styles.textIndent;
    metricsMeasureEl.style.wordBreak = styles.wordBreak;
    metricsMeasureEl.style.whiteSpace = styles.whiteSpace;
    metricsMeasureEl.style.width = `${metricsEl.clientWidth}px`;
  };

  const renderSummary = (
    summary: string,
    options?: {
      shortenOpenRouter?: boolean;
      inputSummary?: string | null;
      sourceUrl?: string | null;
    },
  ) => {
    metricsEl.replaceChildren();
    const tokens = buildMetricsTokens({
      inputSummary: options?.inputSummary ?? renderState.inputSummary,
      shortenOpenRouter: options?.shortenOpenRouter ?? false,
      sourceUrl: options?.sourceUrl ?? renderState.sourceUrl,
      summary,
    });

    tokens.forEach((token, index) => {
      if (index) {metricsEl.append(document.createTextNode(' · '));}
      if (token.kind === 'link') {
        const link = document.createElement('a');
        link.href = token.href;
        link.textContent = token.text;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        metricsEl.append(link);
        return;
      }
      if (token.kind === 'media') {
        if (token.before) {metricsEl.append(document.createTextNode(token.before));}
        const link = document.createElement('a');
        link.href = token.href;
        link.textContent = token.label;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        metricsEl.append(link);
        if (token.after) {metricsEl.append(document.createTextNode(token.after));}
        return;
      }
      metricsEl.append(document.createTextNode(token.text));
    });
  };

  const scheduleFitCheck = () => {
    if (!renderState.summary) {return;}
    if (renderState.rafId != null) {return;}
    renderState.rafId = window.requestAnimationFrame(() => {
      renderState.rafId = null;
      if (!renderState.summary) {return;}
      const parts = buildMetricsParts({
        inputSummary: renderState.inputSummary,
        summary: renderState.summary,
      });
      if (parts.length === 0) {return;}
      const fullText = parts.join(' · ');
      if (!/\bopenrouter\//i.test(fullText)) {return;}
      if (metricsEl.clientWidth <= 0) {return;}
      const measureEl = ensureMetricsMeasureEl();
      syncMetricsMeasureStyles();
      measureEl.textContent = fullText;
      const shouldShorten = elementWrapsToMultipleLines(measureEl);
      if (shouldShorten === renderState.shortened) {return;}
      renderState.shortened = shouldShorten;
      renderSummary(renderState.summary, {
        inputSummary: renderState.inputSummary,
        shortenOpenRouter: shouldShorten,
        sourceUrl: renderState.sourceUrl,
      });
    });
  };

  const ensureObserver = () => {
    if (renderState.observer) {return;}
    renderState.observer = new ResizeObserver(() => {
      scheduleFitCheck();
    });
    renderState.observer.observe(metricsEl);
  };

  const moveTo = (mode: MetricsMode) => {
    const target = mode === 'chat' ? chatMetricsSlotEl : metricsHomeEl;
    if (metricsEl.parentElement !== target) {
      target.append(metricsEl);
    }
    activeMode = mode;
  };

  const renderMode = (mode: MetricsMode) => {
    const state = metricsByMode[mode];
    renderState.summary = state.summary;
    renderState.inputSummary = state.inputSummary;
    renderState.sourceUrl = state.sourceUrl;
    renderState.shortened = false;

    if (mode === 'chat') {
      chatMetricsSlotEl.classList.toggle('isVisible', Boolean(state.summary));
    } else {
      chatMetricsSlotEl.classList.remove('isVisible');
    }

    metricsEl.removeAttribute('title');
    delete metricsEl.dataset.details;

    if (!state.summary) {
      metricsEl.textContent = '';
      metricsEl.classList.add('hidden');
      return;
    }

    renderSummary(state.summary, { inputSummary: state.inputSummary, sourceUrl: state.sourceUrl });
    metricsEl.classList.remove('hidden');
    ensureObserver();
    scheduleFitCheck();
  };

  return {
    clearForMode(mode: MetricsMode) {
      this.setForMode(mode, null, null, null);
    },
    setActiveMode(mode: MetricsMode) {
      moveTo(mode);
      renderMode(mode);
    },
    setForMode(
      mode: MetricsMode,
      summary: string | null,
      inputSummary: string | null,
      sourceUrl: string | null,
    ) {
      metricsByMode[mode] = { inputSummary, sourceUrl, summary };
      if (activeMode === mode) {
        renderMode(mode);
      }
    },
  };
}
