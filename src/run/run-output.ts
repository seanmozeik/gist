import type { LengthArg } from '../flags';
import { SUMMARY_LENGTH_MAX_CHARACTERS } from '../prompts/index';
import { resolveTargetCharacters } from './format';

export function resolveDesiredOutputTokens({
  lengthArg,
  maxOutputTokensArg,
}: {
  lengthArg: LengthArg;
  maxOutputTokensArg: number | null;
}): number | null {
  if (typeof maxOutputTokensArg === 'number') {
    return maxOutputTokensArg;
  }
  const targetChars = resolveTargetCharacters(lengthArg, SUMMARY_LENGTH_MAX_CHARACTERS);
  if (
    !Number.isFinite(targetChars) ||
    targetChars <= 0 ||
    targetChars === Number.POSITIVE_INFINITY
  ) {
    return null;
  }
  // Rough heuristic (chars → tokens). Used for auto selection + cost estimation.
  return Math.max(16, Math.ceil(targetChars / 4));
}
