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
