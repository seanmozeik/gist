import type { ProviderResult } from '../../types';
import type { TranscriptionResult } from './media';

export function joinNotes(notes: string[]): string | null {
  return notes.length > 0 ? notes.join('; ') : null;
}

export function buildWhisperResult({
  attemptedProviders,
  notes,
  outcome,
  metadata,
  includeProviderOnFailure = false,
}: {
  attemptedProviders: ProviderResult['attemptedProviders'];
  notes: string[];
  outcome: TranscriptionResult;
  metadata: Record<string, unknown>;
  includeProviderOnFailure?: boolean;
}): ProviderResult {
  if (outcome.text) {
    return {
      attemptedProviders,
      metadata: { ...metadata, transcriptionProvider: outcome.provider },
      notes: joinNotes(notes),
      source: 'whisper',
      text: outcome.text,
    };
  }

  const failureMetadata =
    includeProviderOnFailure && outcome.provider
      ? { ...metadata, transcriptionProvider: outcome.provider }
      : metadata;

  return {
    attemptedProviders,
    metadata: failureMetadata,
    notes: outcome.error?.message ?? null,
    source: null,
    text: null,
  };
}
