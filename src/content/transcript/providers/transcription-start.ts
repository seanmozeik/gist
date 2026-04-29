import type { TranscriptionProviderHint } from '../../link-preview/deps.js';

type Env = Record<string, string | undefined>;

export interface TranscriptionAvailability {
  hasSidecar: boolean;
  hasAnyProvider: boolean;
  effectiveEnv: Env;
}

export async function resolveTranscriptionAvailability({
  env,
}: {
  env?: Env;
}): Promise<TranscriptionAvailability> {
  const effectiveEnv = env ?? process.env;
  const hasSidecar = Boolean(effectiveEnv.SUMMARIZE_LOCAL_BASE_URL);
  const hasAnyProvider = hasSidecar;

  return { effectiveEnv, hasAnyProvider, hasSidecar };
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

  const providerHint: TranscriptionProviderHint = availability.hasSidecar ? 'sidecar' : 'unknown';
  const modelId = availability.hasSidecar ? 'sidecar' : null;

  return { availability, modelId, providerHint };
}
