import { WebContentsView, ipcMain, nativeImage } from 'electron';
import type { BrowserWindow } from 'electron';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import type { TabBounds, Tab, ScreenshotResult } from '@shared/types';
import { IPC } from '@shared/ipc-channels';

interface SelectionRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface SelectionInboundPayload {
  text: string;
  rect: SelectionRect | null;
}

interface ManagedTab {
  id: string;
  kind: 'web' | 'github';
  view: WebContentsView;
  url: string;
  title: string;
  visible: boolean;
  bounds: TabBounds;
}

export class TabManager {
  private tabs = new Map<string, ManagedTab>();
  private activeTabId: string | null = null;
  /** webContents.id → tab id, for routing the selection IPC back to a tab. */
  private byWebContentsId = new Map<number, string>();

  constructor(private win: BrowserWindow) {
    this.registerSelectionRelay();
  }

  createWebTab(url: string, kind: 'web' | 'github' = 'web'): Tab {
    const id = nanoid(10);
    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        // Mirrors the path resolution used for the main preload in
        // src/main/index.ts. Built output: out/preload/web-tab.mjs.
        preload: join(__dirname, '../preload/web-tab.mjs'),
      },
    });

    const managed: ManagedTab = {
      id,
      kind,
      view,
      url,
      title: url,
      visible: false,
      bounds: { x: 0, y: 0, width: 0, height: 0 },
    };

    view.webContents.on('page-title-updated', (_e, title) => {
      managed.title = title;
      this.broadcastState(id);
    });

    view.webContents.on('did-navigate', (_e, nav) => {
      managed.url = nav;
      this.broadcastState(id);
    });

    view.webContents.on('did-navigate-in-page', (_e, nav) => {
      managed.url = nav;
      this.broadcastState(id);
    });

    view.webContents.on('did-start-loading', () => this.broadcastState(id));
    view.webContents.on('did-stop-loading', () => this.broadcastState(id));

    view.webContents.loadURL(url).catch((err) => {
      console.error(`[tabs] loadURL failed for ${url}:`, err);
    });

    this.win.contentView.addChildView(view);
    view.setVisible(false);

    this.tabs.set(id, managed);
    this.byWebContentsId.set(view.webContents.id, id);

    return {
      id,
      kind,
      title: url,
      url,
      createdAt: Date.now(),
    };
  }

  closeTab(id: string): void {
    const t = this.tabs.get(id);
    if (!t) return;
    try {
      this.win.contentView.removeChildView(t.view);
    } catch {
      // ignore
    }
    // WebContentsView cleanup — close its webContents
    try {
      this.byWebContentsId.delete(t.view.webContents.id);
      t.view.webContents.close();
    } catch {
      // ignore
    }
    this.tabs.delete(id);
    if (this.activeTabId === id) {
      this.activeTabId = null;
    }
  }

  focusTab(id: string): void {
    for (const [tabId, tab] of this.tabs) {
      const isActive = tabId === id;
      tab.view.setVisible(isActive && tab.visible);
    }
    this.activeTabId = id;
  }

  setBounds(id: string, bounds: TabBounds): void {
    const tab = this.tabs.get(id);
    if (!tab) return;
    tab.bounds = bounds;
    const rounded = {
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
    };
    tab.view.setBounds(rounded);
  }

  setVisibility(id: string, visible: boolean): void {
    const tab = this.tabs.get(id);
    if (!tab) return;
    tab.visible = visible;
    tab.view.setVisible(visible);
  }

  navigate(id: string, url: string): void {
    const tab = this.tabs.get(id);
    if (!tab) return;
    tab.url = url;
    tab.view.webContents.loadURL(url).catch((err) => {
      console.error(`[tabs] navigate failed:`, err);
    });
  }

  goBack(id: string): void {
    const tab = this.tabs.get(id);
    if (tab?.view.webContents.navigationHistory.canGoBack()) {
      tab.view.webContents.navigationHistory.goBack();
    }
  }

  goForward(id: string): void {
    const tab = this.tabs.get(id);
    if (tab?.view.webContents.navigationHistory.canGoForward()) {
      tab.view.webContents.navigationHistory.goForward();
    }
  }

  reload(id: string): void {
    const tab = this.tabs.get(id);
    tab?.view.webContents.reload();
  }

  async screenshot(id: string): Promise<ScreenshotResult | null> {
    const tab = this.tabs.get(id);
    if (!tab) return null;
    const image = await tab.view.webContents.capturePage();
    const png = image.toPNG();
    const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
    const size = image.getSize();
    return {
      dataUrl,
      width: size.width,
      height: size.height,
    };
  }

  /** Capture an arbitrary view as data URL (kept for future non-active tab grabs) */
  async snapshotImage(id: string): Promise<string | null> {
    const tab = this.tabs.get(id);
    if (!tab) return null;
    const image = await tab.view.webContents.capturePage();
    const buf = image.toPNG();
    const file = nativeImage.createFromBuffer(buf);
    return file.toDataURL();
  }

  /**
   * Extract article content from a web/github tab as Markdown. The
   * in-page script walks the DOM (prefer <article>/<main>, strip
   * nav/aside/footer/scripts) and emits a Markdown subset preserving
   * headings, links, images (absolute URLs), inline emphasis, lists,
   * and fenced code blocks. Keeping links + images intact matters for
   * the "Generate from reader" flow — the LLM can then embed them
   * verbatim in the generated artifact.
   */
  async extractWebText(
    id: string,
  ): Promise<{ title: string; source: string; text: string } | null> {
    const tab = this.tabs.get(id);
    if (!tab) return null;
    // Run in the page's main world. Returns a JSON string we parse here.
    const script = `(function () {
      try {
        var STRIP_SEL = 'nav, aside, footer, header, script, style, noscript, iframe, .nav, .header, .footer, .sidebar, [aria-hidden="true"], [role="navigation"], [role="banner"], [role="contentinfo"]';
        var article = document.querySelector('article, main, [role="main"]');
        var root = article || document.body;
        var clone = root.cloneNode(true);
        clone.querySelectorAll(STRIP_SEL).forEach(function (n) { n.remove(); });

        function abs(url) {
          if (!url) return '';
          try { return new URL(url, location.href).href; } catch (e) { return url; }
        }
        function escapeMd(s) {
          return String(s || '').replace(/([\\\\\\[\\]\`])/g, '\\\\$1');
        }
        function collapseWS(s) {
          return String(s || '').replace(/\\s+/g, ' ');
        }

        function inline(node) {
          if (node.nodeType === 3) return collapseWS(node.nodeValue || '');
          if (node.nodeType !== 1) return '';
          var tag = node.tagName.toLowerCase();
          if (tag === 'br') return '\\n';
          if (tag === 'a') {
            var href = abs(node.getAttribute('href') || '');
            var label = childrenInline(node).trim();
            if (!label) return '';
            if (!href || href.indexOf('javascript:') === 0) return label;
            return '[' + label + '](' + href + ')';
          }
          if (tag === 'img') {
            var src = abs(node.getAttribute('src') || node.getAttribute('data-src') || '');
            var alt = (node.getAttribute('alt') || '').replace(/\\]/g, '');
            if (!src) return '';
            return '![' + alt + '](' + src + ')';
          }
          if (tag === 'code') {
            var code = (node.textContent || '').replace(/\`/g, '\\\\\`');
            return '\`' + code + '\`';
          }
          if (tag === 'strong' || tag === 'b') return '**' + childrenInline(node) + '**';
          if (tag === 'em' || tag === 'i') return '*' + childrenInline(node) + '*';
          if (tag === 'del' || tag === 's') return '~~' + childrenInline(node) + '~~';
          return childrenInline(node);
        }
        function childrenInline(node) {
          var out = '';
          for (var i = 0; i < node.childNodes.length; i++) out += inline(node.childNodes[i]);
          return out;
        }

        function block(node, depth) {
          if (node.nodeType === 3) {
            var t = collapseWS(node.nodeValue || '').trim();
            return t ? t + '\\n\\n' : '';
          }
          if (node.nodeType !== 1) return '';
          var tag = node.tagName.toLowerCase();

          // Headings
          var m = tag.match(/^h([1-6])$/);
          if (m) {
            var level = parseInt(m[1], 10);
            var heading = childrenInline(node).trim();
            return heading ? '#'.repeat(level) + ' ' + heading + '\\n\\n' : '';
          }

          if (tag === 'p') {
            var p = childrenInline(node).trim();
            return p ? p + '\\n\\n' : '';
          }

          if (tag === 'pre') {
            var codeEl = node.querySelector('code');
            var src = (codeEl || node).textContent || '';
            var lang = '';
            if (codeEl) {
              var cls = codeEl.className || '';
              var lm = cls.match(/language-([\\w+-]+)/);
              if (lm) lang = lm[1];
            }
            return '\\n\`\`\`' + lang + '\\n' + src.replace(/\\n+$/, '') + '\\n\`\`\`\\n\\n';
          }

          if (tag === 'blockquote') {
            var inner = childrenBlock(node, depth + 1).trim();
            if (!inner) return '';
            return inner.split('\\n').map(function (ln) { return '> ' + ln; }).join('\\n') + '\\n\\n';
          }

          if (tag === 'ul' || tag === 'ol') {
            var ordered = tag === 'ol';
            var items = [];
            var idx = 1;
            for (var i = 0; i < node.children.length; i++) {
              var li = node.children[i];
              if (!li || li.tagName.toLowerCase() !== 'li') continue;
              var content = childrenBlock(li, depth + 1).trim() || childrenInline(li).trim();
              var prefix = ordered ? (idx + '. ') : '- ';
              idx++;
              if (!content) continue;
              var lines = content.split('\\n');
              var first = '  '.repeat(depth) + prefix + lines[0];
              var rest = lines.slice(1).map(function (l) { return '  '.repeat(depth + 1) + l; }).join('\\n');
              items.push(rest ? first + '\\n' + rest : first);
            }
            return items.join('\\n') + '\\n\\n';
          }

          if (tag === 'hr') return '---\\n\\n';

          if (tag === 'img') {
            var i_md = inline(node);
            return i_md ? i_md + '\\n\\n' : '';
          }

          if (tag === 'figure') {
            return childrenBlock(node, depth);
          }

          // Generic block container: recurse, or fall back to inline if it has none.
          var blocky = childrenBlock(node, depth);
          if (blocky.trim()) return blocky;
          var inl = childrenInline(node).trim();
          return inl ? inl + '\\n\\n' : '';
        }
        function childrenBlock(node, depth) {
          var out = '';
          for (var i = 0; i < node.childNodes.length; i++) out += block(node.childNodes[i], depth);
          return out;
        }

        var markdown = childrenBlock(clone, 0)
          .replace(/[\\t ]+\\n/g, '\\n')
          .replace(/\\n{3,}/g, '\\n\\n')
          .trim();

        return JSON.stringify({
          title: document.title || '',
          url: location.href,
          text: markdown,
        });
      } catch (err) {
        return JSON.stringify({ error: String(err && err.message || err) });
      }
    })();`;
    const json = (await tab.view.webContents.executeJavaScript(script, true)) as string;
    let parsed: { title?: string; url?: string; text?: string; error?: string };
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new Error('Reader extraction returned invalid JSON.');
    }
    if (parsed.error) throw new Error(`Reader extraction failed: ${parsed.error}`);
    return {
      title: parsed.title ?? '',
      source: parsed.url ?? tab.url,
      text: parsed.text ?? '',
    };
  }

  destroyAll(): void {
    for (const id of [...this.tabs.keys()]) {
      this.closeTab(id);
    }
  }

  private broadcastState(id: string): void {
    const tab = this.tabs.get(id);
    if (!tab || this.win.isDestroyed()) return;
    const wc = tab.view.webContents;
    this.win.webContents.send(IPC.TAB_STATE_CHANGED, {
      id,
      title: tab.title,
      url: tab.url,
      loading: wc.isLoading(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
    });
  }

  /**
   * Receive selection events from web-tab preloads, translate the rect
   * from WebContentsView-local coords into main-window viewport coords
   * by adding the tab's bounds offset, and forward to the renderer.
   */
  private registerSelectionRelay(): void {
    ipcMain.on(IPC.WEB_TAB_SELECTION_INBOUND, (event, payload: SelectionInboundPayload) => {
      const tabId = this.byWebContentsId.get(event.sender.id);
      if (!tabId) return;
      const tab = this.tabs.get(tabId);
      if (!tab || this.win.isDestroyed()) return;
      const translated = payload.rect
        ? {
            top: payload.rect.top + tab.bounds.y,
            left: payload.rect.left + tab.bounds.x,
            width: payload.rect.width,
            height: payload.rect.height,
          }
        : null;
      this.win.webContents.send(IPC.WEB_TAB_SELECTION_CHANGED, {
        tabId,
        text: payload.text,
        rect: translated,
      });
    });
  }
}
