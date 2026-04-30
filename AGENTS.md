# Gist Guardrails

- Note: multiple agents often work in this folder. If you see files/changes you do not recognize, ignore them and list them at the end.

## Workspace layout

- Single-package Bun/TypeScript CLI.
- Package:
  - `@seanmozeik/gist` = CLI + library exports for extraction, prompts, TTY/progress, and streaming.
- Product target:
  - Agent-friendly CLI: paste a URL, local path, or stdin and get extracted text or a summary.
  - Keep broad source support: articles/web pages, YouTube, Twitter/X, podcasts/RSS/audio, remote assets, local files, and stdin.
  - Keep model backends simple: OpenRouter, local sidecar (`local/...`), and CLI providers (`claude`, `codex`, `gemini`, `agent`).
- Dev:
  - Build: `bun run build`
  - Gate: `bun run check`
  - Typecheck: `bun run typecheck`
  - CLI smoke: `bun src/cli.ts --help`
  - Tests exist but are currently stale/noisy; prefer build/typecheck and focused smoke checks unless the task is specifically test cleanup.

## Code exploration — prefer `ast-outline` over full reads

For `.rs`, `.cs`, `.py`, `.pyi`, `.ts`, `.tsx`, `.js`, `.jsx`, `.java`, `.kt`, `.kts`,
`.scala`, `.sc`, `.go`, and `.md` files, read structure with `ast-outline`
before opening full contents.
Pull method bodies only once you know which ones you need.

Stop at the step that answers the question:

1. **Unfamiliar directory** — `ast-outline digest <dir>`: one-page map
   of every file's types and public methods.

2. **One file's shape** — `ast-outline <file>`: signatures with line
   ranges, no bodies (5–10× smaller than a full read).

3. **One method, class, or markdown section** — `ast-outline show <file>
<Symbol>`. Suffix matching: `TakeDamage`, or `Player.TakeDamage` when
   ambiguous. Multiple at once: `ast-outline show Player.cs TakeDamage
Heal Die`. For markdown, the symbol is the heading text.

4. **Who implements/extends a type** — `ast-outline implements <Type>
   <dir>`: AST-accurate (skip `grep`), transitive by default with
   `[via Parent]` tags on indirect matches. Add `--direct` for level-1 only.

Fall back to a full read only when you need context beyond the body
`show` returned.

If the outline header contains `# WARNING: N parse errors`, the outline
for that file is partial — read the source directly for the affected region.

`ast-outline help` for flags and rare options.
