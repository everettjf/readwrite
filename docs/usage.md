# ReadWrite — User Guide

> **Read anything. Write anywhere.** This is the full how-to-use guide. For a feature overview see the [README](../README.md); for building from source and cutting releases see [docs/develop.md](develop.md).

ReadWrite is one window split in two: a **reader** on the left and a **Markdown editor** on the right. You read source material — a web page, GitHub repo, PDF, EPUB, or local code folder — and write notes next to it, with region screenshots, AI assistance, and one-click publishing.

---

## Table of contents

1. [Installation](#installation)
2. [First launch & workspaces](#first-launch--workspaces)
3. [The reader (left pane)](#the-reader-left-pane)
4. [Region snip](#region-snip)
5. [The editor (right pane)](#the-editor-right-pane)
6. [Documents & images on disk](#documents--images-on-disk)
7. [AI — inline actions](#ai--inline-actions)
8. [AI — generate from reader](#ai--generate-from-reader)
9. [Publishing](#publishing)
10. [Settings reference](#settings-reference)
11. [Keyboard shortcuts](#keyboard-shortcuts)
12. [Troubleshooting](#troubleshooting)

---

## Installation

### Download a build

Grab the latest installer for your platform from the [Releases page](https://github.com/everettjf/ReadWrite/releases/latest):

| Platform | File                 | Notes                              |
| -------- | -------------------- | ---------------------------------- |
| macOS    | `.dmg`               | Universal — Apple Silicon & Intel. |
| Windows  | `.exe`               | NSIS installer.                    |
| Linux    | `.AppImage` / `.deb` | AppImage is `chmod +x` and run.    |

> **The builds are not code-signed yet.** On first launch the OS may warn you:
>
> - **macOS** — if you see _"ReadWrite can't be opened because Apple cannot check it for malicious software,"_ right-click the app → **Open** → **Open**, or go to **System Settings → Privacy & Security** and click **Open Anyway**. If macOS reports the app is "damaged", clear the quarantine attribute: `xattr -dr com.apple.quarantine /Applications/ReadWrite.app`.
> - **Windows** — on the SmartScreen prompt click **More info → Run anyway**.

### Run from source

```bash
git clone https://github.com/everettjf/ReadWrite.git
cd ReadWrite
pnpm install      # auto-rebuilds better-sqlite3 against Electron's Node ABI
pnpm dev          # main + preload + renderer with HMR
```

Requires **Node ≥ 20** and **pnpm ≥ 9**. If you hit a `NODE_MODULE_VERSION` mismatch, run `pnpm run rebuild:native` (the explicit `run` matters — `pnpm rebuild` is a different built-in).

---

## First launch & workspaces

On first launch you'll land on the **Welcome / Recent** screen: recent documents on the right (newest first), recent reader items on the left. Nothing auto-opens.

**A workspace is just a folder.** Pick one to begin:

- On macOS the default suggestion is `~/Library/Mobile Documents/com~apple~CloudDocs/ReadWrite Notes/`, which lives in iCloud Drive so your notes sync across devices automatically.
- You can point a workspace at any folder — an existing notes directory, a Git repo, anywhere.

Switch between workspaces from the dropdown in the title bar (or the sidebar header). **Each workspace independently remembers** its last open document, its reader tabs, and its recent items.

- **Forget** removes a workspace from the list but leaves the folder untouched on disk.
- **Delete** moves the workspace folder to the system Trash (recoverable).

---

## The reader (left pane)

The reader is **multi-tab** and handles four kinds of source. Open a new tab with the `+` button in the reader tab bar, then:

| Source          | How to open                                                          |
| --------------- | -------------------------------------------------------------------- |
| **Web page**    | Paste any `https://…` URL.                                           |
| **GitHub repo** | Type the `owner/repo` shorthand (e.g. `everettjf/ReadWrite`).        |
| **PDF**         | Open a local `.pdf` — continuous scroll with zoom.                   |
| **EPUB**        | Open a local `.epub` — reading location is saved per tab.            |
| **Code folder** | Open a local directory — read-only Monaco viewer + a live file tree. |

A few things worth knowing:

- **Web and GitHub tabs are real Chromium views** (`WebContentsView`), not iframes. That's why authenticated sites, cookies, and sites that send `X-Frame-Options: DENY` render correctly — nearly every real app works.
- **The code-folder file tree hot-refreshes** when files change on disk (via a `chokidar` watcher), so it stays in sync if you're editing the code elsewhere.
- **Recent reader items** appear at the bottom of the reader pane — re-open a PDF or page from history without the file dialog.
- **Tab sessions are restored** — closing the app or switching workspaces preserves your open reader tabs.

> **Tip:** `src/renderer/src/lib/open-tab.ts` is the single code path that creates reader tabs, so the `+` dialog, empty state, and quick links all behave identically.

---

## Region snip

The snip tool is the bridge between reading and writing: capture a rectangle of the reader and drop it into your doc as an image.

1. Click the **✂️ button** in the reader toolbar, or press **`⇧⌘S`** (macOS) / **`Ctrl+Shift+S`** (Windows/Linux).
2. The reader freezes. **Drag a rectangle** over the region you want.
3. The cropped PNG is saved into the active document's `images/` folder and a **relative-path Markdown image reference** is inserted into the editor at the cursor.

Capture is native and instant: web tabs use `WebContentsView.capturePage()`; PDF / EPUB / code tabs use `webContents.capturePage(rect)`.

---

## The editor (right pane)

The editor is **Milkdown 7.x WYSIWYG** with GitHub-Flavored Markdown, undo/redo history, and slash commands. Type `/` for a command menu (headings, lists, code blocks, tables, etc.).

- **Toggle source mode** — one click switches to a **CodeMirror 6** raw-Markdown view sharing the same buffer, for when you want to edit the source directly. Toggle back at any time.
- **Paste images anywhere** — system clipboard, a snip, or drag-and-drop. The image auto-saves into `images/` and inserts a relative-path link (see [the `imagesDirMode` setting](#settings-reference) to control placement).
- **Autosave** runs on a configurable debounce — you rarely press save.
- Editor **font, family, and max content width** are all controllable from Settings.

---

## Documents & images on disk

ReadWrite keeps your content as plain files, not in a database:

```
<workspace folder>/
├── my-first-note/
│   ├── my-first-note.md
│   └── images/
│       ├── snip-01.png
│       └── pasted-02.png
└── another-doc/
    ├── another-doc.md
    └── images/
```

- Each document is **its own subfolder** containing `<name>.md` and an `images/` directory.
- **Image references stay relative** (`images/snip-01.png`), so you can move, sync, or back up a document folder and the references never break.
- Because everything is Markdown on disk, you can open the same folder in Obsidian, VS Code, or any editor — ReadWrite doesn't lock your content in.

Renaming a document (via the **Rename** dialog) renames both the folder and the `.md` file together.

---

## AI — inline actions

Inline actions are short, in-place edits over an **OpenAI-compatible HTTP API**. They never overwrite your text silently — every change opens a **Cursor-style diff** with **Accept / Reject / Regenerate**.

Available actions (on a selection, or the whole document):

| Action        | What it does                                                 |
| ------------- | ------------------------------------------------------------ |
| **Polish**    | Improves wording, grammar, and flow.                         |
| **Translate** | Between English and Chinese.                                 |
| **Summarize** | Condenses to key points.                                     |
| **Explain**   | Explains the selected text.                                  |
| **Interpret** | Runs a custom prompt of your choosing against the selection. |

### Set it up

**Settings → AI → API**:

1. Choose a provider / set an **OpenAI-compatible base URL**. Works with OpenAI, Anthropic, Google, DeepSeek, Moonshot (Kimi), Azure OpenAI, or a local **Ollama** endpoint.
2. Paste your **API key** — it's encrypted with the OS keychain (Electron `safeStorage`), never written to the settings file in plaintext.
3. Set the **model name**.

Output streams in live. Nothing in your document changes until you click **Accept**.

---

## AI — generate from reader

This is the long-form surface: draft a full Markdown artifact from whatever is in the active reader tab — using a **CLI you already have installed**, so there's **no extra API key and no extra subscription**.

### How it works

1. Open something in the reader (a paper, an article, a PDF).
2. Click **"Generate from reader…"** in the editor.
3. ReadWrite extracts the reader's text (web via a Readability-style pass; PDF via pdfjs), picks a **writing style** and **template**, and pipes the prompt to your local AI CLI.
4. The draft **streams in** (with a live character count and tail preview). It's **cancellable** at any time.
5. Route the result to a **new document**, **append** to the current one, or **replace** the current content — your choice.

### Built-in styles & templates

- **Styles** — 技术深度 (technical depth) / 随笔 (essay) / 教程 (tutorial) / 公众号体 (WeChat article voice) / 科普 (popular science) / 简报 (brief).
- **Templates** — 技术博客 (tech blog) / 读书笔记 (reading notes) / 新闻摘要 (news digest).

You can add your own styles and templates in Settings.

### Pick & configure a provider

**Settings → AI → External AI CLI**:

| Provider        | Status                   | Notes                                                                                           |
| --------------- | ------------------------ | ----------------------------------------------------------------------------------------------- |
| **Claude Code** | Recommended, well-tested | Runs `claude -p --allowedTools ""` — no tool access.                                            |
| **Codex**       | Experimental             | OpenAI Codex CLI.                                                                               |
| **Gemini**      | Experimental             | Google Gemini CLI.                                                                              |
| **OpenCode**    | Experimental             | opencode.ai.                                                                                    |
| **Custom**      | Any CLI                  | Your own command template (`{prompt}` is substituted; otherwise the prompt is piped via stdin). |

Check what you already have, then let the app detect it:

```bash
which claude    # Anthropic Claude Code (recommended)
which codex     # OpenAI Codex
which gemini    # Google Gemini CLI
which opencode  # opencode.ai
```

In the app: **Settings → AI → External AI CLI → pick provider → Detect CLI**. If detection fails, paste an absolute binary path into the override field.

> **Safety:** the CLI runs in a **no-tools / sandboxed mode** so that prompt-injected content from a reader page can't trick the model into reading your local files. See `src/main/cli/claude-code.ts` for the exact flags.

---

## Publishing

When a draft is ready, ReadWrite renders it for the platforms people actually post to.

### Copy to WeChat 公众号

Renders the document with **per-element inline `style="…"`** (WeChat strips `<style>` tags) and **base64-embeds local images**, then copies it to the clipboard ready to paste into the WeChat editor. Three themes ship: **Default, Serif, Compact**.

### Direct publish to a WeChat draft

Uploads inline images via `material/uploadimg`, creates a draft via `draft/add`, and opens the WeChat editor for final review. The access token is cached for its 7200-second lifetime. Configure your `appId` / `appSecret` in **Settings → WeChat** (the secret is stored in the OS keychain).

### Copy as inlined HTML

For generic targets — email, Notion, etc. — copy the rendered document as self-contained HTML with inlined styles.

---

## Settings reference

Open settings from the title bar; it's a **standalone window** with a sidebar. Changes sync live to every open window.

| Panel          | What's in it                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------ |
| **General**    | Theme, default workspace behavior, app-level preferences.                                                    |
| **Editor**     | Font family, font size, content max-width, autosave debounce.                                                |
| **Images**     | `imagesDirMode`: `next-to-doc` (default) / `custom` / `pictures` — where pasted/snipped images are saved.    |
| **AI**         | OpenAI-compatible API (base URL, key, model) **and** the External AI CLI provider + custom styles/templates. |
| **WeChat**     | `appId` / `appSecret` for direct draft publishing.                                                           |
| **Workspaces** | Manage the workspace list (forget / delete).                                                                 |
| **About**      | Version and links.                                                                                           |

Secrets (AI API keys, WeChat `appSecret`) are stored via Electron `safeStorage` (OS keychain on macOS/Windows, libsecret on Linux), never in the settings blob.

---

## Keyboard shortcuts

| Action      | macOS                  | Windows / Linux     |
| ----------- | ---------------------- | ------------------- |
| Region snip | `⇧⌘S`                  | `Ctrl+Shift+S`      |
| Undo / Redo | `⌘Z` / `⇧⌘Z`           | `Ctrl+Z` / `Ctrl+Y` |
| Save        | Autosaves; `⌘S` forces | `Ctrl+S`            |

(Slash commands inside the editor — type `/` — cover headings, lists, code blocks, tables, and more.)

---

## Troubleshooting

**"ReadWrite can't be opened" / "is damaged" on macOS** — the build isn't notarized yet. Right-click → Open, or run `xattr -dr com.apple.quarantine /Applications/ReadWrite.app`.

**`NODE_MODULE_VERSION` mismatch when running from source** — run `pnpm run rebuild:native` (the explicit `run` is required).

**"Generate from reader" fails or hangs** — the most common cause is a provider CLI flag that drifted between versions. Confirm the CLI runs standalone (`claude -p "hello"`), re-run **Detect CLI**, or paste an absolute path in the override field. Codex / Gemini / OpenCode are experimental and the most likely to need adjustment; Claude Code is the best-tested path. Please [open an issue](https://github.com/everettjf/ReadWrite/issues) noting which provider and version failed.

**A web page won't load in the reader** — some sites block all embedding. Most authenticated sites work because of `WebContentsView`; if one doesn't, please report it.

**Inline AI action returns nothing** — check the base URL, key, and model name in **Settings → AI → API**. For local Ollama, make sure the server is running and the model is pulled.

**Images broke after moving a folder** — references are relative to the document's folder. Move the whole document subfolder (including its `images/` directory) as a unit, not just the `.md`.

---

Still stuck? Open an issue at <https://github.com/everettjf/ReadWrite/issues>. Bug reports and PRs are very welcome — this is early-stage open source.
