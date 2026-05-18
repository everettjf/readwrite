import { useEffect, useRef, useState } from 'react';
import { useEditorStore } from '@/stores/editor';
import { useSettingsStore } from '@/stores/settings';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Code, Eye, Share2, Loader2, Send, FileCode2, Upload } from 'lucide-react';
import { MilkdownEditor } from './MilkdownEditor';
import { SourceEditor } from './SourceEditor';
import { WelcomePanel } from './WelcomePanel';
import { useActiveBridge } from '@/lib/active-bridge';
import { buildWeChatHtml, copyHtmlToClipboard } from '@/lib/wechat-html';
import { AIInterpretDialog, type InsertTarget } from '@/components/dialogs/AIInterpretDialog';
import { AIDiffDialog } from '@/components/dialogs/AIDiffDialog';
import { PublishToWeChatDialog } from '@/components/dialogs/PublishToWeChatDialog';
import { useEditorCommandsStore, type AiRequest } from '@/stores/editor-commands';
import { marked } from 'marked';
import juice from 'juice';

interface ToolbarStatus {
  kind: 'info' | 'error';
  text: string;
}

const POLISH_DOC_INSTRUCTION =
  'Polish the following Markdown document for clarity and flow. Preserve all structure, code, links, images, and formatting. Return only the revised Markdown.';
const POLISH_SELECTION_INSTRUCTION =
  'Polish the following Markdown excerpt. Preserve any inline code, links, and emphasis. Return only the revised Markdown.';
const TRANSLATE_EN_INSTRUCTION =
  'Translate the following Markdown to natural, idiomatic English. Preserve all structure, code, links, images, and formatting. Return only the translated Markdown.';
const TRANSLATE_ZH_INSTRUCTION =
  '把下面的 Markdown 翻译成自然、地道的中文。保留所有结构、代码、链接、图片和格式。只返回翻译后的 Markdown。';
const SUMMARIZE_INSTRUCTION =
  'Summarize the following Markdown into 3 bullet points. Return only the bullet list.';
const EXPLAIN_INSTRUCTION =
  'Explain the following Markdown excerpt step by step in plain language. Return only the explanation, in the same language as the original.';

function EditorToolbar(): JSX.Element {
  const mode = useEditorStore((s) => s.mode);
  const setMode = useEditorStore((s) => s.setMode);
  const content = useEditorStore((s) => s.content);
  const path = useEditorStore((s) => s.path);
  const dirty = useEditorStore((s) => s.dirty);
  const setContent = useEditorStore((s) => s.setContent);
  const aiEnabled = useSettingsStore((s) => s.aiEnabled);
  const aiApiKey = useSettingsStore((s) => s.aiApiKey);
  const wechatExportTheme = useSettingsStore((s) => s.wechatExportTheme);
  const bridge = useActiveBridge();

  const [exportBusy, setExportBusy] = useState(false);
  const [status, setStatus] = useState<ToolbarStatus | null>(null);
  const [interpretOpen, setInterpretOpen] = useState(false);
  const [interpretSelection, setInterpretSelection] = useState('');
  const [interpretMode, setInterpretMode] = useState<'editor-selection' | 'reader-excerpt'>(
    'editor-selection',
  );
  const [interpretDefaultPrompt, setInterpretDefaultPrompt] = useState<string | undefined>(
    undefined,
  );
  const [publishOpen, setPublishOpen] = useState(false);

  // The active AI diff request — null when no AI action is in flight or
  // pending review. The same state object carries through three phases:
  //   busy=true               → AI is generating (spinner in dialog)
  //   busy=false, error set   → AI failed (error in dialog, can Regenerate)
  //   busy=false, proposed    → AI succeeded (diff in dialog, Accept/Reject)
  const [aiDiff, setAiDiff] = useState<{
    title: string;
    target: 'selection' | 'document';
    instruction: string;
    input: string;
    original: string;
    proposed: string | null;
    error: string | null;
    busy: boolean;
    /** Correlates with the in-flight AI streaming job. */
    jobId: string | null;
  } | null>(null);

  // Subscribe to streaming progress and pipe into the active job.
  // Filtered by jobId so a superseded request can't overwrite the
  // newer one.
  useEffect(() => {
    return window.api.ai.onProgress((evt) => {
      setAiDiff((prev) =>
        prev && prev.jobId === evt.jobId ? { ...prev, proposed: evt.total } : prev,
      );
    });
  }, []);

  useEffect(() => {
    if (!status || status.kind !== 'info') return;
    const t = setTimeout(() => setStatus(null), 4000);
    return () => clearTimeout(t);
  }, [status]);

  const onCopyHtml = async (): Promise<void> => {
    setStatus(null);
    try {
      const rawHtml = await marked.parse(content);
      const html = juice(rawHtml);
      await copyHtmlToClipboard(html);
      setStatus({ kind: 'info', text: 'Copied as inlined HTML — paste into your destination.' });
    } catch (err) {
      setStatus({ kind: 'error', text: (err as Error).message });
    }
  };

  const onCopyToWeChat = async (): Promise<void> => {
    setStatus(null);
    setExportBusy(true);
    try {
      const { html, warnings } = await buildWeChatHtml(content, {
        markdownPath: path,
        themeId: wechatExportTheme,
      });
      await copyHtmlToClipboard(html);
      const tail =
        warnings.length > 0
          ? ` (${warnings.length} warning${warnings.length === 1 ? '' : 's'})`
          : '';
      setStatus({
        kind: 'info',
        text: `Copied to clipboard. Open mp.weixin.qq.com → 写新图文 → paste.${tail}`,
      });
      if (warnings.length > 0) console.warn('[wechat-export] warnings:', warnings);
    } catch (err) {
      setStatus({ kind: 'error', text: (err as Error).message });
    } finally {
      setExportBusy(false);
    }
  };

  const requireBridge = (): boolean => {
    if (!bridge) {
      setStatus({ kind: 'error', text: 'Editor is still booting — try again in a moment.' });
      return false;
    }
    return true;
  };

  const requireAiKey = (): boolean => {
    if (!aiApiKey || !aiApiKey.trim()) {
      setStatus({
        kind: 'error',
        text: 'No AI API key configured. Open Settings → AI to add one.',
      });
      return false;
    }
    return true;
  };

  /**
   * Kick off a destructive AI action (Polish / Translate / Summarize / Explain).
   * Always opens the diff dialog with `busy=true`, runs the AI in the background,
   * then surfaces the result there. The user explicitly Accepts before the
   * editor changes.
   */
  const requestAiDiff = async (
    instruction: string,
    label: string,
    target: 'selection' | 'document',
  ): Promise<void> => {
    setStatus(null);
    if (!requireBridge() || !bridge) return;
    if (!requireAiKey()) return;

    let input: string;
    if (target === 'selection') {
      const selection = bridge.getSelectionText();
      if (!selection.trim()) {
        setStatus({
          kind: 'error',
          text: `Select some text first to ${label.toLowerCase()} a portion.`,
        });
        return;
      }
      input = selection;
    } else {
      input = content;
    }

    const jobId = `ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    setAiDiff({
      title: label,
      target,
      instruction,
      input,
      original: input,
      proposed: '',
      error: null,
      busy: true,
      jobId,
    });

    try {
      const result = await window.api.ai.complete({ input, instruction, jobId });
      setAiDiff((prev) =>
        prev && prev.jobId === jobId
          ? { ...prev, proposed: result.text, error: null, busy: false }
          : prev,
      );
    } catch (err) {
      setAiDiff((prev) =>
        prev && prev.jobId === jobId
          ? { ...prev, error: (err as Error).message, busy: false }
          : prev,
      );
    }
  };

  const onDiffAccept = (finalText: string): void => {
    if (!aiDiff || !bridge) return;
    if (aiDiff.target === 'selection') {
      bridge.replaceSelection(finalText);
    } else {
      setContent(finalText, { markDirty: true });
    }
    setStatus({ kind: 'info', text: `${aiDiff.title} applied.` });
    setAiDiff(null);
  };

  const onDiffReject = (): void => {
    if (aiDiff?.busy && aiDiff.jobId) {
      window.api.ai.cancel(aiDiff.jobId).catch(() => null);
    }
    setAiDiff(null);
  };

  const onDiffRegenerate = async (): Promise<void> => {
    if (!aiDiff) return;
    if (aiDiff.jobId) window.api.ai.cancel(aiDiff.jobId).catch(() => null);
    const { input, instruction } = aiDiff;
    const jobId = `ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 4)}`;
    setAiDiff((prev) => (prev ? { ...prev, proposed: '', error: null, busy: true, jobId } : prev));
    try {
      const result = await window.api.ai.complete({ input, instruction, jobId });
      setAiDiff((prev) =>
        prev && prev.jobId === jobId
          ? { ...prev, proposed: result.text, error: null, busy: false }
          : prev,
      );
    } catch (err) {
      setAiDiff((prev) =>
        prev && prev.jobId === jobId
          ? { ...prev, error: (err as Error).message, busy: false }
          : prev,
      );
    }
  };

  const onOpenInterpret = (): void => {
    setStatus(null);
    if (!requireBridge()) return;
    setInterpretSelection(bridge?.getSelectionText() ?? '');
    setInterpretMode('editor-selection');
    setInterpretDefaultPrompt(undefined);
    setInterpretOpen(true);
  };

  const onOpenInterpretFromReader = (text: string, defaultPrompt?: string): void => {
    setStatus(null);
    if (!requireBridge()) return;
    setInterpretSelection(text);
    setInterpretMode('reader-excerpt');
    setInterpretDefaultPrompt(defaultPrompt && defaultPrompt.trim() ? defaultPrompt : undefined);
    setInterpretOpen(true);
  };

  const onInterpretInsert = (markdown: string, target: InsertTarget): void => {
    if (!bridge) return;
    if (target === 'replace-selection') {
      bridge.replaceSelection(markdown);
    } else if (target === 'insert-after-selection') {
      // The active bridge inserts markdown at the current cursor; after a
      // selection that means at the end of the selection range.
      bridge.insertAtCursor(`\n\n${markdown}\n\n`);
    } else {
      setContent(`${content}\n\n${markdown}\n`, { markDirty: true });
    }
    setInterpretOpen(false);
    setStatus({ kind: 'info', text: 'Inserted AI response.' });
  };

  // Consume AI requests dispatched from outside the editor subtree (e.g.
  // the action rail at the reader/editor seam). The rail can't run AI
  // itself because the active bridge — needed for selection text and
  // selection-replacement — is only reachable from inside the editor.
  // The handler closes over fresh state via a ref, so the subscription
  // can stay set up once per `aiEnabled` flip instead of resubscribing
  // every render.
  const aiCommandHandlerRef = useRef<(cmd: AiRequest) => void>(() => {});
  aiCommandHandlerRef.current = (cmd: AiRequest): void => {
    switch (cmd.kind) {
      case 'polish':
        if (cmd.target === 'selection') {
          requestAiDiff(POLISH_SELECTION_INSTRUCTION, 'Polish selection', 'selection');
        } else {
          requestAiDiff(POLISH_DOC_INSTRUCTION, 'Polish whole document', 'document');
        }
        return;
      case 'translate': {
        const instruction = cmd.lang === 'en' ? TRANSLATE_EN_INSTRUCTION : TRANSLATE_ZH_INSTRUCTION;
        const docLabel = cmd.lang === 'en' ? 'Translate doc to English' : '翻译全文为中文';
        const selLabel = cmd.lang === 'en' ? 'Translate to English' : '翻译为中文';
        requestAiDiff(instruction, cmd.target === 'document' ? docLabel : selLabel, cmd.target);
        return;
      }
      case 'summarize':
        requestAiDiff(SUMMARIZE_INSTRUCTION, 'Summarize document', 'document');
        return;
      case 'explain':
        requestAiDiff(EXPLAIN_INSTRUCTION, 'Explain selection', 'selection');
        return;
      case 'interpret':
        onOpenInterpret();
        return;
      case 'interpret-reader-selection':
        onOpenInterpretFromReader(cmd.text, cmd.defaultPrompt);
        return;
    }
  };
  useEffect(() => {
    if (!aiEnabled) return;
    const queued = useEditorCommandsStore.getState().consume();
    if (queued) aiCommandHandlerRef.current(queued);
    return useEditorCommandsStore.subscribe((s) => {
      if (!s.pending) return;
      const cmd = useEditorCommandsStore.getState().consume();
      if (cmd) aiCommandHandlerRef.current(cmd);
    });
  }, [aiEnabled]);

  return (
    <>
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border bg-background px-2">
        <div className="flex items-center rounded-md border border-border p-0.5">
          <Button
            variant={mode === 'wysiwyg' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7"
            onClick={() => setMode('wysiwyg')}
          >
            <Eye className="mr-1 h-3.5 w-3.5" /> WYSIWYG
          </Button>
          <Button
            variant={mode === 'source' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7"
            onClick={() => setMode('source')}
          >
            <Code className="mr-1 h-3.5 w-3.5" /> Source
          </Button>
        </div>
        <div className="flex-1" />
        <span className="truncate text-xs text-muted-foreground">
          {path ? path.split(/[\\/]/).pop() : 'Untitled (unsaved)'}
          {dirty && ' ·'}
        </span>
        <div className="flex-1" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" title="Export / copy" disabled={exportBusy}>
              {exportBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Share2 className="h-4 w-4" />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel>Copy / Export</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onCopyToWeChat}>
              <Send className="mr-2 h-4 w-4" />
              <div className="flex flex-col">
                <span>Copy to WeChat 公众号</span>
                <span className="text-[10px] text-muted-foreground">
                  Inline-styled HTML, images embedded
                </span>
              </div>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onCopyHtml}>
              <FileCode2 className="mr-2 h-4 w-4" />
              <div className="flex flex-col">
                <span>Copy as inlined HTML</span>
                <span className="text-[10px] text-muted-foreground">
                  Generic — for emails, etc.
                </span>
              </div>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setPublishOpen(true)}>
              <Upload className="mr-2 h-4 w-4" />
              <div className="flex flex-col">
                <span>Publish draft to WeChat 公众号</span>
                <span className="text-[10px] text-muted-foreground">
                  Uploads images, creates a draft to review
                </span>
              </div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {status && (
        <div
          className={
            status.kind === 'error'
              ? 'border-b border-destructive/30 bg-destructive/10 px-3 py-1 text-xs text-destructive'
              : 'border-b border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-600 dark:text-emerald-400'
          }
        >
          {status.text}
        </div>
      )}

      {aiEnabled && (
        <AIInterpretDialog
          open={interpretOpen}
          selectionText={interpretSelection}
          documentText={content}
          mode={interpretMode}
          defaultPrompt={interpretDefaultPrompt}
          onCancel={() => setInterpretOpen(false)}
          onInsert={onInterpretInsert}
        />
      )}

      <PublishToWeChatDialog open={publishOpen} onClose={() => setPublishOpen(false)} />

      {aiDiff && (
        <AIDiffDialog
          open={aiDiff !== null}
          title={aiDiff.title}
          original={aiDiff.original}
          proposed={aiDiff.proposed}
          error={aiDiff.error}
          busy={aiDiff.busy}
          onAccept={onDiffAccept}
          onReject={onDiffReject}
          onRegenerate={onDiffRegenerate}
        />
      )}
    </>
  );
}

export function EditorPane(): JSX.Element {
  const mode = useEditorStore((s) => s.mode);
  const path = useEditorStore((s) => s.path);

  // No document open → Welcome / Recent screen instead of an empty editor.
  // Once the user picks something (New doc, open from list, …) `path`
  // becomes non-null and the real editor takes over.
  if (!path) {
    return (
      <div className="flex h-full w-full flex-col bg-background">
        <WelcomePanel />
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col bg-background">
      {mode === 'wysiwyg' ? (
        <MilkdownEditor>
          <EditorToolbar />
        </MilkdownEditor>
      ) : (
        <SourceEditor>
          <EditorToolbar />
        </SourceEditor>
      )}
    </div>
  );
}
