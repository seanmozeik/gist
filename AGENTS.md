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

## Prefer `ast-outline` over full reads

Usage: ast-outline <COMMAND> [OPTIONS]

Commands:
outline Outline given files or directories (signatures with line ranges)
digest One-page module map
show Extract source of a symbol
implements Find subclasses / implementations
surface True public API surface (resolves `pub use` / `__all__`)
deps Forward import-graph traversal: what a file imports
reverse-deps Backward import-graph: who imports a file
cycles Find import cycles via Tarjan SCC
graph Emit the dep graph (text / JSON / DOT / DSM)
search Hybrid BM25 + dense semantic search over the repo
find-related Find chunks semantically similar to a given file:line
index Build, refresh, or inspect the per-repo search index
prompt Print this agent prompt snippet
install Install ast-outline into a coding-agent CLI
uninstall Remove ast-outline from a coding-agent CLI
status Report what's installed where
mcp Run as an MCP (Model Context Protocol) server over stdio

Each command has `--json` for stable schemas and `--compact` for single-line JSON. Pass an unknown flag or no command and the help text prints automatically — there's no "default" command, every operation is explicit.

Read structure with `ast-outline` before opening full contents. Pull method bodies only once you know which ones you need.

Stop at the step that answers the question:

1. **Unfamiliar directory** — `ast-outline digest <dir>`: one-page map of every file's types and public methods.

2. **One file's shape** — `ast-outline outline <file>`: signatures with line ranges, no bodies (5–10× smaller than a full read).

3. **One method, class, or markdown section** — `ast-outline show <file> <Symbol>`. Suffix matching: `TakeDamage`, or `Player.TakeDamage` when ambiguous. Multiple at once: `ast-outline show Player TakeDamage Heal Die`. For markdown, the symbol is the heading text.

4. **Who implements/extends a type** — `ast-outline implements <Type> <dir>`: AST-accurate (skip `grep`), transitive by default with `[via Parent]` tags on indirect matches. Add `--direct` for level-1 only.

5. **You don't know the file or symbol name** — `ast-outline search "<query>"`: hybrid BM25 + dense semantic search over the repo. Use bare identifiers for symbol lookup (`HandlerStack`, `Sinatra::Base` — auto-leans BM25), full sentences for behaviour search ("how does login work" — auto-balances semantic + BM25). First call builds an index at `.ast-outline/index/` (~seconds for typical repos); subsequent calls reuse it and refresh incrementally.

6. **Find code similar to a chunk you already have** — `ast-outline find-related <file>:<line>`: returns chunks semantically similar to the one containing that line. Useful for "what else looks like this?" or finding alternative implementations. Pastes directly from `search` output (which prints results as `path:start-end`).

7. **The actual published API of a package** — `ast-outline surface <dir>`: resolves `pub use` re-exports (Rust) and `__all__` (Python) so you see exactly what a downstream user can reach, not the union of every `pub`/non-underscore item. Falls back to visibility-filtered output for Java/C#/Go/Kotlin (no real re-export concept). Use `--tree` for hierarchy, `--include-chain` to see the re-export path each entry took.

8. **What does this file pull in / who depends on it / are there cycles?** — file-level dep-graph commands. First call builds a graph at `.ast-outline/deps/graph.bin` (~hundreds of ms for typical repos); subsequent calls reuse it.
   - `ast-outline deps <file> [--depth N]`: forward — what `<file>` imports (transitively).
   - `ast-outline reverse-deps <file> [--depth N]`: backward — who imports `<file>`. Use before refactoring to know the blast radius.
   - `ast-outline cycles [<dir>]`: import cycles via Tarjan SCC. Exits non-zero when cycles exist (CI gate).
   - `ast-outline graph [<dir>] --format text|json|dot|dsm`: emit the full graph. `dsm` is a Design Structure Matrix sorted by Lakos level — visual cycle/inversion spotter.

Fall back to a full read only when you need context beyond the body `show` returned. If the outline header contains `# WARNING: N parse errors`, the outline for that file is partial — read the source directly for the affected region.
