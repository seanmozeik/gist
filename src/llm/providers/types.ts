import type { ModelRequestOptions } from '../model-options.js';

export interface OpenAiClientConfig {
  apiKey: string;
  baseURL?: string;
  useChatCompletions: boolean;
  isOpenRouter: boolean;
  extraHeaders?: Record<string, string>;
  requestOptions?: ModelRequestOptions;
}
