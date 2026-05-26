# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev                 # main + preload + renderer with HMR (electron-vite dev)
pnpm build               # electron-vite build (no installer)
pnpm typecheck           # tsc --noEmit for both node + web projects (runs both sequentially)
pnpm typecheck:node      # main + preload only
pnpm typecheck:web       # renderer only
pnpm lint                # eslint --cache
pnpm lint:fix
pnpm format              # prettier --write
pnpm test                # vitest run (jsdom env, picks up src/**/*.{test,spec}.{ts,tsx})
pnpm test:watch
vitest run path/to/file.test.ts            # single test file
vitest run -t "name substring"             # filter by test name

pnpm dist                # build + electron-builder for host platform
pnpm dist:mac | dist:win | dist:linux      # explicit platform (cross-builds for Windows from non-Windows need Wine)
pnpm run rebuild:native  # NOTE: `pnpm rebuild` is a different built-in; the `run` matters when better-sqlite3 / NODE_MODULE_VERSION drifts

./deploy.sh              # typecheck + lint + test + dist for host
./deploy.sh release [patch|minor|major|x.y.z]   # bumps package.json, regenerates CHANGELOG.md from Conventional Commits, tags, pushes (set SKIP_CHECKS=1 to skip the gate, YES=1 to skip the confirmation prompt, UPLOAD_MAC=1 to also build+upload the mac .dmg locally instead of waiting for CI)
./deploy.sh upload-mac [version]   # build the mac .dmg locally and upload it to the GitHub Release (defaults to package.json version) — for filling in mac artifacts by hand after a failed CI run; creates the release if missing
```

Pre-commit runs `lint-staged` (eslint --fix + prettier) via Husky; commitlint enforces Conventional Commits on commit messages. Do not bypass either with `--no-verify`.

## Architecture

Three-process Electron app (main / preload / renderer) wired through `electron-vite`. Aliases (`@main`, `@shared`, `@renderer`, `@`) are defined identically in `electron.vite.config.ts` and `vitest.config.ts` — keep them in sync if you add one.

### Process responsibilities

- **`src/main/`** — window lifecycle, the `WebContentsView` tab manager (`tabs.ts`), SQLite persistence (`db/`), `chokidar` file watchers (`watchers/`), AI HTTP + external CLI subprocess control (`cli/`), and all IPC handlers (`ipc/`).
- **`src/preload/`** — two preload scripts: `index.ts` for the main renderer (`window.api.*` via `contextBridge`), and `web-tab.ts` for the sandboxed `WebContentsView` instances (only forwards user selection back to main).
- **`src/renderer/`** — React 18 + Tailwind + shadcn/ui. `App.tsx` is the main window; `SettingsApp.tsx` is loaded at `#/settings` in the standalone settings window. State is Zustand stores in `stores/`; cross-process IO goes through `window.api.*`.
- **`src/shared/`** — types and IPC channel string constants imported by all three processes. `ipc-channels.ts` is the single source of truth for channel names — never inline a channel string.

### Key boundaries to know before touching code

- **`WebContentsView` over `<iframe>` / `<webview>`**: web/github reader tabs are real Chromium views the main process layers above the renderer DOM and positions via `tab:update-bounds` IPC. The renderer never owns them. This is why authenticated sites and sites with `X-Frame-Options: DENY` work. `TabManager` in `src/main/tabs.ts` is the owner; the renderer side is `WebReader` + `TabBar` driving IPC. PDF / EPUB / code tabs are pure DOM, not WebContentsView.
- **One-time process setup**: `src/main/index.ts` separates `setupOnce()` (IPC handlers, DB, menu — registered exactly once per app lifetime) from `openMainWindow()` (which can run again on macOS dock-icon activate). Re-registering IPC handlers crashes Electron, so anything that calls `ipcMain.handle` belongs in `setupOnce`.
- **Cross-window settings sync**: `SETTINGS_SET` broadcasts `SETTINGS_CHANGED` to every `BrowserWindow`. Both the main window and the settings window subscribe via `window.api.settings.onChanged`, so values stay live without polling. Secrets are stripped from broadcasts and refetched on demand.
- **AI has two parallel surfaces** — don't conflate them:
  - Short inline actions (Polish / Translate / Summarize / Explain / Interpret) go through `src/main/ipc/ai.ts` over HTTP to an OpenAI-compatible endpoint, streaming back via `AI_COMPLETE_PROGRESS`.
  - Long-form "Generate from reader" spawns an external CLI subprocess (`claude` / `codex` / `gemini` / `opencode` / custom) from `src/main/cli/`, no-tools flags applied for safety, prompt via stdin, cancellation via `AbortSignal`. See `claude-code.ts` for the exact `claude -p --allowedTools ""` invocation pattern.
- **Secrets**: `src/main/secrets.ts` wraps Electron `safeStorage` (OS keychain / libsecret). AI API keys and the WeChat `appSecret` live there, never in the settings KV blob. `migrateSecretsFromLegacySettings()` runs once on startup to move any plaintext leftovers. When adding a new secret field, add its key to `SECRET_KEYS` so settings IO routes it correctly.
- **Workspace ≠ application state**: a workspace is just a folder. Each document is its own subfolder (`<name>/<name>.md` + `<name>/images/`). Workspace switch loads a different SQLite-keyed view (active tabs, recent items, last doc) but the rest of the app keeps running. The "Forget vs Delete to Trash" distinction matters — forget removes from the recent list only.
- **Image paths stay relative**: pasting / snipping / drag-drop saves into the active doc's `images/` folder and inserts a relative-path Markdown link. The `imagesDirMode` setting (`next-to-doc` / `custom` / `pictures`) controls placement; resolution lives in `src/renderer/src/lib/path-transform.ts` and the screenshot IPC. If a feature touches image saving, route it through there so moving a doc folder doesn't break the references.
- **`src/renderer/src/lib/open-tab.ts`** is the single entry point for creating reader tabs from any UI surface (TabBar `+` dialog, EmptyState, quick links). It handles GitHub `owner/repo` shorthand, recent-reader push, and tab kind detection — don't duplicate that logic in callers.

### Persistence

Settings, session, per-workspace tab sessions, and recent reader items all live in a single SQLite `kv_store` table accessed via `kvGet` / `kvSet` in `src/main/db/`. Defaults are merged in `getCurrentSettings()` in `src/main/ipc/settings.ts` — when you add an `AppSettings` field, also add its default there and mirror it in the renderer store's `DEFAULTS` constant so the pre-load state matches.

## Conventions

- TypeScript `strict: true` across all three processes. No `any` without a disable-comment justification.
- Prefer `import type { ... }` for type-only imports; the linter nudges otherwise.
- Conventional Commits enforced by commitlint. Allowed types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`. Scopes are free-form but kept short (`reader`, `editor`, `main`, `ai`, `wechat`, `ci`, etc.).
- Releases are tagged `v<version>` and ride a GitHub Actions matrix (`macos-latest`, `windows-latest`, `ubuntu-latest`) that uploads installers to a GitHub Release. The `## [<version>]` block in `CHANGELOG.md` becomes the release notes — auto-generated from `feat`/`fix`/`refactor`/`perf` commits by `scripts/cut-changelog.mjs`, editable before pushing the tag.

## Further reading

- [`README.md`](README.md) — feature overview and quick start.
- [`docs/usage.md`](docs/usage.md) — full end-user guide (install, reader, snip, editor, AI, publishing, settings, troubleshooting).
- [`pages/`](pages/) — the static GitHub Pages landing site, published at <https://everettjf.github.io/ReadWrite/> by `.github/workflows/pages.yml` (Pages source = GitHub Actions) on pushes touching `pages/**`. Edit the HTML/CSS directly; no build step.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — branching, commit rules, dependency policy.
- [`docs/develop.md`](docs/develop.md) — distributable builds, signing, the release flow in detail.
- [`docs/testing.md`](docs/testing.md) — manual black-box test plan to run before tagging a macOS release.
- [`docs/adr/001-electron-vs-tauri.md`](docs/adr/001-electron-vs-tauri.md) — non-obvious framing decisions (Electron over Tauri, capture-then-overlay snip, per-element inline styles for WeChat export).
