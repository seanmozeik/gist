---
name: gist
description: Agent-facing contract for extracting, transcribing, and summarizing URLs, YouTube/videos, podcasts, PDFs, local files, and stdin through the local gist CLI.
homepage: https://github.com/seanmozeik/gist
metadata: { 'openclaw': { 'emoji': '🧾', 'requires': { 'bins': ['gist'] } } }
---

# gist

Use `gist` when an agent needs clean extracted text, a transcript, or an LLM summary from a URL, YouTube/video link, podcast episode, PDF, local file, or stdin. The CLI is optimized for agent workflows: choose `--extract` when the user asks for source content, choose a normal run when the user asks what something is about, and choose `--json` when another tool will consume the result.

## Default Summary

Use a normal run when the user asks for the gist, key points, overview, or summary:

```bash
gist "https://example.com/article"
```

Use `--length` to match the requested depth:

```bash
gist "https://example.com/article" --length short
gist "https://example.com/article" --length long
gist "https://example.com/article" --length 12000
```

Use `--language` only when the user requested a language:

```bash
gist "https://example.com/article" --language German
```

## Extraction

Use `--extract` when the user asks for original text, raw content, Markdown, transcript, quotes, or material to pass into another tool:

```bash
gist "https://example.com/article" --extract
```

Prefer Markdown for article/webpage extraction when structure matters:

```bash
gist "https://example.com/article" --extract --format md
```

Do not use `--extract` when the user asked for interpretation or synthesis; summarize instead.

## Video And Podcasts

For a summary of a YouTube video, direct video, or podcast episode:

```bash
gist "https://youtu.be/dQw4w9WgXcQ"
```

For transcript extraction:

```bash
gist "https://youtu.be/dQw4w9WgXcQ" --extract --youtube auto
```

Add timestamps only when they are useful to the user:

```bash
gist "https://youtu.be/dQw4w9WgXcQ" --extract --timestamps
```

Use video understanding only when the transcript is unavailable or insufficient and the user needs visual content considered:

```bash
gist "https://example.com/video.mp4" --video-mode understand --model google/gemini-3-flash
```

If a transcript is very large, return a concise summary first and ask for a specific section or time range before expanding.

## Files And Stdin

Summarize a file:

```bash
gist "/path/to/file.pdf"
```

Extract file content when the user needs source text:

```bash
gist "/path/to/file.pdf" --extract --format md
```

Use stdin for clipboard or pipeline input:

```bash
pbpaste | gist -
```

## JSON For Agents

Use `--json` when a subsequent step needs structured fields, metrics, cache state, extracted content, or prompt metadata:

```bash
gist "https://example.com/article" --json
```

Combine `--json` with `--extract` for structured extraction:

```bash
gist "https://example.com/article" --extract --format md --json
```

Guidance:

- Use human output for direct user-facing summaries.
- Use `--json` for automation, comparisons, validation, caching decisions, or when you need to inspect metadata.
- Do not parse progress lines or rich terminal output; parse JSON only when `--json` is set.
- Streaming is not useful with `--json`; leave `--stream` unset or use `--stream off`.

## Agent-Friendly Output

Prefer `--plain` when the agent will read or relay normal text output. It removes rich terminal rendering and keeps the output cleaner:

```bash
gist "https://example.com/article" --length short --plain
gist "https://example.com/article" --extract --plain
gist "https://example.com/article" --extract --format md --plain
```

Guidance:

- Use `--plain` by default for agent-facing text output.
- Use human output plus `--plain` for direct user-facing summaries.
- Use `--length short` or `--length medium` when the user asks for a compact answer.
- Use `--extract --format md` when document structure matters; use plain extraction when only text content matters.
- Use `--json` only when the next step needs structured data. JSON is easier to parse but usually more verbose than `--plain`.
- Avoid `--verbose`, `--debug`, and detailed metrics in agent workflows unless diagnosing a failure.
- Disable streaming with `--stream off` when capturing output programmatically.

## Model Selection

Most agent tasks should let the CLI use its configured default:

```bash
gist "https://example.com/article"
```

Force a model only when the user asks or the input needs a specific capability:

```bash
gist "https://example.com/article" --model google/gemini-3-flash
gist "/path/to/file.pdf" --model openai/gpt-5-mini
gist "https://example.com/video.mp4" --video-mode understand --model google/gemini-3-flash
```

Non-`local/...` model ids route through OpenRouter. Do not add `openrouter/` unless the user supplied that form. `local/...` is the exception for a local sidecar.

## Flag Choices

Use these flags deliberately:

- `--force-summary`: summarize even when extracted content is short.
- `--timeout 30s|2m|5000ms`: increase for slow pages, videos, or models.
- `--retries <count>`: retry model timeouts.
- `--plain`: disable ANSI/rich rendering for cleaner human text.
- `--no-cache`: bypass summary cache when freshness matters.
- `--no-media-cache`: bypass cached media downloads when media content may have changed.

## Skill Export

Use `--skill` to print this Markdown contract from the installed CLI:

```bash
gist --skill
```

This is intended for agent discovery and should not be mixed with normal input processing.

## Failure Handling

If extraction fails, try a narrower mode before giving up:

```bash
gist "https://example.com/article" --extract --format md
gist "https://youtu.be/dQw4w9WgXcQ" --extract --youtube yt-dlp
```

Exit codes:

- `0`: success.
- `1`: runtime failure such as extraction failure, timeout, missing credentials, or model failure.
- `2`: CLI usage error.
