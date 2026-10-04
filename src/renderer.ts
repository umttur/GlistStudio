// Before Monaco, which reads its words in the chosen language while it loads.
import { editorLanguage } from './editor-language';
// Monaco's package root selects its AMD build in Electron's CommonJS context.
// The explicit ESM entry prevents a runtime `define is not defined` failure.
// eslint-disable-next-line import/no-unresolved
import * as monaco from 'monaco-editor/editor/editor.api';
// Semantic tokens for whole documents, which clangd sends. Monaco's own
// semanticTokens feature loads only the variant for visible ranges.
// eslint-disable-next-line import/no-unresolved
import 'monaco-editor/editor/contrib/semanticTokens/browser/documentSemanticTokens';
import appIconUrl from '../assets/glistengine.ico';
import { AgentSettings } from './agent-settings';
import { applyTheme, getActiveTheme, onThemeChange, setUpThemePicker } from './appearance';
import { ClangdClient } from './clangd';
import { registerCmakeLanguage } from './cmake-language';
import { checkDataFiles } from './data-checks';
import { DataFormatError, formatIni, formatToml, formatYaml, isDataLanguage } from './data-format';
import { registerTomlLanguage } from './toml-language';
import { editorBehaviour, loadEditorSettings, onEditorSettingsChange, setUpEditorSettings } from './editor-settings';
import { defaultHiddenFolders, hiddenFolderList, setHiddenFolders } from './hidden-folders';
import { codeFontStack, editorFonts, loadFonts, onFontsChange, panelFontSize, setUpFontSettings } from './fonts';
import { changedLines, codeLines, editsWithin, type LineRange } from './format-lines';
import { formatOutput, newOutputStyle, outputBanner } from './output-format';
import { OutputHistory, type OutputRun, type OutputSection } from './output-history';
import { fileIconElement } from './file-icons';
import { icon, placeIcons, type IconName } from './icons';
import { Debugger } from './debugger';
import { setHostPlatform } from './host';
import { baseName, isWithin, joinPath, pathUri, uriPath } from './paths';
import { isLinux, isMac, primaryKey, reformatShortcut, shortcutLabel } from './shortcuts';
import { dressSelects } from './select-menu';
import { setUpStarPrompt } from './star-prompt';
import { setUpGlistInstaller } from './glist-installer';
import { TargetPicker } from './targets';
import { canUpdate, checkForUpdates, setUpUpdates } from './updates';
import { GitClient } from './git-client';
import { branchName, CommitView } from './git-commit-view';
import { showMenu, type MenuEntry } from './context-menu';
import { editorCommands, editorMenu, editorMenuPoint, type EditorMenuHooks } from './editor-menu';
import { EditorLayout, maxGroups } from './editor-layout';
import { CommandPalette, type PaletteCommand } from './command-palette';
import { FindInFiles } from './find-in-files';
import { applyPatchFiles, applyPatchFromClipboard } from './patches';
import { SearchEverywhere, type SymbolHit } from './search-everywhere';
import { declarationAt } from './symbol-signature';
import { cloneDialog, formDialog, identityDialog, pushDialog, type PushEntry } from './git-dialogs';
import { PluginsView, pluginTarget } from './plugins-view';
import { EngineView, engineTarget } from './engine-view';
import { updateCheckout, type CheckoutTarget, type CheckoutUpdateHooks } from './checkout-updates';
import { GitEditor } from './git-editor';
import { describeDebugger, installGdb, setUpDebuggerSettings } from './debugger-settings';
import { GitPanel, type GitPanelView } from './git-panel';
import { notify, type Notice } from './notifications';
import { copyReport, errorMessage, ignorableError, setReportWindow } from './debug-report';
import { setUpProjectPicker } from './project-picker';
import { AboutView } from './about-view';
import { StudioTerminal } from './terminal';
import { PathSettings } from './path-settings';
import { EnvironmentSettings } from './environment-settings';
import { RunArguments } from './run-arguments';
import { terminalTheme } from './themes';
import { isLanguage, languages } from './languages';
import { choiceDialog, confirmDialog } from './confirm-dialog';
import { lineChanges, mapLine } from './line-diff';
import { applyLanguage, getLanguage, percent, t, type TranslationKey } from './localization';
import { renderImagePage, type ImagePage } from './image-page';
import { imageType } from './images';
import { renderDatabasePage, type DatabasePage } from './database-page';
import { renderDatabaseDiffPage, type DatabaseDiffPage } from './database-diff-page';
import { isDatabaseFile } from './databases';
import { renderModelPage, type ModelPage } from './model-page';
import { modelType } from './models';
import { renderMediaPage, type MediaPage } from './media-page';
import { mediaType } from './media';
import { loadSession, restorableTab, saveSession, type ProjectSession } from './project-session';
import { renderReadmePage, type ReadmePage } from './readme-page';
import { setUpRepair } from './repair';
import './index.css';

interface OpenFile {
  kind: 'file';
  path: string;
  name: string;
  model: monaco.editor.ITextModel;
  // The model's alternative version id when it matched the file on disk.
  savedVersion: number;
  readOnly: boolean;
  // The .clang-format a C or C++ file follows, once known.
  style?: GlistCodeStyle | null;
}

// A file compared between two versions, in a tab of its own: the last commit
// against the file as it is now, or a commit against the one before it.
interface DiffTab {
  kind: 'diff';
  // The tab's key.
  path: string;
  file: string;
  // Where a renamed file was before.
  from?: string;
  name: string;
  // Revisions; no base means the file did not exist yet, no target means as it is now.
  base: string | null;
  target: string | null;
  original: monaco.editor.ITextModel;
  modified: monaco.editor.ITextModel;
  leftLabel: string;
  rightLabel: string;
  // Why there are no lines to compare, such as a binary file.
  message: string;
  // Its two versions have arrived once; until then it compares two empty texts.
  filled?: boolean;
}

// A plugin's README, opened from the Plugins view, in a tab of its own.
interface ReadmeTab {
  kind: 'readme';
  // The tab's key: readme:<name>.
  path: string;
  name: string;
  page: ReadmePage;
  // Goes up when the README arrives, so a side showing the tab draws it again.
  version: number;
}

// An image file, shown as a picture rather than as text.
interface ImageTab {
  kind: 'image';
  // The tab's key: the file's path.
  path: string;
  name: string;
  page: ImagePage;
  // Goes up when the image arrives, so a side showing the tab draws it again.
  version: number;
}

// A 3D model, drawn rather than shown as text.
interface ModelTab {
  kind: 'model';
  // The tab's key: the file's path.
  path: string;
  name: string;
  page: ModelPage;
  // Goes up when the model arrives, so a side showing the tab draws it again.
  version: number;
}

// A SQLite database, opened to look in and change rather than as bytes.
interface DatabaseTab {
  kind: 'database';
  // The tab's key: the file's path.
  path: string;
  name: string;
  page: DatabasePage;
  version: number;
}

// A video or a sound, played rather than shown as bytes.
interface MediaTab {
  kind: 'media';
  // The tab's key: the file's path.
  path: string;
  name: string;
  page: MediaPage;
  version: number;
}

// A database compared between two versions, table by table and row by row,
// where another file's diff would be compared line by line.
interface DatabaseDiffTab {
  kind: 'database-diff';
  // The tab's key, as a diff's: diff:<base>:<target>:<file>.
  path: string;
  name: string;
  file: string;
  page: DatabaseDiffPage;
  // Goes up when a comparison arrives, so a side showing the tab draws it again.
  version: number;
}

// Tabs drawn in a side's page rather than in its editor; those of a file
// follow it when it is renamed and close when it is deleted.
type FilePageTab = ImageTab | ModelTab | DatabaseTab | MediaTab;
type PageTab = ReadmeTab | FilePageTab | DatabaseDiffTab;

type EditorTab = OpenFile | DiffTab | PageTab;
const isFilePageTab = (tab: EditorTab): tab is FilePageTab => tab.kind === 'image' || tab.kind === 'model' || tab.kind === 'database'
  || tab.kind === 'media';
const isPageTab = (tab: EditorTab): tab is PageTab => tab.kind === 'readme' || tab.kind === 'database-diff' || isFilePageTab(tab);

// Shown regardless after a moment, should setting up stop short of the end.
window.setTimeout(() => document.documentElement.classList.add('ready'), 4000);

const element = <T extends HTMLElement>(selector: string): T => {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Arayüz öğesi bulunamadı: ${selector}`);
  return found;
};

const openButton = element<HTMLButtonElement>('#open-project');
const emptyOpenButton = element<HTMLButtonElement>('#empty-open-project');
const emptyNewProjectButton = element<HTMLButtonElement>('#empty-new-project');
const saveButton = element<HTMLButtonElement>('#save-file');
const buildButton = element<HTMLButtonElement>('#build-project');
const buildMenuButton = element<HTMLButtonElement>('#build-menu');
const runButton = element<HTMLButtonElement>('#run-project');
const stopButton = element<HTMLButtonElement>('#stop-project');
const debugButton = element<HTMLButtonElement>('#debug-project');
// Settings > Build > Show all targets: the target Build, Run and Debug use.
const targetPicker = new TargetPicker(element<HTMLSelectElement>('#target-select'), () => updateButtons());
const debugControls = element<HTMLElement>('#debug-controls');
const debugContinueButton = element<HTMLButtonElement>('#debug-continue');
const debugPauseButton = element<HTMLButtonElement>('#debug-pause');
const debugStepButtons = ['#debug-step-over', '#debug-step-into', '#debug-step-out'].map((id) => element<HTMLButtonElement>(id));
const debugStartButton = element<HTMLButtonElement>('#debug-start');
const newFileButton = element<HTMLButtonElement>('#new-file');
const newFolderButton = element<HTMLButtonElement>('#new-folder');
const deleteEntryButton = element<HTMLButtonElement>('#delete-entry');
const refreshButton = element<HTMLButtonElement>('#refresh-tree');
const appShell = element<HTMLElement>('#app-shell');
const activityButtons = [...document.querySelectorAll<HTMLButtonElement>('.activity-button[data-view]')];
const explorerView = element<HTMLElement>('#explorer-view');
const debugView = element<HTMLElement>('#debug-view');
const fileTree = element<HTMLDivElement>('#file-tree');
const tabsHost = element<HTMLDivElement>('#editor-tabs');
const editorHost = element<HTMLDivElement>('#editor-host');
const welcome = element<HTMLDivElement>('#welcome');
const groupsHost = element<HTMLElement>('#editor-groups');
// The diff view as the page starts, for the right side to copy.
const diffTemplate = element<HTMLElement>('#diff-view').cloneNode(true) as HTMLElement;
const commitViewElement = element<HTMLElement>('#commit-view');
const pluginsViewElement = element<HTMLElement>('#plugins-view');
const engineViewElement = element<HTMLElement>('#engine-view');
const commitActivity = element<HTMLButtonElement>('#commit-activity');
const gitTab = element<HTMLButtonElement>('#git-tab');
const gitPanelElement = element<HTMLElement>('#git-panel');
const gitMenuButton = element<HTMLButtonElement>('#git-menu-button');
const branchChip = element<HTMLButtonElement>('#git-branch-chip');
const output = element<HTMLPreElement>('#output');
const projectRootLabel = element<HTMLDivElement>('#project-root-label');
const processStatus = element<HTMLSpanElement>('#process-status');
const clangdStatus = element<HTMLSpanElement>('#clangd-status');
const buildNotice = element<HTMLElement>('#build-notice');
const inputDialog = element<HTMLDialogElement>('#input-dialog');
const inputForm = element<HTMLFormElement>('#input-form');
const inputValue = element<HTMLInputElement>('#input-dialog-value');
const projectDialog = element<HTMLDialogElement>('#new-project-dialog');
const settingsDialog = element<HTMLDialogElement>('#settings-dialog');
const settingsLanguage = element<HTMLSelectElement>('#settings-language');
element<HTMLImageElement>('#app-icon').src = appIconUrl;
element<HTMLImageElement>('#welcome-icon').src = appIconUrl;

let activeProject: GlistProjectInfo | null = null;
let selectedEntry: GlistFileEntry | null = null;
const selectedEntries = new Map<string, GlistFileEntry>();
let selectionAnchor: HTMLButtonElement | null = null;
const treeRowEntries = new WeakMap<HTMLButtonElement, GlistFileEntry>();
let copiedEntryPaths: string[] = [];
let isBuildRunning = false;
let isRunRunning = false;
// Build or Run was pressed and the backend has not taken it over yet.
let isStarting = false;
// The open files and diffs, each once however many tabs show it.
const openFiles = new Map<string, EditorTab>();
// The tabs on each side of the editor area, and which is in front.
const layout = new EditorLayout();
const fileTabs = (): OpenFile[] => [...openFiles.values()].filter((tab): tab is OpenFile => tab.kind === 'file');
// The tab in front on the side being worked in.
const activeTab = (): EditorTab | undefined => (layout.activeKey ? openFiles.get(layout.activeKey) : undefined);
// The file tab in front, if the tab in front is one.
const activeFile = (): OpenFile | undefined => {
  const tab = activeTab();
  return tab?.kind === 'file' ? tab : undefined;
};
const expandedDirectories = new Set<string>();
// Sends the menus to macOS's menu bar again, a moment after what they offer changed; set up with the menus.
let scheduleMenuSync: () => void = () => undefined;
let draggedTab: { key: string; group: number } | null = null;
let suppressTabClick = false;
// The tab a click began on, for a double click to be on one tab.
let tabPressed: { key: string; group: number } | null = null;

type SidebarView = 'explorer' | 'debug' | 'commit' | 'engine' | 'plugins';
let sidebarView: SidebarView = 'explorer';

const setSidebarVisible = (visible: boolean): void => {
  appShell.classList.toggle('sidebar-hidden', !visible);
  activityButtons.forEach((button) => {
    const active = visible && button.dataset.view === sidebarView;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
};

const showView = (view: SidebarView): void => {
  sidebarView = view;
  explorerView.hidden = view !== 'explorer';
  debugView.hidden = view !== 'debug';
  commitViewElement.hidden = view !== 'commit';
  pluginsViewElement.hidden = view !== 'plugins';
  engineViewElement.hidden = view !== 'engine';
  setSidebarVisible(true);
  if (view === 'commit') void git.refresh();
  if (view === 'plugins') void pluginsView.load();
  if (view === 'engine') void engineView.load();
};

// The button of the view already showing hides the side bar.
const toggleView = (view: SidebarView): void => {
  if (view === sidebarView && !appShell.classList.contains('sidebar-hidden')) setSidebarVisible(false);
  else showView(view);
};

const toggleExplorer = (): void => toggleView('explorer');
// The panel under the editor has tabs: the Output of builds and runs, a
// terminal, and, while they are turned on in Settings, a coding agent and Git.
type PanelView = 'output' | 'terminal' | 'agent' | 'git';
let panelView: PanelView = 'output';
const terminalHost = element<HTMLDivElement>('#terminal');
const agentHost = element<HTMLDivElement>('#agent-terminal');
const agentTab = element<HTMLButtonElement>('#agent-tab');
const agentSelect = element<HTMLSelectElement>('#agent-select');
const newTerminalButton = element<HTMLButtonElement>('#new-terminal');
const newTerminalMenuButton = element<HTMLButtonElement>('#new-terminal-menu');
const clearOutputButton = element<HTMLButtonElement>('#clear-output');
const terminalSelect = element<HTMLSelectElement>('#terminal-select');
const closeTerminalButton = element<HTMLButtonElement>('#close-terminal');
const agentTerminal = new StudioTerminal(agentHost, 'agent', 'agentExited');
// Glist Engine's installer, in its dialog; it runs once per click, never on a key.
const installTerminal = new StudioTerminal(element<HTMLDivElement>('#install-terminal'), 'install', 'terminalExited', false);

// The Terminal tab's shells, as many as New Terminal opens (shell, shell-2 and
// so on), one shown at a time, chosen in the list beside the tab's tools as
// the Agent tab's agent is. Closing the last one leaves a fresh one.
interface ShellTab { session: GlistTerminalSession; number: number; terminal: StudioTerminal; host: HTMLDivElement; shell?: GlistTerminalShell }
const shellTabs: ShellTab[] = [];
let terminalLook: { theme?: ReturnType<typeof terminalTheme>; family?: string; size?: number; scale?: number } = {};
const panelTerminals = (): StudioTerminal[] => [...shellTabs.map((tab) => tab.terminal), agentTerminal, installTerminal];
onThemeChange((theme) => {
  terminalLook = { ...terminalLook, theme: terminalTheme(theme.palette, theme.kind) };
  panelTerminals().forEach((each) => each.setTheme(terminalTheme(theme.palette, theme.kind)));
});
onFontsChange((fonts) => {
  terminalLook = { ...terminalLook, family: codeFontStack(fonts), size: panelFontSize(fonts) };
  panelTerminals().forEach((each) => each.setFont(codeFontStack(fonts), panelFontSize(fonts)));
});
// A terminal with a shell of its own, as New Terminal's list opens one, or Settings' choice.
const addShell = (shell?: GlistTerminalShell): ShellTab => {
  const number = shellTabs.reduce((most, tab) => Math.max(most, tab.number), 0) + 1;
  const host = document.createElement('div');
  host.className = 'terminal-instance';
  terminalHost.append(host);
  const session = (number === 1 ? 'shell' : `shell-${number}`) as GlistTerminalSession;
  const terminal = new StudioTerminal(host, session);
  terminal.shell = shell?.id;
  if (terminalLook.theme) terminal.setTheme(terminalLook.theme);
  if (terminalLook.family) terminal.setFont(terminalLook.family, terminalLook.size ?? 12);
  if (terminalLook.scale) terminal.setScale(terminalLook.scale);
  const tab: ShellTab = { session, number, terminal, host, shell };
  shellTabs.push(tab);
  return tab;
};
let shellTab = addShell();
const shellLabel = (tab: ShellTab): string =>
  `${t('terminalNumbered').replace('{number}', String(tab.number))}${tab.shell ? ` · ${tab.shell.name}` : ''}`;
const listShells = (): void => {
  terminalSelect.replaceChildren(...shellTabs.map((each) => new Option(shellLabel(each), each.session)));
  terminalSelect.value = shellTab.session;
};
const showShell = (tab: ShellTab): void => {
  shellTab = tab;
  shellTabs.forEach((each) => { each.host.hidden = each !== tab; });
  listShells();
  if (panelShowing('terminal')) tab.terminal.show();
};
// Asked first while its shell runs, as what runs in it stops.
const closeShell = async (): Promise<void> => {
  const closing = shellTab;
  if (closing.terminal.alive && !(await confirmDialog(t('confirmCloseTerminal').replace('{name}', shellLabel(closing))))) return;
  if (!shellTabs.includes(closing)) return;
  closing.terminal.dispose();
  closing.host.remove();
  shellTabs.splice(shellTabs.indexOf(closing), 1);
  showShell(shellTabs[shellTabs.length - 1] ?? addShell());
};
// Opened before the panel shows it, so only the new one starts a shell.
const newShell = (shell?: GlistTerminalShell): void => {
  showShell(addShell(shell));
  showPanel('terminal');
};
const terminalFor = (view: PanelView): StudioTerminal | null =>
  (view === 'terminal' ? shellTab.terminal : view === 'agent' ? agentTerminal : null);

const panelShowing = (view: PanelView): boolean => !appShell.classList.contains('output-hidden') && panelView === view;
showShell(shellTab);

const setOutputVisible = (visible: boolean): void => {
  appShell.classList.toggle('output-hidden', !visible);
  if (visible) terminalFor(panelView)?.show();
  gitPanel.setVisible(visible && panelView === 'git');
};

const showPanel = (view: PanelView): void => {
  panelView = view;
  document.querySelectorAll<HTMLButtonElement>('.output-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.panel === view);
  });
  output.hidden = view !== 'output';
  terminalHost.hidden = view !== 'terminal';
  agentHost.hidden = view !== 'agent';
  gitPanelElement.hidden = view !== 'git';
  agentSelect.hidden = view !== 'agent';
  terminalSelect.hidden = view !== 'terminal';
  closeTerminalButton.hidden = view !== 'terminal';
  outputHistorySelect.hidden = view !== 'output' || outputHistory.size === 0;
  newTerminalButton.hidden = view === 'output' || view === 'git';
  newTerminalMenuButton.hidden = view !== 'terminal';
  // The Git tab's views have tools of their own.
  clearOutputButton.hidden = view === 'git';
  // The log wants more room than a build's output.
  if (view === 'git' && parseInt(getComputedStyle(appShell).getPropertyValue('--panel-height'), 10) < 300) {
    appShell.style.setProperty('--panel-height', '300px');
  }
  const titles: Array<[HTMLButtonElement, TranslationKey]> = [
    [clearOutputButton, ({ output: 'clearOutput', terminal: 'clearTerminal', agent: 'clearAgent', git: 'clearOutput' } as const)[view]],
    [newTerminalButton, view === 'agent' ? 'restartAgent' : 'newTerminal'],
  ];
  titles.forEach(([button, key]) => { button.dataset.i18nTitle = key; button.title = t(key); });
  setOutputVisible(true);
};

// The agents turned on in Settings. The Agent tab shows while there is one,
// and runs the one picked in its list.
const showAgents = (available: GlistAgentStatus[]): void => {
  const previous = agentSelect.value;
  agentSelect.replaceChildren(...available.map((agent) => {
    const option = document.createElement('option');
    option.value = agent.id;
    option.textContent = agent.name;
    return option;
  }));
  if (available.some((agent) => agent.id === previous)) agentSelect.value = previous;
  agentTab.hidden = available.length === 0;
  if (available.length === 0) {
    agentTerminal.stop();
    agentTerminal.setAgent(undefined);
    if (panelView === 'agent') showPanel('output');
    return;
  }
  agentTerminal.setAgent(agentSelect.value as GlistAgentId);
};
agentSelect.addEventListener('change', () => {
  agentTerminal.setAgent(agentSelect.value as GlistAgentId);
  if (panelShowing('agent')) agentTerminal.show();
});

// A tab that is showing hides the panel; otherwise the panel opens on it.
const togglePanel = (view: PanelView): void => {
  if (panelShowing(view)) setOutputVisible(false);
  else showPanel(view);
};

// Up to 300%, for projectors in classrooms.
const zoomLevels = [50, 67, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300] as const;
// The browser build's CSS zoom, by which screen pixels from the mouse are
// divided to place things in CSS pixels. Electron zooms natively: always 1.
const pageZoom = (): number => Number(document.documentElement.style.getPropertyValue('--page-zoom')) || 1;
const defaultZoom = 100;

const loadZoom = (): number => {
  try {
    const saved = Number(window.localStorage.getItem('glist-studio-zoom'));
    if (zoomLevels.some((level) => level === saved)) return saved;
  } catch { /* Storage may be unavailable. */ }
  return defaultZoom;
};

let zoomPercentage = loadZoom();

// The Scale row in Settings, and a chip in the title bar while the scale is
// not 100%, which says so and puts it back.
const scaleSlider = element<HTMLInputElement>('#settings-scale');
const scaleValue = element<HTMLOutputElement>('#scale-value');
const scaleDown = element<HTMLButtonElement>('#scale-down');
const scaleUp = element<HTMLButtonElement>('#scale-up');
const scaleReset = element<HTMLButtonElement>('#scale-reset');
const zoomIndicator = element<HTMLButtonElement>('#zoom-indicator');
scaleSlider.max = String(zoomLevels.length - 1);

const showZoom = (): void => {
  const index = zoomLevels.findIndex((level) => level === zoomPercentage);
  scaleSlider.value = String(index);
  scaleSlider.setAttribute('aria-valuetext', percent(zoomPercentage));
  scaleValue.textContent = percent(zoomPercentage);
  scaleDown.disabled = index === 0;
  scaleUp.disabled = index === zoomLevels.length - 1;
  scaleReset.disabled = zoomPercentage === defaultZoom;
  zoomIndicator.hidden = zoomPercentage === defaultZoom;
  const label = document.createElement('span');
  label.textContent = percent(zoomPercentage);
  zoomIndicator.replaceChildren(icon(zoomPercentage > defaultZoom ? 'zoom-in' : 'zoom-out'), label);
};

placeIcons();
dressSelects();

// Windows and Linux: the window's buttons, the page's own (index.html), so they
// zoom with it. The middle one is Restore Down while the window fills the screen.
const windowMaximize = element<HTMLButtonElement>('#window-maximize');
const showMaximized = (maximized: boolean): void => {
  const key = maximized ? 'windowRestore' : 'windowMaximize';
  windowMaximize.replaceChildren(icon(maximized ? 'chrome-restore' : 'chrome-maximize'));
  windowMaximize.dataset.i18nTitle = key;
  windowMaximize.dataset.i18nAriaLabel = key;
  windowMaximize.title = t(key);
  windowMaximize.setAttribute('aria-label', t(key));
};
// They show only where the main process draws none (index.css), which the
// preload marks after this runs, so they are wired in the app regardless.
if (window.glistFiles) {
  element<HTMLButtonElement>('#window-minimize').addEventListener('click', () => { void window.glistAPI.windowControl('minimize'); });
  windowMaximize.addEventListener('click', () => { void window.glistAPI.windowControl('maximize'); });
  element<HTMLButtonElement>('#window-close').addEventListener('click', () => { void window.glistAPI.windowControl('close'); });
  window.glistAPI.onWindowMaximized(showMaximized);
  void window.glistAPI.windowMaximized().then(showMaximized);
}
registerCmakeLanguage();
registerTomlLanguage();
checkDataFiles();
applyTheme(getActiveTheme());

const setZoom = (percentage: number): void => {
  const closest = zoomLevels.reduce((best, level) => (
    Math.abs(level - percentage) < Math.abs(best - percentage) ? level : best
  ), defaultZoom);
  zoomPercentage = closest;
  try { window.localStorage.setItem('glist-studio-zoom', String(closest)); } catch { /* Storage may be unavailable. */ }
  void window.glistAPI.setZoomFactor(closest / 100);
  document.documentElement.style.setProperty('--window-zoom', String(closest / 100));
  scheduleMenuSync();
  terminalLook = { ...terminalLook, scale: pageZoom() };
  shellTabs.forEach((tab) => tab.terminal.setScale(pageZoom()));
  showZoom();
};

const changeZoom = (direction: -1 | 1): void => {
  const currentIndex = zoomLevels.findIndex((level) => level === zoomPercentage);
  const nextIndex = Math.min(zoomLevels.length - 1, Math.max(0, currentIndex + direction));
  setZoom(zoomLevels[nextIndex]);
};

// A drag applies on release: zooming under the pointer would move the slider away from it.
const sliderZoom = (): number => zoomLevels[Number(scaleSlider.value)] ?? defaultZoom;
scaleSlider.addEventListener('input', () => { scaleValue.textContent = percent(sliderZoom()); });
scaleSlider.addEventListener('change', () => setZoom(sliderZoom()));
scaleDown.addEventListener('click', () => changeZoom(-1));
scaleUp.addEventListener('click', () => changeZoom(1));
scaleReset.addEventListener('click', () => setZoom(defaultZoom));
zoomIndicator.addEventListener('click', () => setZoom(defaultZoom));

applyLanguage(getLanguage());
// index.html greets in English; nothing has been written to the output yet.
output.textContent = t('initialOutput');
void window.glistAPI.setLanguage(getLanguage());
void window.glistAPI.getPlatform().then((platform) => {
  setHostPlatform(platform);
  applyLanguage(getLanguage());
});
setZoom(zoomPercentage);

const refreshLanguage = (): void => {
  applyLanguage(getLanguage());
  describeDebugger();
  runArguments.describe();
  if (!activeProject) {
    projectRootLabel.textContent = t('projectPlaceholder');
    if (output.textContent === '' || Object.values(languages)
      .some((words) => output.textContent === words.interface.initialOutput)) clearOutput(t('initialOutput'));
  }
  if (!isBuildRunning && !isRunRunning) setProcessStatus(t('ready'), false);
};

const requestName = (titleKey: TranslationKey, labelKey: TranslationKey, initial = ''): Promise<string | null> =>
  new Promise((resolve) => {
    const title = element<HTMLElement>('#input-dialog-title');
    const label = element<HTMLElement>('#input-dialog-label');
    const submit = inputForm.querySelector<HTMLButtonElement>('button[type="submit"]');
    title.textContent = t(titleKey);
    label.textContent = t(labelKey);
    if (submit) submit.textContent = titleKey === 'rename' || titleKey === 'databaseRenameTable' ? t('rename') : t('create');
    inputValue.value = initial;
    const cleanup = (value: string | null): void => {
      inputForm.removeEventListener('submit', onSubmit);
      inputDialog.removeEventListener('close', onClose);
      inputDialog.close();
      resolve(value);
    };
    const onSubmit = (event: SubmitEvent): void => {
      event.preventDefault();
      cleanup(inputValue.value.trim() || null);
    };
    const onClose = (): void => {
      inputForm.removeEventListener('submit', onSubmit);
      inputDialog.removeEventListener('close', onClose);
      resolve(null);
    };
    inputForm.addEventListener('submit', onSubmit);
    inputDialog.addEventListener('close', onClose);
    element<HTMLButtonElement>('#input-cancel').onclick = () => inputDialog.close();
    inputDialog.showModal();
    inputValue.focus();
    inputValue.select();
  });

const codeEditorOptions: monaco.editor.IStandaloneEditorConstructionOptions = {
  automaticLayout: true,
  // Colors from clangd for functions, types, members and the like.
  'semanticHighlighting.enabled': true,
  // Matching brackets share a color, by how deep they are nested.
  bracketPairColorization: { enabled: true },
  // Room for breakpoints.
  glyphMargin: true,
  // The caret and scrolling as Settings > Editor has them.
  ...editorBehaviour(loadEditorSettings()),
  padding: { top: 14, bottom: 20 },
  renderWhitespace: 'selection',
  scrollBeyondLastLine: false,
  tabSize: 4,
  // The studio draws the right-click menu (editor-menu.ts).
  contextmenu: false,
};
const editor = monaco.editor.create(editorHost, codeEditorOptions);

// A side's diff view, for a diff tab in front there.
interface DiffPane {
  view: HTMLElement;
  host: HTMLElement;
  left: HTMLElement;
  right: HTMLElement;
  message: HTMLElement;
  open: HTMLButtonElement;
  rollback: HTMLButtonElement;
  // Made the first time the side shows a diff.
  editor: monaco.editor.IStandaloneDiffEditor | null;
}
const diffPane = (view: HTMLElement): DiffPane => {
  const part = <T extends HTMLElement>(name: string): T => view.querySelector(`[data-diff="${name}"]`) as T;
  return { view, host: part('host'), left: part('left'), right: part('right'), message: part('message'), open: part('open'), rollback: part('rollback'), editor: null };
};

// One side of the editor area as it is drawn: its tab strip, and the editor
// or diff view under it showing the tab in front there.
interface GroupView {
  element: HTMLElement;
  tabsHost: HTMLElement;
  stage: HTMLElement;
  host: HTMLElement;
  editor: monaco.editor.IStandaloneCodeEditor;
  diff: DiffPane;
  // Where a README or an image tab is drawn, and which one it holds.
  page: HTMLElement;
  pageShown: { key: string; version: number; render: { dispose(): void } } | null;
  // Where a dragged tab would go.
  overlay: HTMLElement;
  // The tab shown, and where each of its tabs was scrolled to and its cursor.
  shown: string | null;
  viewStates: Map<string, monaco.editor.ICodeEditorViewState | null>;
}
const dropOverlay = (stage: HTMLElement): HTMLElement => {
  const overlay = document.createElement('div');
  overlay.className = 'drop-overlay';
  overlay.hidden = true;
  stage.append(overlay);
  return overlay;
};
const readmeView = (stage: HTMLElement): HTMLElement => {
  const page = document.createElement('div');
  page.className = 'readme-view';
  page.hidden = true;
  stage.append(page);
  return page;
};
const groupViews: GroupView[] = [{
  element: tabsHost.parentElement as HTMLElement,
  tabsHost,
  stage: editorHost.parentElement as HTMLElement,
  host: editorHost,
  editor,
  diff: diffPane(element('#diff-view')),
  page: readmeView(editorHost.parentElement as HTMLElement),
  pageShown: null,
  overlay: dropOverlay(editorHost.parentElement as HTMLElement),
  shown: null,
  viewStates: new Map(),
}];
// The editor of the side being worked in.
const currentEditor = (): monaco.editor.IStandaloneCodeEditor => (groupViews[layout.focused] ?? groupViews[0]).editor;

// Settings > Build: each build and run in the output by itself, the ones
// before it in the list beside the Output tab's tools (output-history.ts).
const clearsOutputOnRun = (): boolean => {
  try { return window.localStorage.getItem('glist-studio-clear-output') !== 'off'; } catch { return true; }
};
const outputHistorySelect = element<HTMLSelectElement>('#output-history');
const outputHistory = new OutputHistory(output, outputHistorySelect, clearsOutputOnRun, (size) => {
  outputHistorySelect.hidden = panelView !== 'output' || size === 0;
});

const clearOutput = (text = ''): void => outputHistory.reset(text);

// Opens a file named in the output, relative to the project when not absolute,
// in a transient tab, as an error looked at.
const openOutputLocation = (filePath: string, line: number): void => {
  if (!activeProject) return;
  const absolute = /^([a-zA-Z]:[\\/]|[\\/])/.test(filePath) ? filePath : joinPath(activeProject.root, filePath);
  void revealLocation(pathUri(absolute), { lineNumber: line, column: 1 }, true);
};

// Appends nodes; rewriting textContent made long builds quadratic. To the
// newest build or run unless said otherwise, or to the output itself when
// Clear Output took the one it was for.
const appendOutput = (text: string, kind: 'normal' | 'success' | 'error' = 'normal', section: OutputSection = outputHistory.current): void => {
  const to = section.element.isConnected ? section : outputHistory.current;
  // A section's first line at its top, without the blank line it came with.
  const fresh = !to.element.hasChildNodes();
  if (kind === 'normal') to.element.append(...formatOutput(fresh ? text.replace(/^\n/, '') : text, to.style, openOutputLocation));
  else {
    const message = document.createElement('span');
    message.className = kind === 'success' ? 'ansi-green' : 'ansi-red';
    // The mark on the text's own line, however many line breaks it came with.
    message.append(...formatOutput(`${kind === 'success' ? '✓' : '✕'} ${text.replace(/^\s*\n|\n\s*$/g, '')}`, newOutputStyle(), openOutputLocation));
    to.element.append(...(fresh ? [] : ['\n']), message, '\n');
  }
  if (outputHistory.isShown(to)) output.scrollTop = output.scrollHeight;
};

// What a file operation did, or why it could not, as a notification rather
// than in the Output panel, which keeps what builds and runs print.
const noticePath = (target: string): string => (activeProject && isWithin(target, activeProject.root)
  ? target.slice(activeProject.root.length + 1) || target : target);
const noticeDone = (key: TranslationKey, target: string): void =>
  notify({ text: `${t(key)}: ${baseName(target)}`, detail: noticePath(target), kind: 'success' });
// Electron wraps an error from the main process in words about IPC; the error itself is enough.
const remoteError = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']*': (?:Error: )?/, '');
const noticeFailed = (key: TranslationKey, error: unknown, name?: string): void => notify({
  text: name ? `${t(key)}: ${name}` : t(key),
  detail: remoteError(error),
  kind: 'error',
  error,
});

// What a debug report says of the window (debug-report.ts).
setReportWindow(() => ({
  project: activeProject?.root ?? null,
  zoom: zoomPercentage,
  theme: `${getActiveTheme().name} (${getActiveTheme().id})`,
  language: getLanguage(),
}));
// Help > Copy Debug Info: the same report without an error, for a problem that showed none.
const copyDebugInfo = (): Promise<void> => copyReport().then(
  () => notify({ text: t('debugInfoCopied'), kind: 'success' }),
  (error: unknown) => noticeFailed('copyDetailsFailed', error),
);

// Errors nothing caught, in the page, the main process or the backend: each
// different one once, as a notice with Copy Details. Some are no fault.
const shownErrors = new Set<string>();
const uncaughtError = (error: unknown, fallback = ''): void => {
  const message = errorMessage(error, fallback);
  if (ignorableError(error, message) || shownErrors.has(message)) return;
  shownErrors.add(message);
  notify({ text: t('unexpectedError'), detail: message, kind: 'error', error });
};
window.addEventListener('error', (event) => uncaughtError(event.error, event.message));
window.addEventListener('unhandledrejection', (event) => uncaughtError(event.reason));
window.glistAPI.onAppError((error) => uncaughtError(error));

const setProcessStatus = (label: string, active: boolean, error = false): void => {
  processStatus.classList.toggle('active', active);
  processStatus.classList.toggle('error', error);
  const labelNode = processStatus.querySelector('span');
  if (labelNode) labelNode.textContent = label;
};
// The page starts with the English words.
setProcessStatus(t('ready'), false);
projectRootLabel.textContent = t('projectPlaceholder');

const languageForFile = (filePath: string): { id: string; label: string } => {
  if (filePath.endsWith('CMakeLists.txt')) return { id: 'cmake', label: 'CMake' };
  const extension = filePath.split('.').pop()?.toLowerCase() ?? '';
  const languages: Record<string, { id: string; label: string }> = {
    c: { id: 'cpp', label: 'C' }, cc: { id: 'cpp', label: 'C++' },
    cpp: { id: 'cpp', label: 'C++' }, cxx: { id: 'cpp', label: 'C++' },
    h: { id: 'cpp', label: 'C++ Header' }, hh: { id: 'cpp', label: 'C++ Header' },
    hpp: { id: 'cpp', label: 'C++ Header' }, json: { id: 'json', label: 'JSON' },
    md: { id: 'markdown', label: 'Markdown' }, xml: { id: 'xml', label: 'XML' },
    yml: { id: 'yaml', label: 'YAML' }, yaml: { id: 'yaml', label: 'YAML' },
    cmake: { id: 'cmake', label: 'CMake' }, toml: { id: 'toml', label: 'TOML' },
    ini: { id: 'ini', label: 'INI' }, cfg: { id: 'ini', label: 'INI' }, conf: { id: 'ini', label: 'INI' },
    properties: { id: 'ini', label: 'INI' }, editorconfig: { id: 'ini', label: 'INI' },
    gitconfig: { id: 'ini', label: 'INI' }, gitmodules: { id: 'ini', label: 'INI' },
    // .clang-format and .clang-tidy are YAML.
    'clang-format': { id: 'yaml', label: 'YAML' }, 'clang-tidy': { id: 'yaml', label: 'YAML' },
  };
  return languages[extension] ?? { id: 'plaintext', label: 'Plain Text' };
};

const isDirty = (tab: EditorTab): boolean => tab.kind === 'file' && tab.model.getAlternativeVersionId() !== tab.savedVersion;

const updateButtons = (): void => {
  scheduleMenuSync();
  const hasProject = Boolean(activeProject);
  saveButton.disabled = !activeFile();
  buildButton.disabled = !hasProject || isBuildRunning || isStarting;
  buildMenuButton.disabled = buildButton.disabled;
  runButton.disabled = !hasProject || isRunRunning || isBuildRunning || isStarting || !targetPicker.runnable;
  debugButton.disabled = !hasProject || isBuildRunning || isStarting || debug.active || !targetPicker.runnable;
  debugStartButton.disabled = debugButton.disabled;
  stopButton.disabled = !isBuildRunning && !isRunRunning && !debug.active;
  debugControls.hidden = !debug.active || debug.state === 'starting';
  debugContinueButton.disabled = debug.state !== 'paused';
  debugPauseButton.disabled = debug.state !== 'running';
  debugStepButtons.forEach((button) => { button.disabled = debug.state !== 'paused'; });
  refreshButton.disabled = !hasProject;
  newFileButton.disabled = !hasProject;
  newFolderButton.disabled = !hasProject;
  deleteEntryButton.disabled = ![...selectedEntries.values()].some((entry) => !isRootFolder(entry.path));
};

// Draws a README, an image or a model tab in a side, again only once it
// changed; without one, hides it, and lets go of what a tab no longer in the
// side drew there: closed, a model gives back its WebGL context at once, not
// when another page is next shown. (A tab closed is out of the layout before
// it is out of openFiles.)
const showPageTab = (view: GroupView, tab?: PageTab): void => {
  view.page.hidden = !tab;
  const shown = view.pageShown;
  if (!tab && shown && (!openFiles.has(shown.key) || !layout.groupsWith(shown.key).includes(groupViews.indexOf(view)))) {
    shown.render.dispose();
    view.pageShown = undefined;
  }
  if (!tab || (view.pageShown?.key === tab.path && view.pageShown.version === tab.version)) return;
  view.pageShown?.render.dispose();
  const render = tab.kind === 'readme' ? renderReadmePage(view.page, tab.page)
    : tab.kind === 'model' ? renderModelPage(view.page, tab.page)
      : tab.kind === 'database' ? renderDatabasePage(view.page, tab.page)
        : tab.kind === 'media' ? renderMediaPage(view.page, tab.page)
          : tab.kind === 'database-diff' ? renderDatabaseDiffPage(view.page, tab.page) : renderImagePage(view.page, tab.page);
  view.pageShown = { key: tab.path, version: tab.version, render };
  view.page.scrollTop = 0;
};

// Shows each side's tab in front: a file in the side's editor, where it was
// scrolled to last there, a diff in the diff view, a README or an image in its
// page, and the welcome screen once no tab is left.
const showGroups = (): void => {
  const split = layout.groups.length > 1;
  if (split) secondGroupView();
  groupsHost.classList.toggle('split', split);
  if (groupResizer) groupResizer.hidden = !split;
  groupViews.forEach((view, index) => {
    view.element.hidden = index >= layout.groups.length;
    view.element.classList.toggle('focused', index === layout.focused);
    const key = layout.groups[index]?.active ?? null;
    const tab = key ? openFiles.get(key) : undefined;
    const model = view.editor.getModel();
    if (view.shown && model && openFiles.get(view.shown)?.kind === 'file' && (openFiles.get(view.shown) as OpenFile).model === model) {
      view.viewStates.set(view.shown, view.editor.saveViewState());
    }
    view.shown = key;
    if (!tab) {
      view.editor.setModel(null);
      view.host.classList.remove('visible');
      view.diff.editor?.setModel(null);
      view.diff.view.hidden = true;
      showPageTab(view);
      if (index === 0) welcome.hidden = false;
      return;
    }
    if (index === 0) welcome.hidden = true;
    if (isPageTab(tab)) {
      view.host.classList.remove('visible');
      view.diff.view.hidden = true;
      showPageTab(view, tab);
      return;
    }
    showPageTab(view);
    if (tab.kind === 'diff') {
      view.host.classList.remove('visible');
      showDiffTab(view, tab);
      return;
    }
    view.diff.view.hidden = true;
    if (model !== tab.model) {
      view.editor.setModel(tab.model);
      view.editor.restoreViewState(view.viewStates.get(tab.path) ?? null);
    }
    view.editor.updateOptions({ readOnly: tab.readOnly, rulers: rulersFor(tab) });
    view.host.classList.add('visible');
    // Measured now, not on the next frame, so a line can be revealed right away.
    view.editor.layout();
  });
};

// How a tab comes to the front: as it is, such as clicked; opened to stay; or
// opened transient, only to be looked at, as a diff or a search result is,
// until another tab of its side comes to the front (editor-layout.ts).
type Opening = 'front' | 'keep' | 'transient';

// Brings a tab to the front of a side, the one being worked in unless given.
// A file with unsaved changes never opens transient, as leaving would close it.
const activateFile = (filePath: string, group = layout.focused, opening: Opening = 'front'): void => {
  const tab = openFiles.get(filePath);
  if (!tab) return;
  const closed = opening === 'front' ? layout.activate(filePath, group)
    : layout.open(filePath, group, opening === 'transient' && !isDirty(tab));
  showGroups();
  forgetClosed(closed);
  renderTabs();
  updateButtons();
  if (tab.kind === 'file') currentEditor().focus();
};

// A transient tab that closed as another took its place, or as its side
// switched to another tab: what it showed is let go, unless another tab has it.
const forgetClosed = (key: string | null): void => {
  const tab = key === null || layout.isOpen(key) ? undefined : openFiles.get(key);
  if (tab) forgetDocument(tab);
};

// A transient tab double-clicked, or its file edited, stays.
const keepTab = (key: string, group?: number): void => {
  if (layout.keep(key, group)) renderTabs();
};

const disposeTab = (tab: EditorTab): void => {
  // A database's tab lets go of the file, which Windows would not let be moved or deleted.
  if (tab.kind === 'database') void window.glistAPI.databaseClose(tab.path);
  if (isPageTab(tab)) return;
  if (tab.kind === 'file') { tab.model.dispose(); return; }
  groupViews.forEach((view) => { if (view.diff.editor?.getModel()?.modified === tab.modified) view.diff.editor.setModel(null); });
  tab.original.dispose();
  tab.modified.dispose();
};

// Forgets what the file's tabs remembered, once none is left.
const forgetDocument = (tab: EditorTab): void => {
  openFiles.delete(tab.path);
  disposeTab(tab);
  groupViews.forEach((view) => view.viewStates.delete(tab.path));
};

// Closes one tab; the file closes with its last tab, saved first. If it cannot
// be saved, the tab stays. A database's last tab asks first whether to commit
// the changes waiting.
const closeFile = async (filePath: string, group = layout.focused): Promise<void> => {
  const file = openFiles.get(filePath);
  if (!file) return;
  if (layout.groupsWith(filePath).length <= 1 && file.kind === 'file' && isDirty(file)) {
    try { await saveFile(file); } catch (error) { noticeFailed('saveFailed', error); return; }
  }
  if (layout.groupsWith(filePath).length <= 1 && file.kind === 'database' && !(await databasesSettled(filePath))) return;
  const wasInFront = layout.groups[group]?.active === filePath;
  layout.close(filePath, group);
  showGroups();
  if (!layout.isOpen(filePath)) forgetDocument(file);
  renderTabs();
  updateButtons();
  if (wasInFront && activeFile()) currentEditor().focus();
};

const clearTabDropIndicators = (): void => {
  groupViews.forEach((view) => {
    view.overlay.hidden = true;
    view.tabsHost.classList.remove('drop-at-end');
    view.tabsHost.querySelectorAll('.drop-before, .drop-after').forEach((tab) => {
      tab.classList.remove('drop-before', 'drop-after');
    });
  });
};

// Moves a tab before or after another, or to the end of a side's strip.
const moveTab = (key: string, from: number, to: number, targetKey?: string, placeAfter = false): void => {
  const tabs = layout.groups[to]?.tabs.filter((other) => other !== key) ?? [];
  const before = targetKey && placeAfter ? tabs[tabs.indexOf(targetKey) + 1] : targetKey;
  const closed = layout.move(key, from, to, before);
  showGroups();
  forgetClosed(closed);
  renderTabs();
  updateButtons();
};

const tabElement = (file: EditorTab, group: number): HTMLButtonElement => {
  const tab = document.createElement('button');
  tab.type = 'button';
  tab.draggable = true;
  tab.className = 'editor-tab';
  tab.dataset.path = file.path;
  tab.classList.toggle('active', file.path === layout.groups[group]?.active);
  tab.classList.toggle('read-only', file.kind === 'file' && file.readOnly);
  tab.classList.toggle('transient', layout.isTransient(file.path, group));
  tab.classList.toggle('diff', file.kind === 'diff' || file.kind === 'database-diff');
  if (file.kind === 'diff') tab.title = `${file.file}\n${file.leftLabel} / ${file.rightLabel}`;
  else if (file.kind === 'database-diff') tab.title = `${file.file}\n${file.page.left} / ${file.page.right}`;
  else if (file.kind === 'readme') tab.title = `${file.name} README`;
  else if (isFilePageTab(file)) tab.title = file.path;
  else tab.title = file.readOnly ? `${file.path} (${t('readOnly')})` : file.path;
  if (layout.isTransient(file.path, group)) tab.title += `\n${t('transientTab')}`;
  const label = document.createElement('span');
  label.className = 'tab-label';
  label.textContent = file.name;
  const dirty = document.createElement('span');
  dirty.className = 'dirty-dot';
  dirty.classList.toggle('visible', isDirty(file));
  dirty.append(icon('circle-filled'));
  const close = document.createElement('span');
  close.className = 'tab-close';
  close.draggable = false;
  close.append(icon('close'));
  close.addEventListener('click', (event) => { event.stopPropagation(); closeFile(file.path, group); });
  let kind = fileIconElement(file.name);
  if (file.kind === 'diff' || file.kind === 'database-diff' || file.kind === 'readme') {
    kind = document.createElement('span');
    kind.className = `file-icon ${file.kind === 'readme' ? 'dependency' : 'diff'}`;
    kind.append(icon(file.kind === 'readme' ? 'extensions' : 'diff'));
  }
  // Italics say transient now, so a file that cannot be changed shows a lock.
  const lock = file.kind === 'file' && file.readOnly ? [icon('lock-small')] : [];
  lock.forEach((svg) => svg.classList.add('tab-lock'));
  tab.append(kind, label, ...lock, dirty, close);
  tab.addEventListener('click', () => { if (!suppressTabClick) activateFile(file.path, group); });
  // A double click on it keeps a transient tab. Both clicks must be on this
  // tab: an X's first click closes its tab, and the second lands on the one
  // that slid under it. (Each click draws the tabs again, so the element is new.)
  tab.addEventListener('dblclick', () => {
    if (tabPressed?.key === file.path && tabPressed.group === group) keepTab(file.path, group);
  });
  // A middle click closes the tab, as in a browser. Pressing the middle button
  // would otherwise start the page scrolling on Windows and Linux, and letting
  // it go would paste Linux's selected text into the editor that has the keys.
  tab.addEventListener('mousedown', (event) => {
    if (event.button === 1) event.preventDefault();
    if (event.button === 0 && event.detail === 1) {
      tabPressed = event.target instanceof Element && event.target.closest('.tab-close') ? null : { key: file.path, group };
    }
  });
  tab.addEventListener('mouseup', (event) => { if (event.button === 1) event.preventDefault(); });
  tab.addEventListener('auxclick', (event) => {
    if (event.button !== 1) return;
    event.preventDefault();
    closeFile(file.path, group);
  });
  tab.addEventListener('contextmenu', (event) => showMenu(event, tabMenu(file.path, group)));
  tab.addEventListener('dragstart', (event) => {
    draggedTab = { key: file.path, group };
    suppressTabClick = true;
    event.dataTransfer?.setData('text/plain', file.path);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    requestAnimationFrame(() => tab.classList.add('dragging'));
  });
  tab.addEventListener('dragover', (event) => {
    if (!draggedTab || (draggedTab.key === file.path && draggedTab.group === group)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    clearTabDropIndicators();
    const bounds = tab.getBoundingClientRect();
    tab.classList.add(event.clientX < bounds.left + bounds.width / 2 ? 'drop-before' : 'drop-after');
  });
  tab.addEventListener('drop', (event) => {
    if (!draggedTab) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = tab.getBoundingClientRect();
    moveTab(draggedTab.key, draggedTab.group, group, file.path, event.clientX >= bounds.left + bounds.width / 2);
    clearTabDropIndicators();
  });
  tab.addEventListener('dragend', () => {
    tab.classList.remove('dragging');
    draggedTab = null;
    clearTabDropIndicators();
    window.setTimeout(() => { suppressTabClick = false; }, 0);
  });
  return tab;
};

// The open project's tabs, open folders and places in its files, kept so it
// opens the same way next time (project-session.ts): soon after a change, and
// at once when the window is left or closed. Not while it is being put back.
let restoringSession = false;
let sessionTimer: number | undefined;
const currentSession = (): ProjectSession => {
  const views: Record<string, unknown> = {};
  groupViews.forEach((view) => {
    view.viewStates.forEach((state, key) => { if (state && restorableTab(key)) views[key] = state; });
    const shown = view.shown && openFiles.get(view.shown);
    if (shown && shown.kind === 'file' && view.editor.getModel() === shown.model) views[shown.path] = view.editor.saveViewState();
  });
  // A transient tab does not come back.
  return {
    groups: layout.keptGroups().map((group) => ({ tabs: group.tabs.filter(restorableTab), active: group.active })),
    focused: layout.focused,
    expanded: [...expandedDirectories],
    views,
  };
};
const saveSessionNow = (): void => {
  window.clearTimeout(sessionTimer);
  if (activeProject && !restoringSession) saveSession(activeProject.root, currentSession());
};
const scheduleSessionSave = (): void => {
  window.clearTimeout(sessionTimer);
  sessionTimer = window.setTimeout(saveSessionNow, 400);
};

// Names are never shortened, so a side's strip scrolls sideways instead.
// Its tab in front is scrolled into sight when that tab or the number of tabs
// changes, not each time the strip is drawn, which would undo scrolling it by hand.
const stripShowed = new WeakMap<HTMLElement, string>();
const revealFrontTab = (strip: HTMLElement): void => {
  const tab = strip.querySelector('.editor-tab.active');
  if (!tab) return;
  const bounds = strip.getBoundingClientRect();
  const box = tab.getBoundingClientRect();
  if (box.left < bounds.left) strip.scrollLeft -= bounds.left - box.left;
  else if (box.right > bounds.right) strip.scrollLeft += Math.min(box.right - bounds.right, box.left - bounds.left);
};

const renderTabs = (): void => {
  groupViews.forEach((view, group) => {
    const keys = layout.groups[group]?.tabs ?? [];
    view.tabsHost.replaceChildren(...keys.flatMap((key) => {
      const file = openFiles.get(key);
      return file ? [tabElement(file, group)] : [];
    }));
    const showing = `${layout.groups[group]?.active ?? ''}\n${keys.length}`;
    // A strip not drawn yet has no width to scroll in; it is done once it has.
    if (stripShowed.get(view.tabsHost) === showing || view.tabsHost.clientWidth === 0) return;
    stripShowed.set(view.tabsHost, showing);
    revealFrontTab(view.tabsHost);
  });
  scheduleSessionSave();
};

// A mouse's wheel turns the strip sideways; a touchpad's sideways swipe already does.
const scrollTabsByWheel = (view: GroupView): void => {
  view.tabsHost.addEventListener('wheel', (event) => {
    const strip = view.tabsHost;
    if (event.ctrlKey || strip.scrollWidth <= strip.clientWidth || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    event.preventDefault();
    const step = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? strip.clientWidth : 1;
    strip.scrollLeft += event.deltaY * step;
  }, { passive: false });
};

// A drop past the last tab puts it at the end of that side's strip.
const listenForTabDrops = (view: GroupView): void => {
  view.tabsHost.addEventListener('dragover', (event) => {
    if (!draggedTab) return;
    const bounds = view.tabsHost.getBoundingClientRect();
    if (event.clientX < bounds.left + 28) view.tabsHost.scrollLeft -= 14;
    else if (event.clientX > bounds.right - 28) view.tabsHost.scrollLeft += 14;
    if (event.target instanceof Element && event.target.closest('.editor-tab')) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    clearTabDropIndicators();
    view.tabsHost.classList.add('drop-at-end');
  });
  view.tabsHost.addEventListener('drop', (event) => {
    if (!draggedTab || (event.target instanceof Element && event.target.closest('.editor-tab'))) return;
    event.preventDefault();
    moveTab(draggedTab.key, draggedTab.group, groupViews.indexOf(view));
    clearTabDropIndicators();
  });
};

const isProjectPath = (filePath: string): boolean =>
  Boolean(activeProject && isWithin(filePath, activeProject.root));

const readContents = (filePath: string): Promise<string> => (isProjectPath(filePath)
  ? window.glistAPI.readFile(filePath) : window.glistAPI.readWorkspaceFile(filePath));

// The engine's and plugins' folders the open project names. Neither builds on
// its own, so their work happens from an app, and their files can be edited
// here; other files in the Glist folder, such as zbin's, stay read-only.
let dependencyFolders: string[] = [];
let dependenciesKnown: Promise<void> = Promise.resolve();

// How updates of the engine and plugins reach the Git tools, for a conflict to resolve there.
const checkoutHooks: CheckoutUpdateHooks = {
  gitTools: () => git.enabled,
  showConflicts: () => { void git.refresh().then(() => showView('commit')); },
  showConsole: () => showGitPanel('console'),
  save: () => saveProjectFiles(),
  reload: async () => { await reloadFromDisk(); void git.refresh(); },
};

// The Plugins view: GlistPlugins' plugins to install, add to the project and update.
const pluginsView = new PluginsView(
  element<HTMLElement>('#plugins-list'), element<HTMLInputElement>('#plugins-search'),
  element<HTMLButtonElement>('#plugins-refresh'), element<HTMLElement>('#plugins-activity'),
  {
    hasProject: () => Boolean(activeProject),
    projectChanged: () => { void learnDependencies(); void loadProjectTree(); void git.refresh(); },
    showReadme: (plugin) => openReadme(plugin),
    updates: checkoutHooks,
  },
);

// The Engine view: the engine the project uses, where it stands against GlistEngine, and Update.
const engineView = new EngineView(
  element<HTMLElement>('#engine-info'), element<HTMLButtonElement>('#engine-refresh'), element<HTMLElement>('#engine-activity'),
  {
    updates: checkoutHooks,
    install: () => { void showGlistInstaller(); },
    showInGit: (folder) => { showPanel('git'); gitPanel.showRepository(folder, 'log'); },
    changed: () => { void learnDependencies(); void loadProjectTree(); void git.refresh(); },
  },
);

// In the background: new commits for the engine and the installed plugins,
// asked for 20 seconds after the start and then every six hours, and said
// once for each set of them.
let toldUpdates = '';
const checkSourceUpdates = async (): Promise<void> => {
  const [engineBehind, plugins] = await Promise.all([engineView.load(true), pluginsView.checkUpdates()]);
  const names = [...(engineBehind ? ['GlistEngine'] : []), ...plugins.map((plugin) => plugin.name)];
  if (names.length === 0 || names.join() === toldUpdates) return;
  toldUpdates = names.join();
  notify({
    text: t('updatesNotice').replace('{names}', names.join(', ')),
    actions: [{
      label: t('updateButton'),
      run: () => {
        void (async () => {
          if (engineBehind) await engineView.update();
          await pluginsView.updateAll(plugins);
          toldUpdates = '';
        })();
      },
    }],
  });
};
window.setTimeout(() => { void checkSourceUpdates(); }, 20000);
window.setInterval(() => { void checkSourceUpdates(); }, 6 * 60 * 60 * 1000);

const learnDependencies = (): Promise<void> => {
  dependenciesKnown = window.glistAPI.listDependencies()
    .then((dependencies) => { dependencyFolders = dependencies.filter((dependency) => dependency.exists).map((dependency) => dependency.path); })
    .catch(() => { dependencyFolders = []; });
  return dependenciesKnown;
};

// The engine's or plugin's folder a file is in, if any.
const dependencyFolderOf = (filePath: string): string | undefined => dependencyFolders.find((folder) => isWithin(filePath, folder));

const isEditablePath = (filePath: string): boolean => isProjectPath(filePath) || Boolean(dependencyFolderOf(filePath));

// The project's own folder and the engine's and plugins' are not renamed, moved or deleted.
const isRootFolder = (folder: string): boolean => folder === activeProject?.root || dependencyFolders.includes(folder);

// The first change to the engine or a plugin in a session says that it is shared.
const warnedShared = new Set<string>();
// Tabs being read again from disk, which is not a change anyone made.
const reloading = new Set<OpenFile>();

// clangd and the explorer may spell one path differently, the URI does not.
const findOpenFile = (uri: monaco.Uri): OpenFile | undefined =>
  fileTabs().find((file) => file.model.uri.toString() === uri.toString());

// Gives a file a tab without switching to it. Files outside the project, the
// engine and its plugins open read-only. One opening transient gets its tab
// only once it comes to the front, so one asked for later is not replaced by it.
const loadFile = async (filePath: string, transient = false): Promise<OpenFile> => {
  const uri = pathUri(filePath);
  let file = findOpenFile(uri);
  if (file) return file;
  await dependenciesKnown;
  const contents = await readContents(filePath);
  file = findOpenFile(uri);
  if (file) return file;
  // clangd may already hold a model of this file for a preview.
  const model = monaco.editor.getModel(uri) ?? monaco.editor.createModel(contents, languageForFile(filePath).id, uri);
  if (model.getValue() !== contents) model.setValue(contents);
  if (transient) return addDocument(filePath, model, !isEditablePath(filePath));
  const added = addTab(filePath, model, !isEditablePath(filePath));
  renderTabs();
  return added;
};

const refreshDirtyMark = (file: OpenFile): void => {
  groupViews.forEach((view) => {
    const tab = [...view.tabsHost.children].find((child) => (child as HTMLElement).dataset.path === file.path);
    tab?.querySelector('.dirty-dot')?.classList.toggle('visible', isDirty(file));
  });
};

// Keeps a file open, on a model that matches it on disk, for its tabs to show.
const addDocument = (filePath: string, model: monaco.editor.ITextModel, readOnly: boolean): OpenFile => {
  const file: OpenFile = { kind: 'file', path: filePath, name: baseName(filePath), model, savedVersion: model.getAlternativeVersionId(), readOnly };
  openFiles.set(filePath, file);
  model.onDidChangeContent((event) => {
    refreshDirtyMark(file);
    // Edited, by typing, pasting or formatting, its transient tabs stay. Read again from disk, not.
    if (!event.isFlush && !reloading.has(file)) keepTab(file.path);
    const folder = dependencyFolderOf(file.path);
    if (folder && !warnedShared.has(folder) && isDirty(file) && !reloading.has(file)) {
      warnedShared.add(folder);
      notify({ text: t('sharedEdit').replace('{name}', baseName(folder)) });
    }
  });
  clangd.track(model);
  void applyCodeStyle(file);
  return file;
};

// Where a file's .clang-format says lines end.
const rulersFor = (file: OpenFile | undefined): number[] => (file?.style?.columnLimit ? [file.style.columnLimit] : []);

// Settings > Code Formatting: Glist Engine's style unless it says the project's .clang-format, or none.
const codeStyleMode = (): GlistCodeStyleMode => {
  try {
    const mode = window.localStorage.getItem('glist-studio-code-style');
    return mode === 'project' || mode === 'none' ? mode : 'glist';
  } catch { return 'glist'; }
};
const styleOf = (file: OpenFile): Promise<GlistCodeStyle | null> => window.glistAPI.codeStyle(file.path, codeStyleMode()).catch((): null => null);

// The editor indents a C or C++ file as its style says, with tabs or spaces
// and as far; with none, as it guesses from the text.
const applyCodeStyle = async (file: OpenFile): Promise<void> => {
  if (file.model.getLanguageId() !== 'cpp') return;
  file.style = await styleOf(file);
  const { style } = file;
  if (file.model.isDisposed()) return;
  if (style) file.model.updateOptions({ insertSpaces: !style.useTab, tabSize: style.tabWidth, indentSize: style.indentWidth });
  else file.model.detectIndentation(true, 4);
  groupViews.forEach((view) => {
    if (view.editor.getModel() === file.model) view.editor.updateOptions({ rulers: rulersFor(file) });
  });
};

const formatOnSave = (): boolean => {
  try { return window.localStorage.getItem('glist-studio-format-on-save') !== 'off'; } catch { return true; }
};

// Before a C or C++ file is saved, however the save was asked for, the lines
// changed since it was last saved are formatted by its .clang-format, as one step Undo takes back: indents
// with tabs or spaces as it says, spacing, braces. Lines nobody touched stay
// as they are, and #include lines are left out, so they are never reordered.
// Without a .clang-format above it, Glist Studio's own, Glist Engine's style,
// is followed. With clangd not answering in time, it is saved as it is.
const formatForSaving = async (file: OpenFile): Promise<void> => {
  if (!formatOnSave() || file.readOnly || file.model.getLanguageId() !== 'cpp') return;
  const style = await styleOf(file);
  if (!style || style.disabled) return;
  const version = file.model.getVersionId();
  // What is on disk is what was last saved.
  const saved = await window.glistAPI.readFile(file.path).catch(() => '');
  if (file.model.getVersionId() !== version) return;
  await formatLines(file, changedLines(saved, file.model.getValue()), style);
};

// Reformat File: the file, or the lines chosen, laid out by its .clang-format
// as one step Undo takes back, with #include lines where they are, as on save.
const reformatFile = async (): Promise<void> => {
  const file = activeFile();
  const editor = currentEditor();
  if (file && !file.readOnly && editor.getModel() === file.model && isDataLanguage(file.model.getLanguageId())) {
    await reformatData(file, editor);
    return;
  }
  if (!file || file.readOnly || file.model.getLanguageId() !== 'cpp' || editor.getModel() !== file.model) return;
  if (codeStyleMode() === 'none') {
    notify({ text: t('reformatOff') });
    return;
  }
  const style = await styleOf(file);
  if (!style || style.disabled) {
    notify({ text: t(style ? 'reformatDisabled' : 'reformatNoStyle'), detail: style?.file });
    return;
  }
  // Lines chosen to the start of the next one end before it.
  const chosen = editor.getSelection();
  const lines = chosen && !chosen.isEmpty()
    ? codeLines(file.model.getValue(), chosen.startLineNumber,
      chosen.endColumn === 1 && chosen.endLineNumber > chosen.startLineNumber ? chosen.endLineNumber - 1 : chosen.endLineNumber)
    : codeLines(file.model.getValue());
  if (!(await formatLines(file, lines, style))) notify({ text: t('reformatUnavailable'), kind: 'error' });
};

// A settings file laid out whole, as one step Undo takes back: JSON by
// Monaco's JSON service, YAML, TOML and INI by data-format.ts. One with a
// mistake is left as it is, and the notice says where.
const reformatData = async (file: OpenFile, editor: monaco.editor.IStandaloneCodeEditor): Promise<void> => {
  const { model } = file;
  const language = model.getLanguageId();
  if (language === 'json') {
    await editor.getAction('editor.action.formatDocument')?.run();
    return;
  }
  const { insertSpaces, indentSize } = model.getOptions();
  let laid: string;
  try {
    laid = language === 'yaml' ? formatYaml(model.getValue(), insertSpaces ? indentSize : 2)
      : language === 'toml' ? await formatToml(model.getValue()) : formatIni(model.getValue());
  } catch (error) {
    if (!(error instanceof DataFormatError)) throw error;
    const { line, column, message } = error.problem;
    notify({
      text: t('reformatMistake'),
      detail: `${t('line')} ${line}: ${message}`,
      kind: 'error',
      actions: [{ label: t('goToMistake'), run: () => { editor.setPosition({ lineNumber: line, column }); editor.revealLineInCenter(line); editor.focus(); } }],
    });
    return;
  }
  if (laid === model.getValue()) return;
  const position = editor.getPosition();
  editor.pushUndoStop();
  editor.executeEdits('glist.reformat', [{ range: model.getFullModelRange(), text: laid, forceMoveMarkers: true }]);
  editor.pushUndoStop();
  if (position) editor.setPosition(model.validatePosition(position));
};

const canReformat = (): boolean => {
  const file = activeFile();
  return Boolean(file && !file.readOnly && (file.model.getLanguageId() === 'cpp' || isDataLanguage(file.model.getLanguageId())));
};
const hasSelection = (): boolean => Boolean(currentEditor().getSelection() && !currentEditor().getSelection()?.isEmpty());
// Settings files are laid out whole; only C++ can be by the lines chosen.
const reformatsSelection = (): boolean => hasSelection() && currentEditor().getModel()?.getLanguageId() === 'cpp';

// Formats lines of a file by its .clang-format through clangd, as one step Undo
// takes back. False when clangd did not answer in time; typed into meanwhile,
// the file is left as it is, as the edits are for text that is gone.
const formatLines = async (file: OpenFile, ranges: LineRange[], style: GlistCodeStyle): Promise<boolean> => {
  if (ranges.length === 0) return true;
  const version = file.model.getVersionId();
  // Glist Studio's own style is in its folder, which clangd is pointed to.
  const styleFolder = style.builtIn ? style.file.replace(/[\\/][^\\/]*$/, '') : undefined;
  const edits = await Promise.race([
    clangd.formatLineEdits(file.model, ranges, styleFolder),
    new Promise<null>((resolve) => { window.setTimeout(() => resolve(null), 3000); }),
  ]);
  if (!edits) return false;
  if (edits.length === 0 || file.model.getVersionId() !== version) return true;
  const operations = editsWithin(edits, ranges).map((edit) => ({ range: edit.range, text: edit.text }));
  if (operations.length === 0) return true;
  // Through an editor showing it, the one worked in first, so its cursor keeps its place.
  const view = currentEditor().getModel() === file.model
    ? currentEditor() : groupViews.find((candidate) => candidate.editor.getModel() === file.model)?.editor;
  if (view) {
    view.pushUndoStop();
    view.executeEdits('clang-format', operations);
    view.pushUndoStop();
  } else {
    file.model.pushEditOperations([], operations, () => null);
  }
  return true;
};

// Opens a tab on a model that matches the file on disk, on the side being
// worked in, without switching to it.
const addTab = (filePath: string, model: monaco.editor.ITextModel, readOnly: boolean): OpenFile => {
  const file = addDocument(filePath, model, readOnly);
  layout.add(filePath);
  return file;
};

// Every save comes here, Ctrl+S's and the automatic ones alike (leaving the
// editor or the window, closing a tab, Build, Run and the rest), so each is
// formatted first as Ctrl+S's is. One save of a file at a time: leaving the
// editor and the window together ask twice, and formatting waits for clangd,
// so the second waits for the first and saves only what is still changed.
// The text is taken once, so anything typed while it is written stays unsaved.
const savesUnderway = new WeakMap<OpenFile, Promise<void>>();
const saveFile = (file: OpenFile): Promise<void> => {
  const save = (savesUnderway.get(file) ?? Promise.resolve()).catch((): void => undefined).then(async (): Promise<void> => {
    if (!isDirty(file)) return;
    await formatForSaving(file);
    const version = file.model.getAlternativeVersionId();
    await window.glistAPI.writeFile(file.path, file.model.getValue());
    file.savedVersion = version;
    clangd.saved(file.model);
    refreshDirtyMark(file);
    if (baseName(file.path) === 'CMakeLists.txt' && isProjectPath(file.path)) void learnDependencies().then(refreshDependencies);
    // A changed .clang-format: the open files indent as it now says.
    if (/^[._]clang-format$/.test(file.name)) fileTabs().forEach((tab) => { void applyCodeStyle(tab); });
    void git.refresh();
  });
  savesUnderway.set(file, save);
  return save;
};

// Opening a tab takes a moment; the last one asked for comes to the front,
// not whichever finished loading last.
let navigation = 0;

// Opens a file in a tab to stay, or transient: a search result, a definition
// or an error looked at, until another tab of the side comes to the front. A
// database's always stays: closing it would ask about its changes waiting.
const openFile = async (filePath: string, name: string, transient = false): Promise<boolean> => {
  if (imageType(filePath)) { openImage(filePath, transient); return true; }
  if (modelType(filePath)) { openModel(filePath, transient); return true; }
  if (isDatabaseFile(filePath)) { openDatabase(filePath); return true; }
  if (mediaType(filePath)) { openMedia(filePath, transient); return true; }
  navigation += 1;
  const ticket = navigation;
  try {
    const file = await loadFile(filePath, transient);
    // Another tab was asked for meanwhile, so nothing is placed in this one,
    // and a transient one, never placed, is let go.
    if (ticket !== navigation) {
      if (!layout.isOpen(file.path) && openFiles.get(file.path) === file) forgetDocument(file);
      return false;
    }
    activateFile(file.path, layout.focused, transient ? 'transient' : 'keep');
    return true;
  } catch (error) {
    noticeFailed('fileOpenFailed', error, name);
    return false;
  }
};

const revealLocation = async (uri: monaco.Uri, selection?: monaco.IRange | monaco.IPosition, transient = false): Promise<boolean> => {
  const filePath = uriPath(uri);
  if (!(await openFile(filePath, baseName(filePath), transient))) return false;
  if (!selection) return true;
  const target = currentEditor();
  if ('startLineNumber' in selection) {
    target.setSelection(selection);
    target.revealRangeInCenterIfOutsideViewport(selection);
  } else {
    target.setPosition(selection);
    target.revealPositionInCenterIfOutsideViewport(selection);
  }
  return true;
};

// A model for a file without a tab, for a peek view or Find in Files' preview.
const loadModel = async (uri: monaco.Uri): Promise<monaco.editor.ITextModel | null> => {
  const existing = monaco.editor.getModel(uri);
  if (existing) return existing;
  try {
    const filePath = uriPath(uri);
    const contents = await readContents(filePath);
    const loaded = monaco.editor.getModel(uri);
    if (loaded) return loaded;
    const model = monaco.editor.createModel(contents, languageForFile(filePath).id, uri);
    // A peek view can edit this model; give it a tab then, so the change can be saved.
    const cleanVersion = model.getAlternativeVersionId();
    const watcher = model.onDidChangeContent((event) => {
      // Opening the file for real resets the text, which is not an edit.
      if (event.isFlush) return;
      watcher.dispose();
      if (findOpenFile(uri) || !isEditablePath(filePath)) return;
      addTab(filePath, model, false).savedVersion = cleanVersion;
      renderTabs();
    });
    return model;
  } catch {
    return null;
  }
};

const clangd = new ClangdClient({
  loadModel,
  openForEdit: async (uri) => {
    const filePath = uriPath(uri);
    if (!isProjectPath(filePath)) return null;
    try { return (await loadFile(filePath)).model; } catch { return null; }
  },
  log: (text) => appendOutput(`\n${text}\n`),
  buildNeeded: (needed) => { buildNotice.hidden = !needed; },
  hoverTaken: (model, position) => debug.valueAt(model, position).then(Boolean),
  status: (text, busy) => {
    clangdStatus.hidden = !text;
    clangdStatus.classList.toggle('active', busy);
    const label = clangdStatus.querySelector('span');
    if (label) label.textContent = text ?? '';
  },
});

// Debug's entry in the output's list, and the exit code its program ended with.
let debugRun: OutputRun | null = null;
let debugExit: number | undefined;
const debug = new Debugger({
  currentEditor,
  openLocation: (filePath, line) => revealLocation(pathUri(filePath), { lineNumber: line, column: 1 }),
  log: (text, kind) => appendOutput(text, kind, debugRun ?? outputHistory.current),
  changed: () => {
    updateButtons();
    if (debugRun && debug.state === 'idle') {
      outputHistory.finishWithExit(debugRun, debugExit);
      debugRun = null;
    }
  },
  exited: (exitCode) => { debugExit = exitCode; },
  missingDebugger: () => notify({
    text: t('debuggerMissingNotice'), kind: 'error',
    actions: [{ label: t('installDebugger'), run: () => { void installGdb(); } }],
  }),
  debuggerFailed: () => notify({
    text: t('debuggerFailedNotice'), kind: 'error',
    actions: [{ label: t('installDebuggerAgain'), run: () => { void installGdb(true); } }],
  }),
  views: {
    status: element<HTMLElement>('#debug-status'),
    variables: element<HTMLElement>('#debug-variables'),
    stack: element<HTMLElement>('#debug-stack'),
    breakpoints: element<HTMLElement>('#debug-breakpoints'),
  },
});

// Each side makes its diff editor the first time it shows a diff tab.
let diffInline = ((): boolean => { try { return window.localStorage.getItem('glist-studio-diff-inline') === 'on'; } catch { return false; } })();

const ensureDiffEditor = (view: GroupView): monaco.editor.IStandaloneDiffEditor => {
  const pane = view.diff;
  if (pane.editor) return pane.editor;
  const viewer = monaco.editor.createDiffEditor(pane.host, {
    automaticLayout: true,
    readOnly: true,
    originalEditable: false,
    renderSideBySide: !diffInline,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    contextmenu: false,
    ...editorFonts(loadFonts()),
  });
  pane.editor = viewer;
  onFontsChange((fonts) => viewer.updateOptions(editorFonts(fonts)));
  // A diff view keeps going without a minimap.
  onEditorSettingsChange((settings) => viewer.updateOptions({ ...editorBehaviour(settings), minimap: { enabled: false } }));
  [viewer.getOriginalEditor(), viewer.getModifiedEditor()].forEach((side) => {
    side.onContextMenu((event) => showMenu(event.event.browserEvent, editorMenu(side, editorMenuHooks, false)));
    side.onDidFocusEditorWidget(() => focusGroup(groupViews.indexOf(view)));
  });
  return viewer;
};

// The diffs in front on either side.
const diffsInFront = (): DiffTab[] => [...new Set(layout.groups.map((group) => group.active))]
  .map((key) => (key ? openFiles.get(key) : undefined))
  .filter((tab): tab is DiffTab => tab?.kind === 'diff');

// The diff a side shows, for its toolbar.
const shownDiff = (view: GroupView): DiffTab | undefined => {
  const tab = view.shown ? openFiles.get(view.shown) : undefined;
  return tab?.kind === 'diff' ? tab : undefined;
};

const showDiffTab = (view: GroupView, tab: DiffTab): void => {
  const pane = view.diff;
  pane.view.hidden = false;
  const viewer = ensureDiffEditor(view);
  pane.left.textContent = tab.leftLabel;
  pane.right.textContent = tab.rightLabel;
  pane.message.hidden = !tab.message;
  pane.message.textContent = tab.message;
  const change = git.changeOf(tab.file);
  pane.rollback.hidden = tab.target !== null || !change || change.state === 'untracked' || change.state === 'conflict';
  pane.open.disabled = tab.target === null && change?.state === 'deleted';
  if (viewer.getModel()?.modified === tab.modified) return;
  viewer.setModel({ original: tab.original, modified: tab.modified });
  // A diff opens at its first change, once it is known: of its two versions,
  // not of the two empty texts a tab shown before they arrive compares first
  // (a transient tab is shown at once), and only then, not on every refresh.
  const shown = viewer.onDidUpdateDiff(() => {
    if (viewer.getModel()?.modified !== tab.modified) { shown.dispose(); return; }
    if (!tab.filled) return;
    shown.dispose();
    viewer.revealFirstDiff();
  });
};

const readVersion = async (revision: string | null, filePath: string): Promise<GlistGitFileVersion> => {
  if (!revision) return { text: null };
  try { return await window.glistAPI.gitFileAt(revision, filePath); } catch { return { text: null }; }
};

// The file as it is now: as the editor has it, typing included, or as saved.
const workingVersion = async (filePath: string): Promise<GlistGitFileVersion> => {
  const open = findOpenFile(pathUri(filePath));
  if (open) return { text: open.model.getValue() };
  try { return { text: await readContents(filePath) }; } catch { return { text: null }; }
};

const versionLabel = (revision: string | null, version: GlistGitFileVersion, filePath: string): string => {
  const name = revision === null ? t('diffWorking')
    : revision === 'HEAD' ? t('diffHead').replace('{hash}', git.repositoryOf(filePath)?.head?.slice(0, 7) ?? '')
      : t('diffCommit').replace('{hash}', revision.startsWith('stash@') ? revision : revision.slice(0, 7));
  return version.text === null ? `${name}: ${t('diffMissing')}` : name;
};

const fillDiff = async (tab: DiffTab): Promise<void> => {
  const [left, right] = await Promise.all([
    readVersion(tab.base, tab.from ?? tab.file),
    tab.target ? readVersion(tab.target, tab.file) : workingVersion(tab.file),
  ]);
  if (tab.original.isDisposed()) return;
  if (tab.original.getValue() !== (left.text ?? '')) tab.original.setValue(left.text ?? '');
  if (tab.modified.getValue() !== (right.text ?? '')) tab.modified.setValue(right.text ?? '');
  tab.filled = true;
  tab.leftLabel = tab.base ? versionLabel(tab.base, left, tab.file) : t('diffMissing');
  tab.rightLabel = versionLabel(tab.target, right, tab.file);
  tab.message = [left, right].some((version) => version.binary) ? t('diffBinary')
    : [left, right].some((version) => version.tooLarge) ? t('diffTooLarge') : '';
  if (layout.groups.some((group) => group.active === tab.path)) showGroups();
};

interface DiffRequest {
  file: string;
  from?: string;
  base: string | null;
  target: string | null;
}

const openGitDiff = async (request: DiffRequest): Promise<void> => {
  navigation += 1;
  const ticket = navigation;
  const key = `diff:${request.base ?? ''}:${request.target ?? ''}:${request.file}`;
  // A database is compared by its tables and rows, in a page of its own.
  if (isDatabaseFile(request.file)) { openDatabaseDiff(key, request); return; }
  const existing = openFiles.get(key);
  if (existing?.kind === 'diff') {
    await fillDiff(existing);
    if (ticket === navigation) activateFile(key, layout.focused, 'transient');
    return;
  }
  const language = languageForFile(request.file).id;
  const tab: DiffTab = {
    kind: 'diff',
    path: key,
    file: request.file,
    from: request.from,
    name: baseName(request.file),
    base: request.base,
    target: request.target,
    original: monaco.editor.createModel('', language),
    modified: monaco.editor.createModel('', language),
    leftLabel: '',
    rightLabel: '',
    message: '',
  };
  openFiles.set(key, tab);
  // Transient, in the place of the one before as soon as it is asked for, so
  // the last diff asked for is the one left; that one is let go once this shows.
  const replaced = layout.add(key, layout.focused, true);
  await fillDiff(tab);
  if (ticket === navigation) activateFile(key, layout.focused, 'transient');
  else renderTabs();
  forgetClosed(replaced);
};

// A database between two versions, compared when its tab opens, when it is
// opened again or refreshed, and by itself once what it read changed: the file
// on disk and its -wal (by their sizes and times, cheaply told), or the commit
// HEAD names. Only while in front of a side: one behind looks when next shown.
// Two commits never change. One comparison at a time; asked meanwhile, it
// looks again once done. What waits in the database's own tab is not in the
// file, so the page says so while there is any.
const openDatabaseDiff = (key: string, request: DiffRequest): void => {
  const existing = openFiles.get(key);
  if (existing?.kind === 'database-diff') {
    void existing.page.refresh();
    activateFile(key, layout.focused, 'transient');
    return;
  }
  const working = request.target === null;
  const followsHead = request.base === 'HEAD' || request.target === 'HEAD';
  const stampOf = async (): Promise<string> => `${followsHead ? git.repositoryOf(request.file)?.head ?? '' : ''}|${
    working ? await window.glistAPI.databaseStamp(request.file) : ''}`;
  let stamp: string | undefined;
  let running: Promise<void> | null = null;
  let again = false;
  let finished = 0;
  let timer: number | undefined;
  const inFront = (): boolean => layout.groups.some((group) => group.active === key);
  const database = (): DatabaseTab | undefined => {
    const tab = openFiles.get(request.file);
    return tab?.kind === 'database' ? tab : undefined;
  };
  const compare = (): Promise<void> => {
    if (running) { again = true; return running; }
    running = (async () => {
      const read = await stampOf();
      const diff = await window.glistAPI.databaseDiff(request.file, request.base, request.target, request.from);
      tab.page.left = request.base ? versionLabel(request.base, { text: diff.base.missing ? null : '' }, request.file) : t('diffMissing');
      tab.page.right = versionLabel(request.target, { text: diff.target.missing ? null : '' }, request.file);
      Object.assign(tab.page, { diff, error: undefined });
      stamp = read;
      // The tab's tooltip names the versions.
      if (openFiles.get(key) === tab) renderTabs();
    })().catch((error: unknown) => {
      tab.page.error = remoteError(error);
      // Tried again on the next change.
      stamp = undefined;
    }).finally(() => {
      running = null;
      finished = Date.now();
      // Drawn next by whoever asked.
      shown = drawn();
      if (again) { again = false; tab.page.check(); }
    });
    return running;
  };
  // What the page drew that git or the database's tab may change meanwhile.
  const drawn = (): string => `${tab.page.canOpen()}:${tab.page.canRollback()}:${tab.page.waiting()}`;
  let shown = '';
  const redraw = (): void => {
    tab.version += 1;
    shown = drawn();
    if (openFiles.get(key) === tab) showGroups();
  };
  const refresh = (): Promise<void> => compare().finally(redraw);
  const look = async (): Promise<void> => {
    if (openFiles.get(key) !== tab || !inFront()) return;
    if (running) { again = true; return; }
    const now = working || followsHead ? await stampOf().catch((): string => '') : stamp;
    if (running || openFiles.get(key) !== tab) return;
    if (now !== stamp) void refresh();
    else if (drawn() !== shown) redraw();
  };
  const tab: DatabaseDiffTab = {
    kind: 'database-diff',
    path: key,
    name: baseName(request.file),
    file: request.file,
    version: 0,
    page: {
      name: baseName(request.file),
      left: '',
      right: '',
      refresh,
      // Soon, and not sooner than a second after the last comparison, so a
      // file being written all the time is not compared all the time.
      check: () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => { void look(); }, Math.max(250, finished + 1000 - Date.now()));
      },
      waiting: () => {
        const own = database();
        return own !== undefined && hasPending(own);
      },
      canOpen: () => !(working && (git.changeOf(request.file)?.state === 'deleted' || tab.page.diff?.target.missing)),
      open: () => openDatabase(request.file),
      canRollback: () => {
        const change = git.changeOf(request.file);
        return working && change !== undefined && change.state !== 'untracked' && change.state !== 'conflict';
      },
      // As a text diff's Rollback, saying when changes waiting in the
      // database's tab go too. Those are discarded and the file let go of
      // first: Windows replaces no file that is open, and no connection should
      // have its file replaced under it. The database's tab then reads it again.
      rollback: async () => {
        const own = database();
        const waiting = own !== undefined && hasPending(own);
        if (!(await confirmDialog(t(waiting ? 'databaseDiffRollbackWaiting' : 'confirmRollbackOne').replace('{name}', tab.name)))) return;
        try {
          if (own && waiting) own.page.pending = await window.glistAPI.databaseDiscard(request.file);
          await window.glistAPI.databaseClose(request.file);
        } catch (error) {
          noticeFailed('gitFailed', error);
          return;
        }
        await git.run({ kind: 'rollback', paths: [request.file] }, { root: git.rootOf(request.file) });
        const reopened = database();
        if (reopened) {
          reopened.version += 1;
          showGroups();
        }
        void refresh();
      },
    },
  };
  // Transient, as every diff is.
  openPageTab(tab, compare, true);
};

// A plugin's README in a tab of its own, asked for when the tab first opens.
const openReadme = (plugin: GlistPlugin): void => openPageTab<ReadmeTab>(
  { kind: 'readme', path: `readme:${plugin.name}`, name: plugin.name, page: { name: plugin.name, url: plugin.url }, version: 0 },
  async (tab) => { tab.page.readme = await window.glistAPI.pluginReadme(plugin.name); },
);

// An image file as a picture, in a tab of its own.
const openImage = (filePath: string, transient = false): void => openPageTab<ImageTab>(
  { kind: 'image', path: filePath, name: baseName(filePath), page: { name: baseName(filePath) }, version: 0 },
  async (tab) => { tab.page.image = await window.glistAPI.readImage(filePath); },
  transient,
);

// A 3D model, drawn, in a tab of its own.
const openModel = (filePath: string, transient = false): void => openPageTab<ModelTab>(
  { kind: 'model', path: filePath, name: baseName(filePath), page: { name: baseName(filePath) }, version: 0 },
  async (tab) => { tab.page.model = await window.glistAPI.readModel(filePath); },
  transient,
);

// A SQLite database, in a tab of its own that reads it as it is shown.
const openDatabase = (filePath: string): void => openPageTab<DatabaseTab>(
  {
    kind: 'database',
    path: filePath,
    name: baseName(filePath),
    page: { name: baseName(filePath), path: filePath, askName: (initial) => requestName('databaseRenameTable', 'databaseTableName', initial) },
    version: 0,
  },
  async (): Promise<void> => undefined,
);

// A video or a sound, in a tab of its own that plays it as it is shown.
const openMedia = (filePath: string, transient = false): void => openPageTab<MediaTab>(
  { kind: 'media', path: filePath, name: baseName(filePath), page: { name: baseName(filePath), path: filePath }, version: 0 },
  async (): Promise<void> => undefined,
  transient,
);

// A README's or an image's tab, brought to the front, to stay or transient;
// what it shows is asked for when it first opens, and drawn when it arrives.
const openPageTab = <T extends PageTab>(tab: T, load: (tab: T) => Promise<void>, transient = false): void => {
  if (!openFiles.has(tab.path)) {
    openFiles.set(tab.path, tab);
    void load(tab)
      .catch((error: unknown) => { tab.page.error = remoteError(error); })
      .finally(() => { tab.version += 1; showGroups(); });
  }
  activateFile(tab.path, layout.focused, transient ? 'transient' : 'keep');
};

// A file against its last commit.
const openWorkingDiff = (filePath: string): Promise<void> => {
  const change = git.changeOf(filePath);
  return openGitDiff({ file: filePath, from: change?.from, base: git.repositoryOf(filePath)?.head ? 'HEAD' : null, target: null });
};

// Open File: the file where the diff was looking, the line under the cursor if
// it is in sight, else the first line in sight, at the same height on screen.
// A commit's version is followed to the same line in the file as it is now.
const openDiffFile = async (view: GroupView): Promise<void> => {
  const tab = shownDiff(view);
  const shown = view.diff.editor?.getModifiedEditor();
  if (!tab || !shown) return;
  const visible = shown.getVisibleRanges();
  const cursor = shown.getPosition();
  const inSight = cursor && visible.some((range) => range.startLineNumber <= cursor.lineNumber && cursor.lineNumber <= range.endLineNumber);
  const anchor = inSight ? cursor : { lineNumber: visible[0]?.startLineNumber ?? 1, column: 1 };
  // Its height in the window: the diff has its toolbar above it, the editor not.
  const height = (shown.getDomNode()?.getBoundingClientRect().top ?? 0) + shown.getTopForLineNumber(anchor.lineNumber) - shown.getScrollTop();
  const shownText = tab.modified.getValue();
  focusGroup(groupViews.indexOf(view));
  if (!(await openFile(tab.file, baseName(tab.file)))) return;
  const target = currentEditor();
  const model = target.getModel();
  if (!model) return;
  const same = model.getValue() === shownText;
  const line = Math.min(same ? anchor.lineNumber : mapLine(lineChanges(shownText, model.getValue()), anchor.lineNumber), model.getLineCount());
  target.setPosition({ lineNumber: line, column: same ? anchor.column : 1 });
  target.setScrollTop(Math.max(0, target.getTopForLineNumber(line) - (height - (target.getDomNode()?.getBoundingClientRect().top ?? 0))));
  target.focus();
};

// A side's diff toolbar: step through the changes, one column or two, open
// the file there, or put the file back as it was committed.
const wireDiffPane = (view: GroupView): void => {
  const pane = view.diff;
  const button = (name: string): HTMLButtonElement => pane.view.querySelector(`[data-diff="${name}"]`) as HTMLButtonElement;
  button('previous').addEventListener('click', () => pane.editor?.goToDiff('previous'));
  button('next').addEventListener('click', () => pane.editor?.goToDiff('next'));
  button('layout').addEventListener('click', () => {
    diffInline = !diffInline;
    try { window.localStorage.setItem('glist-studio-diff-inline', diffInline ? 'on' : 'off'); } catch { /* Storage may be unavailable. */ }
    groupViews.forEach((other) => other.diff.editor?.updateOptions({ renderSideBySide: !diffInline }));
  });
  pane.open.addEventListener('click', () => { void openDiffFile(view); });
  pane.rollback.addEventListener('click', async () => {
    const tab = shownDiff(view);
    if (!tab || !(await confirmDialog(t('confirmRollbackOne').replace('{name}', tab.name)))) return;
    void git.run({ kind: 'rollback', paths: [tab.file] }, { root: git.rootOf(tab.file) });
  });
};

// Git: all of it hidden and silent until it is turned on in Settings.
const git = new GitClient({
  saveAll: () => saveProjectFiles(),
  reloadFiles: () => reloadFromDisk(),
  filesChanged: () => { void reloadOpenFiles(); },
  busy: (label) => {
    if (label) setProcessStatus(label, true);
    else if (!isBuildRunning && !isRunRunning) setProcessStatus(t('ready'), false);
  },
  showConsole: () => showGitPanel('console'),
  showConflicts: () => showView('commit'),
});

const showGitPanel = (view: GitPanelView): void => {
  showPanel('git');
  gitPanel.show(view);
};

const showGitHistory = (filePath: string): void => {
  showPanel('git');
  gitPanel.showHistory(filePath);
};

const showCommitView = (): void => {
  if (!git.enabled) return;
  showView('commit');
  commitPane.focusMessage();
};

// Open files changed on disk are read again, unless they have unsaved changes:
// the engine's too, so a tab shows what Update Engine and Plugins brought in
// and saving it later does not put the old text back.
const reloadOpenFiles = async (): Promise<void> => {
  for (const file of fileTabs()) {
    if (isDirty(file)) continue;
    let contents: string;
    try {
      contents = await readContents(file.path);
    } catch {
      // Gone, such as a file the branch checked out does not have.
      closeFile(file.path);
      continue;
    }
    // Typed into while it was read: what is typed wins.
    if (isDirty(file) || file.model.isDisposed()) continue;
    if (file.model.getValue() !== contents) {
      // As an edit, so Undo can bring back what was there.
      reloading.add(file);
      file.model.pushStackElement();
      file.model.pushEditOperations([], [{ range: file.model.getFullModelRange(), text: contents }], () => null);
      file.model.pushStackElement();
      reloading.delete(file);
    }
    file.savedVersion = file.model.getAlternativeVersionId();
    refreshDirtyMark(file);
  }
  for (const diff of diffsInFront()) await fillDiff(diff);
};

// After git changed files: the open ones, and the explorer's list of them.
const reloadFromDisk = async (): Promise<void> => {
  await reloadOpenFiles();
  await loadProjectTree();
};

const ensureIdentity = async (): Promise<boolean> => {
  const identity = await window.glistAPI.gitIdentity().catch((): GlistGitIdentity => ({ name: '', email: '' }));
  if (identity.name && identity.email) return true;
  const entered = await identityDialog(identity);
  if (!entered) return false;
  const result = await window.glistAPI.gitRun({ kind: 'identity', ...entered });
  if (!result.success) notify({ text: t('gitFailed'), detail: result.message, kind: 'error' });
  return result.success;
};

// The project's commits, and the engine's and plugins' that have any to send, in one dialog.
const pushChanges = async (): Promise<void> => {
  const repository = git.repository;
  const entries: PushEntry[] = [];
  let problem: Notice | null = null;
  if (repository) {
    try {
      const outgoing = await window.glistAPI.gitOutgoing();
      if (!outgoing.remote) {
        problem = { text: t('noRemotes'), kind: 'error', actions: [{ label: t('addRemote'), run: () => { showGitPanel('remotes'); void gitPanel.addRemote(); } }] };
      } else if (!outgoing.branch) {
        problem = { text: t('detached').replace('{hash}', repository.head?.slice(0, 7) ?? ''), kind: 'error' };
      } else entries.push({ name: repository.name, outgoing, upstream: repository.upstream });
    } catch (error) {
      problem = { text: t('gitFailed'), detail: errorText(error), kind: 'error' };
    }
  }
  for (const dependency of git.dependencies.filter((entry) => entry.branch && entry.ahead > 0)) {
    try {
      const outgoing = await window.glistAPI.gitOutgoing(dependency.folder);
      if (outgoing.remote && outgoing.commits.length > 0) entries.push({ name: dependency.name, root: dependency.folder, outgoing, upstream: dependency.upstream });
    } catch { /* It is left out; its own Git tab tells why. */ }
  }
  if (entries.length === 0) {
    if (problem) notify(problem);
    return;
  }
  const choice = await pushDialog(entries);
  if (!choice) return;
  for (const entry of choice.entries) {
    const remote = (entry.root === undefined ? choice.remote : null) ?? entry.outgoing.remote ?? undefined;
    const target = `${remote}/${entry.outgoing.branch}`;
    await git.run({
      kind: 'push',
      // A branch that follows its remote pushes there; otherwise it starts following the one chosen.
      remote: remote === entry.outgoing.remote && entry.upstream ? undefined : remote,
      tags: choice.tags,
      force: choice.force,
    }, {
      root: entry.root,
      busy: 'pushing',
      success: entries.length > 1 ? t('pushedRepository').replace('{name}', entry.name).replace('{target}', target) : t('pushedTo').replace('{target}', target),
      failureActions: (result) => (result.rejected && entry.root === undefined ? [{ label: t('updateProject'), run: () => { void updateProject(); } }] : []),
    });
  }
};

const updateProject = async (): Promise<void> => {
  const repository = git.repository;
  if (!repository) return;
  await git.run({ kind: 'pull', rebase: git.updateByRebase }, {
    busy: 'updating',
    success: t('updatedFrom').replace('{upstream}', repository.upstream ?? ''),
    failureActions: (result) => (repository.upstream || result.conflicts ? [] : [{ label: t('pushMenu'), run: () => { void pushChanges(); } }]),
  });
};

const fetchAll = (): Promise<GlistGitResult> => git.run({ kind: 'fetch' }, { busy: 'fetching', success: t('fetched') });

// The engine and the project's plugins, each from where it is published, as
// the Plugins view updates them. They are shared by every project, so this is
// its own command and asks first, instead of being part of Update Project.
const updateDependencies = async (): Promise<void> => {
  const listed = await window.glistAPI.listPlugins().catch((): GlistPluginList | null => null);
  const targets: CheckoutTarget[] = git.dependencies.map((repository) => (repository.kind === 'engine'
    ? engineTarget
    : pluginTarget(listed?.plugins.find((plugin) => plugin.name === repository.name) ?? { name: repository.name, description: '', url: '', installed: true })));
  if (targets.length === 0 || !(await confirmDialog(t('confirmUpdateDependencies').replace('{names}', targets.map((target) => target.name).join(', '))))) return;
  const upToDate: string[] = [];
  for (const target of targets) {
    if ((await updateCheckout(target, checkoutHooks, true)).upToDate) upToDate.push(target.name);
  }
  if (upToDate.length > 0) notify({ text: t('dependenciesUpToDate').replace('{names}', upToDate.join(', ')), kind: 'success' });
  void git.refresh();
};

const checkoutRef = async (ref: string, root?: string): Promise<void> => {
  const success = t('checkedOut').replace('{name}', ref);
  const result = await git.run({ kind: 'checkout', ref }, { root, success, quiet: (outcome) => Boolean(outcome.localChanges) });
  if (result.localChanges) {
    notify({
      text: result.message,
      kind: 'error',
      actions: [{ label: t('smartCheckout'), run: () => { void git.run({ kind: 'checkout', ref, smart: true }, { root, success }); } }],
    });
  }
};

const newBranch = async (start?: string, label?: string, root?: string): Promise<void> => {
  const from = label ?? git.repositoryAt(root)?.branch ?? 'HEAD';
  const values = await formDialog({
    title: t('newBranchFrom').replace('{start}', from),
    submit: t('create'),
    fields: [
      { kind: 'text', key: 'name', label: t('branchName'), required: true },
      { kind: 'checkbox', key: 'checkout', label: t('checkout'), value: true },
    ],
  });
  if (!values) return;
  await git.run({ kind: 'create-branch', name: String(values.name), start, checkout: Boolean(values.checkout) }, { root });
};

const cloneProject = async (): Promise<void> => {
  if (!(await saveProjectFiles())) return;
  const location = await window.glistAPI.getProjectsDirectory();
  const root = await cloneDialog(location, (update) => window.glistAPI.onGitConsole((entry) => {
    const line = entry.kind === 'output' ? entry.text.split(/[\r\n]/).map((part) => part.trim()).filter(Boolean).pop() : null;
    if (line) update(line);
  }));
  if (root) await openProjectWith(() => window.glistAPI.openProjectPath(root));
};

const deleteProjectFile = async (filePath: string): Promise<void> => {
  try {
    if (activeProject && !isWithin(filePath, joinPath(activeProject.root, 'CMakeLists.txt'))) await saveOpenCmake();
    await window.glistAPI.deleteEntry(filePath);
    closeFilesUnderEntry(filePath);
    await reloadOpenCmake();
    await loadProjectTree();
    noticeDone('movedToTrash', filePath);
  } catch (error) {
    noticeFailed('deleteFailed', error);
  }
};

const commitPane = new CommitView({
  branch: element<HTMLElement>('#commit-branch'),
  banner: element<HTMLElement>('#commit-banner'),
  changes: element<HTMLElement>('#commit-changes'),
  box: element<HTMLElement>('#commit-box'),
  message: element<HTMLTextAreaElement>('#commit-message'),
  amend: element<HTMLInputElement>('#commit-amend'),
  commit: element<HTMLButtonElement>('#commit-button'),
  commitAndPush: element<HTMLButtonElement>('#commit-push-button'),
  refresh: element<HTMLButtonElement>('#commit-refresh'),
  rollback: element<HTMLButtonElement>('#commit-rollback'),
  update: element<HTMLButtonElement>('#commit-update'),
  push: element<HTMLButtonElement>('#commit-push'),
}, git, {
  projectRoot: () => activeProject?.root ?? null,
  openDiff: (change) => { void openWorkingDiff(change.path); },
  openFile: (filePath) => { void openFile(filePath, baseName(filePath)); },
  openConflict: (filePath) => {
    void openFile(filePath, baseName(filePath)).then((opened) => {
      const line = opened ? (currentEditor().getModel()?.getLinesContent().findIndex((text) => text.startsWith('<<<<<<<')) ?? -1) : -1;
      if (line < 0) return;
      currentEditor().revealLineInCenter(line + 1);
      currentEditor().setPosition({ lineNumber: line + 1, column: 1 });
    });
  },
  deleteFile: deleteProjectFile,
  showHistory: showGitHistory,
  push: () => { void pushChanges(); },
  update: () => { void updateProject(); },
  branchMenu: (anchor) => showMenuAt(anchor, 'branches'),
  ensureIdentity,
});

const gitPanel = new GitPanel(gitPanelElement, git, {
  projectRoot: () => activeProject?.root ?? null,
  openCommitDiff: (file, base, commit) => {
    const added = file.state === 'added' || file.state === 'untracked';
    void openGitDiff({ file: file.path, from: file.from, base: added ? null : base, target: file.at ?? commit });
  },
  push: () => { void pushChanges(); },
  update: () => { void updateProject(); },
  newBranch: (start, label, root) => { void newBranch(start, label, root); },
  checkout: (ref, root) => { void checkoutRef(ref, root); },
});

const gitEditor = new GitEditor(currentEditor, git, {
  pathOf: (model) => findOpenFile(model.uri)?.path ?? null,
  readOnly: (model) => findOpenFile(model.uri)?.readOnly ?? true,
  openDiff: (filePath) => { void openWorkingDiff(filePath); },
  showCommit: (hash, filePath) => { showPanel('git'); void gitPanel.showCommit(hash, git.rootOf(filePath)); },
  markResolved: (filePath) => {
    const file = findOpenFile(pathUri(filePath));
    void (file && isDirty(file) ? saveFile(file) : Promise.resolve())
      .then(() => git.run({ kind: 'mark-resolved', paths: [filePath] }, { root: git.rootOf(filePath) }));
  },
});

// Opens a menu of the title bar at another button; set up with the menus.
let showMenuAt: (anchor: HTMLElement, menu: string) => void = () => undefined;
// The title bar menus' commands, for the command palette; set up with the menus.
let menuCommands: () => PaletteCommand[] = () => [];

// Go to Definition and References landing in another file open it transient.
monaco.editor.registerEditorOpener({
  openCodeEditor: (_source, resource, selectionOrPosition) => revealLocation(resource, selectionOrPosition, true),
});

const switchSourceHeader = async (): Promise<void> => {
  const model = currentEditor().getModel();
  const target = model && await clangd.switchSourceHeader(model);
  if (target) await revealLocation(target);
};

// The file in front, if Git knows it. Engine and plugin files count too, in
// their own repositories.
const trackedFile = (): OpenFile | undefined => {
  const file = activeFile();
  const change = file ? git.changeOf(file.path) : undefined;
  return file && git.repositoryOf(file.path) && change?.state !== 'untracked' && !git.isIgnored(file.path) ? file : undefined;
};

// The right-click menu, and the same from the keyboard at the cursor.
const editorMenuHooks: EditorMenuHooks = {
  navigates: () => clangd.navigates,
  switchSourceHeader: () => { void switchSourceHeader(); },
  commandPalette: () => commandPalette.open(),
  reformat: () => { void reformatFile(); },
  git: () => {
    const file = git.enabled && git.repository ? trackedFile() : undefined;
    return file ? [
      { label: t('showDiff'), run: () => { void openWorkingDiff(file.path); } },
      { label: t('showHistory'), run: () => showGitHistory(file.path) },
      { label: t(gitEditor.isBlaming() ? 'hideAnnotate' : 'annotate'), run: () => { void gitEditor.toggleBlame(); } },
    ] : [];
  },
};
// What every side's editor has: the code font and caret, breakpoints and Git's marks,
// its keys, its right-click menu, and making its side the one worked in when
// it takes focus.
const setUpEditor = (view: GroupView): void => {
  const target = view.editor;
  onFontsChange((fonts) => target.updateOptions(editorFonts(fonts)));
  onEditorSettingsChange((settings) => target.updateOptions(editorBehaviour(settings)));
  debug.attach(target);
  gitEditor.attach(target);
  target.onDidFocusEditorWidget(() => focusGroup(groupViews.indexOf(view)));
  target.onDidChangeCursorPosition(scheduleSessionSave);
  // Leaving the editor, for the terminal or the explorer, saves as leaving the
  // window does, so what is run from there sees what is on screen.
  target.onDidBlurEditorWidget(() => { if (activeProject) void saveProjectFiles(); });
  target.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.KeyO, () => { void switchSourceHeader(); }, 'editorLangId == cpp');
  target.addCommand(isLinux ? monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyI : monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF,
    () => { void reformatFile(); }, 'editorLangId =~ /^(cpp|json|yaml|toml|ini)$/');
  // As Monaco's own menu did: focus, and the cursor at the click unless it is in the selection.
  target.onContextMenu((event) => {
    target.focus();
    const position = event.target.position;
    if (position && !target.getSelection()?.containsPosition(position)) target.setPosition(position);
    showMenu(event.event.browserEvent, editorMenu(target, editorMenuHooks));
  });
  const showMenuHere = (): void => showMenu(editorMenuPoint(target), editorMenu(target, editorMenuHooks));
  target.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.F10, showMenuHere);
  target.addCommand(monaco.KeyCode.ContextMenu, showMenuHere);
};

// Makes a side the one worked in: its editor gets the commands, and its tab in front is marked so.
const focusGroup = (group: number): void => {
  if (group < 0 || group >= layout.groups.length || group === layout.focused) return;
  layout.focus(group);
  groupViews.forEach((view, index) => view.element.classList.toggle('focused', index === layout.focused));
  updateButtons();
};

// Dragging a tab over a side's editor: onto the other side it moves there, and
// onto the right half of the only side it makes a new side there. Monaco would
// otherwise take the drop as text and type the file's path in.
const listenForEditorDrops = (view: GroupView): void => {
  const target = (event: DragEvent): 'whole' | 'right' | null => {
    const group = groupViews.indexOf(view);
    if (!draggedTab || group >= layout.groups.length) return null;
    if (group !== draggedTab.group) return 'whole';
    const bounds = view.stage.getBoundingClientRect();
    return layout.groups.length < maxGroups && (layout.groups[group]?.tabs.length ?? 0) > 1
      && event.clientX > bounds.left + bounds.width / 2 ? 'right' : null;
  };
  view.stage.addEventListener('dragover', (event) => {
    if (!draggedTab) return;
    event.stopPropagation();
    const place = target(event);
    view.overlay.hidden = !place;
    view.overlay.classList.toggle('right', place === 'right');
    if (!place) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  }, true);
  view.stage.addEventListener('dragleave', (event) => {
    if (!view.stage.contains(event.relatedTarget as Node | null)) view.overlay.hidden = true;
  }, true);
  view.stage.addEventListener('drop', (event) => {
    if (!draggedTab) return;
    event.preventDefault();
    event.stopPropagation();
    const place = target(event);
    view.overlay.hidden = true;
    const group = groupViews.indexOf(view);
    if (place) moveTab(draggedTab.key, draggedTab.group, place === 'right' ? group + 1 : group);
  }, true);
};

// Everything a side has, for the left one now and the right one when it is made.
const setUpGroupView = (view: GroupView): void => {
  setUpEditor(view);
  listenForTabDrops(view);
  scrollTabsByWheel(view);
  listenForEditorDrops(view);
  wireDiffPane(view);
  // A click anywhere in a side makes it the one worked in.
  view.element.addEventListener('pointerdown', () => focusGroup(groupViews.indexOf(view)), true);
};
setUpGroupView(groupViews[0]);

// Where the left side ends, as a share of the area, dragged and kept.
const splitKey = 'glist-studio-editor-split';
const setSplit = (percent: number): void => groupsHost.style.setProperty('--editor-split', `${Math.min(85, Math.max(15, percent))}%`);
setSplit(((): number => { try { return Number(window.localStorage.getItem(splitKey)) || 50; } catch { return 50; } })());
let groupResizer: HTMLElement | null = null;

// The right side, made the first time something opens there: a tab strip, an
// editor with the left one's settings, and a copy of the diff view.
const secondGroupView = (): GroupView => {
  if (groupViews[1]) return groupViews[1];
  const resizer = document.createElement('div');
  resizer.className = 'group-resizer';
  resizer.addEventListener('pointerdown', () => {
    const bounds = groupsHost.getBoundingClientRect();
    const onMove = (moveEvent: PointerEvent): void => setSplit(((moveEvent.clientX - bounds.left) / bounds.width) * 100);
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      try { window.localStorage.setItem(splitKey, groupsHost.style.getPropertyValue('--editor-split').replace('%', '')); } catch { /* Storage may be unavailable. */ }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });
  groupResizer = resizer;
  const group = document.createElement('div');
  group.className = 'editor-group';
  const strip = document.createElement('div');
  strip.className = 'editor-tabs';
  const stage = document.createElement('div');
  stage.className = 'editor-stage';
  const host = document.createElement('div');
  host.className = 'editor-host';
  const diffView = diffTemplate.cloneNode(true) as HTMLElement;
  [diffView, ...diffView.querySelectorAll('[id]')].forEach((node) => node.removeAttribute('id'));
  placeIcons(diffView);
  stage.append(host, diffView);
  group.append(strip, stage);
  groupsHost.append(resizer, group);
  const view: GroupView = {
    element: group,
    tabsHost: strip,
    stage,
    host,
    editor: monaco.editor.create(host, codeEditorOptions),
    diff: diffPane(diffView),
    page: readmeView(stage),
    pageShown: null,
    overlay: dropOverlay(stage),
    shown: null,
    viewStates: new Map(),
  };
  groupViews.push(view);
  setUpGroupView(view);
  return view;
};

// Opens the tab's file on the other side too, where it was scrolled to here.
const splitTab = (key: string, group = layout.focused): void => {
  const source = groupViews[group];
  const state = source?.shown === key && source.editor.getModel() ? source.editor.saveViewState() : source?.viewStates.get(key);
  const closed = layout.split(key, group);
  if (layout.groups.length > 1) secondGroupView();
  const target = groupViews[layout.focused];
  if (state && target && target.shown !== key && !target.viewStates.has(key)) target.viewStates.set(key, state);
  showGroups();
  forgetClosed(closed);
  renderTabs();
  updateButtons();
  if (openFiles.get(key)?.kind === 'file') currentEditor().focus();
};

// A tab's right-click menu: close it or others, and put it on the other side.
const tabMenu = (key: string, group: number): MenuEntry[] => {
  const tabs = layout.groups[group]?.tabs ?? [];
  const other = layout.groups.length > 1 ? 1 - group : 1;
  const closeTabs = (keys: string[]): void => keys.forEach((each) => closeFile(each, group));
  return [
    { label: t('close'), run: () => closeFile(key, group) },
    { label: t('closeOthers'), run: () => closeTabs(tabs.filter((each) => each !== key)), disabled: tabs.length < 2 },
    { label: t('closeAll'), run: () => closeTabs([...tabs]) },
    'separator',
    { label: t(group === 0 ? 'splitRight' : 'splitLeft'), run: () => splitTab(key, group) },
    ...(layout.groups.length > 1 || tabs.length > 1
      ? [{ label: t(group === 0 ? 'moveRight' : 'moveLeft'), run: () => moveTab(key, group, other) }] : []),
  ];
};

const resetTreeSelection = (): void => {
  selectedEntries.clear();
  fileTree.querySelectorAll('.tree-row.selected').forEach((selectedRow) => {
    selectedRow.classList.remove('selected');
  });
};

const selectTreeEntry = (entry: GlistFileEntry, row: HTMLButtonElement, event?: MouseEvent): void => {
  const additive = Boolean(event && primaryKey(event));
  if (event?.shiftKey && selectionAnchor) {
    const rows = [...fileTree.querySelectorAll<HTMLButtonElement>('.tree-row[data-path]')]
      .filter((candidate) => candidate.offsetParent !== null);
    const [from, to] = [rows.indexOf(selectionAnchor), rows.indexOf(row)];
    if (from >= 0 && to >= 0) {
      if (!additive) resetTreeSelection();
      rows.slice(Math.min(from, to), Math.max(from, to) + 1).forEach((candidate) => {
        const candidateEntry = treeRowEntries.get(candidate);
        if (!candidateEntry) return;
        selectedEntries.set(candidateEntry.path, candidateEntry);
        candidate.classList.add('selected');
      });
    } else {
      resetTreeSelection();
      selectedEntries.set(entry.path, entry);
      row.classList.add('selected');
      selectionAnchor = row;
    }
    selectedEntry = entry;
  } else if (additive) {
    if (selectedEntries.has(entry.path)) {
      selectedEntries.delete(entry.path);
      row.classList.remove('selected');
      if (selectedEntry?.path === entry.path) selectedEntry = [...selectedEntries.values()].at(-1) ?? null;
    } else {
      selectedEntries.set(entry.path, entry);
      row.classList.add('selected');
      selectedEntry = entry;
    }
    selectionAnchor = row;
  } else {
    resetTreeSelection();
    selectedEntries.set(entry.path, entry);
    row.classList.add('selected');
    selectedEntry = entry;
    selectionAnchor = row;
  }
  updateButtons();
};

const clearTreeSelection = (): void => {
  resetTreeSelection();
  selectedEntry = null;
  selectionAnchor = null;
  updateButtons();
};

const selectedTreeEntries = (): GlistFileEntry[] => [...selectedEntries.values()];
const selectAllVisibleTreeEntries = (): void => {
  resetTreeSelection();
  const rows = [...fileTree.querySelectorAll<HTMLButtonElement>('.tree-row[data-path]')]
    .filter((row) => row.offsetParent !== null);
  rows.forEach((row) => {
    const entry = treeRowEntries.get(row);
    if (!entry) return;
    selectedEntries.set(entry.path, entry);
    row.classList.add('selected');
  });
  selectedEntry = rows.length > 0 ? treeRowEntries.get(rows[rows.length - 1]) ?? null : null;
  selectionAnchor = rows[0] ?? null;
  updateButtons();
};
const topLevelEntries = (entries: GlistFileEntry[]): GlistFileEntry[] => entries.filter((entry) =>
  !entries.some((parent) => parent.path !== entry.path && parent.isDirectory && isWithin(entry.path, parent.path)));
const deletableTreeEntries = (): GlistFileEntry[] =>
  topLevelEntries(selectedTreeEntries().filter((entry) => !isRootFolder(entry.path)));

const showContextMenu = (event: MouseEvent, entry?: GlistFileEntry, row?: HTMLButtonElement): void => {
  event.preventDefault();
  event.stopPropagation();
  if (entry && row) {
    if (!selectedEntries.has(entry.path)) selectTreeEntry(entry, row);
    else { selectedEntry = entry; updateButtons(); }
    row.focus({ preventScroll: true });
  }
  if (!activeProject) return;
  const selection = selectedTreeEntries();
  const single = selection.length === 1;
  const item = (key: TranslationKey, run: () => void, danger = false): MenuEntry => ({ label: t(key), run, danger });
  const gitItems: MenuEntry[] = [];
  // The engine and plugins are repositories of their own, which these do not reach.
  if (single && git.repository && entry && isProjectPath(entry.path)) {
    const change = git.changeOf(entry.path);
    if (!entry.isDirectory && change?.state !== 'untracked') {
      gitItems.push(item('showDiff', () => { void openWorkingDiff(entry.path); }));
      gitItems.push(item('showHistory', () => showGitHistory(entry.path)));
    }
    if (change && change.state !== 'untracked' && change.state !== 'conflict') {
      gitItems.push(item('rollback', async () => {
        if (await confirmDialog(t('confirmRollbackOne').replace('{name}', entry.name))) void git.run({ kind: 'rollback', paths: [entry.path] });
      }));
    }
    if (change?.state === 'untracked' || (entry.isDirectory && !git.isIgnored(entry.path))) {
      gitItems.push(item('addToGitignore', () => { void git.run({ kind: 'ignore', paths: [entry.path] }); }));
    }
  }
  showMenu(event, [
    { label: t('newMenu'), children: [item('newFile', createFile), item('newFolder', createFolder), item('newCppClass', createClass)] },
    'separator',
    ...(selection.length > 0 ? [item('copy', copySelectedEntries)] : []),
    ...(copiedEntryPaths.length > 0 ? [item('paste', pasteCopiedEntries)] : []),
    ...(single && entry && !isRootFolder(entry.path) ? [item('rename', renameSelectedEntry)] : []),
    ...(deletableTreeEntries().length > 0 ? [item('delete', deleteSelectedEntries, true)] : []),
    'separator',
    { label: t('showIn'), children: [item('systemExplorer', showInExplorer), item('integratedTerminal', openIntegratedTerminal)] },
    ...(gitItems.length > 0 ? [{ label: t('menuGit'), children: gitItems }] : []),
  ]);
};

interface TreeRowOptions {
  // Instead of the folder icon, for the engine and plugins.
  icon?: IconName;
}

const createTreeRow = (entry: GlistFileEntry, depth: number, options: TreeRowOptions = {}): HTMLDivElement => {
  const container = document.createElement('div');
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'tree-row';
  row.style.paddingLeft = `${10 + depth * 14}px`;
  // Files and folders move by dragging them onto another folder.
  row.draggable = !isRootFolder(entry.path);
  const arrow = document.createElement('span');
  arrow.className = 'tree-arrow';
  if (entry.isDirectory) arrow.append(icon('chevron-right'));
  let kind = fileIconElement(entry.name);
  if (entry.isDirectory) {
    kind = document.createElement('span');
    kind.className = `file-icon ${options.icon ? 'dependency' : 'folder'}`;
    kind.append(icon(options.icon ?? 'folder'));
  }
  const label = document.createElement('span'); label.className = 'tree-label'; label.textContent = entry.name;
  row.append(arrow, kind, label);
  container.append(row);
  row.dataset.path = entry.path;
  if (entry.isDirectory) row.dataset.directory = 'true';
  treeRowEntries.set(row, entry);
  decorateTreeRow(row);
  const select = (event?: MouseEvent): void => selectTreeEntry(entry, row, event);
  row.addEventListener('contextmenu', (event) => showContextMenu(event, entry, row));

  if (entry.isDirectory) {
    const children = document.createElement('div');
    children.className = 'tree-children'; children.hidden = !expandedDirectories.has(entry.path); container.append(children);
    let loaded = false;
    const loadChildren = async (): Promise<void> => {
      if (!loaded) {
        loaded = true;
        try {
          const entries = await window.glistAPI.listDirectory(entry.path);
          children.append(...entries.map((child) => createTreeRow(child, depth + 1)));
        } catch (error) {
          children.textContent = error instanceof Error ? error.message : String(error);
        }
      }
    };
    const showExpanded = (): void => {
      arrow.classList.toggle('expanded', !children.hidden);
      if (!options.icon) kind.replaceChildren(icon(children.hidden ? 'folder' : 'folder-opened'));
    };
    const toggleExpanded = async (): Promise<void> => {
      children.hidden = !children.hidden;
      if (children.hidden) expandedDirectories.delete(entry.path);
      else expandedDirectories.add(entry.path);
      scheduleSessionSave();
      showExpanded();
      if (!children.hidden) await loadChildren();
    };
    if (!children.hidden) { showExpanded(); void loadChildren(); }
    row.addEventListener('click', select);
    row.addEventListener('dblclick', () => { void toggleExpanded(); });
    arrow.addEventListener('click', (event) => {
      event.stopPropagation();
      select();
      void toggleExpanded();
    });
    // A double click on the arrow is two explicit arrow clicks, not a third
    // toggle from the row's double-click handler.
    arrow.addEventListener('dblclick', (event) => { event.stopPropagation(); });
  } else {
    row.addEventListener('click', select);
    row.addEventListener('dblclick', () => {
      select();
      void openFile(entry.path, entry.name);
    });
  }
  return container;
};

// Explorer rows in Git's colors: changed, new, conflicting or ignored files,
// and folders holding changes.
const decorateTreeRow = (row: HTMLElement): void => {
  const entryPath = row.dataset.path;
  const change = entryPath && git.repository ? git.changeOf(entryPath) : undefined;
  let state: string | undefined = change?.state;
  if (!state && entryPath && git.repository) {
    if (git.isIgnored(entryPath)) state = 'ignored';
    else if (row.dataset.directory) state = git.folderState(entryPath) ?? undefined;
  }
  if (state) row.dataset.git = state; else delete row.dataset.git;
};

// Below the project, like CLion's External Libraries: the engine and the
// plugins the app's CMakeLists.txt names, to browse and read. Collapsed on
// request, and kept so per project.
const dependencySection = async (projectRoot: string): Promise<HTMLElement | null> => {
  let dependencies: GlistDependency[];
  try { dependencies = await window.glistAPI.listDependencies(); } catch { return null; }
  const section = document.createElement('div');
  section.className = 'tree-section';
  const title = document.createElement('button');
  title.type = 'button';
  title.className = 'tree-row tree-section-title';
  const arrow = document.createElement('span');
  arrow.className = 'tree-arrow';
  arrow.append(icon('chevron-right'));
  const label = document.createElement('span');
  label.className = 'tree-label';
  label.textContent = t('dependencies');
  // Marked, so a change of language reaches it without drawing the tree again.
  label.dataset.i18n = 'dependencies';
  title.append(arrow, label);
  const children = document.createElement('div');
  children.className = 'tree-children';
  const collapsedKey = `${projectRoot}#dependencies-collapsed`;
  children.hidden = expandedDirectories.has(collapsedKey);
  arrow.classList.toggle('expanded', !children.hidden);
  title.addEventListener('click', () => {
    children.hidden = !children.hidden;
    if (children.hidden) expandedDirectories.add(collapsedKey); else expandedDirectories.delete(collapsedKey);
    arrow.classList.toggle('expanded', !children.hidden);
  });
  children.append(...dependencies.map((dependency) => {
    const dependencyIcon: IconName = dependency.kind === 'engine' ? 'package' : 'extensions';
    if (dependency.exists) {
      return createTreeRow({ name: dependency.name, path: dependency.path, isDirectory: true }, 0, { icon: dependencyIcon });
    }
    // Named in CMakeLists.txt but not downloaded: the build will stop on it.
    const missing = document.createElement('div');
    missing.className = 'tree-row missing';
    missing.style.paddingLeft = '10px';
    const why: TranslationKey = dependency.kind === 'engine' ? 'engineMissing' : 'pluginMissing';
    missing.dataset.i18nTitle = why;
    missing.title = t(why);
    const warningIcon = document.createElement('span');
    warningIcon.className = 'file-icon dependency';
    warningIcon.append(icon('warning'));
    const name = document.createElement('span');
    name.className = 'tree-label';
    name.textContent = dependency.name;
    missing.append(document.createElement('span'), warningIcon, name);
    return missing;
  }));
  section.append(title, children);
  return section;
};

// Only the latest load fills the tree, so overlapping loads and project
// switches cannot mix their rows.
let treeGeneration = 0;

const loadProjectTree = async (): Promise<void> => {
  if (!activeProject) return;
  treeGeneration += 1;
  const generation = treeGeneration;
  clearTreeSelection();
  let rows: Array<HTMLElement | string>;
  try {
    rows = (await window.glistAPI.listDirectory(activeProject.root)).map((entry) => createTreeRow(entry, 0));
  } catch (error) {
    rows = [`${t('treeFailed')}: ${errorText(error)}`];
  }
  const dependencies = await dependencySection(activeProject.root);
  if (dependencies) rows.push(dependencies);
  if (generation === treeGeneration) {
    // A user can still click the old rows while the asynchronous reload is in
    // progress. Clear that late selection before those rows leave the DOM.
    clearTreeSelection();
    fileTree.replaceChildren(...rows);
  }
};

// The plugins come from CMakeLists.txt, so saving it may change them.
const refreshDependencies = async (): Promise<void> => {
  if (!activeProject) return;
  const section = await dependencySection(activeProject.root);
  const current = fileTree.querySelector('.tree-section');
  if (section && current) current.replaceWith(section);
};

const directoryForNewEntry = (): string | null => {
  if (!activeProject) return null;
  if (!selectedEntry) return activeProject.root;
  if (selectedEntry.isDirectory) return selectedEntry.path;
  return selectedEntry.path.replace(/[\\/][^\\/]+$/, '') || activeProject.root;
};

const revealTargetDirectory = (directory: string): void => {
  if (activeProject && directory !== activeProject.root) expandedDirectories.add(directory);
};

const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error);

const openCmakeFile = (): OpenFile | undefined =>
  activeProject ? findOpenFile(pathUri(joinPath(activeProject.root, 'CMakeLists.txt'))) : undefined;

const saveOpenCmake = async (): Promise<void> => {
  const file = openCmakeFile();
  if (file && isDirty(file)) await saveFile(file);
};

const reloadOpenCmake = async (): Promise<void> => {
  const file = openCmakeFile();
  if (!file) return;
  const contents = await window.glistAPI.readFile(file.path);
  if (file.model.getValue() !== contents) file.model.setValue(contents);
  file.savedVersion = file.model.getAlternativeVersionId();
  refreshDirtyMark(file);
};

const createFile = async (): Promise<void> => {
  const directory = directoryForNewEntry();
  if (!directory) return;
  const name = await requestName('newFile', 'fileName');
  if (!name) return;
  try {
    await saveOpenCmake();
    const createdPath = await window.glistAPI.createFile(directory, name);
    await reloadOpenCmake();
    revealTargetDirectory(directory);
    await loadProjectTree();
    await openFile(createdPath, name);
    noticeDone('fileCreated', createdPath);
  } catch (error) {
    noticeFailed('createFailed', error);
  }
};

const createFolder = async (): Promise<void> => {
  const directory = directoryForNewEntry();
  if (!directory) return;
  const name = await requestName('newFolder', 'folderName', 'NewFolder');
  if (!name) return;
  try {
    const createdPath = await window.glistAPI.createDirectory(directory, name);
    revealTargetDirectory(directory);
    await loadProjectTree();
    noticeDone('folderCreated', createdPath);
  } catch (error) {
    noticeFailed('createFailed', error);
  }
};

const createClass = async (): Promise<void> => {
  const directory = directoryForNewEntry();
  if (!directory) return;
  const className = await requestName('newCppClass', 'className', 'NewClass');
  if (!className) return;
  try {
    await saveOpenCmake();
    const created = await window.glistAPI.createCppClass(directory, className);
    await reloadOpenCmake();
    revealTargetDirectory(directory);
    await loadProjectTree();
    await openFile(created.header, `${className}.h`);
    notify({ text: `${t('classCreated')}: ${className}`, kind: 'success' });
  } catch (error) {
    noticeFailed('createFailed', error);
  }
};

const copySelectedEntries = (): void => {
  const entries = topLevelEntries(selectedTreeEntries());
  if (entries.length === 0) return;
  copiedEntryPaths = entries.map((entry) => entry.path);
  if (entries.length === 1) noticeDone('copied', entries[0].path);
  else notify({
    text: t('copiedItems').replace('{count}', String(entries.length)),
    detail: entries.map((entry) => noticePath(entry.path)).join('\n'),
    kind: 'success',
  });
};

const pasteCopiedEntries = async (): Promise<void> => {
  let directory = directoryForNewEntry();
  if (copiedEntryPaths.length === 0 || !directory) return;
  const copiedHere = copiedEntryPaths.find((entryPath) => isWithin(directory, entryPath) && isWithin(entryPath, directory));
  if (copiedHere) {
    directory = copiedHere.replace(/[\\/][^\\/]+$/, '') || activeProject?.root || directory;
  }
  const pastedPaths: string[] = [];
  try {
    for (const file of fileTabs()) {
      if (copiedEntryPaths.some((entryPath) => isWithin(file.path, entryPath)) && isDirty(file)) await saveFile(file);
    }
    for (const entryPath of copiedEntryPaths) {
      pastedPaths.push(await window.glistAPI.copyEntry(entryPath, directory));
    }
    if (activeProject && directory !== activeProject.root) expandedDirectories.add(directory);
    await loadProjectTree();
    if (pastedPaths.length === 1) noticeDone('pasted', pastedPaths[0]);
    else notify({
      text: t('pastedItems').replace('{count}', String(pastedPaths.length)),
      detail: pastedPaths.map(noticePath).join('\n'),
      kind: 'success',
    });
  } catch (error) {
    await loadProjectTree();
    noticeFailed('copyFailed', error);
  }
};

const showInExplorer = async (): Promise<void> => {
  const target = selectedEntry?.path ?? activeProject?.root;
  if (!target) return;
  try { await window.glistAPI.showInExplorer(target); }
  catch (error) { noticeFailed('showFailed', error); }
};

const openIntegratedTerminal = async (): Promise<void> => {
  const target = selectedEntry?.path ?? activeProject?.root;
  if (!target) return;
  // In a terminal of its own, unless the one showing has not been used yet.
  const tab = shellTab.terminal.used ? addShell() : shellTab;
  const opening = tab.terminal.openAt(target);
  showShell(tab);
  showPanel('terminal');
  try { await opening; }
  catch (error) { noticeFailed('showFailed', error); }
};

const closeFilesUnderEntry = (entryPath: string): void => {
  const closing = [...openFiles.values()].filter((tab) => (tab.kind === 'file' || isFilePageTab(tab)) && isWithin(tab.path, entryPath));
  layout.remove((key) => closing.some((file) => file.path === key));
  showGroups();
  closing.forEach(forgetDocument);
  renderTabs();
  updateButtons();
};

// Follows a rename on disk. Renamed tabs keep their place in the tab strips,
// and where they were scrolled to.
const relocateOpenFiles = (oldPath: string, newPath: string): void => {
  fileTabs().filter((file) => isWithin(file.path, oldPath)).forEach((file) => {
    const nextPath = `${newPath}${file.path.slice(oldPath.length)}`;
    const nextUri = pathUri(nextPath);
    // Only a clangd preview of a file that used to be at the new path can be there.
    monaco.editor.getModel(nextUri)?.dispose();
    addDocument(nextPath, monaco.editor.createModel(file.model.getValue(), languageForFile(nextPath).id, nextUri), false);
    openFiles.delete(file.path);
    layout.rename(file.path, nextPath);
    groupViews.forEach((view) => {
      const state = view.editor.getModel() === file.model ? view.editor.saveViewState() : view.viewStates.get(file.path);
      view.viewStates.delete(file.path);
      if (state !== undefined) view.viewStates.set(nextPath, state);
      if (view.shown === file.path) view.shown = nextPath;
    });
    file.model.dispose();
  });
  // An image's or a model's tab keeps its place, under the new path.
  [...openFiles.values()].filter((tab): tab is FilePageTab => isFilePageTab(tab) && isWithin(tab.path, oldPath)).forEach((tab) => {
    const nextPath = `${newPath}${tab.path.slice(oldPath.length)}`;
    openFiles.delete(tab.path);
    layout.rename(tab.path, nextPath);
    groupViews.forEach((view) => { if (view.shown === tab.path) view.shown = nextPath; });
    Object.assign(tab, { path: nextPath, name: baseName(nextPath) });
    tab.page.name = tab.name;
    if (tab.kind === 'database') tab.page.path = nextPath;
    if (tab.kind === 'media') tab.page.path = nextPath;
    openFiles.set(nextPath, tab);
  });
  showGroups();
  renderTabs();
};

// A database's tab with changes waiting to be committed, as its page last heard.
const hasPending = (tab: EditorTab): tab is DatabaseTab => tab.kind === 'database' && Boolean(tab.page.pending?.open);

// Before databases let go of their files, which rolls back what was not
// committed, each with changes waiting asks: Commit, Discard, or Cancel (and
// Escape), which keeps them waiting and stops what asked: false then. A commit
// that fails throws, its changes still waiting.
const settleDatabases = async (entryPath?: string): Promise<boolean> => {
  const pending = [...openFiles.values()].filter(hasPending).filter((tab) => entryPath === undefined || isWithin(tab.path, entryPath));
  for (const tab of pending) {
    const chosen = await choiceDialog(t('databaseSaveBeforeClosing').replace('{name}', tab.name), [
      { value: 'discard', label: t('databaseDiscard') },
      { value: 'commit', label: t('databaseCommit'), primary: true },
    ]);
    if (!chosen) return false;
    tab.page.pending = await (chosen === 'commit' ? window.glistAPI.databaseCommit(tab.path) : window.glistAPI.databaseDiscard(tab.path));
  }
  return true;
};
const databasesSettled = (entryPath?: string): Promise<boolean> => settleDatabases(entryPath)
  .catch((error: unknown) => { noticeFailed('saveFailed', error); return false; });
// The browser build opens a project in place of the one open, letting go of
// its databases; the app opens it in a window of its own.
const leavingDatabases = (): Promise<boolean> => (window.glistFiles ? Promise.resolve(true) : databasesSettled());

// Renames or moves an entry: changed files in it are saved first, and open
// tabs, copied paths and open folders in it follow it to its new path.
// Databases open in tabs let go of their files first, asking about the changes
// waiting in them: Windows moves and deletes no file that is open. They open
// again when next asked for.
const releaseDatabases = async (entryPath: string): Promise<void> => {
  await Promise.all([...openFiles.values()].filter((tab) => tab.kind === 'database' && isWithin(tab.path, entryPath))
    .map((tab) => window.glistAPI.databaseClose(tab.path)));
};

// Null when a database in it was asked about and Cancel chosen: nothing moves.
const relocateEntry = async (entryPath: string, change: () => Promise<string>): Promise<string | null> => {
  await saveOpenCmake();
  if (!(await settleDatabases(entryPath))) return null;
  await releaseDatabases(entryPath);
  for (const file of fileTabs()) {
    if (isWithin(file.path, entryPath) && isDirty(file)) await saveFile(file);
  }
  const nextPath = await change();
  const moved = (inside: string): string => `${nextPath}${inside.slice(entryPath.length)}`;
  relocateOpenFiles(entryPath, nextPath);
  copiedEntryPaths = copiedEntryPaths.map((copiedPath) =>
    (isWithin(copiedPath, entryPath) ? moved(copiedPath) : copiedPath));
  [...expandedDirectories].filter((folder) => isWithin(folder, entryPath)).forEach((folder) => {
    expandedDirectories.delete(folder);
    expandedDirectories.add(moved(folder));
  });
  await reloadOpenCmake();
  return nextPath;
};

const renameSelectedEntry = async (): Promise<void> => {
  if (!selectedEntry || selectedEntries.size !== 1) return;
  const entry = selectedEntry;
  const newName = await requestName('rename', 'newName', entry.name);
  if (!newName || newName === entry.name) return;
  try {
    const nextPath = await relocateEntry(entry.path, () => window.glistAPI.renameEntry(entry.path, newName));
    if (nextPath === null) return;
    await loadProjectTree();
    notify({ text: t('renamedTo').replace('{from}', entry.name).replace('{to}', baseName(nextPath)), detail: noticePath(nextPath), kind: 'success' });
  } catch (error) {
    noticeFailed('renameFailed', error);
  }
};

// Files and folders dragged onto another folder, moved there together.
const moveEntries = async (entryPaths: string[], folder: string): Promise<void> => {
  const moving = entryPaths.filter((entryPath) => entryPath.replace(/[\\/][^\\/]+$/, '') !== folder);
  if (moving.length === 0) return;
  const movedPaths: string[] = [];
  try {
    for (const entryPath of moving) {
      const movedPath = await relocateEntry(entryPath, () => window.glistAPI.moveEntry(entryPath, folder));
      if (movedPath === null) break;
      movedPaths.push(movedPath);
    }
    if (movedPaths.length === 0) return;
    if (activeProject && folder !== activeProject.root) expandedDirectories.add(folder);
    await loadProjectTree();
    const text = movedPaths.length === 1
      ? t('movedInto').replace('{name}', baseName(movedPaths[0])).replace('{folder}', baseName(folder))
      : t('movedItemsInto').replace('{count}', String(movedPaths.length)).replace('{folder}', baseName(folder));
    notify({ text, detail: movedPaths.map(noticePath).join('\n'), kind: 'success' });
  } catch (error) {
    await loadProjectTree();
    noticeFailed('moveFailed', error);
  }
};

const deleteSelectedEntries = async (): Promise<void> => {
  const entries = deletableTreeEntries();
  if (entries.length === 0) return;
  const description = entries.length === 1
    ? `“${entries[0].name}”: ${t(entries[0].isDirectory ? 'confirmDeleteFolder' : 'confirmDeleteFile')}`
    : t('confirmDeleteItems').replace('{count}', String(entries.length));
  if (!(await confirmDialog(description))) return;
  if ([...openFiles.values()].some((file) => entries.some((entry) => isWithin(file.path, entry.path)) && (isDirty(file) || hasPending(file)))
    && !(await confirmDialog(t('confirmDirtyDelete')))) return;
  const deleted: GlistFileEntry[] = [];
  try {
    const cmakePath = activeProject ? joinPath(activeProject.root, 'CMakeLists.txt') : null;
    if (cmakePath && !entries.some((entry) => isWithin(cmakePath, entry.path))) await saveOpenCmake();
    for (const entry of entries) {
      await releaseDatabases(entry.path);
      await window.glistAPI.deleteEntry(entry.path);
      deleted.push(entry);
      copiedEntryPaths = copiedEntryPaths.filter((copiedPath) => !isWithin(copiedPath, entry.path));
      closeFilesUnderEntry(entry.path);
    }
    await reloadOpenCmake();
    await loadProjectTree();
    if (deleted.length === 1) noticeDone('movedToTrash', deleted[0].path);
    else notify({
      text: t('movedItemsToTrash').replace('{count}', String(deleted.length)),
      detail: deleted.map((entry) => noticePath(entry.path)).join('\n'),
      kind: 'success',
    });
  } catch (error) {
    await reloadOpenCmake().catch((): undefined => undefined);
    await loadProjectTree();
    noticeFailed('deleteFailed', error);
  }
};

const disposeOpenFiles = (): void => {
  layout.clear();
  showGroups();
  openFiles.forEach(disposeTab);
  openFiles.clear();
  groupViews.forEach((view) => view.viewStates.clear());
  renderTabs();
  monaco.editor.getModels().forEach((model) => model.dispose());
};

const hasDirtyFiles = (): boolean => [...openFiles.values()].some(isDirty);

// After a project opens with Glist Engine installed, a star for GlistEngine on GitHub, asked for at most twice.
const askForStar = setUpStarPrompt(
  { dialog: element<HTMLDialogElement>('#star-dialog'), star: element<HTMLButtonElement>('#star-open') },
  () => window.glistAPI.glistStatus().then((status) => status.installed),
  () => { void window.glistAPI.openEngineRepository(); },
);

const openSelectedProject = async (selected: GlistProjectInfo): Promise<void> => {
  await debug.stop();
  // The project left is kept as it was; the new one opens as it was left.
  saveSessionNow();
  restoringSession = true;
  const session = loadSession(selected.root);
  disposeOpenFiles(); activeProject = selected;
  selectedEntry = null;
  copiedEntryPaths = [];
  expandedDirectories.clear();
  session?.expanded.forEach((folder) => expandedDirectories.add(folder));
  projectRootLabel.textContent = selected.name.toUpperCase();
  document.title = `${selected.name} - Glist Studio`;
  shellTabs.forEach((tab) => tab.terminal.projectChanged());
  agentTerminal.projectChanged();
  dependencyFolders = [];
  warnedShared.clear();
  void learnDependencies();
  void engineView.load();
  gitPanel.reload();
  void git.projectChanged().then(() => commitPane.restoreMessage());
  await loadProjectTree(); updateButtons();
  clearOutput(`Glist Studio\n${t('openedProject')}: ${selected.root}\n`);
  if (!selected.hasCMakeProject) notify({ text: t('noCmake') });
  void clangd.start(selected.root);
  debug.setProject(selected.root);
  targetPicker.projectChanged(selected.root);
  runArguments.projectChanged(selected.root, selected.name);
  try { if (session) await restoreSession(session); } finally { restoringSession = false; }
  void askForStar();
};

// A project's last tabs, on the sides they were on, the one in front of each,
// and where each file was scrolled to. A file gone since is left out.
const restoreSession = async (session: ProjectSession): Promise<void> => {
  for (const [index, group] of session.groups.entries()) {
    if (index > 0 && !layout.groups[index]) layout.groups.push({ tabs: [], active: null, transient: null });
    layout.focus(index);
    for (const key of group.tabs) {
      try {
        if (imageType(key)) openImage(key);
        else if (modelType(key)) openModel(key);
        else if (isDatabaseFile(key)) openDatabase(key);
        else if (mediaType(key)) openMedia(key);
        else await loadFile(key);
        // A file open on the other side already gets its tab on this one too.
        layout.add(key, index);
      } catch { /* Gone, or not readable now. */ }
    }
  }
  if (layout.groups.length > 1 && layout.groups[1].tabs.length === 0) layout.groups.splice(1);
  session.groups.forEach((group, index) => {
    if (group.active && layout.groups[index]?.tabs.includes(group.active)) layout.activate(group.active, index);
  });
  if (layout.groups.length > 1) secondGroupView();
  groupViews.forEach((view) => Object.entries(session.views).forEach(([key, state]) => {
    view.viewStates.set(key, state as monaco.editor.ICodeEditorViewState);
  }));
  layout.focus(Math.min(session.focused, layout.groups.length - 1));
  showGroups();
  renderTabs();
  updateButtons();
};

const openProjectWith = async (open: () => Promise<GlistProjectInfo | null>): Promise<void> => {
  try {
    if (!(await leavingDatabases())) return;
    const selected = await open();
    if (selected) await openSelectedProject(selected);
  } catch (error) {
    noticeFailed('projectOpenFailed', error);
  }
};

// Where a new Glist app's code starts: its canvas, gCanvas.h beside gCanvas.cpp,
// with the .cpp in front. Nothing opens for a project without them.
const openCanvas = async (root: string): Promise<void> => {
  const source = joinPath(root, 'src');
  const names = new Set((await window.glistAPI.listDirectory(source).catch((): GlistFileEntry[] => [])).map((entry) => entry.name));
  for (const name of ['gCanvas.h', 'gCanvas.cpp']) {
    if (names.has(name) && !(await openFile(joinPath(source, name), name))) return;
  }
};

// Open Project lists the projects to pick from; Browse opens any other folder.
const showProjectPicker = setUpProjectPicker({
  dialog: element<HTMLDialogElement>('#open-project-dialog'),
  filter: element<HTMLInputElement>('#project-filter'),
  list: element<HTMLElement>('#project-list'),
  empty: element<HTMLElement>('#project-list-empty'),
  browse: element<HTMLButtonElement>('#project-picker-browse'),
  create: element<HTMLButtonElement>('#project-picker-new'),
  cancel: element<HTMLButtonElement>('#project-picker-cancel'),
}, {
  open: (root) => { void openProjectWith(() => window.glistAPI.openProjectPath(root)); },
  browse: () => { void openProjectWith(() => window.glistAPI.openProject()); },
  create: () => showNewProjectDialog(),
});

// Without Glist installed where its scripts put it, the welcome screen and the
// Help menu offer to install it.
let glistInstalled = true;
const glistMissing = element<HTMLElement>('#glist-missing');
const showGlistInstaller = setUpGlistInstaller({
  dialog: element<HTMLDialogElement>('#glist-install-dialog'),
  intro: element<HTMLElement>('#glist-install-intro'),
  password: element<HTMLElement>('#glist-install-password'),
  location: element<HTMLElement>('#glist-install-location'),
  progress: element<HTMLElement>('#glist-install-progress'),
  bar: element<HTMLProgressElement>('#glist-install-bar'),
  step: element<HTMLElement>('#glist-install-step'),
  result: element<HTMLElement>('#glist-install-result'),
  install: element<HTMLButtonElement>('#glist-install-start'),
  openApp: element<HTMLButtonElement>('#glist-install-open'),
  close: element<HTMLButtonElement>('#glist-install-close'),
}, installTerminal, () => {
  glistInstalled = true;
  glistMissing.hidden = true;
}, (root) => {
  const before = activeProject;
  void openProjectWith(() => window.glistAPI.openProjectPath(joinPath(joinPath(root, 'myglistapps'), 'GlistApp')))
    .then(() => { if (activeProject && activeProject !== before) void openCanvas(activeProject.root); });
});
element<HTMLButtonElement>('#install-glist').addEventListener('click', () => { void showGlistInstaller(); });
const pickerClone = element<HTMLButtonElement>('#project-picker-clone');
pickerClone.addEventListener('click', () => {
  element<HTMLDialogElement>('#open-project-dialog').close();
  void cloneProject();
});
void window.glistAPI.glistStatus().then((status) => {
  glistInstalled = status.installed;
  glistMissing.hidden = status.installed;
}).catch((): undefined => undefined);

const chooseProject = async (): Promise<void> => {
  if (!(await saveProjectFiles())) return;
  await showProjectPicker();
};

const showNewProjectDialog = (): void => {
  const location = element<HTMLElement>('#project-location');
  location.textContent = '';
  void window.glistAPI.getProjectsDirectory().then((directory) => { location.textContent = directory; });
  element<HTMLInputElement>('#project-name-input').value = '';
  element<HTMLElement>('#project-dialog-error').textContent = '';
  projectDialog.showModal();
  element<HTMLInputElement>('#project-name-input').focus();
};

const saveActiveFile = async (): Promise<void> => {
  const file = activeFile();
  if (!file || file.readOnly || !isDirty(file)) return;
  try {
    await saveFile(file);
    setProcessStatus(`${file.name} ${t('saved')}`, false);
  } catch (error) {
    noticeFailed('saveFailed', error);
  }
};

// Build and Run compile what is on screen, so every changed tab is saved first.
const saveProjectFiles = async (): Promise<boolean> => {
  try {
    for (const file of fileTabs()) {
      if (!file.readOnly && isDirty(file)) await saveFile(file);
    }
    return true;
  } catch (error) {
    noticeFailed('saveFailed', error);
    return false;
  }
};

// As in JetBrains' IDEs: leaving the window saves every changed file, formatted
// as Ctrl+S formats it (saveFile); coming back reads again the files
// changed on disk meanwhile, other than those with changes not saved yet. Build,
// Run, Debug, Git and the Plugins view save first too, and so does leaving an
// editor (setUpEditor): saving needs no setting.
window.addEventListener('blur', () => { if (activeProject) { void saveProjectFiles(); saveSessionNow(); } });
window.addEventListener('focus', () => { if (activeProject) void reloadOpenFiles(); });

// Keeps a second click from reaching the backend while the first is on its way.
const whileStarting = async (task: () => Promise<void>): Promise<void> => {
  isStarting = true;
  updateButtons();
  try { await task(); } finally { isStarting = false; updateButtons(); }
};

// What the last build printed, to find its first error in.
let buildLog = '';
// Run's entry in the output's list while it builds, then while its program runs.
let startingRun: OutputRun | null = null;
let launchedRun: OutputRun | null = null;

// A failed build says so, with the first compiler error and the way to it.
const noticeBuildFailed = (message: string): void => {
  // eslint-disable-next-line no-control-regex
  const plain = buildLog.replace(/\x1b\[[0-9;]*m/g, '');
  const found = /((?:[A-Za-z]:)?[^\s:()'"<>]+\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx|inl)):(\d+)(?::\d+)?:\s*(?:fatal )?error:\s*(.+)/.exec(plain);
  notify({
    text: t('buildFailed'),
    detail: found ? `${baseName(found[1])}:${found[2]}: ${found[3].trim()}` : message.trim(),
    kind: 'error',
    actions: [
      ...(found ? [{ label: t('goToError'), run: () => openOutputLocation(found[1], Number(found[2])) }] : []),
      { label: t('showOutput'), run: () => showPanel('output') },
    ],
  });
};

// Clean, everything built so far is deleted first, CMake's cache with it.
const buildProject = async (clean = false): Promise<void> => {
  if (!activeProject || isBuildRunning || isStarting) return;
  await whileStarting(async () => {
    if (!(await saveProjectFiles())) return;
    showPanel('output');
    const run = outputHistory.begin(clean ? 'cleanBuild' : 'build');
    appendOutput(outputBanner(t(clean ? 'cleanBuild' : 'outputBuild')), 'normal', run);
    buildLog = '';
    const result = await window.glistAPI.buildProject(clean);
    clangd.buildFinished();
    void targetPicker.refresh();
    // A build can change open files, such as CMakeLists.txt when sources were added.
    void reloadOpenFiles();
    appendOutput(result.message, result.success ? 'success' : 'error', run);
    outputHistory.finish(run, result.success ? 'succeeded' : run.stopRequested ? 'stopped' : 'failed');
    setProcessStatus(t(result.success ? 'buildSucceeded' : 'buildFailed'), false, !result.success);
    if (!result.success) noticeBuildFailed(result.message);
  });
};

const runProject = async (): Promise<void> => {
  if (!activeProject || isRunRunning || isBuildRunning || isStarting) return;
  await whileStarting(async () => {
    if (!(await saveProjectFiles())) return;
    showPanel('output');
    const run = outputHistory.begin('run');
    startingRun = run;
    buildLog = '';
    const result = await window.glistAPI.runProject();
    clangd.buildFinished();
    void targetPicker.refresh();
    void reloadOpenFiles();
    appendOutput(result.message, result.success ? 'success' : 'error', run);
    if (!result.success) {
      if (startingRun === run) startingRun = null;
      outputHistory.finish(run, run.stopRequested ? 'stopped' : 'failed');
      noticeBuildFailed(result.message);
    }
  });
};

const debugProject = async (): Promise<void> => {
  if (!activeProject || debug.active || isBuildRunning || isStarting) return;
  await whileStarting(async () => {
    if (!(await saveProjectFiles())) return;
    showView('debug');
    showPanel('output');
    const run = outputHistory.begin('debug');
    debugRun = run;
    debugExit = undefined;
    appendOutput(outputBanner(t('outputDebug')), 'normal', run);
    await debug.start();
    clangd.buildFinished();
    void targetPicker.refresh();
    void reloadOpenFiles();
  });
};

const stopProject = async (): Promise<void> => {
  outputHistory.running().forEach((run) => { run.stopRequested = true; });
  // A running debug session goes first; while it builds, stopping the build ends it.
  const debugging = debug.active && debug.state !== 'starting';
  if (debugging) await debug.stop();
  const result = await window.glistAPI.stopProject();
  if (result.success || !debugging) appendOutput(result.message, result.success ? 'normal' : 'error');
  if (!result.success && !debugging) notify({ text: result.message, kind: 'error' });
};

const configureResizers = (): void => {
  const shell = element<HTMLElement>('#app-shell');
  const sidebarResizer = element<HTMLDivElement>('#sidebar-resizer');
  const panelResizer = element<HTMLDivElement>('#panel-resizer');
  sidebarResizer.addEventListener('pointerdown', (downEvent) => {
    const startX = downEvent.clientX;
    const current = parseInt(getComputedStyle(shell).getPropertyValue('--sidebar-width'), 10);
    const onMove = (moveEvent: PointerEvent): void => shell.style.setProperty('--sidebar-width', `${Math.min(460, Math.max(180, current + (moveEvent.clientX - startX) / pageZoom()))}px`);
    const onUp = (): void => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
  });
  panelResizer.addEventListener('pointerdown', (downEvent) => {
    const startY = downEvent.clientY;
    const current = parseInt(getComputedStyle(shell).getPropertyValue('--panel-height'), 10);
    // Agents draw full-screen interfaces, so the panel may take most of the window.
    const tallest = Math.max(430, (window.innerHeight / pageZoom()) * 0.75);
    const onMove = (moveEvent: PointerEvent): void => shell.style.setProperty('--panel-height', `${Math.min(tallest, Math.max(110, current + (startY - moveEvent.clientY) / pageZoom()))}px`);
    const onUp = (): void => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
  });
};

const configureMenus = (): void => {
  const shell = element<HTMLElement>('#app-shell');
  const popover = element<HTMLDivElement>('#menu-popover');
  const menuButtons = [...document.querySelectorAll<HTMLButtonElement>('.menu-button, .git-branch-chip')];
  // The branches, read when the branch menu opens.
  let branches: GlistGitBranch[] = [];
  let anchor: HTMLElement | null = null;

  interface MenuAction {
    kind: 'item';
    label: string;
    shortcut?: string;
    hint?: string;
    disabled?: boolean;
    // In macOS's menu bar, the system's own item instead.
    role?: 'undo' | 'redo';
    action: () => void;
  }

  type MenuEntry = MenuAction
    | { kind: 'separator' }
    | { kind: 'heading'; label: string };

  const item = (
    label: string,
    action: () => void,
    options: Omit<MenuAction, 'kind' | 'label' | 'action'> = {},
  ): MenuAction => ({ kind: 'item', label, action, ...options });

  const menuItems = (menu: string): MenuEntry[] => {
    const menus: Record<string, MenuEntry[]> = {
      file: [
        { kind: 'heading', label: t('newMenu') },
        item(t('newProject'), showNewProjectDialog),
        item(t('newFile'), createFile, { disabled: !activeProject }),
        item(t('newFolder'), createFolder, { disabled: !activeProject }),
        item(t('newCppClass'), createClass, { disabled: !activeProject }),
        { kind: 'separator' },
        item(t('openProject'), chooseProject, { shortcut: 'Ctrl+O' }),
        ...(git.enabled ? [item(t('cloneMenu'), () => { void cloneProject(); })] : []),
        item(t('save'), saveActiveFile, { shortcut: 'Ctrl+S', disabled: !activeFile() }),
        { kind: 'separator' },
        // The browser build is one page, which opens no other windows.
        ...(window.glistFiles ? [item(t('newWindow'), () => { void window.glistAPI.newWindow(); })] : []),
        // Exit closes every window, as closing Glist Studio from the taskbar does;
        // a Mac's app menu has Quit for it. The explorer closes a project.
        ...(window.glistFiles && !isMac ? [item(t('exitApp'), () => { void window.glistAPI.quitApp(); })]
          : [item(t('closeProject'), () => { void closeProject(); }, { disabled: !activeProject })]),
      ],
      edit: [
        item(t('undo'), () => currentEditor().trigger('menu', 'undo', null), { shortcut: 'Ctrl+Z', disabled: !activeFile(), role: 'undo' }),
        item(t('redo'), () => currentEditor().trigger('menu', 'redo', null), { shortcut: isMac ? 'Cmd+Shift+Z' : 'Ctrl+Y', disabled: !activeFile(), role: 'redo' }),
        { kind: 'separator' },
        item(t('find'), () => currentEditor().getAction('actions.find')?.run(), { shortcut: 'Ctrl+F', disabled: !activeFile() }),
        item(t('findInFilesMenu'), () => findInFiles.open(), { shortcut: 'Ctrl+Shift+F', disabled: !activeProject }),
        item(t('searchEverywhere'), () => searchEverywhere.open(), { hint: t('doubleShift') }),
        { kind: 'separator' },
        item(t(reformatsSelection() ? 'reformatSelection' : 'reformatFile'), () => { void reformatFile(); }, { shortcut: reformatShortcut, disabled: !canReformat() }),
      ],
      view: [
        { kind: 'heading', label: t('layout') },
        item(t(shell.classList.contains('sidebar-hidden') || sidebarView !== 'explorer' ? 'showExplorer' : 'hideExplorer'),
          toggleExplorer, { shortcut: 'Ctrl+B' }),
        item(t(panelShowing('output') ? 'hideOutput' : 'showOutput'), () => togglePanel('output'), { shortcut: 'Ctrl+J' }),
        item(t('splitEditor'), () => { if (layout.activeKey) splitTab(layout.activeKey); }, { shortcut: 'Ctrl+\\', disabled: !layout.activeKey }),
        item(t(panelShowing('terminal') ? 'hideTerminal' : 'showTerminal'), () => togglePanel('terminal'), {
          shortcut: isMac ? 'Control+`' : 'Ctrl+`',
        }),
        item(t('newTerminal'), newShell, { shortcut: isMac ? 'Control+Shift+`' : 'Ctrl+Shift+`' }),
        ...(agentTab.hidden ? [] : [item(t(panelShowing('agent') ? 'hideAgent' : 'showAgent'), () => togglePanel('agent'))]),
        { kind: 'separator' },
        { kind: 'heading', label: t('zoom') },
        item(t('zoomIn'), () => changeZoom(1), {
          shortcut: 'Ctrl++', disabled: zoomPercentage === zoomLevels[zoomLevels.length - 1],
        }),
        item(t('zoomOut'), () => changeZoom(-1), {
          shortcut: 'Ctrl+-', disabled: zoomPercentage === zoomLevels[0],
        }),
        item(t('resetZoom'), () => setZoom(defaultZoom), {
          shortcut: 'Ctrl+0', hint: percent(zoomPercentage), disabled: zoomPercentage === defaultZoom,
        }),
        { kind: 'separator' },
        item(t('repairReload'), () => { void reloadWindowSafely(); }, { shortcut: 'Ctrl+R' }),
        { kind: 'separator' },
        { kind: 'heading', label: t('preferences') },
        item(t('settings'), () => openSettings()),
      ],
      run: [
        item(t('build'), () => { void buildProject(); }, {
          shortcut: 'Ctrl+Shift+B', disabled: !activeProject || isBuildRunning || isStarting,
        }),
        item(t('cleanBuild'), () => { void buildProject(true); }, { disabled: !activeProject || isBuildRunning || isStarting }),
        item(t('run'), runProject, {
          shortcut: 'F5', disabled: !activeProject || isRunRunning || isBuildRunning || isStarting || !targetPicker.runnable,
        }),
        item(t('debug'), debugProject, {
          shortcut: 'F6', disabled: !activeProject || isBuildRunning || isStarting || debug.active || !targetPicker.runnable,
        }),
        { kind: 'separator' },
        item(t('stop'), stopProject, { shortcut: 'Shift+F5', disabled: !isRunRunning && !isBuildRunning && !debug.active }),
        { kind: 'separator' },
        { kind: 'heading', label: t('debug') },
        item(t('continue'), () => debug.continue(), { shortcut: 'F5', disabled: debug.state !== 'paused' }),
        item(t('pause'), () => debug.pause(), { disabled: debug.state !== 'running' }),
        item(t('stepOver'), () => debug.stepOver(), { shortcut: 'F10', disabled: debug.state !== 'paused' }),
        item(t('stepInto'), () => debug.stepInto(), { shortcut: 'F11', disabled: debug.state !== 'paused' }),
        item(t('stepOut'), () => debug.stepOut(), { shortcut: 'Shift+F11', disabled: debug.state !== 'paused' }),
        item(t('toggleBreakpoint'), () => debug.toggleAtCursor(), { shortcut: 'F9', disabled: !activeFile() }),
      ],
      git: gitMenu(),
      branches: branchMenu(),
      help: [
        ...(glistInstalled ? [] : [item(t('installGlistMenu'), () => { void showGlistInstaller(); })]),
        item(t('engineAbout'), () => { void window.glistAPI.openEngineSite(); }),
        ...(canUpdate() ? [item(t('checkForUpdates'), checkForUpdates)] : []),
        { kind: 'separator' },
        item(t('copyDebugInfo'), () => { void copyDebugInfo(); }),
        ...(window.glistFiles ? [item(t('toggleDevTools'), () => { void window.glistAPI.toggleDevTools(); }, { shortcut: isMac ? 'Cmd+Alt+I' : 'Ctrl+Shift+I' })] : []),
        item(t('repairIde'), () => repair.open()),
        item(t('aboutMenu'), () => openSettings('about')),
      ],
    };
    return menus[menu] ?? [];
  };

  // Git's menu, like JetBrains' Git menu; before there is a repository, how to get one.
  const gitMenu = (): MenuEntry[] => {
    const repository = git.repository;
    if (!repository) {
      return [
        item(t('createRepository'), () => { void git.run({ kind: 'init' }); }, { disabled: !activeProject }),
        item(t('cloneMenu'), () => { void cloneProject(); }),
      ];
    }
    const file = activeFile();
    const change = file ? git.changeOf(file.path) : undefined;
    const tracked = Boolean(trackedFile());
    return [
      item(t('commitMenu'), showCommitView, { shortcut: 'Ctrl+K' }),
      item(t('pushMenu'), () => { void pushChanges(); }, { shortcut: 'Ctrl+Shift+K', disabled: !repository.branch }),
      item(t('updateProject'), () => { void updateProject(); }, { shortcut: 'Ctrl+T', disabled: !repository.upstream }),
      item(t('fetch'), () => { void fetchAll(); }),
      ...(git.dependencies.length > 0 ? [item(t('updateDependencies'), () => { void updateDependencies(); })] : []),
      { kind: 'separator' },
      item(t('newBranch'), () => { void newBranch(); }),
      item(t('branchesMenu'), () => showGitPanel('branches')),
      item(t('stashChanges'), () => { showGitPanel('stashes'); void gitPanel.stash(); }),
      item(t('gitLogMenu'), () => showGitPanel('log')),
      item(t('remotesMenu'), () => showGitPanel('remotes')),
      item(t('applyPatch'), () => { void applyPatchFiles(git); }),
      item(t('applyPatchClipboard'), () => { void applyPatchFromClipboard(git); }),
      { kind: 'separator' },
      { kind: 'heading', label: t('currentFile') },
      item(t('showDiff'), () => { if (file) void openWorkingDiff(file.path); }, { disabled: !tracked }),
      item(t('showHistory'), () => { if (file) showGitHistory(file.path); }, { disabled: !tracked }),
      item(t(gitEditor.isBlaming() ? 'hideAnnotate' : 'annotate'), () => { void gitEditor.toggleBlame(); }, { disabled: !tracked }),
      item(`${t('rollback')}...`, async () => {
        if (file && await confirmDialog(t('confirmRollbackOne').replace('{name}', file.name))) {
          void git.run({ kind: 'rollback', paths: [file.path] }, { root: git.rootOf(file.path) });
        }
      }, { disabled: !change || change.state === 'untracked' || change.state === 'conflict' }),
    ];
  };

  // The title bar's branch: what to do with the repository, and the branches to switch to.
  const branchMenu = (): MenuEntry[] => {
    const repository = git.repository;
    if (!repository) return [];
    const branchItem = (branch: GlistGitBranch): MenuAction => item(branch.name, () => { if (!branch.current) void checkoutRef(branch.name); }, {
      hint: branch.current ? t('currentBranch') : [branch.ahead ? `↑${branch.ahead}` : '', branch.behind ? `↓${branch.behind}` : ''].join(' ').trim(),
    });
    const local = branches.filter((branch) => !branch.remote).sort((left, right) => Number(right.current) - Number(left.current));
    // The twelve remote ones with the latest commits, still in name order.
    const recent = new Set(branches.filter((branch) => branch.remote).sort((left, right) => right.date - left.date).slice(0, 12));
    const remote = branches.filter((branch) => recent.has(branch));
    // Each of the engine and plugins with its branch, opening it in the Git tab.
    const dependencyItem = (dependency: GlistGitRepository): MenuAction => item(dependency.name, () => {
      showPanel('git');
      gitPanel.showRepository(dependency.folder, 'branches');
    }, {
      hint: [branchName(dependency), dependency.ahead ? `↑${dependency.ahead}` : '', dependency.behind ? `↓${dependency.behind}` : ''].join(' ').trim(),
    });
    const dependencies = git.dependencies.length === 0 ? [] : [
      { kind: 'heading' as const, label: t('engineAndPlugins') },
      ...git.dependencies.map(dependencyItem),
      item(t('updateDependencies'), () => { void updateDependencies(); }, { disabled: !git.dependencies.some((dependency) => dependency.upstream) }),
    ];
    return [
      item(t('updateProject'), () => { void updateProject(); }, { shortcut: 'Ctrl+T', disabled: !repository.upstream }),
      item(t('commitMenu'), showCommitView, { shortcut: 'Ctrl+K' }),
      item(t('pushMenu'), () => { void pushChanges(); }, { shortcut: 'Ctrl+Shift+K', disabled: !repository.branch }),
      { kind: 'separator' },
      item(t('newBranch'), () => { void newBranch(); }),
      ...(local.length > 0 ? [{ kind: 'heading' as const, label: t('localBranches') }, ...local.map(branchItem)] : []),
      ...(remote.length > 0 ? [{ kind: 'heading' as const, label: t('remoteBranches') }, ...remote.map(branchItem)] : []),
      ...dependencies,
      { kind: 'separator' },
      item(t('manageBranches'), () => { showPanel('git'); gitPanel.showRepository(undefined, 'branches'); }),
    ];
  };

  const closeMenu = (): void => {
    popover.hidden = true;
    anchor?.classList.remove('active');
    anchor = null;
    menuButtons.forEach((button) => {
      button.classList.remove('active');
      button.setAttribute('aria-expanded', 'false');
    });
  };

  const openMenu = async (button: HTMLElement, menu = button.dataset.menu ?? ''): Promise<void> => {
    if (menu === 'branches') branches = await window.glistAPI.gitBranches().catch((): GlistGitBranch[] => []);
    anchor = button;
    popover.replaceChildren();
    menuItems(menu).forEach((entry) => {
      if (entry.kind === 'separator') {
        const separator = document.createElement('div');
        separator.className = 'menu-separator';
        separator.setAttribute('role', 'separator');
        popover.append(separator);
        return;
      }
      if (entry.kind === 'heading') {
        const heading = document.createElement('div');
        heading.className = 'menu-heading';
        heading.textContent = entry.label;
        popover.append(heading);
        return;
      }
      const itemButton = document.createElement('button');
      itemButton.type = 'button';
      itemButton.className = 'menu-item';
      itemButton.setAttribute('role', 'menuitem');
      itemButton.disabled = Boolean(entry.disabled);
      const label = document.createElement('span');
      label.textContent = entry.label;
      const metadata = document.createElement('span');
      metadata.className = 'menu-metadata';
      if (entry.hint) {
        const hint = document.createElement('span');
        hint.className = 'menu-hint';
        hint.textContent = entry.hint;
        metadata.append(hint);
      }
      const shortcut = document.createElement('kbd');
      shortcut.textContent = shortcutLabel(entry.shortcut ?? '');
      metadata.append(shortcut);
      itemButton.append(label, metadata);
      itemButton.addEventListener('click', () => { closeMenu(); entry.action(); });
      popover.append(itemButton);
    });

    const bounds = button.getBoundingClientRect();
    const zoom = pageZoom();
    popover.hidden = false;
    // Menus of buttons on the right open leftward, to stay in the window.
    popover.style.left = `${Math.max(0, Math.min(bounds.left, window.innerWidth - popover.offsetWidth * zoom - 8)) / zoom}px`;
    popover.style.top = button.closest('.topbar') ? '' : `${(bounds.bottom + 2) / zoom}px`;
    button.classList.add('active');
    button.setAttribute('aria-expanded', 'true');
  };
  showMenuAt = (target, menu) => { closeMenu(); void openMenu(target, menu); };

  // On macOS the same menus go to the system's menu bar, and the title bar
  // keeps only its buttons. Each item's action waits here for its id.
  const nativeActions = new Map<string, () => void>();
  const syncNativeMenu = async (): Promise<void> => {
    nativeActions.clear();
    const menus: GlistAppMenu[] = menuButtons.filter((button) => button.classList.contains('menu-button') && !button.hidden && button.dataset.menu)
      .map((button) => {
        const name = button.dataset.menu ?? '';
        const items = menuItems(name).map((entry, index): GlistAppMenuItem => {
          if (entry.kind !== 'item') return { kind: entry.kind, label: entry.kind === 'heading' ? entry.label : undefined };
          const id = `${name}:${index}`;
          nativeActions.set(id, entry.action);
          return {
            kind: 'item', id, label: entry.hint ? `${entry.label} (${entry.hint})` : entry.label,
            shortcut: entry.shortcut, enabled: !entry.disabled, ...(entry.role ? { role: entry.role } : {}),
          };
        });
        return { name, label: button.textContent ?? name, items };
      });
    const words: GlistAppMenuWords = {
      about: t('aboutMenu'), settings: `${t('settings')}...`, services: t('macServices'), hide: t('macHide'), hideOthers: t('macHideOthers'),
      showAll: t('macShowAll'), quit: t('macQuit'), cut: t('cut'), copy: t('copy'), paste: t('paste'), selectAll: t('selectAll'), window: t('macWindow'),
      minimize: t('macMinimize'), zoom: t('macZoom'), front: t('macFront'),
    };
    const native = await window.glistAPI.setAppMenu(menus, words).catch(() => false);
    document.documentElement.classList.toggle('native-menu', native);
  };
  let menuTimer = 0;
  scheduleMenuSync = () => {
    window.clearTimeout(menuTimer);
    menuTimer = window.setTimeout(() => { void syncNativeMenu(); }, 80);
  };
  window.glistAPI.onMenuCommand((id) => {
    if (id === 'app:about') openSettings('about');
    else if (id === 'app:settings') openSettings();
    else nativeActions.get(id)?.();
  });
  scheduleMenuSync();
  menuCommands = () => menuButtons.filter((button) => button.dataset.menu && button.dataset.menu !== 'branches' && !button.hidden)
    .flatMap((button) => menuItems(button.dataset.menu ?? '')
      .filter((entry): entry is MenuAction => entry.kind === 'item')
      .map((entry) => ({ label: entry.label, category: button.textContent ?? '', shortcut: entry.shortcut, disabled: entry.disabled, run: entry.action })));

  menuButtons.forEach((button) => {
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', 'false');
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const wasOpen = button.classList.contains('active') && !popover.hidden;
      closeMenu();
      if (wasOpen) return;
      void openMenu(button);
    });
    button.addEventListener('pointerenter', () => {
      if (!popover.hidden && !button.classList.contains('active')) {
        closeMenu();
        void openMenu(button);
      }
    });
    button.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowDown') return;
      event.preventDefault();
      if (popover.hidden || !button.classList.contains('active')) {
        closeMenu();
        void openMenu(button).then(() => popover.querySelector<HTMLButtonElement>('.menu-item:not(:disabled)')?.focus());
        return;
      }
      popover.querySelector<HTMLButtonElement>('.menu-item:not(:disabled)')?.focus();
    });
  });

  popover.setAttribute('role', 'menu');
  popover.addEventListener('keydown', (event) => {
    const entries = [...popover.querySelectorAll<HTMLButtonElement>('.menu-item:not(:disabled)')];
    if (entries.length === 0) return;
    const currentIndex = entries.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex: number | null = null;
    if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % entries.length;
    else if (event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + entries.length) % entries.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = entries.length - 1;
    if (nextIndex !== null) {
      event.preventDefault();
      entries[nextIndex].focus();
    }
  });
  document.addEventListener('click', closeMenu);
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || popover.hidden) return;
    const activeButton = menuButtons.find((button) => button.classList.contains('active'));
    closeMenu();
    activeButton?.focus();
  });
  window.addEventListener('blur', closeMenu);
  activityButtons.forEach((button) => button.addEventListener('click', () => toggleView(button.dataset.view as SidebarView)));
};

openButton.addEventListener('click', chooseProject);
emptyOpenButton.addEventListener('click', chooseProject);
emptyNewProjectButton.addEventListener('click', showNewProjectDialog);
saveButton.addEventListener('click', saveActiveFile);
buildButton.addEventListener('click', () => { void buildProject(); });
// Beside Build, its other ways: Clean Build.
buildMenuButton.addEventListener('click', (event) => {
  const disabled = !activeProject || isBuildRunning || isStarting;
  showMenu(event, [
    { label: t('build'), run: () => { void buildProject(); }, disabled },
    { label: t('cleanBuild'), run: () => { void buildProject(true); }, disabled },
  ]);
});
runButton.addEventListener('click', runProject);
stopButton.addEventListener('click', stopProject);
newFileButton.addEventListener('click', createFile);
newFolderButton.addEventListener('click', createFolder);
deleteEntryButton.addEventListener('click', deleteSelectedEntries);
refreshButton.addEventListener('click', loadProjectTree);
clearOutputButton.addEventListener('click', () => {
  const panelTerminal = terminalFor(panelView);
  if (panelTerminal) panelTerminal.clear();
  else clearOutput();
});
// New Terminal opens another shell beside the others; on the Agent tab it starts the agent again.
newTerminalButton.addEventListener('click', () => {
  if (panelView === 'terminal') newShell();
  else void agentTerminal.restart();
});
closeTerminalButton.addEventListener('click', () => { void closeShell(); });
// Beside New Terminal: a terminal with one of the computer's shells, or Settings to choose the default.
newTerminalMenuButton.addEventListener('click', () => {
  void window.glistAPI.terminalShells().then(({ default: fallback, shells }) => {
    const box = newTerminalMenuButton.getBoundingClientRect();
    showMenu({ clientX: box.left, clientY: box.bottom }, [
      { label: t('shellDefaultNamed').replace('{name}', fallback), run: () => newShell() },
      ...shells.map((shell) => ({ label: shell.name, run: () => newShell(shell) })),
      'separator' as const,
      { label: t('chooseDefaultShell'), run: () => openSettings('environment') },
    ]);
  });
});
terminalSelect.addEventListener('change', () => {
  const chosen = shellTabs.find((tab) => tab.session === terminalSelect.value);
  if (chosen) showShell(chosen);
});
document.querySelectorAll<HTMLButtonElement>('.output-tab').forEach((tab) => {
  const view = tab.dataset.panel === 'terminal' || tab.dataset.panel === 'agent' || tab.dataset.panel === 'git' ? tab.dataset.panel : 'output';
  tab.addEventListener('click', () => showPanel(view));
});
element<HTMLButtonElement>('#close-explorer').addEventListener('click', () => setSidebarVisible(false));
debugButton.addEventListener('click', debugProject);
debugStartButton.addEventListener('click', debugProject);
debugContinueButton.addEventListener('click', () => debug.continue());
debugPauseButton.addEventListener('click', () => debug.pause());
debugStepButtons[0].addEventListener('click', () => debug.stepOver());
debugStepButtons[1].addEventListener('click', () => debug.stepInto());
debugStepButtons[2].addEventListener('click', () => debug.stepOut());
element<HTMLButtonElement>('#close-output').addEventListener('click', () => setOutputVisible(false));
const agentSettings = new AgentSettings(
  { options: element<HTMLElement>('#agent-options'), error: element<HTMLElement>('#agent-error') },
  showAgents,
  (text, kind) => appendOutput(text, kind),
);
void agentSettings.refresh();
void setUpUpdates();
// Settings: a page per category, and the last one seen comes back.
const settingsTabs = [...document.querySelectorAll<HTMLButtonElement>('.settings-tab')];
const settingsPages = [...document.querySelectorAll<HTMLElement>('.settings-page')];
const showSettingsPage = (page: string): void => {
  const shown = settingsTabs.some((tab) => tab.dataset.page === page) ? page : 'general';
  settingsTabs.forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.page === shown);
    tab.setAttribute('aria-current', tab.dataset.page === shown ? 'page' : 'false');
  });
  settingsPages.forEach((section) => { section.hidden = section.dataset.page !== shown; });
  try { window.localStorage.setItem('glist-studio-settings-page', shown); } catch { /* Storage may be unavailable. */ }
};
settingsTabs.forEach((tab) => tab.addEventListener('click', () => showSettingsPage(tab.dataset.page ?? 'general')));
showSettingsPage(((): string => { try { return window.localStorage.getItem('glist-studio-settings-page') ?? 'general'; } catch { return 'general'; } })());
// Settings > Environment's variables, and Run and Debug's program arguments for the open project.
new EnvironmentSettings(element<HTMLElement>('#env-entries'), element<HTMLButtonElement>('#env-add'), element<HTMLElement>('#env-error'));
const runArguments = new RunArguments(element<HTMLInputElement>('#run-arguments'), element<HTMLElement>('#run-arguments-hint'));
runArguments.projectChanged(null, '');

// Settings > PATH, whose automatic folders depend on the open project.
const pathSettings = new PathSettings(element<HTMLElement>('#path-entries'), element<HTMLButtonElement>('#path-add'), element<HTMLElement>('#path-error'));
const aboutView = new AboutView(element<HTMLElement>('#about-info'), element<HTMLButtonElement>('#about-copy'));
// Opens Settings, at the page given or the one seen last.
const openSettings = (page?: string): void => {
  if (page) showSettingsPage(page);
  settingsDialog.showModal();
  // An agent may have been installed or removed outside the studio.
  void agentSettings.refresh();
  void showGitSettings();
  void pathSettings.refresh();
  void aboutView.refresh();
};
element<HTMLButtonElement>('#open-settings').addEventListener('click', () => openSettings());
// Its words, in a language just chosen.
settingsLanguage.addEventListener('change', () => { void aboutView.refresh(); });
element<HTMLButtonElement>('#settings-close').addEventListener('click', () => settingsDialog.close());
settingsLanguage.replaceChildren(...Object.entries(languages).map(([code, words]) => new Option(words.name, code)));
settingsLanguage.value = getLanguage();
settingsLanguage.addEventListener('change', () => {
  const next = isLanguage(settingsLanguage.value) ? settingsLanguage.value : 'en';
  applyLanguage(next);
  refreshLanguage();
  scheduleMenuSync();
  // Monaco's own words follow at the next start; saying so once is enough.
  if (next !== editorLanguage) notify({ text: t('editorLanguageRestart') });
  agentSettings.render();
  listShells();
  void listShellChoices();
  outputHistory.render();
  commitPane.render();
  gitPanel.reload();
  // The Plugins and Engine views draw their words when they load; once the backend speaks the language too.
  void window.glistAPI.setLanguage(next).then(() => {
    void pluginsView.load();
    void engineView.load();
  });
});
setUpFontSettings({
  code: element<HTMLInputElement>('#font-code'),
  codeSize: element<HTMLInputElement>('#font-code-size'),
  ligatures: element<HTMLInputElement>('#font-ligatures'),
  interface: element<HTMLInputElement>('#font-interface'),
  codeList: element<HTMLDataListElement>('#font-code-list'),
  interfaceList: element<HTMLDataListElement>('#font-interface-list'),
});
setUpEditorSettings({
  caretStyle: element<HTMLSelectElement>('#caret-style'),
  smoothCaret: element<HTMLInputElement>('#smooth-caret'),
  smoothScrolling: element<HTMLInputElement>('#smooth-scrolling'),
  wordWrap: element<HTMLInputElement>('#word-wrap'),
  minimap: element<HTMLInputElement>('#show-minimap'),
  stickyScroll: element<HTMLInputElement>('#sticky-scroll'),
  reduceMotion: element<HTMLInputElement>('#reduce-motion'),
});

// Settings > General: the folders the explorer and search leave out.
const hiddenFoldersInput = element<HTMLInputElement>('#hidden-folders');
hiddenFoldersInput.value = ((): string => { try { return window.localStorage.getItem('glist-studio-hidden-folders') ?? defaultHiddenFolders.join(', '); } catch { return defaultHiddenFolders.join(', '); } })();
void window.glistAPI.setHiddenFolders(hiddenFoldersInput.value);
// The commit view keeps hidden files' changes out of a commit, here in the page.
setHiddenFolders(hiddenFolderList(hiddenFoldersInput.value));
hiddenFoldersInput.addEventListener('change', () => {
  try { window.localStorage.setItem('glist-studio-hidden-folders', hiddenFoldersInput.value); } catch { /* Storage may be unavailable. */ }
  setHiddenFolders(hiddenFolderList(hiddenFoldersInput.value));
  void window.glistAPI.setHiddenFolders(hiddenFoldersInput.value).then(() => loadProjectTree());
});

// Settings > General: hardware acceleration, which Electron takes only as it
// starts. The browser build has none to turn off, so the setting is hidden there.
void window.glistAPI.startupSettings().then((startup) => {
  if (!startup) return;
  const toggle = element<HTMLInputElement>('#hardware-acceleration');
  const restart = element<HTMLElement>('#hardware-acceleration-restart');
  const showRestart = (): void => { restart.hidden = toggle.checked === startup.running.hardwareAcceleration; };
  element<HTMLElement>('#graphics-settings').hidden = false;
  toggle.checked = startup.saved.hardwareAcceleration;
  showRestart();
  toggle.addEventListener('change', () => {
    void window.glistAPI.setStartupSettings({ hardwareAcceleration: toggle.checked });
    showRestart();
  });
});
setUpThemePicker({
  options: element<HTMLElement>('#theme-options'),
  importButton: element<HTMLButtonElement>('#theme-import'),
  fileInput: element<HTMLInputElement>('#theme-file'),
  error: element<HTMLElement>('#theme-error'),
});
element<HTMLButtonElement>('#project-cancel').addEventListener('click', () => projectDialog.close());
// A new project from a template, opened here; from a window with a project
// already, the main process makes it in a new window instead (index.ts).
const createAndOpen = async (template: GlistTemplate, name: string): Promise<void> => {
  if (!(await leavingDatabases())) return;
  const selected = await window.glistAPI.createProject(template, name);
  if (!selected) return;
  await openSelectedProject(selected);
  notify({ text: `${t('projectCreated')}: ${baseName(selected.root)}`, detail: selected.root, kind: 'success' });
};
element<HTMLFormElement>('#new-project-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!(await saveProjectFiles())) return;
  const name = element<HTMLInputElement>('#project-name-input').value.trim();
  const template = element<HTMLSelectElement>('#project-template').value as GlistTemplate;
  const errorHost = element<HTMLElement>('#project-dialog-error');
  try {
    await createAndOpen(template, name);
    projectDialog.close();
  } catch (error) {
    errorHost.textContent = errorText(error);
  }
});

// A window the main process made for a project, at the start or for one
// opened from another window, opens it first.
void window.glistAPI.windowProject().then(async (first) => {
  if (first?.kind === 'open') await openProjectWith(() => window.glistAPI.openProjectPath(first.root));
  else if (first?.kind === 'create') await createAndOpen(first.template, first.name).catch((error: unknown) => noticeFailed('projectOpenFailed', error));
});

// The project's window closes, saved first; the last window stays, without a project.
const closeProject = async (): Promise<void> => {
  if (!activeProject || !(await saveProjectFiles()) || !(await databasesSettled())) return;
  await window.glistAPI.closeProject();
};
fileTree.addEventListener('click', (event) => {
  if (event.target instanceof Element && event.target.closest('.tree-row')) return;
  clearTreeSelection();
});
fileTree.addEventListener('contextmenu', (event) => {
  if (event.target instanceof Element && event.target.closest('.tree-row')) return;
  clearTreeSelection();
  showContextMenu(event);
});

// Files and folders dragged in from the system's file manager are copied into
// the folder they are dropped on: the folder under the pointer, a file's own
// folder, or the project's when dropped below the list. Electron says where the
// files are, so they are copied from there; a browser gives only their contents,
// which are sent instead.
const externalDrag = (event: DragEvent): boolean => !draggedTab && !draggedEntries && Boolean(event.dataTransfer?.types.includes('Files'));
// A file or folder being dragged within the explorer, which moves it: not into
// itself, nor into the folder it is already in.
let draggedEntries: string[] | null = null;
const moveTarget = (event: DragEvent): string | null => {
  const folder = draggedEntries ? dropFolderAt(event) : null;
  if (!draggedEntries || !folder || draggedEntries.some((entry) => isWithin(folder, entry))) return null;
  return draggedEntries.some((entry) => folder !== entry.replace(/[\\/][^\\/]+$/, '')) ? folder : null;
};
const dropFolderAt = (event: DragEvent): string | null => {
  if (!activeProject) return null;
  const row = event.target instanceof Element ? event.target.closest<HTMLElement>('.tree-row') : null;
  if (!row) return activeProject.root;
  const entryPath = row.dataset.path;
  if (!entryPath || !isEditablePath(entryPath)) return null;
  return row.dataset.directory ? entryPath : entryPath.replace(/[\\/][^\\/]+$/, '');
};
const markDropFolder = (folder: string | null): void => {
  fileTree.classList.toggle('drop-root', folder !== null && folder === activeProject?.root);
  fileTree.querySelectorAll('.tree-row.drop-target').forEach((row) => row.classList.remove('drop-target'));
  if (folder && folder !== activeProject?.root) fileTree.querySelector(`.tree-row[data-path="${CSS.escape(folder)}"]`)?.classList.add('drop-target');
};

// A browser's drop as files to send: each with its place in what was dropped and its bytes in base64.
const base64Of = async (file: File): Promise<string> => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(binary);
};
const readDropped = async (dropped: Array<{ entry: FileSystemEntry | null; file: File | null }>): Promise<Array<{ path: string; data: string }>> => {
  const found: Array<{ path: string; data: string }> = [];
  const walk = async (entry: FileSystemEntry, place: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => { (entry as FileSystemFileEntry).file(resolve, reject); });
      found.push({ path: place, data: await base64Of(file) });
      return;
    }
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => { reader.readEntries(resolve, reject); });
      if (batch.length === 0) return;
      for (const inner of batch) await walk(inner, `${place}/${inner.name}`);
    }
  };
  for (const { entry, file } of dropped) {
    if (entry) await walk(entry, entry.name);
    else if (file) found.push({ path: file.name, data: await base64Of(file) });
  }
  return found;
};

const importDropped = async (dropped: Array<{ entry: FileSystemEntry | null; file: File | null }>, folder: string): Promise<void> => {
  try {
    const paths = dropped.map(({ file }) => (file && window.glistFiles ? window.glistFiles.pathForFile(file) : ''));
    const copied = paths.length > 0 && paths.every(Boolean)
      ? await window.glistAPI.importPaths(paths, folder)
      : await window.glistAPI.importFiles(folder, await readDropped(dropped));
    if (copied.length === 0) return;
    if (activeProject && folder !== activeProject.root) expandedDirectories.add(folder);
    await loadProjectTree();
    notify({
      text: t('copiedInto').replace('{folder}', baseName(folder)),
      detail: copied.map((entry) => baseName(entry)).join(', '),
      kind: 'success',
    });
  } catch (error) {
    noticeFailed('copyFailed', error);
  }
};

fileTree.addEventListener('dragstart', (event) => {
  const row = event.target instanceof Element ? event.target.closest<HTMLElement>('.tree-row[draggable="true"]') : null;
  if (!row?.dataset.path || !event.dataTransfer) return;
  if (!selectedEntries.has(row.dataset.path)) {
    const entry = treeRowEntries.get(row as HTMLButtonElement);
    if (!entry) return;
    selectTreeEntry(entry, row as HTMLButtonElement);
  }
  draggedEntries = deletableTreeEntries().map((entry) => entry.path);
  if (draggedEntries.length === 0) { draggedEntries = null; return; }
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', draggedEntries.join('\n'));
});
fileTree.addEventListener('dragend', () => {
  draggedEntries = null;
  markDropFolder(null);
});
fileTree.addEventListener('dragover', (event) => {
  if (draggedEntries) {
    const folder = moveTarget(event);
    markDropFolder(folder);
    if (!folder || !event.dataTransfer) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    return;
  }
  if (!externalDrag(event)) return;
  const folder = dropFolderAt(event);
  markDropFolder(folder);
  if (!folder || !event.dataTransfer) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
});
fileTree.addEventListener('dragleave', (event) => {
  if (!fileTree.contains(event.relatedTarget as Node | null)) markDropFolder(null);
});
fileTree.addEventListener('drop', (event) => {
  if (draggedEntries) {
    const entries = [...draggedEntries];
    const folder = moveTarget(event);
    draggedEntries = null;
    markDropFolder(null);
    if (!folder) return;
    event.preventDefault();
    void moveEntries(entries, folder);
    return;
  }
  if (!externalDrag(event) || !event.dataTransfer) return;
  event.preventDefault();
  const folder = dropFolderAt(event);
  markDropFolder(null);
  if (!folder) return;
  // What was dropped is only there during the event, so it is taken now and read after.
  const files = [...event.dataTransfer.files];
  const dropped = [...event.dataTransfer.items].filter((item) => item.kind === 'file').map((item, index) => ({
    entry: item.webkitGetAsEntry(), file: item.getAsFile() ?? files[index] ?? null,
  }));
  void importDropped(dropped, folder);
});
projectRootLabel.addEventListener('click', clearTreeSelection);
projectRootLabel.addEventListener('contextmenu', (event) => {
  clearTreeSelection();
  showContextMenu(event);
});

window.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();
  if (primaryKey(event) && !event.altKey && (key === '+' || key === '=')) { event.preventDefault(); changeZoom(1); return; }
  if (primaryKey(event) && !event.altKey && key === '-') { event.preventDefault(); changeZoom(-1); return; }
  if (primaryKey(event) && !event.altKey && key === '0') { event.preventDefault(); setZoom(defaultZoom); return; }
}, { capture: true });

window.addEventListener('keydown', (event) => {
  if (inputDialog.open || projectDialog.open || settingsDialog.open) return;
  if (primaryKey(event) && event.key.toLowerCase() === 'a' && fileTree.contains(document.activeElement)) { event.preventDefault(); selectAllVisibleTreeEntries(); }
  else if (primaryKey(event) && event.key.toLowerCase() === 'c' && selectedEntries.size > 0 && fileTree.contains(document.activeElement)) { event.preventDefault(); copySelectedEntries(); }
  else if (primaryKey(event) && event.key.toLowerCase() === 'v' && copiedEntryPaths.length > 0 && fileTree.contains(document.activeElement)) { event.preventDefault(); pasteCopiedEntries(); }
  else if (primaryKey(event) && event.key.toLowerCase() === 's') { event.preventDefault(); saveActiveFile(); }
  // Reload the Window, not the page bare, which came up without its project. A
  // terminal keeps Ctrl+R, its shell's search of what was typed before.
  else if (primaryKey(event) && !event.altKey && event.key.toLowerCase() === 'r' && !(event.ctrlKey && document.activeElement?.closest('.xterm'))) {
    event.preventDefault();
    void reloadWindowSafely();
  } else if (window.glistFiles && event.key.toLowerCase() === 'i' && (isMac ? event.metaKey && event.altKey : event.ctrlKey && event.shiftKey)) {
    // The developer tools, which Electron's own menu opened before the studio had none on Windows and
    // Linux. In the editor on Linux, Ctrl+Shift+I is Reformat File, which Monaco takes first.
    event.preventDefault();
    void window.glistAPI.toggleDevTools();
  }
  else if (primaryKey(event) && event.key.toLowerCase() === 'o') { event.preventDefault(); chooseProject(); }
  else if (primaryKey(event) && event.shiftKey && event.key.toLowerCase() === 'b') { event.preventDefault(); buildProject(); }
  else if (primaryKey(event) && event.key.toLowerCase() === 'b') { event.preventDefault(); toggleExplorer(); }
  else if (primaryKey(event) && event.key.toLowerCase() === 'j') { event.preventDefault(); togglePanel('output'); }
  // By the key's place left of 1, which types a different character on some layouts.
  else if (event.ctrlKey && event.shiftKey && event.code === 'Backquote') { event.preventDefault(); newShell(); }
  else if (event.ctrlKey && event.code === 'Backquote') { event.preventDefault(); togglePanel('terminal'); }
  else if (event.shiftKey && event.key === 'F5') { event.preventDefault(); stopProject(); }
  else if (event.key === 'F5') { event.preventDefault(); if (debug.state === 'paused') debug.continue(); else runProject(); }
  else if (event.key === 'F6') { event.preventDefault(); debugProject(); }
  // By the key's place, as Alt (Option) changes the character on a Mac.
  else if (isLinux ? primaryKey(event) && event.shiftKey && !event.altKey && event.code === 'KeyI'
    : event.shiftKey && event.altKey && !primaryKey(event) && event.code === 'KeyF') { event.preventDefault(); void reformatFile(); }
  else if (event.key === 'F9') { event.preventDefault(); debug.toggleAtCursor(); }
  else if (event.key === 'F10') { event.preventDefault(); debug.stepOver(); }
  else if (event.shiftKey && event.key === 'F11') { event.preventDefault(); debug.stepOut(); }
  else if (event.key === 'F11') { event.preventDefault(); debug.stepInto(); }
  else if (event.key === 'F2' && selectedEntries.size === 1 && fileTree.contains(document.activeElement)) { event.preventDefault(); renameSelectedEntry(); }
  else if ((event.key === 'Delete' || (isMac && event.metaKey && event.key === 'Backspace')) && selectedEntries.size > 0 && fileTree.contains(document.activeElement)) { event.preventDefault(); deleteSelectedEntries(); }
});
// A mouse wheel notch is one zoom step; a trackpad pinch arrives as many small
// Ctrl+wheel events and has to add up to one first.
let pinchDelta = 0;
window.addEventListener('wheel', (event) => {
  if (!event.ctrlKey || event.deltaY === 0) return;
  event.preventDefault();
  pinchDelta += event.deltaY;
  if (Math.abs(pinchDelta) < 50) return;
  changeZoom(pinchDelta < 0 ? 1 : -1);
  pinchDelta = 0;
}, { passive: false, capture: true });
// Closing with changed files waits for them to be saved, and with changes
// waiting in databases, for them to be committed or discarded (app:save-and-close).
window.addEventListener('beforeunload', (event) => {
  saveSessionNow();
  if (hasDirtyFiles() || [...openFiles.values()].some(hasPending)) { event.preventDefault(); event.returnValue = ''; }
});

window.glistAPI.onBuildOutput((text) => { appendOutput(text); buildLog = (buildLog + text).slice(-200000); });
// Settings > Build: CMake configures again when its files change, unless turned off.
const formatOnSaveInput = element<HTMLInputElement>('#format-on-save');
formatOnSaveInput.checked = formatOnSave();
const codeStyleInput = element<HTMLSelectElement>('#code-style-mode');
codeStyleInput.value = codeStyleMode();
formatOnSaveInput.disabled = codeStyleInput.value === 'none';
codeStyleInput.addEventListener('change', () => {
  try { window.localStorage.setItem('glist-studio-code-style', codeStyleInput.value); } catch { /* Storage may be unavailable. */ }
  formatOnSaveInput.disabled = codeStyleInput.value === 'none';
  // Open files indent in the new style at once.
  fileTabs().forEach((tab) => { void applyCodeStyle(tab); });
});
formatOnSaveInput.addEventListener('change', () => {
  try { window.localStorage.setItem('glist-studio-format-on-save', formatOnSaveInput.checked ? 'on' : 'off'); } catch { /* Storage may be unavailable. */ }
});
const autoConfigureInput = element<HTMLInputElement>('#auto-configure');
autoConfigureInput.checked = ((): boolean => { try { return window.localStorage.getItem('glist-studio-auto-configure') !== 'off'; } catch { return true; } })();
void window.glistAPI.setAutoConfigure(autoConfigureInput.checked);
void setUpDebuggerSettings();
autoConfigureInput.addEventListener('change', () => {
  try { window.localStorage.setItem('glist-studio-auto-configure', autoConfigureInput.checked ? 'on' : 'off'); } catch { /* Storage may be unavailable. */ }
  void window.glistAPI.setAutoConfigure(autoConfigureInput.checked);
});
window.glistAPI.onCompileCommands(() => clangd.compileCommandsChanged());
// Settings > Environment: the shell new terminals start, of those on the computer.
const terminalShellInput = element<HTMLSelectElement>('#terminal-shell');
const chosenShell = ((): string => { try { return window.localStorage.getItem('glist-studio-terminal-shell') ?? ''; } catch { return ''; } })();
void window.glistAPI.setTerminalShell(chosenShell);
const listShellChoices = async (): Promise<void> => {
  const { default: fallback, shells } = await window.glistAPI.terminalShells();
  const chosen = terminalShellInput.value || chosenShell;
  terminalShellInput.replaceChildren(
    new Option(t('shellDefaultNamed').replace('{name}', fallback), ''),
    ...shells.map((shell) => new Option(shell.name, shell.id)),
  );
  terminalShellInput.value = shells.some((shell) => shell.id === chosen) ? chosen : '';
};
void listShellChoices();
terminalShellInput.addEventListener('change', () => {
  try { window.localStorage.setItem('glist-studio-terminal-shell', terminalShellInput.value); } catch { /* Storage may be unavailable. */ }
  void window.glistAPI.setTerminalShell(terminalShellInput.value);
});
const showTargetsInput = element<HTMLInputElement>('#show-targets');
showTargetsInput.checked = targetPicker.shown;
showTargetsInput.addEventListener('change', () => { targetPicker.shown = showTargetsInput.checked; });
const clearOutputOnRunInput = element<HTMLInputElement>('#clear-output-on-run');
clearOutputOnRunInput.checked = clearsOutputOnRun();
clearOutputOnRunInput.addEventListener('change', () => {
  try { window.localStorage.setItem('glist-studio-clear-output', clearOutputOnRunInput.checked ? 'on' : 'off'); } catch { /* Storage may be unavailable. */ }
  outputHistory.modeChanged();
});
// A failure says where to look.
window.glistAPI.onConfigured((result) => {
  clangd.buildFinished();
  void targetPicker.refresh();
  appendOutput(result.message, result.success ? 'success' : 'error');
  if (!result.success) notify({ text: result.message, kind: 'error', actions: [{ label: t('showOutput'), run: () => showPanel('output') }] });
});
window.glistAPI.onBuildStatus((status) => {
  isBuildRunning = status.running; setProcessStatus(status.label, status.running); updateButtons();
});
window.glistAPI.onRunOutput((text) => appendOutput(text, 'normal', launchedRun ?? outputHistory.current));
// What the window shows building and running, made to match the backend: a
// new one runs nothing, and Repair IDE asks the one there is.
const matchProcesses = (building: boolean, running: boolean): void => {
  isBuildRunning = building;
  if (isRunRunning && !running && launchedRun) { outputHistory.finishWithExit(launchedRun, undefined); launchedRun = null; }
  isRunRunning = running;
  if (!building && !running) setProcessStatus(t('ready'), false);
  updateButtons();
};
// Help > Repair IDE (repair.ts), with what it needs of the window.
const repair = setUpRepair({
  projectRoot: () => activeProject?.root ?? null,
  gitEnabled: () => git.enabled,
  saveFiles: () => saveProjectFiles(),
  unsavedFiles: () => hasDirtyFiles(),
  pendingDatabases: () => [...openFiles.values()].filter(hasPending).map((tab) => tab.name),
  settleDatabases: () => databasesSettled(),
  saveSession: () => saveSessionNow(),
  clangd,
  restartClangd: () => (activeProject ? clangd.start(activeProject.root) : Promise.resolve()),
  processes: () => ({
    building: isBuildRunning, running: isRunRunning, debugging: debug.state === 'running' || debug.state === 'paused', terminals: panelTerminals(),
  }),
  matchProcesses,
  stopDebugging: () => debug.stop(),
  showView: (view) => showView(view),
  installGlist: () => { void showGlistInstaller(); },
  build: () => { void buildProject(); },
});
// View > Reload the Window, and Ctrl+R: as Repair IDE's, saving first and
// opening the project again.
const reloadWindowSafely = async (): Promise<void> => {
  if ((await repair.reload()) === 'unsaved') notify({ text: t('repairReloadUnsaved'), kind: 'error' });
};

// The backend stopped by itself, and a new one has the window's settings and
// project again (index.ts): what ran in the old one starts again here, and the
// tabs stay as they are. The notice has the error that stopped it, when it said.
window.glistAPI.onBackendRestarted((error) => {
  // Repair IDE says itself what it restarted, and asked first about databases.
  const asked = repair.restarting();
  if (!asked) {
    notify({
      text: t('backendRestarted'), kind: 'error', ...(error ? { detail: errorMessage(error), error } : {}),
      actions: [{ label: t('repairIde'), run: () => repair.open() }],
    });
  }
  // Changes waiting in databases were in the backend that stopped: gone, and
  // their tabs read their files again.
  const lost = [...openFiles.values()].filter(hasPending);
  lost.forEach((tab) => { tab.page.pending = undefined; tab.version += 1; });
  if (lost.length) {
    if (!asked) notify({ text: t('databaseChangesLost').replace('{name}', lost.map((tab) => tab.name).join(', ')), kind: 'error' });
    showGroups();
  }
  // A build or a program the old one ran ended with it.
  matchProcesses(false, false);
  if (!activeProject) return;
  void debug.stop();
  void clangd.start(activeProject.root);
  shellTabs.forEach((tab) => tab.terminal.projectChanged());
  agentTerminal.projectChanged();
  void git.projectChanged();
  void targetPicker.refresh();
});
window.glistAPI.onSaveAndClose(async () => {
  if (await saveProjectFiles() && await databasesSettled()) window.close();
});
window.glistAPI.onRunStatus((status) => {
  isRunRunning = status.running;
  // The program started, or ended: its run in the list says how.
  if (status.running && startingRun) { launchedRun = startingRun; startingRun = null; }
  else if (!status.running && launchedRun) { outputHistory.finishWithExit(launchedRun, status.exitCode); launchedRun = null; }
  const suffix = status.exitCode !== undefined ? ` · ${t('exit')} ${status.exitCode}` : '';
  setProcessStatus(status.running ? t('running') : `${t('ready')}${suffix}`, status.running);
  updateButtons();
});

const renderBranchChip = (repository: GlistGitRepository | null): void => {
  branchChip.hidden = !repository;
  if (!repository) return;
  const name = document.createElement('span');
  name.className = 'git-branch-name';
  name.textContent = branchName(repository);
  branchChip.replaceChildren(icon('git-branch'), name);
  if (repository.ahead) branchChip.append(icon('arrow-up'), String(repository.ahead));
  if (repository.behind) branchChip.append(icon('arrow-down'), String(repository.behind));
  branchChip.classList.toggle('busy', Boolean(repository.operation));
  branchChip.title = `${t('branchChipTitle').replace('{branch}', name.textContent)}\n${t('aheadBehind')
    .replace('{ahead}', String(repository.ahead)).replace('{behind}', String(repository.behind))}`;
};

const applyGitEnabled = (enabled: boolean): void => {
  commitActivity.hidden = !enabled;
  gitTab.hidden = !enabled;
  gitMenuButton.hidden = !enabled;
  pickerClone.hidden = !enabled;
  if (!enabled) {
    if (sidebarView === 'commit') showView('explorer');
    if (panelView === 'git') showPanel('output');
  }
  scheduleMenuSync();
};

git.onEnabled(applyGitEnabled);
git.onStatus((status) => {
  scheduleMenuSync();
  renderBranchChip(status?.repository ?? null);
  fileTree.querySelectorAll<HTMLElement>('.tree-row[data-path]').forEach(decorateTreeRow);
  diffsInFront().filter((diff) => diff.target === null).forEach((diff) => { void fillDiff(diff); });
  [...openFiles.values()].forEach((tab) => { if (tab.kind === 'database-diff') tab.page.check(); });
});
applyGitEnabled(git.enabled);
if (git.enabled) {
  void window.glistAPI.gitWatch(true);
  void git.refresh();
}

// JetBrains' keys: Ctrl+K commits, Ctrl+Shift+K pushes, Ctrl+T updates. Taken
// before the editor sees them, but not from a terminal, where they edit the line.
window.addEventListener('keydown', (event) => {
  if (!git.enabled || !primaryKey(event) || event.altKey || document.querySelector('dialog[open]')) return;
  if (document.activeElement?.closest('.terminal-host')) return;
  const key = event.key.toLowerCase();
  const run = (task: () => void): void => { event.preventDefault(); event.stopPropagation(); task(); };
  if (key === 'k' && !event.shiftKey) run(showCommitView);
  else if (key === 'k' && event.shiftKey && git.repository) run(() => { void pushChanges(); });
  else if (key === 't' && !event.shiftKey && git.repository) run(() => { void updateProject(); });
}, { capture: true });

// The command palette's commands: the menus' and, with a file open, the
// editor's, the studio's own first and then the rest of Monaco's, in Monaco's words.
const paletteCommands = (): PaletteCommand[] => {
  if (!activeFile()) return menuCommands();
  const category = t('editorCommands');
  const target = currentEditor();
  // Reformat is the Edit menu's too, which lists it already.
  const own = editorCommands(target, editorMenuHooks).filter((command) => command.id !== 'glist.reformat');
  // Monaco's Format Document and Format Selection are Reformat File's, which leaves #includes where they are.
  const listed = new Set([...own.map((command) => command.id), 'editor.action.quickCommand', 'actions.find',
    'editor.action.formatDocument', 'editor.action.formatSelection']);
  const rest = target.getSupportedActions()
    .filter((action) => action.label && !listed.has(action.id))
    .sort((left, right) => left.label.localeCompare(right.label))
    .map((action) => ({ label: action.label, category, run: () => { target.focus(); void action.run(); } }));
  return [...menuCommands(), ...own.map((command) => ({ ...command, category })), ...rest];
};
const commandPalette = new CommandPalette(paletteCommands);

// Find in Files, on Ctrl+Shift+F.
const findInFiles = new FindInFiles({
  search: (query) => window.glistAPI.searchText(query),
  unsaved: () => [...openFiles.values()].flatMap((tab) => (tab.kind === 'file' && isDirty(tab) ? [{ path: tab.path, text: tab.model.getValue() }] : [])),
  model: (filePath) => loadModel(pathUri(filePath)),
  open: (filePath, range) => { void revealLocation(pathUri(filePath), range, true); },
  selection: () => {
    if (!activeFile()) return '';
    const target = currentEditor();
    const selection = target.getSelection();
    if (!selection || selection.isEmpty() || selection.startLineNumber !== selection.endLineNumber) return '';
    return target.getModel()?.getValueInRange(selection) ?? '';
  },
});

// Search Everywhere, on a double Shift. A symbol's declaration is read from its
// file, the editor's text when it is open, and kept a little while for the next letters typed.
const declarations = new Map<string, { read: number; text: Promise<string> }>();
const declaredText = (filePath: string): Promise<string> => {
  const open = monaco.editor.getModel(pathUri(filePath));
  if (open) return Promise.resolve(open.getValue());
  const kept = declarations.get(filePath);
  if (kept && Date.now() - kept.read < 30000) return kept.text;
  const text = readContents(filePath).catch(() => '');
  declarations.set(filePath, { read: Date.now(), text });
  return text;
};
const searchEverywhere = new SearchEverywhere({
  files: () => (activeProject ? window.glistAPI.listFiles(true) : Promise.resolve([])),
  recent: () => [...new Set([layout.activeKey, ...layout.keys()])]
    .filter((key): key is string => typeof key === 'string' && openFiles.get(key)?.kind === 'file'),
  symbols: async (query) => {
    if (clangd.waitingForBuild) return 'build';
    const found = await clangd.workspaceSymbols(query);
    if (!found) return 'off';
    const hits = found.map((symbol): SymbolHit => {
      const filePath = uriPath(monaco.Uri.parse(symbol.location.uri));
      return {
        name: symbol.name, kind: symbol.kind, container: symbol.containerName ?? '', path: filePath,
        line: symbol.location.range.start.line, character: symbol.location.range.start.character,
        place: isProjectPath(filePath) ? 'project' : dependencyFolderOf(filePath) ? 'glist' : 'system',
      };
    });
    // The project's own first, then the engine's and plugins', then the system's, each in clangd's order.
    const order: SymbolHit['place'][] = ['project', 'glist', 'system'];
    return order.flatMap((place) => hits.filter((hit) => hit.place === place));
  },
  signature: async (hit) => declarationAt(await declaredText(hit.path), hit.line, hit.character),
  commands: paletteCommands,
  // A file or a symbol chosen opens transient, as a search result does.
  openFile: (filePath, line, column) => {
    void revealLocation(pathUri(filePath), line ? { lineNumber: line, column: column ?? 1 } : undefined, true);
  },
});

// Ctrl+\ opens the tab in front on the other side too, as in VS Code. In a
// terminal Ctrl+\ stops the program, so it stays there; a Mac's Cmd+\ does not clash.
window.addEventListener('keydown', (event) => {
  if (!primaryKey(event) || event.altKey || event.shiftKey || event.key !== '\\' || document.querySelector('dialog[open]')) return;
  if (!isMac && document.activeElement?.closest('.terminal-host')) return;
  const key = layout.activeKey;
  if (!key) return;
  event.preventDefault();
  event.stopPropagation();
  splitTab(key);
}, { capture: true });

// Ctrl+P, Ctrl+Shift+P or F1 opens it from anywhere, before the editor sees
// them. In a terminal Ctrl+P recalls the previous line, so it stays there;
// a Mac's Cmd+P does not clash.
window.addEventListener('keydown', (event) => {
  const inTerminal = Boolean(document.activeElement?.closest('.terminal-host'));
  const wanted = (event.key === 'F1' && !event.shiftKey && !event.altKey && !primaryKey(event))
    || (primaryKey(event) && !event.altKey && event.key.toLowerCase() === 'p' && (event.shiftKey || isMac || !inTerminal));
  if (!wanted || (document.querySelector('dialog[open]') && !commandPalette.isOpen)) return;
  event.preventDefault();
  event.stopPropagation();
  commandPalette.toggle();
}, { capture: true });

// Ctrl+Shift+F finds text in the project's files, from anywhere.
window.addEventListener('keydown', (event) => {
  if (!primaryKey(event) || !event.shiftKey || event.altKey || event.key.toLowerCase() !== 'f') return;
  if (!activeProject || document.querySelector('dialog[open]')) return;
  event.preventDefault();
  event.stopPropagation();
  findInFiles.open();
}, { capture: true });

// Shift pressed and let go twice, with no other key or click between, opens
// Search Everywhere, as in JetBrains' IDEs.
let shiftAlone = false;
let shiftTapped = 0;
window.addEventListener('keydown', (event) => {
  if (event.key === 'Shift') {
    if (!event.repeat) shiftAlone = !event.ctrlKey && !event.altKey && !event.metaKey;
    return;
  }
  shiftAlone = false;
  shiftTapped = 0;
}, { capture: true });
window.addEventListener('keyup', (event) => {
  if (event.key !== 'Shift') return;
  const tapped = shiftAlone;
  shiftAlone = false;
  if (!tapped) { shiftTapped = 0; return; }
  if (performance.now() - shiftTapped > 400) { shiftTapped = performance.now(); return; }
  shiftTapped = 0;
  if (!document.querySelector('dialog[open]')) searchEverywhere.open();
}, { capture: true });
window.addEventListener('pointerdown', () => { shiftAlone = false; shiftTapped = 0; }, { capture: true });

// Settings > Git: turning it on, and the name and email commits are signed with.
const gitEnabledInput = element<HTMLInputElement>('#git-enabled');
const gitOptions = element<HTMLElement>('#git-options');
const gitVersion = element<HTMLElement>('#git-version');
const gitName = element<HTMLInputElement>('#git-name');
const gitEmail = element<HTMLInputElement>('#git-email');
const gitSettingsError = element<HTMLElement>('#git-settings-error');
const gitUpdateMerge = element<HTMLInputElement>('#git-update-merge');
const gitUpdateRebase = element<HTMLInputElement>('#git-update-rebase');
const gitProtect = element<HTMLInputElement>('#git-protect');
const gitProtectedBranches = element<HTMLInputElement>('#git-protected-branches');
const showGitSettings = async (): Promise<void> => {
  gitEnabledInput.checked = git.enabled;
  gitOptions.hidden = !git.enabled;
  gitVersion.hidden = !git.enabled;
  gitUpdateMerge.checked = !git.updateByRebase;
  gitUpdateRebase.checked = git.updateByRebase;
  gitProtect.checked = git.protection.on;
  gitProtectedBranches.value = git.protection.branches.join(', ');
  gitProtectedBranches.disabled = !git.protection.on;
  gitSettingsError.textContent = '';
  // Off, it runs nothing, not even to see whether git is there.
  if (!git.enabled) return;
  const status = await window.glistAPI.gitStatus().catch((): null => null);
  gitVersion.textContent = status?.version ? t('gitFound').replace('{version}', status.version) : t('gitNotFound');
  gitVersion.classList.toggle('missing', !status?.version);
  const identity = await window.glistAPI.gitIdentity().catch((): GlistGitIdentity => ({ name: '', email: '' }));
  gitName.value = identity.name;
  gitName.placeholder = identity.suggestedName ?? '';
  gitEmail.value = identity.email;
};
gitEnabledInput.addEventListener('change', () => {
  git.setEnabled(gitEnabledInput.checked);
  void showGitSettings();
});
const saveProtection = (): void => {
  git.protection = { on: gitProtect.checked, branches: gitProtectedBranches.value.split(',').map((name) => name.trim()).filter(Boolean) };
  gitProtectedBranches.disabled = !gitProtect.checked;
};
gitProtect.addEventListener('change', saveProtection);
gitProtectedBranches.addEventListener('change', saveProtection);
[gitName, gitEmail].forEach((input) => input.addEventListener('change', async () => {
  const result = await window.glistAPI.gitRun({ kind: 'identity', name: gitName.value, email: gitEmail.value });
  gitSettingsError.textContent = result.success ? '' : result.message;
}));
[gitUpdateMerge, gitUpdateRebase].forEach((input) => input.addEventListener('change', () => { git.updateByRebase = gitUpdateRebase.checked; }));

configureResizers();
configureMenus();
updateButtons();
// Styled, themed and in its language: the page can show (index.html hides it until now).
document.documentElement.classList.add('ready');
