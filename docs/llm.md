---
summary: 'LLM usage, env vars, flags, and prompt rules.'
read_when:
  - 'When changing model selection or prompt formatting.'
---

# LLM / summarization mode

By default `gist` will call LLMs through OpenRouter, except for `local/...` models. When CLI tools are
installed, auto mode can use local CLI models via `cli.enabled` or implicit auto CLI fallback
(`cli.autoFallback`; see `docs/cli.md`).

## Defaults

- Default model: `auto`
- Override with `GIST_MODEL`, config file (`model`), or `--model`.

## Env

- `.env` (optional): when running the CLI, `gist` also reads `.env` in the current working directory and merges it into the environment (real env vars win).
- `~/.gist/config.json` `env` (optional): fallback env defaults when process env is missing/blank.
- `OPENROUTER_API_KEY` (required for OpenRouter model ids, including `google/...`, `anthropic/...`, `openai/...`, and explicit `openrouter/...`)
- `OPENAI_BASE_URL` (optional; OpenAI-compatible API endpoint for `local/...`)
- `OPENAI_USE_CHAT_COMPLETIONS` (optional; force OpenAI chat completions for compatible endpoints)
- `GIST_MODEL` (optional; overrides default model selection)
- `CLAUDE_PATH` / `CODEX_PATH` / `GEMINI_PATH` / `AGENT_PATH` / `OPENCLAW_PATH` / `OPENCODE_PATH` (optional; override CLI binary paths)

## Flags

- `--model <model>`
  - Examples:
    - `cli/codex/gpt-5.2`
    - `openai/gpt-5.5`
    - `codex-fast` (explicit Codex CLI GPT Fast preset)
    - `cli/claude/sonnet`
    - `cli/gemini/flash`
    - `cli/agent/auto`
    - `cli/openclaw/main`
    - `cli/opencode/openai/gpt-5.4`
    - `openai/gpt-5.4`
    - `openai/gpt-5.4-mini`
    - `openai/gpt-5.4-nano`
    - `google/gemini-3-flash`
    - `openai/gpt-5-mini`
    - `openai/gpt-5-nano`
    - `nvidia/z-ai/glm5`
    - `zai/glm-4.7`
    - `xai/grok-4-fast-non-reasoning`
    - `google/gemini-2.0-flash`
    - `anthropic/claude-sonnet-4-5`
    - `meta-llama/llama-3.3-70b-instruct:free`
    - `openrouter/meta-llama/llama-3.3-70b-instruct:free` (explicit OpenRouter prefix)
- `--cli [provider]`
  - Examples: `--cli claude`, `--cli Gemini`, `--cli codex`, `--cli agent`, `--cli openclaw`, `--cli opencode` (equivalent to `--model cli/<provider>`); `--cli` alone uses auto selection with CLI enabled.
- `--model auto`
  - See `docs/model-auto.md`
- `--model <preset>`
  - Uses a built-in or config-defined preset (see `docs/config.md` → “Presets”).
- `--prompt <text>` / `--prompt-file <path>`
  - Overrides the built-in summary instructions (prompt becomes the instruction prefix).
  - Prompts are wrapped in `<instructions>`, `<context>`, `<content>` tags.
  - When `--length` is numeric, we add `Output is X characters.` When `--language` is explicitly set, we add `Output should be <language>.`
- `--no-cache`
  - Bypass summary cache reads and writes only (LLM output). Extract/transcript caches still apply.
- `--cache-stats`
  - Print cache stats and exit.
- `--clear-cache`
  - Delete the SQLite cache (extract/summary/transcript) and media download cache, then exit. Must be used alone.
- `--video-mode auto|transcript|understand`
  - Only relevant for video inputs / video-only pages.
- `--length short|medium|long|xl|xxl|<chars>`
  - This is _soft guidance_ to the model (no hard truncation).
  - Minimum numeric value: 50 chars.
  - Built-in default: `xl`.
  - Config default: `output.length` in `~/.gist/config.json`.
  - Output format is Markdown; use short paragraphs and only add bullets when they improve scanability.
- `--force-summary`
  - Always run the LLM even when extracted content is shorter than the requested length.
- `--max-output-tokens <count>`
  - Hard cap for output tokens (optional).
  - If omitted, no max token parameter is sent (provider default).
  - Minimum numeric value: 16.
  - Recommendation: prefer `--length` unless you need a hard cap (some providers count “reasoning” into the cap).
- `--thinking none|low|medium|high|xhigh`
  - Sets OpenAI reasoning effort for `openai/...` GPT-5-family models.
  - Short aliases: `off`, `min` (low), `mid` / `med`, `x-high`, `extra-high`.
- `--fast`
  - Shorthand for `--service-tier fast` on OpenAI models.
- `--service-tier default|fast|priority|flex`
  - OpenAI service tier override. `fast` is the gist-facing alias for OpenAI `priority`; `default` sends no service tier.
- `--retries <count>`
  - LLM retry attempts on timeout (default: 1).
- `--json` (includes prompt + summary in one JSON object)

## Prompt rules

- Video and podcast summaries omit sponsor/ads/promotional segments; do not include them in the summary.
- Do not mention or acknowledge sponsors/ads, and do not say you skipped or ignored anything.
- If a standout line is present, include 1-2 short exact excerpts formatted as Markdown italics with single asterisks. Do not use quotation marks of any kind (straight or curly). If a title or excerpt would normally use quotes, remove them and optionally italicize the text instead. Apostrophes in contractions are OK. Never include ad/sponsor/boilerplate excerpts and do not mention them. Avoid sponsor/ad/promo language, brand names like Squarespace, or CTA phrases like discount code.
- Final check: remove sponsor/ad references or mentions of skipping/ignoring content. Remove any quotation marks. Ensure standout excerpts are italicized; otherwise omit them.
- Hard rules: never mention sponsor/ads; never output quotation marks of any kind (straight or curly), even for titles.

## Input limits

- Text prompts are checked against the model’s max input tokens (LiteLLM catalog) using a GPT tokenizer.
- Text files over 10 MB are rejected before tokenization.

## PDF attachments

- For PDF inputs, `--preprocess auto` will send the PDF directly to the selected OpenRouter model when it supports documents; otherwise we fall back to markitdown.
- `--preprocess always` forces markitdown (no direct attachments).
- Streaming is disabled for document attachments.
