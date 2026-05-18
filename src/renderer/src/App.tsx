import { useCallback, useEffect, useRef, useState } from 'react';
import { TitleBar } from './components/layout/TitleBar';
import { SplitView } from './components/layout/SplitView';
import { ReaderPane } from './components/reader/ReaderPane';
import { EditorPane } from './components/editor/EditorPane';
import { SnipOverlay } from './components/snip/SnipOverlay';
import { DocsSidebar } from './components/sidebar/DocsSidebar';
import { AIBlogJobIndicator } from './components/ai/AIBlogJobIndicator';
import { AIBlogDialog } from './components/dialogs/AIBlogDialog';
import { WorkspacePicker } from './WorkspacePicker';
import { useSettingsStore } from './stores/settings';
import { useEditorStore } from './stores/editor';
import { useTabsStore } from './stores/tabs';
import { useWorkspaceStore } from './stores/workspace';
import { tabsToSession, restoreTabSession } from './lib/tab-session';
import type { DocSummary, SavedTabSession } from '@shared/types';
import { startSnip, finalizeSnip } from './lib/snip-runner';
import {
  saveMarkdown,
  createNewDocument,
  openMarkdownFromDialog,
  openMarkdownAtPath,
  suggestDocNameFromContent,
} from './lib/doc-io';
import { rewriteFileUrlsToRelative } from './lib/path-transform';
import type { PaneSnapshot } from './lib/snip';

export function App(): JSX.Element {
  const loadSettings = useSettingsStore((s) => s.load);
  const settingsLoaded = useSettingsStore((s) => s.loaded);
  const autosaveDebounceMs = useSettingsStore((s) => s.autosaveDebounceMs);
  const sidebarVisible = useSettingsStore((s) => s.sidebarVisible);

  const loadWorkspace = useWorkspaceStore((s) => s.load);
  const workspaceLoaded = useWorkspaceStore((s) => s.loaded);
  const activeWorkspace = useWorkspaceStore((s) => s.active);
  const refreshDocs = useWorkspaceStore((s) => s.refreshDocs);

  const [snipSnap, setSnipSnap] = useState<PaneSnapshot | null>(null);
  const [snipToast, setSnipToast] = useState<string | null>(null);

  // The first time `activeWorkspace` becomes non-null is the app launch
  // (the workspace store loads the persisted active workspace on boot).
  // We deliberately DO NOT auto-open the last doc / restore tab session
  // on launch — the user gets the Welcome panel + a recent list to
  // pick from instead. Subsequent activations (manual workspace switch)
  // do still restore, since the user is asking to "go back" there.
  const isFirstWorkspaceActivationRef = useRef(true);

  useEffect(() => {
    loadSettings().catch((e) => console.error('[settings] load failed:', e));
    loadWorkspace().catch((e) => console.error('[workspace] load failed:', e));
  }, [loadSettings, loadWorkspace]);

  // When the active workspace changes, decide whether to restore state
  // from disk. On the FIRST activation after app launch we skip this —
  // user wanted to land on the Welcome / Recent screen, not the last
  // doc. On manual workspace switches we still restore, since the user
  // is asking to go back to that workspace's context.
  useEffect(() => {
    if (!activeWorkspace) return;

    const isFirst = isFirstWorkspaceActivationRef.current;
    isFirstWorkspaceActivationRef.current = false;

    const editor = useEditorStore.getState();

    if (isFirst) {
      // Clear any stale editor content (in-memory only — no disk writes).
      // EditorPane sees `path === null` and renders the WelcomePanel.
      if (editor.path) {
        editor.setPath(null);
        editor.setContent('', { markDirty: false });
      }
      return;
    }

    let cancelled = false;

    // Restore tab session in parallel with the doc restore.
    window.api.session
      .loadTabSessions()
      .then(async (map) => {
        if (cancelled) return;
        await restoreTabSession(map[activeWorkspace]);
      })
      .catch((err) => console.warn('[tab-session] restore failed:', err));

    const tryRestore = async (): Promise<void> => {
      const remembered = await window.api.workspace.getLastDoc(activeWorkspace).catch(() => null);
      if (cancelled) return;

      if (
        remembered &&
        remembered.startsWith(`${activeWorkspace}/`) &&
        (await window.api.fs.pathExists(remembered).catch(() => false))
      ) {
        try {
          const opened = await openMarkdownAtPath(remembered);
          if (cancelled) return;
          editor.setPath(opened.path);
          editor.setContent(opened.content, { markDirty: false });
          return;
        } catch (err) {
          console.warn('[restore] failed to open last doc:', err);
        }
      }

      // Fallback: clear stale doc → user lands on Welcome panel.
      if (editor.path && !editor.path.startsWith(`${activeWorkspace}/`)) {
        editor.setPath(null);
        editor.setContent('', { markDirty: false });
      }
    };

    tryRestore();
    return () => {
      cancelled = true;
    };
  }, [activeWorkspace]);

  // Persist the active doc path per workspace so it can be restored on next launch.
  useEffect(() => {
    if (!activeWorkspace) return;
    const unsub = useEditorStore.subscribe((state, prev) => {
      if (state.path === prev.path) return;
      window.api.workspace.setLastDoc(activeWorkspace, state.path).catch(() => null);
    });
    return unsub;
  }, [activeWorkspace]);

  // Persist the active tab set per workspace, debounced.
  useEffect(() => {
    if (!activeWorkspace) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastSerialized = '';

    const flush = async (): Promise<void> => {
      const { tabs, activeTabId } = useTabsStore.getState();
      const session = tabsToSession(tabs, activeTabId);
      const serialized = JSON.stringify(session);
      if (serialized === lastSerialized) return;
      lastSerialized = serialized;
      try {
        const map = (await window.api.session.loadTabSessions()) as Record<string, SavedTabSession>;
        map[activeWorkspace] = session;
        await window.api.session.saveTabSessions(map);
      } catch (err) {
        console.warn('[tab-session] save failed:', err);
      }
    };

    const unsub = useTabsStore.subscribe(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, 600);
    });

    return () => {
      if (timer) clearTimeout(timer);
      unsub();
      // Best-effort flush on workspace switch / unmount.
      flush().catch(() => null);
    };
  }, [activeWorkspace]);

  // Auto-refresh the docs list when the workspace folder changes on disk
  // (Finder, Git pulls, iCloud sync, etc.). We filter out images/ subfolders
  // so saving a screenshot doesn't trigger a refresh, and debounce so a burst
  // of FS events coalesces into one refetch.
  useEffect(() => {
    if (!activeWorkspace) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    window.api.fs.watchDir(activeWorkspace).catch(() => null);

    const off = window.api.fs.onWatchEvent((evt) => {
      if (cancelled) return;
      if (evt.root !== activeWorkspace) return;
      // Ignore events that happen inside any doc's images/ folder.
      if (/[\\/]images[\\/]/.test(evt.path)) return;
      // Ignore hidden files (.DS_Store etc).
      if (/[\\/]\.[^\\/]+(?:[\\/]|$)/.test(evt.path)) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (!cancelled) refreshDocs().catch(() => null);
      }, 400);
    });

    return () => {
      cancelled = true;
      off();
      if (timer) clearTimeout(timer);
      window.api.fs.unwatchDir(activeWorkspace).catch(() => null);
    };
  }, [activeWorkspace, refreshDocs]);

  // Autosave / lazy doc-folder creation
  useEffect(() => {
    if (autosaveDebounceMs <= 0) return;
    if (!activeWorkspace) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = useEditorStore.subscribe((state) => {
      if (timer) clearTimeout(timer);
      if (!state.dirty) return;
      timer = setTimeout(async () => {
        const snap = useEditorStore.getState();
        if (!snap.dirty) return;
        try {
          let path = snap.path;
          let createdNew = false;
          if (!path) {
            const created = await createNewDocument({
              initialContent: snap.content,
              suggestedName: suggestDocNameFromContent(snap.content),
            });
            path = created.path;
            useEditorStore.getState().setPath(path);
            createdNew = true;
          } else {
            await saveMarkdown(snap.content, path);
          }
          useEditorStore.getState().setDirty(false);
          // Keep the in-memory editor content aligned with what just hit
          // disk: always relative-path image refs. This collapses any
          // `file://` URLs that snuck in mid-session into the canonical
          // form so source mode shows clean markdown immediately.
          if (path) {
            const normalized = rewriteFileUrlsToRelative(snap.content, path);
            if (normalized !== snap.content) {
              useEditorStore.getState().setContent(normalized, { markDirty: false });
            }
          }
          if (createdNew) {
            await refreshDocs();
          }
        } catch (err) {
          console.error('[autosave] failed:', err);
        }
      }, autosaveDebounceMs);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsub();
    };
  }, [autosaveDebounceMs, activeWorkspace, refreshDocs]);

  // Unsaved-changes guard
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent): void => {
      if (useEditorStore.getState().dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  // Auto-clear snip toast
  useEffect(() => {
    if (!snipToast) return;
    const t = setTimeout(() => setSnipToast(null), 4000);
    return () => clearTimeout(t);
  }, [snipToast]);

  const onStartSnip = useCallback(async () => {
    if (snipSnap) return;
    try {
      const snap = await startSnip();
      if (!snap) {
        setSnipToast('Nothing to snip — open a tab in the reader first.');
        return;
      }
      setSnipSnap(snap);
    } catch (err) {
      setSnipToast(`Snip capture failed: ${(err as Error).message}`);
    }
  }, [snipSnap]);

  const onSnipComplete = useCallback(
    async (rect: { x: number; y: number; w: number; h: number }) => {
      if (!snipSnap) return;
      try {
        const result = await finalizeSnip(snipSnap, rect, { autoInsertIntoEditor: true });
        const where = result.relativePath ?? result.savedPath ?? '(in clipboard)';
        setSnipToast(`Snipped ${result.width}×${result.height} → inserted as ${where}.`);
      } catch (err) {
        setSnipToast(`Snip failed: ${(err as Error).message}`);
      } finally {
        await snipSnap.restore();
        setSnipSnap(null);
      }
    },
    [snipSnap],
  );

  const onSnipCancel = useCallback(async () => {
    if (!snipSnap) return;
    await snipSnap.restore();
    setSnipSnap(null);
  }, [snipSnap]);

  const onNewDoc = useCallback(async () => {
    const editor = useEditorStore.getState();
    if (editor.dirty && !confirm('Discard unsaved changes in the current document?')) return;
    const created = await createNewDocument({ initialContent: '# Untitled\n\n' });
    editor.setPath(created.path);
    editor.setContent(created.content, { markDirty: false });
    await refreshDocs();
  }, [refreshDocs]);

  const onOpenDoc = useCallback(async () => {
    const editor = useEditorStore.getState();
    if (editor.dirty && !confirm('Discard unsaved changes?')) return;
    const opened = await openMarkdownFromDialog();
    if (!opened) return;
    editor.setPath(opened.path);
    editor.setContent(opened.content, { markDirty: false });
  }, []);

  const onSwitchDoc = useCallback(async (doc: DocSummary): Promise<void> => {
    const editor = useEditorStore.getState();
    if (editor.dirty && !confirm('Discard unsaved changes?')) return;
    const opened = await openMarkdownAtPath(doc.path);
    editor.setPath(opened.path);
    editor.setContent(opened.content, { markDirty: false });
  }, []);

  // Global keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const accel = e.metaKey || e.ctrlKey;
      const shifted = accel && e.shiftKey;
      if (shifted && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        onStartSnip();
      } else if (accel && !e.shiftKey && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault();
        onNewDoc();
      } else if (accel && !e.shiftKey && (e.key === 'o' || e.key === 'O')) {
        e.preventDefault();
        onOpenDoc();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onStartSnip, onNewDoc, onOpenDoc]);

  if (!settingsLoaded || !workspaceLoaded) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (!activeWorkspace) {
    return <WorkspacePicker />;
  }

  return (
    <div className="flex h-full w-full flex-col">
      <TitleBar onNewDoc={onNewDoc} onOpenDoc={onOpenDoc} />
      <div className="flex-1 overflow-hidden">
        <SplitView
          sidebar={<DocsSidebar onSwitchDoc={onSwitchDoc} />}
          sidebarVisible={sidebarVisible}
          left={<ReaderPane onStartSnip={onStartSnip} />}
          right={<EditorPane />}
        />
      </div>

      {snipSnap && (
        <SnipOverlay snapshot={snipSnap} onComplete={onSnipComplete} onCancel={onSnipCancel} />
      )}
      {snipToast && (
        <div className="fixed bottom-6 left-1/2 z-[9998] -translate-x-1/2 rounded-md bg-foreground/90 px-3 py-2 text-xs text-background shadow-lg">
          {snipToast}
        </div>
      )}
      <AIBlogDialog />
      <AIBlogJobIndicator />
    </div>
  );
}
