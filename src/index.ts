import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron';
import { invokeChannels, type Handler, type InvokeMethod } from './api';
import {
  defaultProjectsDirectory, initializeStudio, msg, openProjectAt, projectsDirectory, stopClangd, stopDebugging, stopProcesses,
  stopTerminal, studio,
} from './studio';

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

let mainWindow: BrowserWindow | null = null;

if (require('electron-squirrel-startup')) app.quit();

// Tiling compositors such as Hyprland place, size and close windows themselves,
// so window buttons there only get in the way.
const tilingDesktop = process.platform === 'linux' && (
  /hyprland|sway|i3|river|niri|dwl|qtile|bspwm|awesome|xmonad/i.test(
    `${process.env.XDG_CURRENT_DESKTOP ?? ''}:${process.env.XDG_SESSION_DESKTOP ?? ''}`,
  ) || Boolean(process.env.HYPRLAND_INSTANCE_SIGNATURE || process.env.SWAYSOCK || process.env.I3SOCK));

// Where the window buttons sit: macOS draws its own on the left, Windows and
// other Linux desktops get Electron's overlay on the right.
const windowControls = process.platform === 'darwin' ? 'left' : tilingDesktop ? 'none' : 'right';

initializeStudio({
  send: (channel, payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, payload);
    }
  },
  trashItem: (entryPath) => shell.trashItem(entryPath),
  showItemInFolder: (entryPath) => shell.showItemInFolder(entryPath),
  openPath: (entryPath) => shell.openPath(entryPath),
  templateRoot: app.isPackaged
    ? path.join(process.resourcesPath, 'glistapp-template')
    : path.join(app.getAppPath(), 'glistapp-template'),
  projectsDirectory: defaultProjectsDirectory(),
});

const registerIpcHandlers = (): void => {
  Object.entries(studio).forEach(([method, handler]: [string, Handler]) => {
    ipcMain.handle(invokeChannels[method as InvokeMethod], (_event, ...args) => handler(...args));
  });
  ipcMain.handle(invokeChannels.setTheme, (event, colors: GlistWindowColors) => {
    const color = (value: unknown, fallback: string): string =>
      (typeof value === 'string' && /^#[0-9a-f]{3,8}$/i.test(value) ? value : fallback);
    const window = BrowserWindow.fromWebContents(event.sender);
    nativeTheme.themeSource = colors?.kind === 'light' ? 'light' : 'dark';
    window?.setBackgroundColor(color(colors?.background, '#1e1e1e'));
    if (windowControls === 'right') window?.setTitleBarOverlay({
      color: color(colors?.chrome, '#181818'),
      symbolColor: color(colors?.text, '#cccccc'),
      height: 35,
    });
  });
  ipcMain.handle(invokeChannels.openProject, async () => {
    const defaultPath = projectsDirectory();
    const result = await dialog.showOpenDialog({
      title: msg('openTitle'),
      defaultPath: existsSync(defaultPath) ? defaultPath : undefined,
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return openProjectAt(result.filePaths[0]);
  });
  ipcMain.handle(invokeChannels.openEngineSite, () => shell.openExternal('https://www.glistengine.com/'));
  ipcMain.handle(invokeChannels.setZoomFactor, (event, factor: number) => {
    const safeFactor = Number.isFinite(factor) ? Math.min(2, Math.max(0.5, factor)) : 1;
    event.sender.setZoomFactor(safeFactor);
    return safeFactor;
  });
};

const createWindow = (): void => {
  const runtimeMessages: string[] = [];
  const createdWindow = new BrowserWindow({
    width: 1440, height: 900, minWidth: 980, minHeight: 640,
    backgroundColor: '#1e1e1e', title: 'Glist Studio', autoHideMenuBar: true,
    icon: path.join(
      app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), 'assets'),
      process.platform === 'win32' ? 'glistengine.ico' : 'glistengine.png',
    ),
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 12, y: 10 },
    titleBarOverlay: windowControls === 'right' && {
      color: '#181818',
      symbolColor: '#cccccc',
      height: 35,
    },
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      additionalArguments: [`--window-controls=${windowControls}`],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = createdWindow;
  createdWindow.webContents.on('console-message', (event, _level, message) => {
    const detailMessage = (event as unknown as { message?: string }).message;
    runtimeMessages.push(detailMessage ?? message);
  });
  createdWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
  createdWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // The renderer blocks unloading while tabs are unsaved; Electron would then
  // silently refuse to close, so ask instead.
  createdWindow.webContents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(createdWindow, {
      type: 'warning',
      message: msg('unsavedChanges'),
      buttons: [msg('saveAndClose'), msg('closeWithoutSaving'), msg('cancel')],
      defaultId: 0,
      cancelId: 2,
    });
    if (choice === 0) createdWindow.webContents.send('app:save-and-close', null);
    else if (choice === 1) event.preventDefault();
  });
  createdWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== MAIN_WINDOW_WEBPACK_ENTRY) event.preventDefault();
  });
  createdWindow.webContents.once('did-finish-load', () => {
    const screenshotPath = process.env.GLIST_STUDIO_SCREENSHOT;
    if (!screenshotPath) return;
    setTimeout(async () => {
      let diagnostics: unknown;
      try {
        diagnostics = await createdWindow.webContents.executeJavaScript(`({
          scripts: [...document.scripts].map((script) => script.src),
          apiType: typeof window.glistAPI,
          bodyFont: getComputedStyle(document.body).fontFamily,
          shellDisplay: getComputedStyle(document.querySelector('#app-shell')).display
        })`);
      } catch (error) {
        diagnostics = { error: String(error) };
      }
      const image = await createdWindow.webContents.capturePage();
      await fs.writeFile(screenshotPath, image.toPNG());
      await fs.writeFile(
        `${screenshotPath}.json`,
        JSON.stringify({ runtimeMessages, diagnostics }, null, 2),
        'utf8',
      );
      app.quit();
    }, 1000);
  });
  createdWindow.on('closed', () => { stopProcesses(); stopClangd(); stopDebugging(); stopTerminal(); mainWindow = null; });
};

app.whenReady().then(() => { registerIpcHandlers(); createWindow(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
