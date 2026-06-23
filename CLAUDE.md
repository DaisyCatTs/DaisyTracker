# DaisyTracker (repo: Gitracker)

A minimal **GitHub Action** that posts polished push/commit summaries to Discord — one webhook
secret, one Action step, useful commit updates without Renovate/Dependabot spam. **TypeScript**,
runtime **Bun**, linted/formatted with **Biome**, bundled to `dist/` (committed — it's what the
Action runs).

## Build & test
- Install: `bun install`.
- Build the bundle: `bun run build` (check `package.json` scripts for exact names) — **must be
  re-run and `dist/` committed** whenever `src/` changes, or the Action ships stale code.
- Lint/format: `bunx biome check .` / `biome format`.
- Tests: `bun test` (suites under `tests/`).

## Layout
`src/` (Action source) · `dist/` (built output the Action executes — generated, but committed) ·
`action.yml` (Action metadata/inputs) · `tests/` · `vendor/` · `scripts/`.

## Gotchas
- The product/display name is **DaisyTracker**; the repo/dir is `Gitracker`.
- Editing `src/` without rebuilding `dist/` is the classic footgun — always rebuild before committing.
- Never log or commit the Discord webhook URL; it comes from a repo secret at runtime.
