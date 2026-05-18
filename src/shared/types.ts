export type TabKind = 'web' | 'github' | 'pdf' | 'epub' | 'code';

export interface TabBase {
  id: string;
  kind: TabKind;
  title: string;
  createdAt: number;
}

export interface WebTab extends TabBase {
  kind: 'web' | 'github';
  url: string;
  canGoBack?: boolean;
  canGoForward?: boolean;
  loading?: boolean;
}

export interface PdfTab extends TabBase {
  kind: 'pdf';
  path: string;
  page?: number;
}

export interface EpubTab extends TabBase {
  kind: 'epub';
  path: string;
  location?: string;
}

export interface CodeTab extends TabBase {
  kind: 'code';
  rootPath: string;
  activeFile?: string;
}

export type Tab = WebTab | PdfTab | EpubTab | CodeTab;

export interface TabBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScreenshotOptions {
  tabId: string;
  /** Path of the markdown file currently being edited; needed when imagesDirMode === 'next-to-doc'. */
  markdownPath?: string | null;
  format?: 'png' | 'jpeg';
  quality?: number;
}

export interface ScreenshotResult {
  dataUrl: string;
  /** Absolute disk path where the PNG was saved, if any. */
  savedPath?: string;
  /** Path relative to the current markdown file (when next-to-doc mode resolves). */
  relativePath?: string;
  width: number;
  height: number;
}

export interface MarkdownDocument {
  path?: string;
  content: string;
  dirty: boolean;
  frontmatter?: Record<string, unknown>;
}

export type ImagesDirMode = 'next-to-doc' | 'custom' | 'pictures';

/**
 * UI language. 'system' resolves to the OS / browser locale at runtime;
 * 'en' / 'zh' are explicit overrides. Anything else is normalized to 'en'.
 */
export type UiLanguageSetting = 'system' | 'en' | 'zh';

export interface AppSettings {
  theme: 'light' | 'dark' | 'system';
  language: UiLanguageSetting;
  editorMode: 'wysiwyg' | 'source';
  fontSize: number;
  splitRatio: number;

  // Editor
  editorFontSize: number;
  editorFontFamily: 'sans' | 'serif' | 'mono';
  editorMaxWidth: number;

  // Images / screenshots
  imagesDirMode: ImagesDirMode;
  imagesDirCustom?: string;
  imagesDirSubfolderName: string;

  // AI (inline actions — Polish / Translate / Summarize / Explain / Interpret)
  aiEnabled: boolean;
  /** Which vendor API to call. 'openai-compatible' uses an arbitrary
   *  endpoint URL — for DeepSeek (legacy), Moonshot, Kimi, Ollama, Azure
   *  OpenAI deployments, etc. */
  aiProvider: 'openai' | 'anthropic' | 'google' | 'deepseek' | 'openai-compatible';
  /** Used only when aiProvider === 'openai-compatible'. */
  aiEndpoint: string;
  aiApiKey: string;
  aiModel: string;
  aiSystemPrompt: string;

  // External AI CLI (used for long-form generation like the blog feature)
  /** Which external CLI to use for long-form tasks. 'none' disables CLI generation. */
  aiCliProvider: 'none' | 'claude-code' | 'codex' | 'gemini' | 'opencode' | 'custom';
  /** Optional absolute path to the claude binary; falls back to PATH lookup. */
  aiCliClaudePath?: string;
  /** Optional absolute path to the codex binary; falls back to PATH lookup. */
  aiCliCodexPath?: string;
  /** Optional absolute path to the gemini binary. */
  aiCliGeminiPath?: string;
  /** Optional absolute path to the opencode binary. */
  aiCliOpencodePath?: string;
  /** Full command template for the 'custom' provider, e.g. "my-cli --print {prompt}". */
  aiCliCustomCommand?: string;

  /** User-defined writing styles for the "Generate from reader" flow. */
  aiCustomStyles?: AIPresetEntry[];
  /** User-defined templates (artifact shapes) for the "Generate from reader" flow. */
  aiCustomTemplates?: AIPresetEntry[];

  // WeChat 公众号
  wechatAppId?: string;
  wechatAppSecret?: string;
  /** Theme id used by the "Copy to WeChat" export pipeline. */
  wechatExportTheme: string;

  // Editor lifecycle
  /** Autosave debounce in ms (0 to disable). */
  autosaveDebounceMs: number;

  // Layout
  /** Whether the workspace docs sidebar is visible. */
  sidebarVisible: boolean;

  /** How to order the docs sidebar list. */
  docSortKey: DocSortKey;

  /** User-curated shortcuts shown on the reader empty state. */
  quickLinks: QuickLink[];
}

/**
 * Frequently-used URLs (news, dashboards, etc.) the user wants one click
 * away from the reader empty state.
 */
export interface QuickLink {
  id: string;
  name: string;
  url: string;
}

/**
 * Persisted AI preset (style or template). Stored on AppSettings; shape
 * mirrors the in-renderer AIPreset but lives in @shared so the main
 * process can validate it during settings IO.
 */
export interface AIPresetEntry {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
}

export interface DocSummary {
  /** Absolute path to the markdown file. */
  path: string;
  /** Display name (the doc folder's basename, which always matches the .md basename). */
  name: string;
  /** mtime in milliseconds (sortable). */
  mtime: number;
  /** birthtime in milliseconds. Falls back to mtime on filesystems without birthtime. */
  ctime: number;
}

/** How the docs sidebar list is ordered. */
export type DocSortKey = 'mtime' | 'ctime' | 'name';

export interface WechatPublishPayload {
  title: string;
  author?: string;
  digest?: string;
  /** Source URL to link to from the article footer (optional). */
  contentSourceUrl?: string;
  /** WeChat-ready HTML — must contain at least one `<img src="data:image/...;base64,...">` to use as the cover. */
  htmlContent: string;
}

export interface WechatPublishResult {
  /** Returned by /cgi-bin/draft/add — used to navigate or freepublish/submit later. */
  draftMediaId: string;
  /** How many inline images we uploaded. */
  inlineImageCount: number;
}

/**
 * Persisted reader-tab metadata. Reconstructed into live tabs on app boot
 * and on workspace switch. Web tabs always recreate fresh WebContentsViews
 * (Electron can't hibernate them); local-DOM tabs (PDF / EPUB / code) just
 * restore their addressable resource.
 */
export type SavedTab =
  | { kind: 'web' | 'github'; url: string; title?: string }
  | { kind: 'pdf'; path: string; title?: string; page?: number }
  | { kind: 'epub'; path: string; title?: string; location?: string | number }
  | { kind: 'code'; rootPath: string; title?: string; activeFile?: string };

export interface SavedTabSession {
  tabs: SavedTab[];
  /** Index into `tabs` of the active tab (if any). */
  activeIndex?: number;
}

/**
 * Per-workspace history of reader items the user has opened. Stored
 * separately from the live tab session so closing a tab doesn't drop
 * it from the "Recent" list. Capped at ~30 entries per workspace,
 * dedup'd on (kind, ref).
 */
export type RecentReaderItem =
  | { kind: 'web' | 'github'; url: string; title?: string; ts: number }
  | { kind: 'pdf'; path: string; title?: string; ts: number }
  | { kind: 'epub'; path: string; title?: string; ts: number }
  | { kind: 'code'; rootPath: string; title?: string; ts: number };

export interface KnownWorkspace {
  /** Absolute path to the workspace folder. */
  path: string;
  /** Display label, defaults to the basename of the path; user can rename. */
  name: string;
  /** Last time the user activated this workspace (ms since epoch). */
  lastOpenedAt: number;
}

export interface FileTreeEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileTreeEntry[];
}

export interface AICompletionRequest {
  /** The text the user wants the LLM to act on. */
  input: string;
  /** Optional task specifier; when omitted the configured systemPrompt is used as-is. */
  instruction?: string;
  /** Caller-supplied id used to correlate progress events / cancel calls. */
  jobId?: string;
}

/** One streaming chunk from the AI. */
export interface AICompletionProgress {
  jobId: string;
  /** Text added since the previous progress event. */
  delta: string;
  /** Full text generated so far. */
  total: string;
}

export interface AICompletionResult {
  text: string;
  model: string;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
}

export interface CliDetectRequest {
  provider: 'claude-code' | 'codex' | 'gemini' | 'opencode';
  /** Optional explicit path to the binary; overrides PATH lookup. */
  pathOverride?: string;
}

export interface CliDetectResponse {
  available: boolean;
  /** Version line as printed by the CLI (best-effort parse). */
  version?: string;
  /** The resolved or supplied binary path. */
  resolvedPath?: string;
  /** Human-readable error if not available. */
  error?: string;
}

export interface ImageSaveOptions {
  /** Path of the markdown file currently being edited (for next-to-doc resolution). */
  markdownPath?: string | null;
  /** Image content, base64-encoded. */
  base64: string;
  /** MIME type, e.g. 'image/png'. */
  mime: string;
  /** Optional friendly name (extension will be coerced from mime). */
  suggestedName?: string;
}

export interface ImageSaveResult {
  savedPath: string;
  /** Path relative to the current markdown file, when resolution allows it. */
  relativePath?: string;
  width?: number;
  height?: number;
}
