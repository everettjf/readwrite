import { create } from 'zustand';

interface EditorState {
  content: string;
  path: string | null;
  dirty: boolean;
  mode: 'wysiwyg' | 'source';
  setContent: (content: string, opts?: { markDirty?: boolean }) => void;
  setPath: (path: string | null) => void;
  setDirty: (dirty: boolean) => void;
  setMode: (mode: 'wysiwyg' | 'source') => void;
  reset: (content?: string) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  content: `# Welcome to ReadWrite\n\nStart typing, or open a document from **File → Open**.\n\n- Split window: reader on the left, editor on the right.\n- Press the camera button on the reader toolbar to capture a screenshot and insert it here.\n- Toggle WYSIWYG / Source from the editor toolbar.\n`,
  path: null,
  dirty: false,
  mode: 'wysiwyg',
  // `markDirty` semantics:
  //   true            → force dirty = true   (user typed / programmatic edit)
  //   false           → force dirty = false  (fresh load / post-save normalize)
  //   undefined       → infer from whether content actually changed
  // Forcing dirty=false on load matters because the autosave subscriber
  // would otherwise rewrite the just-opened file (bumping mtime) when the
  // previous doc was dirty and the user chose to discard.
  setContent: (content, opts) =>
    set((s) => {
      const nextDirty =
        opts?.markDirty === undefined ? content !== s.content || s.dirty : opts.markDirty;
      return { content, dirty: nextDirty };
    }),
  setPath: (path) => set({ path }),
  setDirty: (dirty) => set({ dirty }),
  setMode: (mode) => set({ mode }),
  reset: (content) => set({ content: content ?? '', dirty: false }),
}));
