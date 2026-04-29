import type { AssistantMessage, Tool } from '@mariozechner/pi-ai';
import { completeSimple, streamSimple } from '@mariozechner/pi-ai';

import { buildPromptHash } from '../cache.js';
import { resolveAgentModel, resolveApiKeyForModel } from './agent-model.js';
import {
  buildSystemPrompt,
  flattenAgentForCli,
  getAgentPrompt,
  normalizeMessages,
  resolveToolList,
} from './agent-request.js';

export function buildAgentPromptHash(automationEnabled: boolean): string {
  return buildPromptHash(getAgentPrompt(automationEnabled));
}

const TOOL_DEFINITIONS: Record<string, Tool> = {
  artifacts: {
    description:
      'Create, read, update, list, or delete session artifacts (notes, CSVs, JSON, binary files).',
    name: 'artifacts',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'get', 'create', 'update', 'delete'],
          description: 'Action to perform',
        },
        fileName: {
          type: 'string',
          description: 'Artifact filename (required for get/create/update/delete)',
        },
        content: {
          type: 'string',
          description:
            'Text content to store. For JSON/arrays/numbers/booleans/null, pass serialized JSON as a string.',
        },
        mimeType: { type: 'string', description: 'Optional MIME type override' },
        contentBase64: { type: 'string', description: 'Base64 payload for binary files' },
        asBase64: {
          type: 'boolean',
          description: 'Return base64 payload for get action instead of parsed text/JSON',
        },
      },
      required: ['action'],
    } as unknown as Tool['parameters'],
  },
  ask_user_which_element: {
    description: 'Ask the user to click the desired element in the page.',
    name: 'ask_user_which_element',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        message: { type: 'string', description: 'Optional instruction shown to the user' },
      },
    } as unknown as Tool['parameters'],
  },
  debugger: {
    description:
      'Run JavaScript in the main world via the Chrome debugger. LAST RESORT; shows a banner to the user.',
    name: 'debugger',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['eval'], description: 'Action to perform' },
        code: { type: 'string', description: 'JavaScript to evaluate in the main world' },
      },
      required: ['action', 'code'],
    } as unknown as Tool['parameters'],
  },
  navigate: {
    description:
      'Navigate the active tab to a URL, list open tabs, or switch tabs. Use this for ALL navigation. Never use window.location/history in code.',
    name: 'navigate',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        url: { type: 'string', description: 'URL to navigate to' },
        newTab: { type: 'boolean', description: 'Open in a new tab', default: false },
        listTabs: { type: 'boolean', description: 'List open tabs in the current window' },
        switchToTab: { type: 'number', description: 'Tab ID to switch to' },
      },
    } as unknown as Tool['parameters'],
  },
  repl: {
    description:
      'Execute JavaScript in a sandbox. Helpers: browserjs(fn), navigate(), sleep(ms), returnFile(), createOrUpdateArtifact(), getArtifact(), listArtifacts(), deleteArtifact().',
    name: 'repl',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string', description: 'Short description of the code intent' },
        code: { type: 'string', description: 'JavaScript code to execute' },
      },
      required: ['title', 'code'],
    } as unknown as Tool['parameters'],
  },
  skill: {
    description:
      'Create, update, list, or delete domain-specific automation libraries that auto-inject into browserjs().',
    name: 'skill',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: {
          type: 'string',
          enum: ['get', 'list', 'create', 'rewrite', 'update', 'delete'],
          description: 'Action to perform',
        },
        name: {
          type: 'string',
          description: 'Skill name (required for get/rewrite/update/delete)',
        },
        url: {
          type: 'string',
          description:
            'URL to filter skills by (optional for list action; defaults to current tab)',
        },
        includeLibraryCode: {
          type: 'boolean',
          description:
            'Use with get action to include library code in output (only needed when editing library code).',
        },
        data: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', description: 'Unique skill name' },
            domainPatterns: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Glob-like domain patterns (e.g., ["github.com", "github.com/*/issues"])',
            },
            shortDescription: { type: 'string', description: 'One-line description' },
            description: { type: 'string', description: 'Full markdown description' },
            examples: { type: 'string', description: 'Plain JavaScript examples' },
            library: { type: 'string', description: 'JavaScript library code to inject' },
          },
        },
        updates: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: {
              type: 'object',
              properties: { old_string: { type: 'string' }, new_string: { type: 'string' } },
            },
            shortDescription: {
              type: 'object',
              properties: { old_string: { type: 'string' }, new_string: { type: 'string' } },
            },
            domainPatterns: {
              type: 'object',
              properties: { old_string: { type: 'string' }, new_string: { type: 'string' } },
            },
            description: {
              type: 'object',
              properties: { old_string: { type: 'string' }, new_string: { type: 'string' } },
            },
            examples: {
              type: 'object',
              properties: { old_string: { type: 'string' }, new_string: { type: 'string' } },
            },
            library: {
              type: 'object',
              properties: { old_string: { type: 'string' }, new_string: { type: 'string' } },
            },
          },
        },
      },
      required: ['action'],
    } as unknown as Tool['parameters'],
  },
  summarize: {
    description:
      'Run Summarize on a URL (summary or extract-only). Use extractOnly + format=markdown to return Markdown.',
    name: 'summarize',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        url: { type: 'string', description: 'URL to summarize (defaults to active tab)' },
        extractOnly: {
          type: 'boolean',
          description: 'Extract content only (no summary)',
          default: false,
        },
        format: {
          type: 'string',
          enum: ['text', 'markdown'],
          description: 'Extraction format when extractOnly is true (default: text)',
        },
        markdownMode: {
          type: 'string',
          enum: ['off', 'auto', 'llm', 'readability'],
          description: 'Markdown conversion mode (only when format=markdown)',
        },
        model: { type: 'string', description: 'Model override (e.g. openai/gpt-5-mini)' },
        length: { type: 'string', description: 'Summary length (short|medium|long|xl|...)' },
        language: { type: 'string', description: 'Output language (auto or tag)' },
        prompt: { type: 'string', description: 'Prompt override' },
        timeout: { type: 'string', description: 'Timeout (e.g. 30s, 2m)' },
        maxOutputTokens: { type: 'string', description: 'Max output tokens (e.g. 2k)' },
        noCache: { type: 'boolean', description: 'Bypass cache' },
        firecrawl: {
          type: 'string',
          enum: ['off', 'auto', 'always'],
          description: 'Firecrawl mode',
        },
        preprocess: {
          type: 'string',
          enum: ['off', 'auto', 'always'],
          description: 'Preprocess/markitdown mode',
        },
        youtube: {
          type: 'string',
          enum: ['auto', 'web', 'yt-dlp', 'apify', 'no-auto'],
          description: 'YouTube transcript mode',
        },
        videoMode: {
          type: 'string',
          enum: ['auto', 'transcript', 'understand'],
          description: 'Video mode',
        },
        timestamps: { type: 'boolean', description: 'Include transcript timestamps' },
        forceSummary: {
          type: 'boolean',
          description: 'Force LLM summary even when content is shorter than requested length',
        },
        maxCharacters: { type: 'number', description: 'Max characters for extraction' },
      },
    } as unknown as Tool['parameters'],
  },
};

export async function streamAgentResponse({
  env,
  pageUrl,
  pageTitle,
  pageContent,
  messages,
  modelOverride,
  tools,
  automationEnabled,
  onChunk,
  onAssistant,
  signal,
}: {
  env: Record<string, string | undefined>;
  pageUrl: string;
  pageTitle: string | null;
  pageContent: string;
  messages: unknown;
  modelOverride: string | null;
  tools: string[];
  automationEnabled: boolean;
  onChunk: (text: string) => void;
  onAssistant: (assistant: AssistantMessage) => void;
  signal?: AbortSignal;
}): Promise<void> {
  const normalizedMessages = normalizeMessages(messages);
  const toolList = resolveToolList(automationEnabled, tools, TOOL_DEFINITIONS);

  const systemPrompt = buildSystemPrompt({ automationEnabled, pageContent, pageTitle, pageUrl });

  const resolved = await resolveAgentModel({ env, modelOverride, pageContent });

  if ('transport' in resolved && resolved.transport === 'cli') {
    const prompt = flattenAgentForCli({ messages: normalizedMessages, systemPrompt });
    const result = await import('../llm/cli.js').then(({ runCliModel }) =>
      runCliModel({
        allowTools: false,
        config: resolved.cliConfig,
        env,
        model: resolved.cliModel,
        prompt,
        provider: resolved.cliProvider,
        timeoutMs: 120_000,
      }),
    );
    onChunk(result.text);
    onAssistant({ content: result.text, role: 'assistant' } as unknown as AssistantMessage);
    return;
  }

  const { provider, model, maxOutputTokens, apiKeys } = resolved;
  const apiKey = resolveApiKeyForModel({ apiKeys, provider });

  const stream = streamSimple(
    model,
    { messages: normalizedMessages, systemPrompt, tools: toolList },
    { apiKey, maxTokens: maxOutputTokens, signal },
  );

  let assistant: AssistantMessage | null = null;
  for await (const event of stream) {
    if (event.type === 'text_delta') {
      onChunk(event.delta);
    } else if (event.type === 'done') {
      assistant = event.message;
      break;
    } else if (event.type === 'error') {
      const message = event.error?.errorMessage ?? 'Agent stream failed.';
      throw new Error(message);
    }
  }

  assistant ??= await stream.result().catch(() => null);

  if (!assistant) {
    throw new Error('Agent stream ended without a result.');
  }

  onAssistant(assistant);
}

export async function completeAgentResponse({
  env,
  pageUrl,
  pageTitle,
  pageContent,
  messages,
  modelOverride,
  tools,
  automationEnabled,
}: {
  env: Record<string, string | undefined>;
  pageUrl: string;
  pageTitle: string | null;
  pageContent: string;
  messages: unknown;
  modelOverride: string | null;
  tools: string[];
  automationEnabled: boolean;
}): Promise<AssistantMessage> {
  const normalizedMessages = normalizeMessages(messages);
  const toolList = resolveToolList(automationEnabled, tools, TOOL_DEFINITIONS);

  const systemPrompt = buildSystemPrompt({ automationEnabled, pageContent, pageTitle, pageUrl });

  const resolved = await resolveAgentModel({ env, modelOverride, pageContent });

  if ('transport' in resolved && resolved.transport === 'cli') {
    const prompt = flattenAgentForCli({ messages: normalizedMessages, systemPrompt });
    const result = await import('../llm/cli.js').then(({ runCliModel }) =>
      runCliModel({
        allowTools: false,
        config: resolved.cliConfig,
        env,
        model: resolved.cliModel,
        prompt,
        provider: resolved.cliProvider,
        timeoutMs: 120_000,
      }),
    );
    return { content: result.text, role: 'assistant' } as unknown as AssistantMessage;
  }

  const { provider, model, maxOutputTokens, apiKeys } = resolved;
  const apiKey = resolveApiKeyForModel({ apiKeys, provider });

  const assistant = await completeSimple(
    model,
    { messages: normalizedMessages, systemPrompt, tools: toolList },
    { apiKey, maxTokens: maxOutputTokens },
  );

  return assistant;
}
