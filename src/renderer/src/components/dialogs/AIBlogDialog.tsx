import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Loader2, Sparkles, AlertTriangle, Minimize2 } from 'lucide-react';
import { useNativeViewMute } from '@/lib/native-view-mute';
import { useSettingsStore } from '@/stores/settings';
import { useEditorStore } from '@/stores/editor';
import { useAIBlogJobStore, type OutputTarget } from '@/stores/ai-blog-job';
import { extractActiveReader, type ExtractedSource } from '@/lib/reader-extract';
import {
  BUILT_IN_STYLES,
  BUILT_IN_TEMPLATES,
  buildBlogPrompt,
  mergeStyles,
  mergeTemplates,
  type AIPreset,
  type Lang,
  type Length,
} from '@/lib/ai-blog-presets';

type SourcePhase =
  | { kind: 'loading' }
  | { kind: 'ready'; source: ExtractedSource }
  | { kind: 'error'; message: string };

export function AIBlogDialog(): JSX.Element {
  const open = useAIBlogJobStore((s) => s.dialogOpen);
  const status = useAIBlogJobStore((s) => s.status);
  const progress = useAIBlogJobStore((s) => s.progress);
  const storedSource = useAIBlogJobStore((s) => s.source);
  const storedOutputTarget = useAIBlogJobStore((s) => s.outputTarget);
  const storeError = useAIBlogJobStore((s) => s.error);
  const closeDialog = useAIBlogJobStore((s) => s.closeDialog);
  const startJob = useAIBlogJobStore((s) => s.start);
  const cancelJob = useAIBlogJobStore((s) => s.cancel);
  const clearError = useAIBlogJobStore((s) => s.clearError);

  useNativeViewMute(open);

  const aiCliProvider = useSettingsStore((s) => s.aiCliProvider);
  const aiCustomStyles = useSettingsStore((s) => s.aiCustomStyles);
  const aiCustomTemplates = useSettingsStore((s) => s.aiCustomTemplates);

  const styles = mergeStyles(aiCustomStyles);
  const templates = mergeTemplates(aiCustomTemplates);

  // Form fields are dialog-local — only the in-flight job lives in the store.
  const [styleId, setStyleId] = useState<string>(BUILT_IN_STYLES[0]!.id);
  const [templateId, setTemplateId] = useState<string>(BUILT_IN_TEMPLATES[0]!.id);
  const [language, setLanguage] = useState<Lang>('zh');
  const [length, setLength] = useState<Length>('medium');
  const [outputTarget, setOutputTarget] = useState<OutputTarget>('new-doc');
  const [extra, setExtra] = useState('');

  // Source extraction is run only when opening for a fresh form (no running job).
  const [sourcePhase, setSourcePhase] = useState<SourcePhase>({ kind: 'loading' });

  const isGenerating = status === 'streaming';

  useEffect(() => {
    if (!open) return;
    // Reopening to view a running job: reuse the stored source, skip extraction.
    if (isGenerating && storedSource) {
      setSourcePhase({ kind: 'ready', source: storedSource });
      if (storedOutputTarget) setOutputTarget(storedOutputTarget);
      return;
    }

    setSourcePhase({ kind: 'loading' });
    setExtra('');

    let cancelled = false;
    extractActiveReader()
      .then((source) => {
        if (cancelled) return;
        setSourcePhase({ kind: 'ready', source });
      })
      .catch((err) => {
        if (cancelled) return;
        setSourcePhase({ kind: 'error', message: (err as Error).message });
      });
    return () => {
      cancelled = true;
    };
    // We intentionally only re-run on `open` transitions; `isGenerating`
    // is read for the initial branch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const style: AIPreset = styles.find((s) => s.id === styleId) ?? styles[0]!;
  const template: AIPreset = templates.find((t) => t.id === templateId) ?? templates[0]!;

  const formDisabled = isGenerating;

  const handleGenerate = async (): Promise<void> => {
    if (sourcePhase.kind !== 'ready') return;
    if (aiCliProvider === 'none') {
      // Surface the same message we used to set inline; route through store
      // so the indicator can show it if the user later closes the dialog.
      clearError();
      // No-op start: just bail with a user-visible note via stored error.
      // We piggy-back by stuffing into store via a fake error set.
      useAIBlogJobStore.setState({
        error: 'External AI CLI is disabled. Pick a provider in Settings → AI CLI first.',
      });
      return;
    }

    if (
      outputTarget === 'replace' &&
      useEditorStore.getState().content.trim().length > 0 &&
      !confirm(
        'Replace the entire current document with the generated blog? This cannot be undone via Undo.',
      )
    ) {
      return;
    }

    const prompt = buildBlogPrompt({
      template,
      style,
      language,
      length,
      extraInstructions: extra,
      source: sourcePhase.source,
    });

    const jobId = `blog-${Date.now().toString(36)}`;
    void startJob({ prompt, jobId, source: sourcePhase.source, outputTarget });
  };

  // Pressing Escape / clicking the overlay / clicking × should minimize
  // (not cancel) when a job is in-flight. Otherwise it closes as before.
  const handleOpenChange = (next: boolean): void => {
    if (next) return;
    closeDialog();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" /> Generate from reader
          </DialogTitle>
          <DialogDescription>
            Reads the active reader pane and asks Claude (via the local CLI) to draft a Markdown
            artifact in the style and template you choose.
          </DialogDescription>
        </DialogHeader>

        {sourcePhase.kind === 'loading' && (
          <div className="flex items-center gap-3 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Extracting reader content…
          </div>
        )}

        {sourcePhase.kind === 'error' && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div>
              <div className="font-medium">Couldn&rsquo;t read the active tab</div>
              <div className="mt-0.5 opacity-80">{sourcePhase.message}</div>
            </div>
          </div>
        )}

        {sourcePhase.kind === 'ready' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="blog-style">Style</Label>
                <select
                  id="blog-style"
                  value={styleId}
                  onChange={(e) => setStyleId(e.target.value)}
                  disabled={formDisabled}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {styles.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                      {s.builtIn ? '' : ' (custom)'}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-muted-foreground">{style.description}</p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="blog-template">Template</Label>
                <select
                  id="blog-template"
                  value={templateId}
                  onChange={(e) => setTemplateId(e.target.value)}
                  disabled={formDisabled}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {t.builtIn ? '' : ' (custom)'}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-muted-foreground">{template.description}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Language</Label>
                <div className="flex gap-1 rounded-md border border-input p-0.5">
                  {(['zh', 'en'] as const).map((l) => (
                    <Button
                      key={l}
                      type="button"
                      variant={language === l ? 'secondary' : 'ghost'}
                      size="sm"
                      className="h-7 flex-1 text-xs"
                      onClick={() => setLanguage(l)}
                      disabled={formDisabled}
                    >
                      {l === 'zh' ? '中文' : 'English'}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Length</Label>
                <div className="flex gap-1 rounded-md border border-input p-0.5">
                  {(['short', 'medium', 'long'] as const).map((l) => (
                    <Button
                      key={l}
                      type="button"
                      variant={length === l ? 'secondary' : 'ghost'}
                      size="sm"
                      className="h-7 flex-1 text-xs capitalize"
                      onClick={() => setLength(l)}
                      disabled={formDisabled}
                    >
                      {l}
                    </Button>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Output</Label>
              <div className="grid grid-cols-3 gap-1 rounded-md border border-input p-0.5">
                {(
                  [
                    ['new-doc', 'New doc'],
                    ['append', 'Append'],
                    ['replace', 'Replace'],
                  ] as const
                ).map(([id, label]) => (
                  <Button
                    key={id}
                    type="button"
                    variant={outputTarget === id ? 'secondary' : 'ghost'}
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setOutputTarget(id)}
                    disabled={formDisabled}
                  >
                    {label}
                  </Button>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground">
                {outputTarget === 'new-doc'
                  ? 'Creates a new document in the active workspace.'
                  : outputTarget === 'append'
                    ? 'Appends to the bottom of the current document.'
                    : 'Replaces the current document’s contents.'}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="blog-extra">Extra instructions (optional)</Label>
              <textarea
                id="blog-extra"
                value={extra}
                onChange={(e) => setExtra(e.target.value)}
                rows={2}
                placeholder="e.g. include a TL;DR up top; title should be a question"
                disabled={formDisabled}
                className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>

            <SourcePreview source={sourcePhase.source} />

            {isGenerating && (
              <div className="space-y-2 rounded-md border border-border bg-muted/30 px-3 py-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>
                    Streaming
                    {progress.chars > 0 ? (
                      <>
                        {' · '}
                        <span className="font-mono text-foreground">
                          {progress.chars.toLocaleString()} chars
                        </span>
                      </>
                    ) : (
                      '…'
                    )}
                  </span>
                </div>
                {progress.total ? (
                  <pre className="max-h-[40vh] overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground/85">
                    {progress.total}
                    <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-foreground/60 align-middle" />
                  </pre>
                ) : (
                  <div className="text-xs italic text-muted-foreground">
                    Waiting for first token…
                  </div>
                )}
                <p className="text-[10px] text-muted-foreground">
                  Tip: click <span className="font-medium">Minimize</span> to keep browsing the
                  reader while generation continues in the background.
                </p>
              </div>
            )}

            {storeError && !isGenerating && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <div className="break-words">{storeError}</div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {isGenerating ? (
            <>
              <Button variant="ghost" onClick={closeDialog} className="gap-1.5">
                <Minimize2 className="h-3.5 w-3.5" /> Minimize
              </Button>
              <Button variant="outline" onClick={() => void cancelJob()}>
                Cancel generation
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={closeDialog}>
                Close
              </Button>
              <Button onClick={() => void handleGenerate()} disabled={sourcePhase.kind !== 'ready'}>
                {storeError ? 'Retry' : 'Generate'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SourcePreview({ source }: { source: ExtractedSource }): JSX.Element {
  const charCount = source.text.length;
  return (
    <div className="space-y-1 rounded-md border border-dashed border-border bg-muted/20 px-3 py-2 text-[11px]">
      <div className="flex items-center gap-2 text-muted-foreground">
        <span className="rounded bg-background px-1.5 py-0.5 font-mono uppercase tracking-wider">
          {source.kind}
        </span>
        <span className="truncate font-medium">{source.title}</span>
      </div>
      <div className="truncate font-mono text-[10px] text-muted-foreground">{source.source}</div>
      <div className="text-[10px] text-muted-foreground">
        Extracted {charCount.toLocaleString()} characters
        {charCount > 50_000 && ' — will be truncated to 50,000 for the prompt'}
      </div>
    </div>
  );
}
