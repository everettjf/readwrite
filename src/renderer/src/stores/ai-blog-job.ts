import { create } from 'zustand';
import type { ExtractedSource } from '@/lib/reader-extract';
import { useEditorStore } from '@/stores/editor';
import { useWorkspaceStore } from '@/stores/workspace';
import { createNewDocument, openMarkdownAtPath } from '@/lib/doc-io';

export type OutputTarget = 'new-doc' | 'append' | 'replace';

export interface BlogJobProgress {
  total: string;
  chars: number;
}

export interface CompletedToast {
  kind: 'success' | 'error';
  message: string;
}

interface StartArgs {
  prompt: string;
  jobId: string;
  source: ExtractedSource;
  outputTarget: OutputTarget;
}

interface AIBlogJobState {
  /** Whether a generation is currently streaming in the main process. */
  status: 'idle' | 'streaming';
  /** True while the user has the full dialog open. False = minimized to the floating pill. */
  dialogOpen: boolean;

  jobId: string | null;
  source: ExtractedSource | null;
  outputTarget: OutputTarget | null;
  progress: BlogJobProgress;

  /** Last error from a failed run — sticky for the indicator/dialog to show. */
  error: string | null;
  /** Toast shown briefly after a job finishes while the dialog is minimized. */
  toast: CompletedToast | null;

  openDialog: () => void;
  closeDialog: () => void;
  setOutputTarget: (target: OutputTarget) => void;
  start: (args: StartArgs) => Promise<void>;
  cancel: () => Promise<void>;
  clearError: () => void;
  clearToast: () => void;
}

async function applyResult(text: string, target: OutputTarget): Promise<void> {
  const editor = useEditorStore.getState();
  const trimmed = text.trim();
  if (!trimmed) throw new Error('AI returned empty output.');

  if (target === 'new-doc') {
    const created = await createNewDocument({ initialContent: trimmed });
    const opened = await openMarkdownAtPath(created.path);
    editor.setPath(opened.path);
    editor.setContent(opened.content, { markDirty: false });
    await useWorkspaceStore.getState().refreshDocs();
    return;
  }
  if (target === 'append') {
    const next = editor.content.trimEnd() + '\n\n' + trimmed + '\n';
    editor.setContent(next, { markDirty: true });
    return;
  }
  if (target === 'replace') {
    editor.setContent(trimmed, { markDirty: true });
    return;
  }
}

export const useAIBlogJobStore = create<AIBlogJobState>((set, get) => {
  // Single live progress subscription that fans out into the store. We
  // attach once and filter by jobId so the listener survives across
  // multiple consecutive runs.
  let unsubscribeProgress: (() => void) | null = null;
  const ensureProgressSub = (): void => {
    if (unsubscribeProgress) return;
    unsubscribeProgress = window.api.aiCli.onProgress((evt) => {
      const s = get();
      if (s.jobId !== evt.jobId) return;
      set({ progress: { total: evt.total, chars: evt.chars } });
    });
  };

  return {
    status: 'idle',
    dialogOpen: false,
    jobId: null,
    source: null,
    outputTarget: null,
    progress: { total: '', chars: 0 },
    error: null,
    toast: null,

    openDialog: () => set({ dialogOpen: true, error: null, toast: null }),
    closeDialog: () => set({ dialogOpen: false }),
    setOutputTarget: (target) => set({ outputTarget: target }),

    start: async ({ prompt, jobId, source, outputTarget }) => {
      ensureProgressSub();
      set({
        status: 'streaming',
        jobId,
        source,
        outputTarget,
        progress: { total: '', chars: 0 },
        error: null,
        toast: null,
      });

      try {
        const result = await window.api.aiCli.generate({ prompt, jobId });
        // If the user started a different job in the meantime, ignore the
        // late result. (Shouldn't normally happen — defensive.)
        if (get().jobId !== jobId) return;

        await applyResult(result.text, outputTarget);

        const wasMinimized = !get().dialogOpen;
        set({
          status: 'idle',
          jobId: null,
          source: null,
          outputTarget: null,
          progress: { total: '', chars: 0 },
          // Auto-close the dialog on success to match the original UX —
          // the new doc / append / replace is already visible in the editor.
          dialogOpen: false,
          toast: wasMinimized ? { kind: 'success', message: 'AI generation finished.' } : null,
        });
      } catch (err) {
        if (get().jobId !== jobId) return;
        const message = (err as Error).message || String(err);
        const wasMinimized = !get().dialogOpen;
        set({
          status: 'idle',
          jobId: null,
          error: message,
          toast: wasMinimized ? { kind: 'error', message } : null,
        });
      }
    },

    cancel: async () => {
      const id = get().jobId;
      if (!id) return;
      // Optimistically clear so progress events for this job get ignored.
      set({
        status: 'idle',
        jobId: null,
        source: null,
        outputTarget: null,
        progress: { total: '', chars: 0 },
        error: null,
      });
      try {
        await window.api.aiCli.cancel(id);
      } catch {
        // ignore — main may have already cleaned up
      }
    },

    clearError: () => set({ error: null }),
    clearToast: () => set({ toast: null }),
  };
});
