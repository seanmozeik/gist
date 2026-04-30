import type { TranscriptionConfig } from '../transcription-config.js';
import type { ProviderResult, TranscriptSource } from '../types.js';
import {
  resolveTranscriptionAvailability,
  type TranscriptionAvailability,
} from './transcription-start.js';

const MISSING_PROVIDER_NOTE =
  'No transcription provider available. Set GIST_LOCAL_BASE_URL or OPENROUTER_API_KEY.';

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
  const availability = await resolveTranscriptionAvailability({ env: transcription.env });
  return {
    availability,
    canRunYtDlp: Boolean(ytDlpPath && availability.hasAnyProvider),
    canTranscribe: availability.hasAnyProvider,
    missingProviderNote: MISSING_PROVIDER_NOTE,
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
    notes: [MISSING_PROVIDER_NOTE, ...notes].join('; '),
    source: null,
    text: null,
  };
}
