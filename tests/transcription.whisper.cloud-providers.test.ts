import { describe, expect, it } from 'vitest';

import { ASSEMBLYAI_TRANSCRIPTION_MODEL_ID } from '../packages/core/src/transcription/whisper/assemblyai.js';
import {
  buildCloudModelIdChain,
  buildCloudProviderHint,
  cloudProviderLabel,
  formatCloudFallbackTargets,
  resolveCloudProviderOrder,
} from '../packages/core/src/transcription/whisper/cloud-providers.js';

describe('transcription/whisper cloud providers', () => {
  it('resolves cloud provider order from configured keys', () => {
    expect(
      resolveCloudProviderOrder({
        assemblyaiApiKey: 'AAI',
        falApiKey: 'FAL',
        geminiApiKey: 'GEMINI',
        openaiApiKey: 'OPENAI',
      }),
    ).toEqual(['assemblyai', 'gemini', 'openai', 'fal']);
  });

  it('formats provider labels for fallback notes', () => {
    expect(cloudProviderLabel('openai', false)).toBe('Whisper/OpenAI');
    expect(formatCloudFallbackTargets(['assemblyai', 'gemini', 'openai'])).toBe(
      'AssemblyAI/Gemini/OpenAI',
    );
  });

  it('builds provider and model chains from availability', () => {
    expect(
      buildCloudProviderHint({
        hasAssemblyAi: true,
        hasFal: false,
        hasGemini: true,
        hasOpenai: true,
      }),
    ).toBe('assemblyai->gemini->openai');

    expect(
      buildCloudModelIdChain({
        availability: { hasAssemblyAi: true, hasFal: true, hasGemini: true, hasOpenai: true },
        geminiModelId: 'gemini-2.5-flash',
      }),
    ).toBe(
      `${ASSEMBLYAI_TRANSCRIPTION_MODEL_ID}->google/gemini-2.5-flash->whisper-1->fal-ai/wizper`,
    );
  });

  it('returns null chains when no cloud providers are available', () => {
    expect(
      buildCloudProviderHint({
        hasAssemblyAi: false,
        hasFal: false,
        hasGemini: false,
        hasOpenai: false,
      }),
    ).toBeNull();

    expect(
      buildCloudModelIdChain({
        availability: { hasAssemblyAi: false, hasFal: false, hasGemini: false, hasOpenai: false },
        geminiModelId: 'gemini-2.5-flash',
      }),
    ).toBeNull();
  });
});
