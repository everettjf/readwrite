import { create } from 'zustand';

export type AiTarget = 'selection' | 'document';

/**
 * Editor commands that originate outside the editor subtree (e.g. the
 * action rail at the reader/editor seam) and have to be executed by the
 * editor toolbar — which is the only place with access to the active
 * bridge (selection text, replace selection, etc.).
 */
export type AiRequest =
  | { kind: 'polish'; target: AiTarget }
  | { kind: 'translate'; target: AiTarget; lang: 'en' | 'zh' }
  | { kind: 'summarize' }
  | { kind: 'explain' }
  | { kind: 'interpret' }
  | { kind: 'interpret-reader-selection'; text: string; defaultPrompt?: string };

interface EditorCommandsState {
  pending: AiRequest | null;
  request: (cmd: AiRequest) => void;
  consume: () => AiRequest | null;
}

export const useEditorCommandsStore = create<EditorCommandsState>((set, get) => ({
  pending: null,
  request: (cmd) => set({ pending: cmd }),
  consume: () => {
    const cur = get().pending;
    if (cur) set({ pending: null });
    return cur;
  },
}));
