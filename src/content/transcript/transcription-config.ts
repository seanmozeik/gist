import {
  resolveAssemblyAiApiKey,
  resolveFalApiKey,
  resolveGeminiApiKey,
  resolveGroqApiKey,
  resolveOpenAiTranscriptionApiKey,
} from '../../transcription/whisper/provider-setup.js';

export interface TranscriptionConfig {
  env?: Record<string, string | undefined>;
  groqApiKey: string | null;
  assemblyaiApiKey: string | null;
  geminiApiKey: string | null;
  openaiApiKey: string | null;
  falApiKey: string | null;
  geminiModel: string | null;
}

interface TranscriptionConfigInput {
  env?: Record<string, string | undefined>;
  transcription?: Partial<TranscriptionConfig> | null;
  groqApiKey?: string | null;
  assemblyaiApiKey?: string | null;
  geminiApiKey?: string | null;
  openaiApiKey?: string | null;
  falApiKey?: string | null;
  geminiModel?: string | null;
}

function normalizeKey(raw: string | null | undefined): string | null {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveTranscriptionConfig(input: TranscriptionConfigInput): TranscriptionConfig {
  const fromObject = input.transcription ?? null;
  const env = fromObject?.env ?? input.env;
  return {
    assemblyaiApiKey: resolveAssemblyAiApiKey({
      assemblyaiApiKey: fromObject?.assemblyaiApiKey ?? input.assemblyaiApiKey,
      env,
    }),
    env,
    falApiKey: resolveFalApiKey({ env, falApiKey: fromObject?.falApiKey ?? input.falApiKey }),
    geminiApiKey: resolveGeminiApiKey({
      env,
      geminiApiKey: fromObject?.geminiApiKey ?? input.geminiApiKey,
    }),
    geminiModel: normalizeKey(fromObject?.geminiModel ?? input.geminiModel),
    groqApiKey: resolveGroqApiKey({ env, groqApiKey: fromObject?.groqApiKey ?? input.groqApiKey }),
    openaiApiKey: resolveOpenAiTranscriptionApiKey({
      env,
      openaiApiKey: fromObject?.openaiApiKey ?? input.openaiApiKey,
    }),
  };
}
