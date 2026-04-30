import { formatCompactCount } from '../tty/format.js';

export interface ExtractDiagnosticsForFinishLine {
  strategy: 'bird' | 'html';
  markdown: { used: boolean; provider: 'llm' | null; notes?: string | null };
  transcript: { textProvided: boolean; provider: string | null };
}

export function buildExtractFinishLabel(args: {
  extracted: { diagnostics: ExtractDiagnosticsForFinishLine };
  format: 'text' | 'markdown';
  markdownMode: 'off' | 'auto' | 'llm' | 'readability';
  hasMarkdownLlmCall: boolean;
}): string {
  const base = args.format === 'markdown' ? 'markdown' : 'text';

  const transcriptProvided = args.extracted.diagnostics.transcript?.textProvided;
  if (transcriptProvided) {
    const provider = args.extracted.diagnostics.transcript?.provider;
    return provider ? `${base} via transcript/${provider}` : `${base} via transcript`;
  }

  if (args.format === 'markdown') {
    const strategy = args.extracted.diagnostics.strategy ?? '';
    if (strategy === 'html' && args.markdownMode === 'readability') {
      return `${base} via readability`;
    }

    const mdUsed = args.extracted.diagnostics.markdown?.used;
    const mdNotes = args.extracted.diagnostics.markdown.notes ?? null;

    if (mdUsed && mdNotes?.toLowerCase?.()?.includes('readability html used')) {
      return `${base} via readability`;
    }
    if (mdUsed) {
      if (args.markdownMode === 'readability') {
        return `${base} via readability`;
      }
      if (args.hasMarkdownLlmCall) {
        return `${base} via llm`;
      }
      return `${base} via markitdown`;
    }
  }

  const strategy = args.extracted.diagnostics.strategy ?? '';
  if (strategy === 'bird') {
    return `${base} via bird`;
  }
  return base;
}

export function buildSummaryFinishLabel(args: {
  extracted: { diagnostics: ExtractDiagnosticsForFinishLine; wordCount: number };
}): string | null {
  const strategy = args.extracted.diagnostics.strategy ?? '';
  const sources: string[] = [];
  if (strategy === 'bird') {
    sources.push('bird');
  }
  const transcriptProvided = args.extracted.diagnostics.transcript?.textProvided;
  const words =
    typeof args.extracted.wordCount === 'number' && Number.isFinite(args.extracted.wordCount)
      ? args.extracted.wordCount
      : 0;
  const wordLabel = words > 0 ? `${formatCompactCount(words)} words` : null;
  if (transcriptProvided) {
    if (sources.length === 0) {
      return null;
    }
    return `via ${sources.join('+')}`;
  }
  if (sources.length === 0 && !wordLabel) {
    return null;
  }
  if (wordLabel && sources.length > 0) {
    return `${wordLabel} via ${sources.join('+')}`;
  }
  if (wordLabel) {
    return wordLabel;
  }
  return `via ${sources.join('+')}`;
}
