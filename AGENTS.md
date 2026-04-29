# Summarize Guardrails

- Hard rule: single source of truth = `~/Projects/summarize`; never commit in `vendor/summarize` (treat it as a read-only checkout).
- Note: multiple agents often work in this folder. If you see files/changes you do not recognize, ignore them and list them at the end.

## Workspace layout

- Monorepo (bun workspace).
- Packages:
  - `@steipete/summarize` = CLI + UX (TTY/progress/streaming). Depends on core.
  - `@steipete/summarize-core` (`packages/core`) = library surface for programmatic use (Sweetistics etc). No CLI entrypoints.
- Versioning: lockstep versions; publish order: core first, then CLI (`scripts/release.sh` / `RELEASING.md`).
- Dev:
  - Build: `bun run build` (builds core first)
  - Gate: `bun run check`
  - Import from apps: prefer `@steipete/summarize-core` to avoid pulling CLI-only deps.
- Daemon: restart with `bun run summarize daemon restart`; verify via `bun run summarize daemon status`.
- Rebuild (extension + daemon): run **both** in order:
  1. `bun -C apps/chrome-extension run build`
  2. `bun run summarize daemon restart`
- Extension tests:
  - `bun -C apps/chrome-extension run test:chrome` = supported automated path.
  - Firefox Playwright extension tests are not reliable (`moz-extension://` limitation); default `test:firefox` skips.
  - Use `bun -C apps/chrome-extension run test:firefox:force` only for explicit diagnostics.
- Commits: use `committer "type: message" <files...>` (Conventional Commits).
- Patches: `patches/@zag-js__preact@1.40.0.patch` adds missing `@zagjs/shared` exports. Bun applies via `patchedDependencies` in package.json (same as pnpm).

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
