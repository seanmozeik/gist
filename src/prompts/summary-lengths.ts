import type { SummaryLength } from '../shared/contracts.js';

export interface SummaryLengthSpec {
  guidance: string;
  formatting: string;
  targetCharacters: number;
  minCharacters: number;
  maxCharacters: number;
  maxTokens: number;
}

export const SUMMARY_LENGTH_SPECS: Record<SummaryLength, SummaryLengthSpec> = {
  long: {
    formatting:
      'Paragraphs are optional; use up to 3 short paragraphs. Aim for 2-4 sentences per paragraph when you split into paragraphs.',
    guidance:
      'Write a detailed summary that prioritizes the most important points first, followed by key supporting facts or events, then secondary details or conclusions stated in the source.',
    maxCharacters: 6000,
    maxTokens: 3072,
    minCharacters: 2500,
    targetCharacters: 4200,
  },
  medium: {
    formatting:
      'Use 1-3 short paragraphs (2 is typical, but a single paragraph is okay if the content is simple). Aim for 2-3 sentences per paragraph.',
    guidance:
      'Write a clear summary that covers the core claim plus the most important supporting evidence or data points.',
    maxCharacters: 2500,
    maxTokens: 1536,
    minCharacters: 1200,
    targetCharacters: 1800,
  },
  short: {
    formatting:
      'Use 1-2 short paragraphs (a single paragraph is fine). Aim for 2-5 sentences total.',
    guidance:
      'Write a tight summary that delivers the primary claim plus one high-signal supporting detail.',
    maxCharacters: 1200,
    maxTokens: 768,
    minCharacters: 600,
    targetCharacters: 900,
  },
  xl: {
    formatting: 'Use 2-5 short paragraphs. Aim for 2-4 sentences per paragraph.',
    guidance:
      'Write a detailed summary that captures the main points, supporting facts, and concrete numbers or quotes when present.',
    maxCharacters: 14_000,
    maxTokens: 6144,
    minCharacters: 6000,
    targetCharacters: 9000,
  },
  xxl: {
    formatting: 'Use 3-7 short paragraphs. Aim for 2-4 sentences per paragraph.',
    guidance:
      'Write a comprehensive summary that covers background, main points, evidence, and stated outcomes in the source text; avoid adding implications or recommendations unless explicitly stated.',
    maxCharacters: 22_000,
    maxTokens: 12_288,
    minCharacters: 14_000,
    targetCharacters: 17_000,
  },
};

const formatCount = (value: number): string => value.toLocaleString();

export const SUMMARY_LENGTH_TO_TOKENS: Record<SummaryLength, number> = Object.fromEntries(
  Object.entries(SUMMARY_LENGTH_SPECS).map(([key, spec]) => [key, spec.maxTokens]),
) as Record<SummaryLength, number>;

export const SUMMARY_LENGTH_TARGET_CHARACTERS: Record<SummaryLength, number> = Object.fromEntries(
  Object.entries(SUMMARY_LENGTH_SPECS).map(([key, spec]) => [key, spec.targetCharacters]),
) as Record<SummaryLength, number>;

export const SUMMARY_LENGTH_MAX_CHARACTERS: Record<SummaryLength, number> = Object.fromEntries(
  Object.entries(SUMMARY_LENGTH_SPECS).map(([key, spec]) => [key, spec.maxCharacters]),
) as Record<SummaryLength, number>;

export function resolveSummaryLengthSpec(length: SummaryLength): SummaryLengthSpec {
  // SummaryLength is a contracts-enforced enum in all call sites; suppress generic injection warning.
  // eslint-disable-next-line security/detect-object-injection
  return SUMMARY_LENGTH_SPECS[length];
}

export function formatPresetLengthGuidance(length: SummaryLength): string {
  const spec = resolveSummaryLengthSpec(length);
  return `Target length: around ${formatCount(spec.targetCharacters)} characters (acceptable range ${formatCount(spec.minCharacters)}-${formatCount(spec.maxCharacters)}). This is a soft guideline; prioritize clarity.`;
}
