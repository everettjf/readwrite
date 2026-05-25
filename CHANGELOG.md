# Changelog

All notable changes to ReadWrite will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_Nothing yet._

## [0.1.11] — 2026-05-25

### Fixed

- **build**: exclude release/ from app.asar to prevent bundle bloat (2a448f6)

## [0.1.10] — 2026-05-18

### Added

- **layout**: center editor content across editor + sidebar (ee73426)
- **ai**: rewrite tech blog template as What → How → Why narrative (5e165f9)
- **reader**: preserve links and images as Markdown when extracting article text (9666ec4)
- **sidebar**: make docs list sort selectable (modified / created / name) (82cad59)
- **ai**: allow minimizing Generate from reader while generation continues (0039a74)

### Fixed

- **editor**: stop autosave from rewriting freshly-opened docs (458fc33)
- **ai**: route openai-compatible to /chat/completions and surface stream errors (6982d36)

## [0.1.9] — 2026-05-16

### Added

- **reader**: add user-editable Quick Links on empty state (4648a48)

## [0.1.8] — 2026-05-13

### Fixed

- **main**: don't re-register IPC handlers on macOS activate (832334f)

## [0.1.7] — 2026-05-13

### Fixed

- **secrets**: discard unreadable safeStorage ciphertext on read (2aaeff4)

## [0.1.6] — 2026-05-11

### Added

- **reader**: floating selection toolbar across all readers (PDF / EPUB / Code / Web). Select a passage in the reader pane and a small toolbar appears above the selection with one-click _Summarize → notes_, _Translate → notes_, _Interpret…_, and _Custom…_ actions — each one feeds the selected text into the existing AIInterpretDialog so the result lands directly in the note you're writing. (8ffadaa)
- **reader/pdf**: PDFs now have a real text layer overlaid on the canvas, so passages are selectable (and feed the new toolbar). Re-renders cleanly on zoom; the text layer is torn down on unmount so the toolbar never lingers across reader switches. (8ffadaa)
- **shortcut**: `⌘⇧A` / `Ctrl+Shift+A` opens the AI dialog with the current reader selection pre-filled and an empty prompt, for free-form chat against the passage without going through the toolbar. (8ffadaa)
- **i18n**: zh/en strings for the new selection toolbar and its default prompts. (8ffadaa)

### Changed

- **ai/interpret-dialog**: reworked to also accept reader-side selections as input, not just editor selections — the dialog is now the single AI surface for both panes. (8ffadaa)

## [0.1.5] — 2026-04-28

### Fixed

- **ci**: tighten release asset filter to ReadWrite-* (e5c5550)

## [0.1.4] — 2026-04-28

### Fixed

- **ci**: pass --publish=never to electron-builder (331ced1)

## [0.1.3] — 2026-04-28

### Changed

- Internal updates. See git log for details.

## [0.1.2] — 2026-04-28

### Fixed

- **packaging**: hoist node_modules; wire up electron-updater (27017d0)

## [0.1.1] — 2026-04-27

### Added

- **i18n,ui**: add zh/en, name-first workspace dialog, brand polish (a611a22)

### Fixed

- **ci**: exclude internal NSIS helpers from release uploads (aec73c0)

## [0.1.0] — 2026-04-25

The first published release of ReadWrite — a side-by-side reader + Markdown editor with workspaces, screenshots, AI actions, and WeChat 公众号 publishing.

### Highlights

- **Workspace model** — pick or create a folder; every document lives inside as its own subfolder with a `<name>.md` plus an `images/` directory. Move the folder anywhere; relative-path image refs travel with the doc.
- **Multi-tab reader** for the web (real Chromium via `WebContentsView`, so cookies / CSP / `X-Frame-Options: DENY` sites all work), GitHub (`owner/repo` shorthand), PDFs, EPUBs, and local code folders.
- **Milkdown WYSIWYG editor** with a one-click toggle to a full **CodeMirror 6 source mode** that shares the same buffer. Autosave with a configurable debounce.
- **Region-snip tool** (⇧⌘S / Ctrl+Shift+S): drag a rectangle on any reader pane, the cropped PNG goes to the clipboard *and* into the doc's `images/` folder, with a relative-path Markdown link inserted automatically.
- **AI actions** (OpenAI-compatible endpoint, BYO key): Polish selection / whole document, Translate selection or document to English / 中文, Summarize, Explain, plus an Interpret dialog with a custom prompt. API keys live in the OS keychain via Electron's `safeStorage`.
- **Copy to WeChat 公众号** with three style themes — produces self-contained HTML (per-element inline styles, no `<style>` tag, base64-embedded images, the `<li>`-children-wrapped-in-`<p>` quirk) that survives a paste into mp.weixin.qq.com unchanged.
- **Direct publish to WeChat**: upload all images, create a draft, and (optionally) push it to followers — all without leaving the editor.

### Detailed feature list

#### Workspaces (Obsidian-style)
- Mandatory workspace concept. The first-launch onboarding offers three paths: create a new workspace, open an existing folder, or pick from recent ones.
- iCloud-friendly defaults — on macOS, the picker suggests iCloud Drive ahead of `~/Documents` so notes sync across your Macs by default.
- Multiple workspaces, switchable from a title-bar dropdown or `Settings → Workspaces`. Cross-window sync via a `workspace:active-changed` broadcast keeps the main and Settings windows in sync.
- Per-workspace last-doc memory: the document you were editing reopens automatically on next launch, per workspace.
- Settings → Workspaces panel: list, switch, reveal-in-Finder, forget. "Forget" only removes the entry from the known list — the folder on disk is preserved.

#### Documents
- Folder-per-document model — `<name>.md` + `images/` per doc.
- New / Open / Rename buttons in the title bar. Rename atomically renames both the folder and the .md; relative image refs keep working.
- Path transforms at the I/O boundary: in-memory editor content carries `file://` image URLs (so the WYSIWYG view actually renders them), but on save they're rewritten to relative paths so the on-disk markdown is portable.
- Autosave (default 1.5 s debounce, configurable) — first edit on the welcome doc lazily creates the folder.
- Workspace docs sidebar (toggleable) listing every document, sorted by last modified, with search filter and per-doc Rename / Reveal in Finder / Move to Trash. Auto-refreshes when the workspace folder changes on disk (Finder, iCloud, Git pulls).
- Move to Trash uses `shell.trashItem` so docs go to the system Trash and can be restored.

#### Reader
- Web / GitHub tabs render in a native Electron `WebContentsView` (not iframe) so cookies, CSP, and `X-Frame-Options: DENY` sites Just Work.
- PDF via `pdfjs-dist` with page nav and zoom.
- EPUB via `epubjs` + `react-reader`, with location persisted per tab.
- Local code folder via Monaco (read-only) + a `chokidar`-driven file tree that hot-refreshes on disk changes.

#### Editor
- Milkdown 7.x with commonmark + GFM + history + listener + clipboard + upload presets.
- CodeMirror 6 source-mode toggle that shares the buffer.
- Live editor font / family / max-width controlled by CSS variables driven from settings.
- Pasted/dropped images are auto-saved to the doc's `images/` folder via `@milkdown/plugin-upload`, then inserted as a relative Markdown link.

#### Snip
- Title-bar Crop button (also ⇧⌘S / Ctrl+Shift+S) freezes the reader pane, lets you drag a rectangle, and routes the cropped PNG to clipboard + disk + editor in one motion. For web tabs the native `WebContentsView` is briefly hidden so the renderer-side overlay can be drawn on top, then restored automatically.

#### AI
- OpenAI-compatible endpoint configurable in Settings → AI. Works with OpenAI, DeepSeek, Moonshot, Azure OpenAI, Ollama (local), etc.
- Connection test in Settings issues a real chat-completions request.
- Editor-toolbar AI menu with Polish (selection / doc), Translate (selection / doc → English / 中文), Summarize, Explain, and Interpret-with-prompt actions.
- Interpret dialog accepts a custom prompt (with quick-pick chips for common ones), then lets the user review and choose where to insert the response.
- AI requests route through the main process; the API key never leaves the renderer's network panel.

#### WeChat 公众号
- Settings → WeChat: AppID + AppSecret with a credential-verification button that hits the real `cgi-bin/token` endpoint.
- Editor toolbar → Export → **Copy to WeChat 公众号**: three themes (Default sans, Serif, Compact). Inline-styled HTML, base64-embedded images.
- Editor toolbar → Export → **Publish draft to WeChat 公众号**: uploads every inline image to WeChat's permanent media endpoint, replaces `data:` URLs with `mmbiz.qpic.cn` URLs, uploads the cover separately for `thumb_media_id`, and POSTs the article to `/cgi-bin/draft/add`. Access tokens are cached for 7200s.
- A "Publish to followers" button on the draft success state calls `/cgi-bin/freepublish/submit` to push the article live without round-tripping through mp.weixin.qq.com.

#### Security
- AI API key and WeChat AppSecret are encrypted at rest via Electron's `safeStorage` (macOS Keychain, Windows DPAPI, Linux libsecret). The renderer never sees ciphertext; the main process decrypts on demand. Existing plaintext values from older installs auto-migrate on first launch.

#### Build & release
- `electron-builder` configuration for macOS (`.dmg`), Windows (NSIS), Linux (AppImage + `.deb`).
- `deploy.sh` script for local cross-platform packaging and tag-triggered CI release.
- `.github/workflows/release.yml`: tag-triggered three-OS matrix that builds all three platforms natively and publishes a GitHub Release with the binaries attached. Release notes are auto-extracted from this CHANGELOG.
- v0.1.0 binaries ship unsigned — macOS users open with right-click → Open the first time; Windows users see SmartScreen warnings.

#### Tooling
- TypeScript strict across all three processes.
- ESLint + Prettier + Husky + lint-staged + commitlint (Conventional Commits) on every commit.
- Vitest for unit tests; GitHub Actions CI runs typecheck + lint + test on every PR plus a cross-platform build.

### Acknowledgements
- The "Copy to WeChat 公众号" pipeline borrowed the per-element inline-styles approach and the `<li>`-children-wrapped-in-`<p>` quirk directly from [Spute/obsidian-copy-to-mp](https://github.com/Spute/obsidian-copy-to-mp).
- [Milkdown](https://milkdown.dev/), [CodeMirror](https://codemirror.net/), [pdfjs-dist](https://github.com/mozilla/pdf.js), [epubjs](https://github.com/futurepress/epub.js), [shadcn/ui](https://ui.shadcn.com/), [Radix UI](https://www.radix-ui.com/).
