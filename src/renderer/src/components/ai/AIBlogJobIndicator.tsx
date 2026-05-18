import { useEffect } from 'react';
import { Loader2, Sparkles, X, Maximize2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useAIBlogJobStore } from '@/stores/ai-blog-job';

/**
 * Bottom-right floating pill that surfaces an in-flight or recently-finished
 * "Generate from reader" job whenever the full dialog is minimized.
 *
 * - While streaming: shows char count + cancel + maximize controls.
 * - Briefly after a job finishes (success or error) while minimized: shows
 *   a one-line toast for ~5s before auto-dismissing.
 */
export function AIBlogJobIndicator(): JSX.Element | null {
  const status = useAIBlogJobStore((s) => s.status);
  const dialogOpen = useAIBlogJobStore((s) => s.dialogOpen);
  const progress = useAIBlogJobStore((s) => s.progress);
  const toast = useAIBlogJobStore((s) => s.toast);
  const openDialog = useAIBlogJobStore((s) => s.openDialog);
  const cancelJob = useAIBlogJobStore((s) => s.cancel);
  const clearToast = useAIBlogJobStore((s) => s.clearToast);

  // Auto-dismiss the success/error toast after 5s.
  useEffect(() => {
    if (!toast) return;
    if (dialogOpen) {
      clearToast();
      return;
    }
    const t = setTimeout(() => clearToast(), 5000);
    return () => clearTimeout(t);
  }, [toast, dialogOpen, clearToast]);

  // Hide entirely when the dialog is the surface showing this state.
  if (dialogOpen) return null;

  if (status === 'streaming') {
    return (
      <div className="fixed bottom-6 right-6 z-[9990] flex items-center gap-2 rounded-full border border-border bg-background/95 px-3 py-2 text-xs shadow-lg backdrop-blur">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-foreground/80" />
        <Sparkles className="h-3.5 w-3.5 text-foreground/70" />
        <span className="text-foreground/90">
          Generating
          {progress.chars > 0 ? (
            <>
              {' · '}
              <span className="font-mono">{progress.chars.toLocaleString()} chars</span>
            </>
          ) : (
            '…'
          )}
        </span>
        <button
          type="button"
          onClick={openDialog}
          title="Show generation"
          className="ml-1 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => void cancelJob()}
          title="Cancel generation"
          className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  if (toast) {
    const isError = toast.kind === 'error';
    return (
      <div
        className={
          'fixed bottom-6 right-6 z-[9990] flex max-w-md items-start gap-2 rounded-md border px-3 py-2 text-xs shadow-lg backdrop-blur ' +
          (isError
            ? 'border-destructive/40 bg-destructive/10 text-destructive'
            : 'border-border bg-background/95 text-foreground')
        }
      >
        {isError ? (
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        ) : (
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
        )}
        <span className="break-words">{toast.message}</span>
        <button
          type="button"
          onClick={clearToast}
          className="ml-1 rounded p-1 opacity-70 hover:opacity-100"
          title="Dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return null;
}
