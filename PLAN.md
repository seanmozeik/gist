# Gist Refactor Plan

## Goal

Strip summarize down to a single-package CLI focused on:

- **OpenRouter** for LLM summarization
- **Local sidecar** (`local/` prefix) for models at your MySacart endpoint
- **CLI magic** for Claude, Codex, Gemini, Cursor (via `--cli`)
- **Bird CLI wrapper** for Twitter/X content (your forked version)
- Web URL summarization, local file summarization, YouTube summarization

Kill: Chrome extension, daemon, slides, all direct provider integrations (Anthropic/Google/xAI/Z.AI/NVIDIA/GitHub), local model downloading, xurl.

---

## 1. Package Consolidation

### Before

```
gist/                          # root package (@seanmozeik/gist)
  packages/core/               # @seanmozeik/gist-core (content extraction + prompts)
  apps/chrome-extension/       # Chrome extension
```

### After

```
gist/                          # single package (@seanmozeik/gist)
  src/                         # everything flat
    cli.ts                     # entry point
    llm/                       # LLM generation (OpenRouter + local sidecar)
    run/                       # runner orchestration + flows
    content/                   # URL/file/stdin extraction
    config/                    # config parsing
    sidecar/                   # NEW: sidecar HTTP client
    tty/                       # progress/spinner/theme
    prompts/                   # prompt templates
  scripts/                     # build scripts
  tsconfig*.json               # simplified (no workspace references)
```

### Changes

- Delete `packages/core/` — inline its content into `src/content/` and `src/prompts/`
- Delete `apps/chrome-extension/` entirely
- Remove workspaces from root `package.json`
- Simplify build script: single `tsc -p tsconfig.build.json`, no core-first dependency
- Remove `@seanmozeik/gist-core` from dependencies
- Remove `patchedDependencies` (extension polyfills)

---

## 2. Provider Stripping — Only OpenRouter + Local Sidecar

### Model ID Resolution (`src/llm/model-id.ts`)

**Before:** `LlmProvider = 'xai' | 'openai' | 'google' | 'anthropic' | 'zai' | 'nvidia' | 'github-copilot'`
**After:** `LlmProvider = 'openrouter' | 'local'`

- `openrouter/meta/llama-3.1-8b-instruct` → OpenRouter API
- `local/model-name` → Sidecar base URL (configurable)
- Bare model IDs (no prefix) → default to `openrouter/` for backwards compat, or error with hint

### LLM Generation (`src/llm/generate-text.ts`)

**Before:** ~450 lines with branches for xai, google, anthropic, zai, nvidia, openai/github-copilot
**After:** ~150 lines with only two branches:

```typescript
if (parsed.provider === 'openrouter') {
  // Route through OpenRouter (uses existing completeOpenAiText with OpenRouter headers)
} else if (parsed.provider === 'local') {
  // POST to sidecar chat endpoint
} else {
  throw new Error(`Unknown provider: ${parsed.provider}`);
}
```

### LLM Stream (`src/llm/generate-text-stream.ts`)

Same simplification — only OpenRouter + local sidecar streaming.

### Files to DELETE from `src/llm/`

- `providers/anthropic.ts` — Anthropic provider
- `providers/google.ts` — Google/Gemini provider
- `github-models.ts` — GitHub Copilot backend
- `google-models.ts` — Gemini model resolution
- `provider-profile.ts` — gateway provider profiles (xai/zai/nvidia/etc)

### Files to KEEP in `src/llm/`

- `generate-text.ts` — rewrite, simplify
- `generate-text-stream.ts` — simplify
- `generate-text-document.ts` — keep (document handling)
- `generate-text-shared.ts` — keep (retry logic, temperature, etc.)
- `model-id.ts` — rewrite, simplify LlmProvider
- `model-options.ts` — keep (request options)
- `prompt.ts` — keep (Prompt type + helpers)
- `types.ts` — keep (LlmTokenUsage)
- `errors.ts` — keep
- `usage.ts` — keep (token usage normalization)
- `providers/openai.ts` — keep (OpenRouter uses OpenAI-compatible API)
- `providers/shared.ts` — keep (extractText helper)
- `providers/types.ts` — simplify (remove provider-specific types)
- `providers/models.ts` — rewrite (only resolveOpenAiModel for openrouter, resolveLocalModel for sidecar)
- `providers/provider-capabilities.ts` — simplify
- `cli-exec.ts` — keep (CLI provider subprocess exec)
- `cli-provider-output.ts` — keep (parse CLI output for Claude/Codex/Gemini)
- `cli.ts` — keep (runCliModel for --cli flag)

### API Keys Config (`src/config/types.ts`)

**Before:** `{ openai, nvidia, anthropic, google, xai, openrouter, zai, apify, firecrawl, fal, groq, assemblyai }`
**After:** `{ openrouter, apify, firecrawl }` (keep apify/firecrawl for URL fetching)

Remove: `openai`, `nvidia`, `anthropic`, `google`, `xai`, `zai`, `groq`, `assemblyai`.

### Config Types (`src/config/types.ts`)

**Delete from SummarizeConfig:**

- `openai` — remove (baseUrl, whisperUsdPerMinute, etc.)
- `nvidia` — remove
- `anthropic` — remove
- `google` — remove
- `xai` — remove
- `zai` — remove
- `cli` — keep but simplify (remove openclaw/opencode if not needed, keep claude/codex/gemini/agent)

**Add to SummarizeConfig:**

```typescript
interface LocalConfig {
  baseUrl: string; // e.g. "http://localhost:11434" or "http://sidecar:8080"
  transcriptionEndpoint?: string; // default "/api/transcribe"
  chatEndpoint?: string; // default "/api/chat"
}

interface SummarizeConfig {
  model?: ModelConfig;
  local?: LocalConfig; // NEW
  // ... rest stays (language, prompt, cache, output, ui, logging)
}
```

### Config Sections Parsing (`src/config/sections.ts`)

- Remove `parseOpenAiConfig`, `parseNvidiaConfig`, `parseAnthropicConfig`, `parseGoogleConfig`, `parseXaiConfig`, `parseZaiConfig`
- Add `parseLocalConfig`

---

## 3. CLI Magic — Keep Claude/Codex/Gemini/Cursor

### Model ID prefix: `cli/<provider>/<model>`

Providers kept: `claude`, `codex`, `gemini`, `agent` (Cursor).
Remove from config/types: `openclaw`, `opencode`.

### Files to KEEP

- `src/llm/cli.ts` — runCliModel (spawns claude/codex/gemini CLIs)
- `src/llm/cli-exec.ts` — subprocess exec with tracking
- `src/llm/cli-provider-output.ts` — parse JSON output from CLI providers
- `src/run/env.ts` — hasCliAvailability, parseCliProviderArg (simplified)
- `src/run/cli-fallback-state.ts` — auto-fallback state persistence

### Files to SIMPLIFY in config/types.ts

- `CliProvider` = `'claude' | 'codex' | 'gemini' | 'agent'`
- `CliConfig` — keep claude/codex/gemini/agent, remove openclaw/opencode
- `DEFAULT_CLI_MODELS` — keep for kept providers only
- `DEFAULT_AUTO_CLI_ORDER` — keep for kept providers only

---

## 4. Bird CLI Wrapper — Your Fork

### How it works today

Summarize wraps two CLIs via subprocess:

1. **xurl** — reads tweets from X GraphQL API → **DELETE entirely**
2. **bird** — calls `bird read <tweet-url> --json-full` → **KEEP, wraps your fork**

### Your Bird fork at `/tmp/imports/bird.tar.gz`

Interface is identical: `bird read <tweet-id-or-url> --json-full`. Same JSON output shape. No arg changes needed.

Bird CLI supports: `read`, `replies`, `thread`, `search`, `mentions`, `bookmarks`, `post`, `tweet`, `reply`, `home`, `user-tweets`, `search`, `follow`, etc. Summarize only needs `read` for now.

### New Bird wrapper (`src/run/bird/`)

```
src/run/bird/
  index.ts        — readTweet() public API, wraps 'bird' CLI subprocess
  parse.ts        — parseBirdTweetPayload (keep existing, remove xurl parsers)
  types.ts        — BirdTweetPayload, TweetCliClient = 'bird' only
  media.ts        — extractMediaFromBirdRaw (keep, remove extractMediaFromXurlRaw)
```

### Files to DELETE from `src/run/bird/`

- `exec.ts` — merge exec logic into `index.ts` directly

### Files to KEEP/MODIFY in `src/run/bird/`

- `types.ts` — remove xurl from TweetCliClient, keep BirdTweetPayload/BirdTweetMedia
- `parse.ts` — remove parseXurlTweetPayload and extractMediaFromXurlRaw, keep bird parsers
- `media.ts` — remove extractMediaFromXurlRaw, keep extractMediaFromBirdRaw

### Files to DELETE from `src/run/`

- `bird/exec.ts` — inline exec into index.ts
- `cookies/twitter.ts` — if not needed for cookie extraction (bird handles auth internally)
- Constants referencing xurl/BIRD_TIP

### Env checks (`src/run/env.ts`)

- Remove `hasXurlCli()`
- Keep `hasBirdCli()` — checks for `bird` binary on PATH
- Add note: bird is expected from `/tmp/imports/bird.tar.gz` (user installs it)

---

## 5. Local Sidecar System — NEW

### Your Sidecar at `/tmp/imports/sidecar.tar.gz`

Python/FastAPI server. OpenAI-compatible chat + specialized endpoints.

**Default port:** `8000`, **host:** `0.0.0.0`

### Available Models (from `sidecar.json`)

**LLM (enabled):**

- `bonsai` — Bonsai-8B-Q1_0.gguf, 32k context, speculative decoding
- `qwen` — Qwen3.6-35B-A3B-UD-Q4_K_S.gguf, 128k context, reasoning on
- `qwen-smol` — Qwen3.5-4B-UD-Q5_K_XL.gguf, 65k context, reasoning on

**LLM (disabled in config):**

- `qwen2` — Qwen3.6-27B (heavy tier)
- `gemma-smol` — Gemma 4 E4B-it

**Specialized models (enabled):**

- `transcription` — Parakeet TDT 0.6B v2
- `rerank` — gte-reranker-modernbert-base (TEI-compatible)
- `embed` — pplx-embed-v1-0.6b (TEI-compatible)
- `embed_chunked` — pplx-embed-context-v1-0.6b
- `safety` — Prompt-Guard-86M

**PDF (disabled):**

- `pdf` — Marker v1

### Sidecar API Endpoints

| Endpoint               | Method | Purpose                                                        |
| ---------------------- | ------ | -------------------------------------------------------------- | ------------------- |
| `/v1/chat/completions` | POST   | OpenAI-compatible LLM chat (streaming + non-streaming)         |
| `/v1/models`           | GET    | List available LLM models                                      |
| `/transcribe`          | POST   | Audio transcription (multipart file upload)                    |
| `/rerank`              | POST   | TEI-compatible reranking `{query, texts}` → `[{index, score}]` |
| `/embed`               | POST   | TEI-compatible embeddings `{inputs: str                        | str[]}`→`float[][]` |
| `/embed-chunked`       | POST   | Chunked embeddings for long inputs                             |
| `/convert-pdf`         | POST   | PDF → markdown (multipart file upload)                         |
| `/classify`            | POST   | Text classification                                            |
| `/health`              | GET    | System health + model registry status                          |
| `/models/{id}/evict`   | POST   | Operator: unload model                                         |
| `/models/{id}/load`    | POST   | Operator: warm model into memory                               |
| `/models/{id}/reload`  | POST   | Operator: evict+reload                                         |

### Chat Request/Response Format (OpenAI-compatible)

```jsonc
// Request
{
  "model": "qwen",              // model name from sidecar.json
  "messages": [{"role": "user", "content": "..."}],
  "max_tokens": 4096,
  "temperature": 0,
  "stream": false               // or true for SSE streaming
}

// Non-streaming response
{
  "id": "chatcmpl-...",
  "object": "chat.completion",
  "model": "qwen",
  "choices": [{"index": 0, "message": {"role": "assistant", "content": "summary text"}}],
  "usage": {"prompt_tokens": 123, "completion_tokens": 456}
}

// Streaming response (SSE)
event: message
data: {"id":"...","object":"chat.completion.chunk","model":"qwen","choices":[{"index":0,"delta":{"content":"h"}}]}

event: message
data: {"id":"...","choices":[{"index":0,"delta":{"content":"ello"}}]}

event: done
data: {"id":"...","choices":[{"index":0,"finish_reason":"stop"}]}
```

**Note:** Some models (qwen, qwen-smol) output reasoning content via `<|begin_of_thought|>` tags. The sidecar strips these for non-gemma models. Gemma models get special parsing for tool calls and reasoning.

### Transcription Request/Response

```jsonc
// POST /transcribe — multipart/form-data
file: <binary audio>

// Response
{
  "text": "transcribed text...",
  "segments": [...]  // optional timestamp segments
}
```

### Rerank Request/Response (TEI-compatible)

```jsonc
// POST /rerank — application/json
{
  "query": "what is the main topic?",
  "texts": ["document 1...", "document 2..."],
  "return_text": false
}

// Response
[{"index": 0, "score": 0.95}, {"index": 1, "score": 0.72}]
```

### Embed Request/Response (TEI-compatible)

```jsonc
// POST /embed
{
  "inputs": ["text to embed", "another text"]
}

// Response
[[0.1, -0.2, 0.3, ...], [0.4, 0.5, -0.1, ...]]
```

### Config Shape

```typescript
interface LocalConfig {
  baseUrl: string; // e.g. "http://localhost:8000"
  chatEndpoint?: string; // default "/v1/chat/completions" (OpenAI-compatible)
  transcriptionEndpoint?: string; // default "/transcribe"
  rerankEndpoint?: string; // default "/rerank"
  embedEndpoint?: string; // default "/embed"
  pdfConvertEndpoint?: string; // default "/convert-pdf"
}
```

### New files (`src/sidecar/`)

```typescript
// src/sidecar/config.ts
export interface SidecarConfig {
  baseUrl: string;                    // required, e.g. "http://localhost:8000"
  chatEndpoint?: string;              // default "/v1/chat/completions"
  transcriptionEndpoint?: string;     // default "/transcribe"
  rerankEndpoint?: string;            // default "/rerank"
  embedEndpoint?: string;             // default "/embed"
  pdfConvertEndpoint?: string;        // default "/convert-pdf"
  timeoutMs?: number;                 // default 120000
}

export function resolveSidecarConfig(config: SummarizeConfig | null, env: Record<string, string>): SidecarConfig | null;

// src/sidecar/chat.ts — OpenAI-compatible chat proxy to sidecar
export async function sidecarChat({
  config,
  modelId,
  messages,
  maxTokens,
  temperature,
  signal,
}: { ... }): Promise<{ text: string; usage?: LlmTokenUsage }>;

export async function* sidecarChatStream({
  config,
  modelId,
  messages,
  maxTokens,
  temperature,
  signal,
}: { ... }): AsyncIterable<string>;

// src/sidecar/transcribe.ts — audio transcription
export async function sidecarTranscribe({
  config,
  audioPath,
  signal,
}: { ... }): Promise<{ text: string }>;

// src/sidecar/rerank.ts — TEI-compatible reranking
export async function sidecarRerank({
  config,
  query,
  texts,
  signal,
}: { ... }): Promise<Array<{ index: number; score: number }>>;

// src/sidecar/embed.ts — TEI-compatible embeddings
export async function sidecarEmbed({
  config,
  inputs,
  signal,
}: { ... }): Promise<number[][]>;

// src/sidecar/pdf.ts — PDF to markdown conversion
export async function sidecarConvertPdf({
  config,
  pdfPath,
  signal,
}: { ... }): Promise<{ filename: string; markdown: string }>;

// src/sidecar/models.ts — list available models from /v1/models
export async function sidecarListModels({
  config,
  signal,
}: { ... }): Promise<Array<{ id: string; object: string }>>;
```

### Chat endpoint request/response (OpenAI-compatible format)

```typescript
// Request
{
  model: "llama-3.1-8b-instruct",
  messages: [{ role: "user", content: "..." }],
  max_tokens: 4096,
  temperature: 0,
  stream: false
}

// Response (non-streaming)
{
  choices: [{ message: { content: "summary text..." } }],
  usage: { prompt_tokens: 123, completion_tokens: 456 }
}

// Response (streaming) — SSE format
event: message
data: {"choices":[{"delta":{"content":"hello"}}]}

event: done
data: {"usage":{"prompt_tokens":123,"completion_tokens":456}}
```

### Transcription endpoint

```typescript
// Request (multipart form)
{
  file: <binary audio>,
  model: "whisper-large-v3",
  language: "en" | "auto"
}

// Response
{
  text: "transcribed text...",
  segments?: [...] // optional
}
```

---

## 6. Transcription — Sidecar Only

### Before

Multi-provider transcription chain: Groq → ONNX (parakeet/canary) → whisper.cpp → AssemblyAI → FAL.ai → Gemini → OpenAI Whisper. Configured via env vars, local binaries, API keys.

### After

Single path: POST audio file to sidecar `/api/transcribe` endpoint.

### Files to DELETE

- `src/run/transcriber-cli.ts` — ONNX/whisper.cpp setup command
- `src/run/flows/asset/transcript-state.ts` (if exists) — TTY transcript progress state
- Any whisper/Groq/AssemblyAI/FAL-specific code in media flow

### Files to MODIFY

- `src/run/flows/asset/media.ts` — replace multi-provider transcription with sidecar call
- `src/config/types.ts` — remove `MediaCacheConfig` whisper-related fields, keep general cache

---

## 7. Daemon — DELETE

### Files to DELETE (entire directory)

```
src/daemon/
  agent-model.ts
  agent-request.ts
  agent.ts
  auto-mode.ts
  chat.ts
  cli-entrypoint.ts
  cli.ts
  config.ts
  constants.ts
  env-merge.ts
  env-snapshot.ts
  flow-context.ts
  launchd.ts
  meta.ts
  models.ts
  process-registry.ts
  schtasks.ts
  server-admin-routes.ts
  server-agent-route.ts
  server-http.ts
  server-session-routes.ts
  server-session.ts
  server-sse.ts
  server-summarize-execution.ts
  server-summarize-request.ts
  server.ts
  summarize-progress.ts
  summarize.ts
  systemd.ts
  windows-container.ts
```

### Files to MODIFY

- `src/run/cli-preflight.ts` — remove daemon handling, keep help/refresh-free
- `src/run/runner.ts` — remove daemon references
- `src/run/help.ts` — remove daemon help command
- Root `package.json` scripts — remove `summarize daemon restart/status`, extension test commands

---

## 8. Slides — DELETE

### Files to DELETE

```
src/slides/
  download.ts
  extract-finalize.ts
  extract.ts
  frame-extraction.ts
  index.ts
  ingest.ts
  ocr.ts
  process.ts
  scene-detection.ts
  settings.ts
  source-id.ts
  source.ts
  store.ts
  types.ts

src/run/slides-cli.ts
src/run/slides-render.ts

src/run/flows/url/slides-output-render.ts
src/run/flows/url/slides-output-state.ts
src/run/flows/url/slides-output-stream.ts
src/run/flows/url/slides-output.ts
src/run/flows/url/slides-session.ts
src/run/flows/url/slides-text-markdown.ts
src/run/flows/url/slides-text-transcript.ts
src/run/flows/url/slides-text-types.ts
src/run/flows/url/slides-text.ts
```

### Files to MODIFY

- `src/config/types.ts` — remove `slides` from SummarizeConfig
- `src/config/sections.ts` — remove `parseSlidesConfig`
- `src/run/runner-plan.ts` — remove slides settings resolution
- `src/run/help.ts` — remove --slides flag from help text
- `src/run/flows/url/flow.ts` — remove slides session handling

---

## 9. Other Deletions

### Files to DELETE

```
src/costs.ts                         — provider pricing lookup
src/pricing/litellm.ts              — LiteLLM model catalog
src/model-auto-cli.ts               — CLI auto model selection
src/model-auto-rules.ts             — auto rules
src/model-auto.ts                   — auto model resolution
src/refresh-free.ts                 — refresh free tier
src/run/bird/exec.ts                — merge into index.ts
src/run/cookies/twitter.ts          — cookie extraction (bird handles auth)
patches/@zag-js__preact@1.40.0.patch — extension polyfill
```

### Dependencies to REMOVE from package.json

- `@fal-ai/client` — FAL.ai provider
- Any Chrome-extension-only deps

### DevDependencies to REMOVE

- Playwright (extension tests)
- wxt-related types (if any)

---

## 10. File-by-File Summary

### DELETE (40+ files)

```
apps/chrome-extension/                          — entire directory
packages/core/                                  — entire directory
src/daemon/*                                    — entire directory (32 files)
src/slides/*                                    — entire directory (13 files)
src/run/flows/url/slides-*.ts                   — 8 files
src/run/slides-cli.ts
src/run/slides-render.ts
src/run/transcriber-cli.ts
src/run/bird/exec.ts
src/run/cookies/twitter.ts
src/costs.ts
src/pricing/litellm.ts
src/model-auto-cli.ts
src/model-auto-rules.ts
src/model-auto.ts
src/refresh-free.ts
src/llm/providers/anthropic.ts
src/llm/providers/google.ts
src/llm/github-models.ts
src/llm/google-models.ts
src/llm/provider-profile.ts
patches/@zag-js__preact@1.40.0.patch
```

### MODIFY (~25 files)

```
package.json                              — remove workspaces, deps, scripts
tsconfig*.json                            — simplify
src/llm/generate-text.ts                  — rewrite: only openrouter + local
src/llm/generate-text-stream.ts           — simplify
src/llm/model-id.ts                       — LlmProvider = 'openrouter' | 'local'
src/llm/providers/openai.ts               — keep, OpenRouter uses this path
src/llm/providers/shared.ts               — keep
src/llm/providers/types.ts                — simplify
src/llm/providers/models.ts               — rewrite: openrouter + local only
src/run/bird/index.ts                     — wrap 'bird' CLI subprocess
src/run/bird/parse.ts                     — remove xurl parsers
src/run/bird/media.ts                     — remove xurl media extraction
src/run/bird/types.ts                     — TweetCliClient = 'bird' only
src/run/env.ts                            — remove hasXurlCli, simplify cli providers
src/run/cli-preflight.ts                  — remove daemon handling
src/run/runner.ts                         — remove daemon references
src/run/runner-plan.ts                    — remove slides, simplify model selection
src/run/flows/asset/media.ts              — sidecar transcription only
src/run/flows/url/flow.ts                 — remove slides session
src/config/types.ts                       — rewrite types (remove providers, add local)
src/config/sections.ts                    — remove provider parsers, add local parser
src/run/help.ts                           — update help text
src/run/summary-engine.ts                 — simplify API key handling
src/index.ts                              — update exports
```

### CREATE (new files)

```
src/sidecar/config.ts                     — sidecar config resolution
src/sidecar/chat.ts                       — sidecar LLM chat client
src/sidecar/transcribe.ts                 — sidecar transcription client
```

---

## 11. Build & Dev Changes

### package.json scripts

```jsonc
{
  "build": "bun run clean && tsc -p tsconfig.build.json",
  "clean": "rimraf dist",
  "dev:cli": "bun src/cli.ts",
  "s": "bun src/cli.ts",
  "summarize": "bun src/cli.ts",
}
```

Remove: `build:lib`, `build:cli`, `release`, `test:extension-e2e`.

### tsconfig.build.json

Simplify — no workspace references, single compilation target.

---

## Execution Order (do these one at a time, verify between each)

### Step 0: Done

- Big delete pass complete (133 files remaining)
- `src/llm/model-id.ts` rewritten (LlmProvider = 'openrouter' | 'local')
- `src/run/cli-preflight.ts` simplified (removed daemon/refresh-free/transcriber/slides handlers)
- `src/run/runner.ts` simplified (removed daemon/refresh-free/slides/transcriber calls)

### Step 1: Fix broken imports in remaining files

Files with broken imports that need cleanup:

- `src/llm/generate-text.ts` — remove anthropic/google imports, rewrite for openrouter+local only
- `src/llm/generate-text-stream.ts` — remove anthropic import
- `src/llm/generate-text-document.ts` — remove anthropic/google document handling
- `src/llm/provider-capabilities.ts` — remove provider-profile import, simplify
- `src/logging/daemon.ts` — remove daemon reference (or delete this file)
- `src/run/bird.ts` — update imports after bird/index.ts rewrite

### Step 2: Rewrite LLM generation core

- `src/llm/generate-text.ts` — only openrouter + local sidecar branches
- `src/llm/generate-text-stream.ts` — simplify to openrouter + local streaming
- `src/llm/generate-text-document.ts` — remove anthropic/google, keep basic handling
- `src/llm/providers/models.ts` — rewrite: only resolveOpenAiModel (openrouter) + resolveLocalModel (sidecar)
- `src/llm/providers/provider-capabilities.ts` — simplify

### Step 3: Rewrite config types

- `src/config/types.ts` — remove provider configs (anthropic/google/xai/zai/nvidia), add LocalConfig
- `src/config/sections.ts` — remove provider parsers, add parseLocalConfig
- `src/run/env.ts` — remove hasXurlCli, simplify CLI providers (claude/codex/gemini/agent only)

### Step 4: Rewrite summary engine

- `src/run/summary-engine.ts` — remove provider API keys, add sidecar config
- `src/run/summary-llm.ts` — simplify to openrouter + local
- `src/run/model-attempts.ts` — simplify model attempt logic

### Step 5: Update runner orchestration

- `src/run/runner-plan.ts` — remove slides, provider API keys, simplify summary engine creation
- `src/run/help.ts` — update help text (remove --transcriber, --slides flags, update model hint)

### Step 6: Update asset flows

- `src/run/flows/asset/media.ts` — replace multi-provider transcription with sidecar /transcribe
- `src/run/bird/index.ts` — create bird CLI wrapper (shell out to `bird read <url> --json-full`)
- `src/run/bird/parse.ts` — remove xurl parsers, keep bird parsers
- `src/run/bird/media.ts` — remove extractMediaFromXurlRaw
- `src/run/bird/types.ts` — TweetCliClient = 'bird' only
- `src/run/cli-fallback-state.ts` — simplify for kept CLI providers only

### Step 7: Update URL flows

- `src/run/flows/url/summary-resolution.ts` — remove github-models, model-auto imports
- `src/run/flows/url/markdown.ts` — remove github-models import
- `src/run/flows/url/types.ts` — simplify RunMetricsReport references
- `src/run/flows/url/summary.ts` — simplify cost/report references
- `src/run/flows/url/flow.ts` — remove slides session handling

### Step 8: Clean up metric/cost files

- `src/run/run-metrics.ts` — remove litellm import, simplify report building
- `src/costs.ts` — delete or simplify (remove per-provider pricing)
- `src/pricing/litellm.ts` — delete
- `src/run/flows/asset/output.ts` — simplify report references
- `src/run/flows/asset/summary.ts` — simplify LlmCall/RunMetricsReport types
- `src/run/runner-execution.ts` — simplify report references

### Step 9: Package consolidation

- `package.json` — remove workspaces, @seanmozeik/gist-core dep, extension scripts, patchDependencies
- `tsconfig.build.json` — remove workspace refs, single compilation target
- `src/index.ts` — update exports (no more core package)
- Delete empty `packages/` and `apps/` dirs

### Step 10: Create sidecar module

- `src/sidecar/config.ts` — resolve LocalConfig from SummarizeConfig + env
- `src/sidecar/chat.ts` — OpenAI-compatible chat proxy to `/v1/chat/completions`
- `src/sidecar/transcribe.ts` — POST audio to `/transcribe`

### Step 11: Verify

- `bun run build` — should compile
- `bun src/cli.ts --help` — should show clean help
- `bun src/cli.ts openrouter/meta/llama-3.1-8b-instruct "test"` — should work with OpenRouter
- `bun src/cli.ts local/qwen-smol "test"` — should work with sidecar (if running)
