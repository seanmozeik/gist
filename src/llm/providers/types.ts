import type { ModelRequestOptions } from '../model-options';

export interface OpenAiClientConfig {
  apiKey: string;
  baseURL?: string;
  useChatCompletions: boolean;
  isOpenRouter: boolean;
  extraHeaders?: Record<string, string>;
  requestOptions?: ModelRequestOptions;
}
