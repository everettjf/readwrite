import type { BrowserWindow } from 'electron';
import { app, shell, Menu } from 'electron';
import { electronApp, optimizer } from '@electron-toolkit/utils';
import { join } from 'node:path';
import { createMainWindow } from './window';
import { registerAllIpcHandlers } from './ipc';
import { initDatabase, closeDatabase } from './db';
import { TabManager } from './tabs';
import { FileWatcherHub } from './watchers/file-watcher';
import { buildApplicationMenu } from './menu';
import { initAutoUpdater } from './auto-update';

const APP_NAME = 'ReadWrite';

// Suppress the OS keychain prompt that Chromium's Safe Storage throws on the
// very first launch. `WebContentsView` persists cookies, so Chromium's network
// service reaches for the "<App> Safe Storage" keychain item as soon as it
// starts — and because we don't (yet) ship a Developer ID-signed, notarized
// build, macOS can't grant a trusted binary access to that item, so it prompts
// on every launch and "Always Allow" never sticks. `use-mock-keychain` makes
// Chromium (and Electron's `safeStorage`) use a static in-process key instead
// of the OS keychain — no prompt, at the cost of weaker at-rest encryption for
// cookies and for our own secrets (API keys become obfuscated, not truly
// encrypted; see src/main/secrets.ts).
//
// TRADE-OFF / TODO: the real fix is Developer ID signing + notarization
// (electron-builder.yml `notarize`, CI `CSC_IDENTITY_AUTO_DISCOVERY`). Once
// that lands, drop this switch so secrets go back into the real keychain.
//
// NOTE on upgrade: any API key a user previously saved was encrypted with the
// real keychain key and can't be decrypted with the mock key. `readSecret`
// handles this gracefully — it discards the unreadable ciphertext and returns
// empty, so the user just re-enters the key once in Settings.
//
// Windows (DPAPI) never shows this prompt, so we leave it on the real store
// there and only switch macOS / Linux, which both prompt.
if (process.platform === 'darwin' || process.platform === 'linux') {
  app.commandLine.appendSwitch('use-mock-keychain');
}

// Set the app name as early as possible so the macOS menu bar, the dock
// label, and the auto-generated "About <name>" item all show "ReadWrite"
// instead of the default "Electron" / package.json's lowercase "readwrite".
// Production .app bundles get this from electron-builder's productName,
// but in dev (and for window/dock titles before the bundle name kicks in)
// we have to do it ourselves.
app.setName(APP_NAME);

let mainWindow: BrowserWindow | null = null;
let tabManager: TabManager | null = null;
let watcherHub: FileWatcherHub | null = null;

// One-time process-wide setup: IPC handlers, DB, menu, dock icon. Must
// only run once per app lifetime — re-running it would re-register IPC
// handlers and crash with "Attempted to register a second handler".
function setupOnce(): void {
  electronApp.setAppUserModelId('app.readwrite.desktop');

  Menu.setApplicationMenu(buildApplicationMenu(APP_NAME));

  if (process.platform === 'darwin' && app.dock) {
    try {
      app.dock.setIcon(join(__dirname, '../../build/icon.png'));
    } catch {
      // Best-effort — missing in some packaged scenarios; not fatal.
    }
  }

  app.on('browser-window-created', (_event, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  initDatabase();

  // IPC handlers read the current window/managers through these getters,
  // so re-opening the window after close still routes correctly without
  // re-registering anything.
  registerAllIpcHandlers({
    getMainWindow: () => mainWindow,
    getTabManager: () => tabManager!,
    getWatcherHub: () => watcherHub!,
  });
}

// Open (or re-open) the main window. Safe to call again after the window
// was closed — e.g. macOS dock-icon click when no windows are open.
function openMainWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  mainWindow = createMainWindow({
    preloadPath: join(__dirname, '../preload/index.mjs'),
    devUrl: process.env['ELECTRON_RENDERER_URL'],
    indexHtml: join(__dirname, '../renderer/index.html'),
  });

  tabManager = new TabManager(mainWindow);
  watcherHub = new FileWatcherHub(mainWindow);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    tabManager?.destroyAll();
    watcherHub?.destroyAll();
    tabManager = null;
    watcherHub = null;
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  setupOnce();
  openMainWindow();
  initAutoUpdater();

  app.on('activate', () => {
    openMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  closeDatabase();
});
