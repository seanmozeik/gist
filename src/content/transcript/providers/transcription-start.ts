import type { TranscriptionProviderHint } from '../../link-preview/deps';

type Env = Record<string, string | undefined>;

export interface TranscriptionAvailability {
  hasSidecar: boolean;
  hasOpenRouter: boolean;
  hasAnyProvider: boolean;
  effectiveEnv: Env;
}

export async function resolveTranscriptionAvailability({
  env,
}: {
  env?: Env;
}): Promise<TranscriptionAvailability> {
  const effectiveEnv = env ?? process.env;
  const hasSidecar = Boolean(effectiveEnv.GIST_LOCAL_BASE_URL);
  const hasOpenRouter = Boolean(effectiveEnv.OPENROUTER_API_KEY);
  const hasAnyProvider = hasSidecar || hasOpenRouter;

  return { effectiveEnv, hasAnyProvider, hasOpenRouter, hasSidecar };
}

export async function resolveTranscriptionStartInfo({
  env,
}: {
  env?: Env;
}): Promise<{
  availability: TranscriptionAvailability;
  providerHint: TranscriptionProviderHint;
  modelId: string | null;
}> {
  const availability = await resolveTranscriptionAvailability({ env });

  const providerHint: TranscriptionProviderHint = availability.hasSidecar
    ? 'sidecar'
    : (availability.hasOpenRouter
      ? 'openrouter'
      : 'unknown');
  const modelId = availability.hasSidecar
    ? 'sidecar'
    : (availability.hasOpenRouter
      ? (availability.effectiveEnv.GIST_TRANSCRIPTION_MODEL ?? 'openai/whisper-1')
      : null);

  return { availability, modelId, providerHint };
}
