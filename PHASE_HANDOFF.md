# Gist Refactor — Phase Handoff

## Goal
Consolidate `@seanmozeik/gist` into a single-package CLI focused on:
- **OpenRouter** for LLM summarization
- **Local sidecar** (`local/` prefix) for models at your FastAPI server (port 8000)
- **CLI magic** for Claude, Codex, Gemini, Cursor (`--cli` flag)
- **Bird CLI wrapper** for Twitter/X content (your forked version)
- Web URL summarization, local file summarization, YouTube summarization

**Killed:** Chrome extension, daemon, slides, all direct provider integrations (Anthropic/Google/xAI/Z.AI/NVIDIA/GitHub), xurl, local model downloading, price/cost lookup.

---

## Current State

### Git Status
- Latest commit: `refactor: consolidate core into CLI, strip providers/daemon/slides, restore core from git`
- 688 files changed in that commit
- Working tree is clean (ready to continue)

### What's DONE (Steps 0-2)
1. **Step 0 — Delete pass:** All deletions complete
   - `apps/chrome-extension/` deleted
   - `src/daemon/` deleted (32 files)
   - `src/slides/` deleted (13 files)
   - Old provider files deleted: `anthropic.ts`, `google.ts`, `github-models.ts`, `google-models.ts`, `provider-profile.ts`
   - Other deletions: `costs.ts`, `model-auto*.ts`, `refresh-free.ts`, `transcriber-cli.ts`, `bird/exec.ts`

2. **Step 1 — Broken imports:** Mostly fixed
   - Core package fully restored from git (`packages/core/src/` → copied to `src/`)
   - All 96 core TypeScript files present in `src/` — no stubs
   - Import paths updated: `@steipete/summarize-core` → relative paths
   - Most TS errors resolved, but ~30 remain from incomplete provider cleanup

3. **Step 2 — LLM generation core:** Partially done
   - `src/llm/model-id.ts` rewritten: `LlmProvider = 'openrouter' | 'local'`
   - `src/llm/generate-text.ts` rewritten: only openrouter + local branches
   - `src/llm/generate-text-stream.ts` rewritten: simplified to openrouter streaming
   - `src/index.ts` updated with core exports

### What's NOT DONE (Steps 3-11)
| Step | Status | Key Files |
|------|--------|-----------|
| **3** | ❌ NOT STARTED | `config/types.ts`, `config/sections.ts`, `run/env.ts` |
| **4** | ❌ NOT STARTED | `summary-engine.ts`, `summary-llm.ts` |
| **5** | ❌ NOT STARTED | `runner-plan.ts`, `help.ts` |
| **6** | ❌ NOT STARTED | `bird/index.ts`, `flows/asset/media.ts` |
| **7** | ❌ NOT STARTED | `summary-resolution.ts`, `markdown.ts`, `flow.ts` |
| **8** | ❌ NOT STARTED | `costs.ts` (delete), `run-metrics.ts` (simplify) |
| **9** | ❌ NOT STARTED | `package.json`, `tsconfig.build.json` |
| **10** | ❌ NOT STARTED | `src/sidecar/` (new directory) |
| **11** | ❌ NOT STARTED | Verify build + CLI |

---

## Phase 1: Config Types (Step 3)

### What needs to happen
Rewrite `config/types.ts`, `config/sections.ts`, and `run/env.ts` to remove all old provider configs and add `LocalConfig`.

### Key changes for `config/types.ts`:
- `ApiKeysConfig` already simplified: `{ openrouter?, apify?, firecrawl? }` ✓
- `CliProvider` already simplified: `'claude' | 'codex' | 'gemini' | 'agent'` ✓
- `LocalConfig` already added with `baseUrl` field ✓
- `SummarizeConfig` still has `openai?: OpenAiConfig` — this should be removed or repurposed
- Remove any remaining references to deleted providers

### Key changes for `config/sections.ts`:
- Remove parsers for: `parseOpenAiConfig`, `parseNvidiaConfig`, `parseAnthropicConfig`, `parseGoogleConfig`, `parseXaiConfig`, `parseZaiConfig`
- Add `parseLocalConfig` for the `local:` config section

### Key changes for `run/env.ts`:
- Remove `hasXurlCli()` function
- Simplify CLI provider availability checks (only claude/codex/gemini/agent)

---

## Phase 2: Summary Engine & Runner (Steps 4-5)

### What needs to happen
Strip all old provider references from the summary engine and runner plan.

### `summary-engine.ts` issues:
- References `deps.zai`, `deps.providerBaseUrls.anthropic/google/xai`
- Has branches for `zai/`, `google/`, `anthropic/` model IDs
- Passes `anthropicBaseUrlOverride`, `googleBaseUrlOverride`, `xaiBaseUrlOverride` to LLM calls
- Needs to only use `openrouterApiKey` and sidecar config

### `summary-llm.ts`:
- Simplify to only openrouter + local branches

### `runner-plan.ts`:
- Remove slides settings resolution
- Simplify model selection (no more provider API keys)
- Only pass `openrouterApiKey` to `createSummaryEngine`

### `help.ts`:
- Remove `--transcriber`, `--slides` flags from help text
- Update model ID hints

---

## Phase 3: Asset Flows & Sidecar (Steps 6, 10)

### Bird CLI wrapper (`src/run/bird/`)
- Create `index.ts` that wraps `bird read <url> --json-full` subprocess
- `parse.ts` already cleaned up (xurl removed)
- `media.ts` needs xurl media extraction removed
- `types.ts` needs `TweetCliClient = 'bird'` only

### Sidecar module (`src/sidecar/`) — NEW
Your FastAPI server at `/tmp/imports/sidecar.tar.gz` extracted to `/tmp/sidecar-extract/`.

**Endpoints:**
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/v1/chat/completions` | POST | OpenAI-compatible LLM chat |
| `/transcribe` | POST | Audio transcription (multipart) |
| `/rerank` | POST | TEI reranking |
| `/embed` | POST | TEI embeddings |
| `/convert-pdf` | POST | PDF → markdown |
| `/health` | GET | Health check |
| `/models/{id}/evict|load|reload` | POST | Model management |

**Available models (from sidecar.json):**
- LLM: `bonsai`, `qwen`, `qwen-smol`
- Transcription: `transcription` (Parakeet TDT 0.6B)
- Rerank: `rerank` (gte-reranker-modernbert-base)
- Embed: `embed`, `embed_chunked`

### Files to create:
```
src/sidecar/config.ts    — resolve LocalConfig from SummarizeConfig + env
src/sidecar/chat.ts      — OpenAI-compatible chat proxy
src/sidecar/transcribe.ts — audio transcription
```

---

## Phase 4: URL Flows, Cleanup, Package (Steps 7-9)

### URL flows (`src/run/flows/url/`)
- `summary-resolution.ts` — remove github-models, model-auto imports
- `markdown.ts` — remove github-models import
- `flow.ts` — remove slides session handling

### Metric/cost cleanup
- Delete `costs.ts` (provider pricing lookup)
- Simplify `run-metrics.ts` (remove litellm import)

### Package consolidation
- `package.json`: remove workspaces, `@seanmozeik/gist-core` dep, extension scripts, patchDependencies
- `tsconfig.build.json`: remove workspace refs, single compilation target
- Delete empty `packages/` and `apps/` directories

---

## Key Context

### Sidecar Config Shape
```typescript
interface LocalConfig {
  baseUrl: string;                    // e.g. "http://localhost:8000"
  chatEndpoint?: string;              // default "/v1/chat/completions"
  transcriptionEndpoint?: string;     // default "/transcribe"
  rerankEndpoint?: string;            // default "/rerank"
  embedEndpoint?: string;             // default "/embed"
  pdfConvertEndpoint?: string;        // default "/convert-pdf"
}
```

### Bird CLI
- Your fork at `/tmp/imports/bird.tar.gz` extracted to `/tmp/bird-extract/`
- Interface: `bird read <tweet-id-or-url> --json-full`
- Output JSON shape identical to what summarize expects
- No arg changes needed

### Model ID Format
- OpenRouter: `openrouter/meta/llama-3.1-8b-instruct` → uses OpenRouter API
- Local sidecar: `local/qwen-smol` → POSTs to sidecar `/v1/chat/completions`
- Bare model IDs (no prefix): default to `openrouter/` for backwards compat

### LlmProvider Type
```typescript
export type LlmProvider = 'openrouter' | 'local';
```

### ApiKeysConfig Type
```typescript
export interface ApiKeysConfig {
  openrouter?: string;
  apify?: string;
  firecrawl?: string;
}
```

### CliProvider Type (already done)
```typescript
export type CliProvider = 'claude' | 'codex' | 'gemini' | 'agent';
```

---

## Build Status
- `bun run build` currently fails with ~30 errors
- Errors are from incomplete provider cleanup in CLI files (not missing core code)
- Core package is fully restored — all 96 TypeScript files present, no stubs

---

## Next Step (Phase 1)
Start with **Step 3: Rewrite config types**. This is the foundation — everything downstream depends on it. Specifically:
1. Verify `config/types.ts` has correct simplified types
2. Update `config/sections.ts` to remove old provider parsers, add `parseLocalConfig`
3. Update `run/env.ts` to remove xurl references
4. Then move to Step 4: Rewrite summary engine
