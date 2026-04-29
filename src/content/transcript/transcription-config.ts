export interface TranscriptionConfig {
  env?: Record<string, string | undefined>;
}

interface TranscriptionConfigInput {
  env?: Record<string, string | undefined>;
  transcription?: Partial<TranscriptionConfig> | null;
}

export function resolveTranscriptionConfig(input: TranscriptionConfigInput): TranscriptionConfig {
  const fromObject = input.transcription ?? null;
  const env = fromObject?.env ?? input.env;
  return { env };
}
