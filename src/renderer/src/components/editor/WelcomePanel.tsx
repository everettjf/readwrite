import { useWorkspaceStore } from '@/stores/workspace';
import { useEditorStore } from '@/stores/editor';
import { Button } from '@/components/ui/button';
import { ArrowRight, BookOpen, FilePlus, FileText, PenLine, Sparkles } from 'lucide-react';
import { relativeTime } from '@/lib/utils';
import { createNewDocument, openMarkdownFromDialog, openMarkdownAtPath } from '@/lib/doc-io';
import type { DocSummary } from '@shared/types';

const MAX_DOCS_SHOWN = 8;

/**
 * Replaces the editor with a "Welcome / Recent" view when no document
 * is open. Editor-side concern only — focused on documents and
 * writing. Reader-side affordances (URL / PDF / EPUB / code, recent
 * reader items) live in the left pane's EmptyState.
 */
export function WelcomePanel(): JSX.Element {
  const activeWorkspace = useWorkspaceStore((s) => s.active);
  const known = useWorkspaceStore((s) => s.known);
  const docs = useWorkspaceStore((s) => s.docs);
  const refreshDocs = useWorkspaceStore((s) => s.refreshDocs);
  const editor = useEditorStore;

  const wsName = known.find((w) => w.path === activeWorkspace)?.name ?? '—';

  const onNewDoc = async (): Promise<void> => {
    const created = await createNewDocument({ initialContent: '# Untitled\n\n' });
    editor.getState().setPath(created.path);
    editor.getState().setContent(created.content, { markDirty: false });
    await refreshDocs();
  };

  const onOpenMarkdown = async (): Promise<void> => {
    const opened = await openMarkdownFromDialog();
    if (!opened) return;
    editor.getState().setPath(opened.path);
    editor.getState().setContent(opened.content, { markDirty: false });
  };

  const onOpenDoc = async (doc: DocSummary): Promise<void> => {
    const opened = await openMarkdownAtPath(doc.path);
    editor.getState().setPath(opened.path);
    editor.getState().setContent(opened.content, { markDirty: false });
  };

  const recentDocs = [...docs].sort((a, b) => b.mtime - a.mtime).slice(0, MAX_DOCS_SHOWN);

  return (
    <div className="h-full overflow-y-auto bg-gradient-to-br from-background via-background to-primary/[0.035]">
      <div className="mx-auto max-w-4xl space-y-8 px-8 py-10">
        <header className="relative overflow-hidden rounded-2xl border bg-card p-7 shadow-sm">
          <div className="absolute -right-10 -top-14 h-40 w-40 rounded-full bg-primary/[0.06] blur-2xl" />
          <div className="relative space-y-5">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              {wsName}
            </div>
            <div className="max-w-xl space-y-2">
              <h1 className="text-3xl font-semibold tracking-tight">Turn reading into writing.</h1>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Keep the source beside your draft, capture what matters, and shape it into something
                worth sharing.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={onNewDoc}>
                <FilePlus className="mr-2 h-4 w-4" /> Start a document
              </Button>
              <Button variant="outline" onClick={onOpenMarkdown}>
                <FileText className="mr-2 h-4 w-4" /> Open Markdown…
              </Button>
            </div>
          </div>
        </header>

        <section className="grid gap-3 sm:grid-cols-3">
          {[
            { icon: BookOpen, title: 'Read', detail: 'Web, PDF, EPUB, or code' },
            { icon: PenLine, title: 'Write', detail: 'WYSIWYG and source modes' },
            { icon: Sparkles, title: 'Shape', detail: 'Snips, AI, and publishing' },
          ].map(({ icon: Icon, title, detail }) => (
            <div key={title} className="rounded-xl border bg-card/70 p-4">
              <Icon className="mb-3 h-5 w-5 text-primary" />
              <div className="text-sm font-medium">{title}</div>
              <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
            </div>
          ))}
        </section>

        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Recent documents
          </h2>
          {recentDocs.length === 0 ? (
            <div className="rounded-md border border-dashed border-border bg-muted/20 px-4 py-6 text-center text-xs text-muted-foreground">
              No documents yet. Click <span className="font-mono">New document</span> above.
            </div>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {recentDocs.map((doc) => (
                <li key={doc.path}>
                  <button
                    type="button"
                    onClick={() => onOpenDoc(doc)}
                    className="group flex w-full items-center gap-3 rounded-xl border bg-card px-4 py-3 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/20 hover:shadow-md"
                  >
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-sm">{doc.name}</span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {relativeTime(doc.mtime)}
                    </span>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
