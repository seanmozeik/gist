import type { TranscriptionConfig } from '../../transcription-config';
import type { ProviderContext, ProviderFetchOptions, ProviderResult } from '../../types';
import type { TranscribeRequest, TranscriptionResult } from './media';

export interface PodcastFlowContext {
  context: ProviderContext;
  options: ProviderFetchOptions;
  transcription: TranscriptionConfig;
  feedHtml: string | null;
  attemptedProviders: ProviderResult['attemptedProviders'];
  notes: string[];
  pushOnce: (provider: ProviderResult['attemptedProviders'][number]) => void;
  ensureTranscriptionProvider: () => ProviderResult | null;
  transcribe: (request: TranscribeRequest) => Promise<TranscriptionResult>;
}
