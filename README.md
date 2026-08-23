<div align="center">
  <img src="build/icon.png" alt="ReadWrite" width="128" height="128" />
  <h1>ReadWrite</h1>
  <p><em>Read anything. Write anywhere.</em></p>
  <p>
    <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
    <img alt="Platforms" src="https://img.shields.io/badge/platforms-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey">
    <a href="https://github.com/everettjf/ReadWrite/releases/latest"><img alt="Release" src="https://img.shields.io/github/v/release/everettjf/ReadWrite?include_prereleases&color=blue"></a>
    <a href="https://github.com/everettjf/ReadWrite/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/everettjf/ReadWrite/actions/workflows/ci.yml/badge.svg"></a>
  </p>
  <p>
    <strong><a href="https://github.com/everettjf/readwrite">GitHub</a></strong> ·
    <a href="https://everettjf.github.io/ReadWrite/">Website</a> ·
    <a href="https://github.com/everettjf/ReadWrite/releases/latest">Download</a> ·
    <a href="docs/usage.md">User guide</a>
  </p>
</div>

ReadWrite is a cross-platform desktop app that puts a **reader** and a **Markdown editor** side-by-side. Read a paper, GitHub repo, PDF, or EPUB on the left; take notes — with a real WYSIWYG editor, region screenshots that paste straight into the doc, AI actions, and one-click export to your blog or 微信公众号 — on the right.

The non-obvious bit: long-form AI generation runs through **your locally-installed Claude Code / Codex / Gemini / OpenCode CLI** by default — no extra API key, no extra subscription. If you already pay for one of those, ReadWrite uses the seat you have.

> **Project status: development paused.** ReadWrite is not currently under active development, and no new features or releases are planned for the time being. The source remains available for reference and existing users, but issues and pull requests may not receive a response.

## ReadWrite 1.0

The 1.0 workspace is organized around a tighter **Read → Capture → Write → Publish** loop. A new launch dashboard makes the active workspace, recent drafts, and the app's three core capabilities visible at a glance, while keeping documents as ordinary portable Markdown folders.

<!--
Screenshots — drop PNGs into docs/screenshots/ then uncomment.
Suggested shots:
  1. Main window with reader (web or PDF) on the left, editor with notes on the right.
  2. Generate from reader dialog mid-stream — shows the live char counter / tail preview.
  3. Settings → AI panel showing the External AI CLI section.

<p align="center">
  <img src="docs/screenshots/main.png" alt="ReadWrite main window — reader + editor side by side" width="900" />
</p>
<p align="center">
  <img src="docs/screenshots/generate-from-reader.png" alt="Generate from reader dialog mid-stream" width="700" />
</p>
-->

---

## Why ReadWrite

There's a class of work — reading a paper and writing about it, watching a tutorial and turning it into notes, browsing a repo and drafting a blog post — that doesn't fit either a browser tab or a notes app:

- **Browser-only**: you screenshot, alt-tab, paste, repeat. Nothing remembers what you were reading.
- **Notes-only** (Obsidian, Notion, Bear…): the source material is somewhere else, and pasting URLs is a sad substitute for actually having it _next to_ what you're writing.

ReadWrite is one window: live reader on the left, editor on the right, a snip tool that drops region screenshots straight into your doc, and AI that can read what's in the reader and draft something for you in the editor.

---

## Features

### Reader (left pane)

- **Multi-tab** reader supporting:
  - Any **URL** or **GitHub repo** (`owner/repo` shorthand) via Electron's `WebContentsView` — so cookies, CSP, and sites that set `X-Frame-Options: DENY` (i.e. nearly every authenticated app) just work, unlike iframes.
  - **PDF** via `pdfjs-dist` with continuous scroll and zoom.
  - **EPUB** via `epubjs` + `react-reader`, location persisted per tab.
  - **Local code folder** via Monaco (read-only) + a `chokidar`-driven file tree that hot-refreshes on disk changes.
- **Region snip** (✂️ button or `⇧⌘S` / `Ctrl+Shift+S`) — freezes the reader, drag a rectangle, the cropped PNG saves to the doc's `images/` folder and inserts a relative-path Markdown reference. Web tabs use `WebContentsView.capturePage()`; PDF / EPUB / code use `mainWindow.webContents.capturePage(rect)` — both are native and instant.
- **Recent reader items** list at the bottom of the reader pane — re-open a PDF or web page from history without going through the file dialog again.

### Editor (right pane)

- **Milkdown 7.x WYSIWYG** with GFM, history, slash commands, and a one-click toggle to **CodeMirror 6 source mode** sharing the same buffer.
- Pasting any image (system clipboard / snip / drag-drop) auto-saves to `images/` and inserts a relative-path link.
- Live editor font / family / max-width controlled from Settings.
- Autosave with configurable debounce. Image references stay relative, so moving a doc folder elsewhere keeps everything intact.

### Workspaces

A workspace is just a folder. Each document inside lives in its own subfolder with `<name>.md` plus an `images/` directory next to it.

- **Multi-workspace** — switch between projects from a dropdown in the title bar (or the sidebar header). Each workspace remembers its own last document, open reader tabs, and recent items.
- **Forget vs Delete to Trash** — "Forget" removes a workspace from the list but leaves the folder on disk; "Delete" moves the folder to the system Trash (recoverable).
- **iCloud-friendly default** — on macOS the app suggests `~/Library/Mobile Documents/com~apple~CloudDocs/ReadWrite Notes/` so docs sync across devices automatically.

### AI

Two parallel surfaces with different goals:

**Inline actions (OpenAI-compatible API)** — short, in-place edits with a Cursor-style diff review:

- **Polish** (selection or whole doc), **Translate** (en/zh), **Summarize**, **Explain**, **Interpret with custom prompt**.
- Every destructive change opens a side-by-side diff dialog with **Accept / Reject / Regenerate**. Nothing touches your text until you say so.
- Configurable OpenAI-compatible endpoint — works with OpenAI, DeepSeek, Moonshot, Azure OpenAI, local Ollama, etc. API keys are encrypted with Electron's `safeStorage` (OS keychain on macOS / Windows; libsecret on Linux), never sent to anything but your endpoint.

**Generate from reader (external CLI)** — long-form drafts where the input is what you're reading:

- One-click "Generate from reader…" reads the active reader tab (web text via Readability-style extraction; PDF text via pdfjs), then asks your local AI CLI to draft a Markdown artifact.
- Pick **6 built-in writing styles** — 技术深度 / 随笔 / 教程 / 公众号体 / 科普 / 简报 — and **3 built-in templates** — 技术博客 / 读书笔记 / 新闻摘要. Add your own in Settings.
- Provider matrix: **Claude Code** (recommended, well-tested) — `claude -p --allowedTools ""`, no tool access for safety. **Codex / Gemini / OpenCode** as experimental. **Custom command** for any other CLI you run.
- Live streaming progress (char count + tail preview), cancellable. Output lands in a new doc / appended / replacing current — your choice.

### Publish

- **Copy to WeChat 公众号** — renders the doc with per-element inline `style="..."` (no `<style>` tag — WeChat strips them) and base64-embeds local images. Three themes ship: Default, Serif, Compact. Approach modeled on [Spute/obsidian-copy-to-mp](https://github.com/Spute/obsidian-copy-to-mp).
- **Direct publish to WeChat draft** — uploads inline images via `material/uploadimg`, creates a draft via `draft/add`, opens the WeChat editor for final review. Token cached for the 7200s lifetime.
- **Copy as inlined HTML** for generic targets (email, Notion).

### App-level

- **Welcome / Recent screen** on launch — recent documents on the right (newest first), recent reader items on the left. No more auto-opening yesterday's tab.
- **Standalone settings window** with a sidebar (General / Editor / Images / AI / WeChat / Workspaces / About). Cross-window sync — change a value, every open window updates live.
- **Per-workspace tab session** — closing the app or switching workspaces preserves your open reader tabs.

---

## Quick start

```bash
git clone https://github.com/everettjf/ReadWrite.git
cd ReadWrite
pnpm install         # auto-rebuilds better-sqlite3 against Electron's Node ABI
pnpm dev             # main + preload + renderer with HMR
```

Requires **Node ≥ 20** and **pnpm ≥ 9**. If you ever see a `NODE_MODULE_VERSION` mismatch, run `pnpm run rebuild:native` (the explicit `run` matters — `pnpm rebuild` is a different built-in command).

### Optional: hook up "Generate from reader"

If you already have one of these CLIs installed and authenticated:

```bash
which claude    # Anthropic Claude Code (recommended)
which codex     # OpenAI Codex
which gemini    # Google Gemini CLI
which opencode  # opencode.ai
```

Then in the app: **Settings → AI → External AI CLI → pick provider → Detect CLI**. If detection fails, paste an absolute binary path into the override field; or pick "Custom command…" and write your own template (`{prompt}` is replaced; otherwise prompt comes via stdin).

The CLI runs in a **no-tools / sandboxed mode** so prompt-injected reader content can't trick the model into reading your local files. See `src/main/cli/claude-code.ts` for the exact flags.

---

## Architecture (in one minute)

| Process  | Responsibility                                                                                                 |
| -------- | -------------------------------------------------------------------------------------------------------------- |
| Main     | Window lifecycle, `WebContentsView` tab manager, IPC, SQLite persistence, file watchers, AI / CLI / WeChat IO. |
| Preload  | Typed `contextBridge` exposing `window.api.*` to the renderer.                                                 |
| Renderer | React 18 + Tailwind + shadcn/ui. Reader pane (4 tab kinds), Milkdown / CodeMirror editor, Settings window.     |

Two key boundaries:

- **`WebContentsView` over iframe / `<webview>`** — iframes can't render most authenticated sites due to `X-Frame-Options`; `<webview>` is deprecated. `WebContentsView` is a real Chromium tab living above the renderer DOM, controlled by IPC.
- **External CLI providers as subprocesses** — `src/main/cli/` spawns `claude` / `codex` / `gemini` / `opencode` with `--no-tools`-style flags, pipes the prompt via stdin, captures stdout, emits live progress events. Cancellation kills the subprocess via `AbortSignal`.

The non-obvious decisions — Electron over Tauri, capture-then-overlay snip, per-element inline styles for the WeChat exporter — live in [docs/adr/001-electron-vs-tauri.md](docs/adr/001-electron-vs-tauri.md).

IPC channels are declared once in [`src/shared/ipc-channels.ts`](src/shared/ipc-channels.ts); the preload is fully typed so `window.api.foo()` calls are end-to-end strongly typed.

---

## Project layout

```
src/
├── main/                       # Electron main process
│   ├── index.ts                # entry / lifecycle
│   ├── window.ts               # main + settings BrowserWindow factories
│   ├── tabs.ts                 # WebContentsView tab manager
│   ├── secrets.ts              # Electron safeStorage wrapper for AI keys / WeChat secret
│   ├── cli/                    # external CLI providers (claude / codex / gemini / opencode / custom)
│   ├── db/                     # better-sqlite3 (kv_store)
│   ├── ipc/                    # reader / fs / screenshot / settings / ai / cli / wechat / workspace
│   └── watchers/               # chokidar file watcher hub
├── preload/index.ts            # contextBridge api surface
├── renderer/
│   ├── index.html
│   └── src/
│       ├── App.tsx             # main window root
│       ├── SettingsApp.tsx     # settings window root (loaded at #/settings)
│       ├── components/
│       │   ├── layout/         # SplitView, TitleBar, WorkspaceSwitcher
│       │   ├── reader/         # WebReader, PdfReader, EpubReaderView, CodeReader, TabBar, RecentReaderList
│       │   ├── editor/         # MilkdownEditor, SourceEditor, EditorPane, WelcomePanel
│       │   ├── sidebar/        # DocsSidebar (workspace doc browser + filter)
│       │   ├── settings/       # General / Editor / Images / AI / WeChat / Workspaces / About panels
│       │   ├── dialogs/        # AIDiffDialog, AIInterpretDialog, AIBlogDialog, RenameDocDialog, …
│       │   ├── snip/           # full-window region-snip overlay
│       │   └── ui/             # shadcn primitives
│       ├── stores/             # zustand: tabs, editor, settings, workspace, editor-commands
│       └── lib/                # utils, snip, doc-io, recent-reader, ai-blog-presets, wechat-html, …
└── shared/                     # types + IPC channel names shared across processes
```

---

## Tech stack

- **Shell**: Electron 33+, electron-vite, electron-builder
- **UI**: React 18, Tailwind 3, shadcn/ui (Radix primitives), lucide-react, react-resizable-panels
- **Editor**: Milkdown 7.x (commonmark, gfm, history, listener, clipboard, upload), CodeMirror 6
- **Reader**: pdfjs-dist, epubjs + react-reader, Monaco, Electron `WebContentsView`
- **Data**: better-sqlite3 (settings, sessions, recents), Electron `safeStorage` (encrypted secrets), chokidar (file watching), Zustand (state)
- **AI**: OpenAI-compatible HTTP for short actions; subprocess execution of `claude` / `codex` / `gemini` / `opencode` for long-form generation
- **Tooling**: TypeScript strict, ESLint, Prettier, Husky, lint-staged, commitlint (Conventional Commits), Vitest

---

## Roadmap

Tracked in [CHANGELOG.md](CHANGELOG.md). Things on my radar:

- [ ] Code-signing for macOS (Apple Developer ID) and Windows (Authenticode) so Gatekeeper / SmartScreen warnings go away.
- [ ] Mozilla Readability for web content extraction (currently a hand-rolled DOM heuristic — works for ~80% of articles).
- [ ] Recent items in the New-Tab dialog so they're reachable when the reader isn't empty.
- [ ] Snip rectangle: drag handles for post-release adjustment.
- [ ] Better stream-json parsing for Claude Code (we currently rely on `--output-format text` + a byte counter; full event parsing would unlock per-phase progress).
- [ ] Drag-reorder reader tabs.
- [ ] Per-doc YAML frontmatter editor.

---

## Contributing

PRs welcome. The basics:

- Branch off `main`. Use [Conventional Commits](https://www.conventionalcommits.org/).
- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` must all pass; CI runs them on every PR.
- For non-trivial changes, open an issue first so we can agree on direction.

Reference docs:

- [docs/usage.md](docs/usage.md) — full end-user guide: install, reader, snip, editor, AI, publishing, settings, troubleshooting.
- [CONTRIBUTING.md](CONTRIBUTING.md) — code style, commit conventions, PR norms.
- [docs/develop.md](docs/develop.md) — building distributables, cutting releases, signing notes, troubleshooting.
- [docs/testing.md](docs/testing.md) — black-box test plan for manual QA before a release.

---

## Acknowledgements

- The "Copy to WeChat 公众号" pipeline — particularly the per-element inline-styles approach and the `<li>`-children-wrapped-in-`<p>` quirk — was directly modeled on [Spute/obsidian-copy-to-mp](https://github.com/Spute/obsidian-copy-to-mp). Different runtime, same set of WeChat-editor pain points.
- [Anthropic Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview), [OpenAI Codex CLI](https://github.com/openai/codex), [Google Gemini CLI](https://github.com/google-gemini/gemini-cli), and [OpenCode](https://opencode.ai/) — the four agentic CLIs the "Generate from reader" feature wraps.
- [Milkdown](https://milkdown.dev/) for the WYSIWYG core, [CodeMirror](https://codemirror.net/) for the source mode, [pdfjs-dist](https://github.com/mozilla/pdf.js) for PDFs, [epubjs](https://github.com/futurepress/epub.js) for EPUBs.
- [shadcn/ui](https://ui.shadcn.com/) and [Radix UI](https://www.radix-ui.com/) for accessible primitives that don't need a 200KB component library to look good.

---

## License

[MIT](LICENSE) © everettjf
