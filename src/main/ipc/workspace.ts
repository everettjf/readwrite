import { app, ipcMain, shell, BrowserWindow } from 'electron';
import { mkdir, rename, access, writeFile, readdir, stat } from 'node:fs/promises';
import { join, basename, dirname } from 'node:path';
import { homedir } from 'node:os';
import { IPC } from '@shared/ipc-channels';
import type { IpcContext } from './index';
import type { KnownWorkspace } from '@shared/types';
import { kvGet, kvSet } from '../db';

/**
 * Workspace IPC.
 *
 * A workspace is a single root folder; every document inside is its own
 * subfolder containing `<name>.md` + an `images/` directory. The user picks
 * (or creates) a workspace on first launch and can switch between known
 * workspaces at any time. The list of known workspaces and the active one
 * are stored in the global app SQLite kv_store; per-workspace settings
 * (theme, AI keys, etc.) stay global on purpose.
 */

interface SuggestedParent {
  path: string;
  label: string;
  /** True if the path actually exists right now. */
  exists: boolean;
  hint?: string;
}

const KV_KNOWN = 'workspaces';
const KV_ACTIVE = 'activeWorkspace';

function getKnownWorkspaces(): KnownWorkspace[] {
  return kvGet<KnownWorkspace[]>(KV_KNOWN) ?? [];
}

function setKnownWorkspaces(list: KnownWorkspace[]): void {
  kvSet(KV_KNOWN, list);
}

function rememberWorkspace(path: string, name?: string): KnownWorkspace {
  const list = getKnownWorkspaces();
  const idx = list.findIndex((w) => w.path === path);
  const existing = idx >= 0 ? list[idx] : null;
  const entry: KnownWorkspace = {
    path,
    name: name ?? existing?.name ?? basename(path),
    lastOpenedAt: Date.now(),
  };
  if (idx >= 0) list[idx] = entry;
  else list.push(entry);
  list.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  setKnownWorkspaces(list);
  return entry;
}

function setActiveWorkspace(path: string): void {
  kvSet(KV_ACTIVE, path);
}

function getActiveWorkspaceImpl(): string | null {
  const cur = kvGet<string>(KV_ACTIVE);
  return cur && typeof cur === 'string' ? cur : null;
}

/** Public so other IPC modules (e.g. doc creation) can read the active workspace. */
export function getActiveWorkspace(): string | null {
  return getActiveWorkspaceImpl();
}

function broadcastWorkspaceChanged(active: string | null): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) {
      w.webContents.send(IPC.WORKSPACE_ACTIVE_CHANGED, active);
    }
  }
}

function iCloudDocsPath(): string {
  return join(homedir(), 'Library', 'Mobile Documents', 'com~apple~CloudDocs');
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Suggested parent locations for the workspace picker.
 *
 * Each suggestion ends in a "ReadWrite Notes" namespace folder so that all
 * of the user's workspaces stay grouped instead of cluttering iCloud Drive
 * (or ~/Documents) root. The namespace folder is created on demand by the
 * WORKSPACE_CREATE handler's `mkdir -p`; the `exists` flag tracks whether
 * the *parent* container is reachable, since the namespace itself may not
 * exist yet on first run.
 */
const NAMESPACE = 'ReadWrite Notes';

async function suggestedParents(): Promise<SuggestedParent[]> {
  const out: SuggestedParent[] = [];
  if (process.platform === 'darwin') {
    const icloudRoot = iCloudDocsPath();
    out.push({
      path: join(icloudRoot, NAMESPACE),
      label: 'iCloud Drive',
      exists: await pathExists(icloudRoot),
      hint: `Syncs across your Macs and iOS devices via iCloud. We'll group all ReadWrite workspaces under a "${NAMESPACE}" folder.`,
    });
  }
  const docs = app.getPath('documents');
  out.push({
    path: join(docs, NAMESPACE),
    label: 'Documents',
    exists: await pathExists(docs),
    hint: 'Local only.',
  });
  const home = homedir();
  out.push({
    path: join(home, NAMESPACE),
    label: 'Home folder',
    exists: await pathExists(home),
  });
  return out;
}

const FORBIDDEN = /[\\/:*?"<>|]/g; // control-char filtering omitted to satisfy ESLint

function sanitizeName(name: string): string {
  const cleaned = (name ?? '').replace(FORBIDDEN, '-').replace(/\s+/g, ' ').trim().slice(0, 80);
  return cleaned || 'ReadWrite';
}

function timestampForName(): string {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function uniqueFolderPath(parent: string, baseName: string): Promise<string> {
  for (let i = 0; i < 200; i += 1) {
    const candidate = join(parent, i === 0 ? baseName : `${baseName} (${i + 1})`);
    if (!(await pathExists(candidate))) return candidate;
  }
  return join(parent, `${baseName} (${Date.now()})`);
}

/** Migrate the legacy `settings.workspaceRoot` field to the new active-workspace store. */
function migrateLegacy(): void {
  if (getActiveWorkspaceImpl()) return;
  const settings = kvGet<{ workspaceRoot?: string }>('settings');
  const legacy = settings?.workspaceRoot;
  if (legacy && typeof legacy === 'string') {
    rememberWorkspace(legacy);
    setActiveWorkspace(legacy);
  }
}

/** List all `<workspace>/<docFolder>/<docFolder>.md` doc files. Ordering
 *  is decided by the renderer (user preference), so we return an
 *  unsorted-by-design list. */
async function listDocsIn(
  workspace: string,
): Promise<Array<{ path: string; name: string; mtime: number; ctime: number }>> {
  let dirEntries: Array<{
    name: string;
    isDirectory: () => boolean;
    isFile: () => boolean;
  }>;
  try {
    dirEntries = await readdir(workspace, { withFileTypes: true, encoding: 'utf8' });
  } catch {
    return [];
  }
  const docs: Array<{ path: string; name: string; mtime: number; ctime: number }> = [];
  for (const entry of dirEntries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const folder = join(workspace, entry.name);
    const mdPath = join(folder, `${entry.name}.md`);
    try {
      const info = await stat(mdPath);
      if (info.isFile()) {
        // birthtimeMs is 0 on filesystems that don't track creation time
        // (some Linux setups). Fall back to mtime so sort-by-created
        // still produces a stable, sensible ordering.
        const ctime = info.birthtimeMs > 0 ? info.birthtimeMs : info.mtimeMs;
        docs.push({ path: mdPath, name: entry.name, mtime: info.mtimeMs, ctime });
      }
    } catch {
      // markdown file not present; skip
    }
  }
  return docs;
}

export function registerWorkspaceIpc(_ctx: IpcContext): void {
  migrateLegacy();

  ipcMain.handle(IPC.WORKSPACE_LIST_KNOWN, (): KnownWorkspace[] => getKnownWorkspaces());

  ipcMain.handle(IPC.WORKSPACE_GET_ACTIVE, (): string | null => getActiveWorkspaceImpl());

  ipcMain.handle(IPC.WORKSPACE_SET_ACTIVE, async (_e, path: string): Promise<KnownWorkspace> => {
    if (!(await pathExists(path))) {
      throw new Error(`Workspace folder does not exist: ${path}`);
    }
    const entry = rememberWorkspace(path);
    setActiveWorkspace(path);
    broadcastWorkspaceChanged(path);
    return entry;
  });

  ipcMain.handle(
    IPC.WORKSPACE_CREATE,
    async (
      _e,
      opts: { parent: string; name: string; activate?: boolean },
    ): Promise<KnownWorkspace> => {
      const parent = opts.parent;
      if (!(await pathExists(parent))) {
        await mkdir(parent, { recursive: true });
      }
      const baseName = sanitizeName(opts.name);
      const folderPath = await uniqueFolderPath(parent, baseName);
      await mkdir(folderPath, { recursive: true });
      const entry = rememberWorkspace(folderPath);
      if (opts.activate ?? true) {
        setActiveWorkspace(folderPath);
        broadcastWorkspaceChanged(folderPath);
      }
      return entry;
    },
  );

  ipcMain.handle(
    IPC.WORKSPACE_RENAME_KNOWN,
    (_e, opts: { path: string; newName: string }): KnownWorkspace[] => {
      const list = getKnownWorkspaces();
      const idx = list.findIndex((w) => w.path === opts.path);
      if (idx >= 0) {
        list[idx] = { ...list[idx]!, name: sanitizeName(opts.newName) };
        setKnownWorkspaces(list);
      }
      return list;
    },
  );

  ipcMain.handle(IPC.WORKSPACE_FORGET, (_e, path: string): KnownWorkspace[] => {
    const list = getKnownWorkspaces().filter((w) => w.path !== path);
    setKnownWorkspaces(list);
    if (getActiveWorkspaceImpl() === path) {
      kvSet(KV_ACTIVE, null);
      broadcastWorkspaceChanged(null);
    }
    return list;
  });

  ipcMain.handle(IPC.WORKSPACE_TRASH, async (_e, path: string): Promise<KnownWorkspace[]> => {
    // Move the entire workspace folder (with all its docs and images) to
    // the system Trash. Then forget the entry from the known list and
    // clear the active pointer if it was pointing here.
    if (await pathExists(path)) {
      await shell.trashItem(path);
    }
    const list = getKnownWorkspaces().filter((w) => w.path !== path);
    setKnownWorkspaces(list);
    if (getActiveWorkspaceImpl() === path) {
      kvSet(KV_ACTIVE, null);
      broadcastWorkspaceChanged(null);
    }
    return list;
  });

  ipcMain.handle(
    IPC.WORKSPACE_GET_SUGGESTED_PARENTS,
    async (): Promise<SuggestedParent[]> => suggestedParents(),
  );

  ipcMain.handle(IPC.WORKSPACE_REVEAL, async (_e, path: string): Promise<void> => {
    shell.showItemInFolder(path);
  });

  ipcMain.handle(IPC.WORKSPACE_LIST_DOCS, async (_e, workspacePath?: string) => {
    const ws = workspacePath ?? getActiveWorkspaceImpl();
    if (!ws) return [];
    return await listDocsIn(ws);
  });

  // Document creation (now anchored to the active workspace)

  ipcMain.handle(
    IPC.DOC_CREATE_NEW,
    async (
      _e,
      opts: { suggestedName?: string; initialContent?: string; parent?: string },
    ): Promise<string> => {
      const root = opts.parent ?? getActiveWorkspaceImpl();
      if (!root) {
        throw new Error('No active workspace. Pick or create one first.');
      }
      await mkdir(root, { recursive: true });
      const baseName = sanitizeName(opts.suggestedName || `Untitled - ${timestampForName()}`);
      const folderPath = await uniqueFolderPath(root, baseName);
      await mkdir(folderPath, { recursive: true });
      await mkdir(join(folderPath, 'images'), { recursive: true });
      const filePath = join(folderPath, `${basename(folderPath)}.md`);
      await writeFile(filePath, opts.initialContent ?? '', 'utf8');
      return filePath;
    },
  );

  ipcMain.handle(
    IPC.DOC_RENAME,
    async (
      _e,
      opts: { currentPath: string; newName: string; newParent?: string },
    ): Promise<string> => {
      const currentFolder = dirname(opts.currentPath);
      const parent = opts.newParent || dirname(currentFolder);
      const newFolderName = sanitizeName(opts.newName);
      const targetFolder =
        join(parent, newFolderName) === currentFolder
          ? currentFolder
          : await uniqueFolderPath(parent, newFolderName);

      if (targetFolder !== currentFolder) {
        await rename(currentFolder, targetFolder);
      }

      const oldMdName = basename(opts.currentPath);
      const oldMdInTarget = join(targetFolder, oldMdName);
      const desiredMdPath = join(targetFolder, `${basename(targetFolder)}.md`);
      if (oldMdInTarget !== desiredMdPath) {
        await rename(oldMdInTarget, desiredMdPath);
      }
      return desiredMdPath;
    },
  );

  ipcMain.handle(IPC.DOC_REVEAL_IN_FINDER, async (_e, path: string): Promise<void> => {
    shell.showItemInFolder(path);
  });

  ipcMain.handle(IPC.DOC_TRASH, async (_e, mdPath: string): Promise<void> => {
    // Move the entire document folder (not just the .md) to the system Trash.
    const folder = dirname(mdPath);
    await shell.trashItem(folder);
  });

  // Per-workspace "last opened document" memory. The map is stored under a
  // single kv key as { [workspacePath]: docPath } so we can fetch all of it
  // cheaply on app boot.

  ipcMain.handle(IPC.LAST_DOC_GET, (_e, workspacePath: string): string | null => {
    const map = kvGet<Record<string, string>>('lastDocs') ?? {};
    const v = map[workspacePath];
    return typeof v === 'string' ? v : null;
  });

  ipcMain.handle(
    IPC.LAST_DOC_SET,
    (_e, opts: { workspace: string; docPath: string | null }): void => {
      const map = kvGet<Record<string, string>>('lastDocs') ?? {};
      if (opts.docPath) {
        map[opts.workspace] = opts.docPath;
      } else {
        delete map[opts.workspace];
      }
      kvSet('lastDocs', map);
    },
  );

  ipcMain.handle(
    IPC.FS_PATH_EXISTS,
    async (_e, path: string): Promise<boolean> => pathExists(path),
  );
}
