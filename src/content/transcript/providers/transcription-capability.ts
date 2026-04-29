import { buildMissingTranscriptionProviderNote } from '../../../transcription/whisper/provider-setup.js';
import type { TranscriptionConfig } from '../transcription-config.js';
import type { ProviderResult, TranscriptSource } from '../types.js';
import {
  resolveTranscriptionAvailability,
  type TranscriptionAvailability,
} from './transcription-start.js';

export interface TranscriptProviderCapabilities {
  availability: TranscriptionAvailability;
  canTranscribe: boolean;
  canRunYtDlp: boolean;
  missingProviderNote: string;
}

export async function resolveTranscriptProviderCapabilities({
  transcription,
  ytDlpPath,
}: {
  transcription: TranscriptionConfig;
  ytDlpPath?: string | null;
}): Promise<TranscriptProviderCapabilities> {
  const availability = await resolveTranscriptionAvailability({ transcription });
  return {
    availability,
    canRunYtDlp: Boolean(ytDlpPath && availability.hasAnyProvider),
    canTranscribe: availability.hasAnyProvider,
    missingProviderNote: buildMissingTranscriptionProviderNote(),
  };
}

export function buildMissingTranscriptionProviderResult(args: {
  attemptedProviders: TranscriptSource[];
  metadata: NonNullable<ProviderResult['metadata']>;
  notes?: string[] | null;
}): ProviderResult {
  const notes = args.notes?.filter((note) => note.trim().length > 0) ?? [];
  return {
    attemptedProviders: args.attemptedProviders,
    metadata: args.metadata,
    notes: [buildMissingTranscriptionProviderNote(), ...notes].join('; '),
    source: null,
    text: null,
  };
}
