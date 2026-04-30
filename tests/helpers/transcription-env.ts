import { vi } from 'vitest';

const TRANSCRIPTION_ENV_VARS = [
  'GROQ_API_KEY',
  'ASSEMBLYAI_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'GOOGLE_API_KEY',
  'OPENAI_API_KEY',
  'FAL_KEY',
  'GIST_TRANSCRIBER',
  'GIST_ONNX_PARAKEET_CMD',
  'GIST_ONNX_CANARY_CMD',
] as const;

export function stubMissingTranscriptionEnv(): void {
  vi.stubEnv('GIST_DISABLE_LOCAL_WHISPER_CPP', '1');
  for (const name of TRANSCRIPTION_ENV_VARS) {
    vi.stubEnv(name, '');
  }
}
