import { useMemo, useState } from 'react';
import { useWorkspaceStore } from '@/stores/workspace';
import { useEditorStore } from '@/stores/editor';
import { useSettingsStore } from '@/stores/settings';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Folder,
  Plus,
  RefreshCw,
  MoreHorizontal,
  Pencil,
  Trash2,
  ExternalLink,
  Search,
  X,
  ChevronDown,
  ArrowUpDown,
  Check,
} from 'lucide-react';
import { cn, relativeTime } from '@/lib/utils';
import { createNewDocument, openMarkdownAtPath, renameDocFolder, docBasename } from '@/lib/doc-io';
import { RenameDocDialog } from '@/components/dialogs/RenameDocDialog';
import { WorkspaceSwitcher } from '@/components/layout/WorkspaceSwitcher';
import type { DocSummary, DocSortKey } from '@shared/types';

interface DocsSidebarProps {
  onSwitchDoc: (doc: DocSummary) => Promise<void>;
}

export function DocsSidebar({ onSwitchDoc }: DocsSidebarProps): JSX.Element {
  const active = useWorkspaceStore((s) => s.active);
  const known = useWorkspaceStore((s) => s.known);
  const docs = useWorkspaceStore((s) => s.docs);
  const refreshDocs = useWorkspaceStore((s) => s.refreshDocs);
  const editorPath = useEditorStore((s) => s.path);
  const sortKey = useSettingsStore((s) => s.docSortKey);
  const updateSettings = useSettingsStore((s) => s.update);

  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('');
  const [renameTarget, setRenameTarget] = useState<DocSummary | null>(null);

  const activeWorkspaceName =
    known.find((w) => w.path === active)?.name ?? (active ? docBasename(active) : '—');

  const filteredDocs = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const matched = q ? docs.filter((d) => d.name.toLowerCase().includes(q)) : docs.slice();
    return sortDocs(matched, sortKey);
  }, [filter, docs, sortKey]);

  const setSortKey = (next: DocSortKey): void => {
    if (next === sortKey) return;
    void updateSettings({ docSortKey: next });
  };

  const onNew = async (): Promise<void> => {
    const editor = useEditorStore.getState();
    if (editor.dirty && !confirm('Discard unsaved changes?')) return;
    setBusy(true);
    try {
      const created = await createNewDocument({ initialContent: '# Untitled\n\n' });
      editor.setPath(created.path);
      editor.setContent(created.content, { markDirty: false });
      await refreshDocs();
    } finally {
      setBusy(false);
    }
  };

  const onOpen = async (doc: DocSummary): Promise<void> => {
    if (doc.path === editorPath) return;
    await onSwitchDoc(doc);
  };

  const onRenameConfirm = async (newName: string): Promise<void> => {
    if (!renameTarget) return;
    const newPath = await renameDocFolder(renameTarget.path, newName);
    // If the renamed doc is the editor's active doc, reload it from the new path.
    const editor = useEditorStore.getState();
    if (editor.path === renameTarget.path) {
      const reopened = await openMarkdownAtPath(newPath);
      editor.setPath(reopened.path);
      editor.setContent(reopened.content, { markDirty: false });
    }
    setRenameTarget(null);
    await refreshDocs();
  };

  return (
    <div className="flex h-full flex-col bg-muted/20">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border bg-background/40 px-2">
        <WorkspaceSwitcher
          align="start"
          trigger={
            <button
              className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 text-xs font-medium transition-colors hover:bg-accent"
              title={active ?? undefined}
            >
              <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-left">{activeWorkspaceName}</span>
              <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
            </button>
          }
        />
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={onNew}
          disabled={busy}
          title="New document (creates a new folder)"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              title={`Sort: ${SORT_LABELS[sortKey]}`}
            >
              <ArrowUpDown className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
              Sort by
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {(['mtime', 'ctime', 'name'] as const).map((k) => (
              <DropdownMenuItem
                key={k}
                onSelect={() => setSortKey(k)}
                className="flex items-center justify-between gap-4"
              >
                <span>{SORT_LABELS[k]}</span>
                {sortKey === k && <Check className="h-3.5 w-3.5 text-muted-foreground" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => refreshDocs()}
          title="Refresh"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="relative shrink-0 px-2 py-1.5">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter…"
          className="h-7 pl-7 pr-7 text-xs"
        />
        {filter && (
          <button
            type="button"
            onClick={() => setFilter('')}
            className="absolute right-3.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-accent"
            title="Clear filter"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {docs.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">
            No documents yet. Click <span className="font-mono">+</span> to create one.
          </div>
        ) : filteredDocs.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">
            No matches for &ldquo;{filter}&rdquo;.
          </div>
        ) : (
          <ul className="py-1">
            {filteredDocs.map((doc) => {
              const isActive = doc.path === editorPath;
              return (
                <li key={doc.path}>
                  <DocRow
                    doc={doc}
                    active={isActive}
                    sortKey={sortKey}
                    onOpen={onOpen}
                    onChanged={refreshDocs}
                    onStartRename={(d) => setRenameTarget(d)}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <RenameDocDialog
        open={!!renameTarget}
        initialName={renameTarget?.name ?? ''}
        onCancel={() => setRenameTarget(null)}
        onConfirm={onRenameConfirm}
      />
    </div>
  );
}

const SORT_LABELS: Record<DocSortKey, string> = {
  mtime: 'Last modified',
  ctime: 'Created',
  name: 'Name (A–Z)',
};

function sortDocs(docs: DocSummary[], key: DocSortKey): DocSummary[] {
  // Note: `docs` is already a fresh array — sort in place.
  if (key === 'name') {
    return docs.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }),
    );
  }
  if (key === 'ctime') return docs.sort((a, b) => b.ctime - a.ctime);
  return docs.sort((a, b) => b.mtime - a.mtime);
}

interface DocRowProps {
  doc: DocSummary;
  active: boolean;
  sortKey: DocSortKey;
  onOpen: (doc: DocSummary) => void;
  onChanged: () => Promise<void>;
  onStartRename: (doc: DocSummary) => void;
}

function DocRow({
  doc,
  active,
  sortKey,
  onOpen,
  onChanged,
  onStartRename,
}: DocRowProps): JSX.Element {
  const handleReveal = (): void => {
    window.api.workspace.revealInFinder(doc.path).catch(() => null);
  };

  const handleDelete = async (): Promise<void> => {
    const ok = confirm(
      `Delete "${doc.name}"?\n\nThis moves the entire document folder to the system Trash.\nYou can restore it from there.`,
    );
    if (!ok) return;
    try {
      await window.api.workspace.trashDoc(doc.path);
      const editor = useEditorStore.getState();
      if (editor.path === doc.path) {
        editor.setPath(null);
        editor.setContent('', { markDirty: false });
      }
      await onChanged();
    } catch (err) {
      alert(`Delete failed: ${(err as Error).message}`);
    }
  };

  return (
    <div
      className={cn(
        'group flex items-center gap-2 px-2 py-1.5 text-xs transition-colors',
        active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
      )}
    >
      <button
        type="button"
        onClick={() => onOpen(doc)}
        className="flex min-w-0 flex-1 flex-col gap-0.5 text-left"
      >
        <span className="truncate font-medium">{doc.name}</span>
        <span className="truncate text-[10px] text-muted-foreground">
          {sortKey === 'name'
            ? relativeTime(doc.mtime)
            : sortKey === 'ctime'
              ? `Created ${relativeTime(doc.ctime)}`
              : relativeTime(doc.mtime)}
        </span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => onStartRename(doc)}>
            <Pencil className="mr-2 h-3.5 w-3.5" /> Rename
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={handleReveal}>
            <ExternalLink className="mr-2 h-3.5 w-3.5" /> Reveal in Finder
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={handleDelete}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="mr-2 h-3.5 w-3.5" /> Move to Trash
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
