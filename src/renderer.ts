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
import { codeFontStack, loadFonts, onFontsChange, panelFontSize, setUpFontSettings, type FontSettings } from './fonts';
import { formatOutput, newOutputStyle } from './output-format';
import { fileIconElement } from './file-icons';
import { icon, placeIcons, type IconName } from './icons';
import { Debugger } from './debugger';
import { setHostPlatform } from './host';
import { baseName, isWithin, joinPath, pathUri, uriPath } from './paths';
import { isMac, primaryKey, shortcutLabel } from './shortcuts';
import { setUpGlistInstaller } from './glist-installer';
import { GitClient } from './git-client';
import { branchName, CommitView } from './git-commit-view';
import { cloneDialog, formDialog, identityDialog, pushDialog, type PushEntry } from './git-dialogs';
import { GitEditor } from './git-editor';
import { GitPanel, type GitPanelView } from './git-panel';
import { notify, type Notice } from './notifications';
import { setUpProjectPicker } from './project-picker';
import { StudioTerminal } from './terminal';
import { terminalTheme } from './themes';
import { applyLanguage, getLanguage, t, type TranslationKey } from './localization';
import './index.css';

interface OpenFile {
  kind: 'file';
  path: string;
  name: string;
  model: monaco.editor.ITextModel;
  // The model's alternative version id when it matched the file on disk.
  savedVersion: number;
  readOnly: boolean;
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
}

type EditorTab = OpenFile | DiffTab;

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
const runButton = element<HTMLButtonElement>('#run-project');
const stopButton = element<HTMLButtonElement>('#stop-project');
const debugButton = element<HTMLButtonElement>('#debug-project');
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
const diffView = element<HTMLElement>('#diff-view');
const diffHost = element<HTMLElement>('#diff-host');
const diffMessage = element<HTMLElement>('#diff-message');
const diffRollbackButton = element<HTMLButtonElement>('#diff-rollback');
const diffOpenButton = element<HTMLButtonElement>('#diff-open');
const commitViewElement = element<HTMLElement>('#commit-view');
const commitActivity = element<HTMLButtonElement>('#commit-activity');
const gitTab = element<HTMLButtonElement>('#git-tab');
const gitPanelElement = element<HTMLElement>('#git-panel');
const gitMenuButton = element<HTMLButtonElement>('#git-menu-button');
const branchChip = element<HTMLButtonElement>('#git-branch-chip');
const output = element<HTMLPreElement>('#output');
const projectRootLabel = element<HTMLDivElement>('#project-root-label');
const processStatus = element<HTMLSpanElement>('#process-status');
const clangdStatus = element<HTMLSpanElement>('#clangd-status');
const contextMenu = element<HTMLDivElement>('#explorer-context-menu');
const inputDialog = element<HTMLDialogElement>('#input-dialog');
const inputForm = element<HTMLFormElement>('#input-form');
const inputValue = element<HTMLInputElement>('#input-dialog-value');
const projectDialog = element<HTMLDialogElement>('#new-project-dialog');
const settingsDialog = element<HTMLDialogElement>('#settings-dialog');
const settingsLanguage = element<HTMLSelectElement>('#settings-language');
element<HTMLImageElement>('#app-icon').src = appIconUrl;
element<HTMLImageElement>('#welcome-icon').src = appIconUrl;

let activeProject: GlistProjectInfo | null = null;
let activeFilePath: string | null = null;
let selectedEntry: GlistFileEntry | null = null;
let copiedEntryPath: string | null = null;
let isBuildRunning = false;
let isRunRunning = false;
// Build or Run was pressed and the backend has not taken it over yet.
let isStarting = false;
const openFiles = new Map<string, EditorTab>();
const fileTabs = (): OpenFile[] => [...openFiles.values()].filter((tab): tab is OpenFile => tab.kind === 'file');
// The file tab in front, if the tab in front is one.
const activeFile = (): OpenFile | undefined => {
  const tab = activeFilePath ? openFiles.get(activeFilePath) : undefined;
  return tab?.kind === 'file' ? tab : undefined;
};
const expandedDirectories = new Set<string>();
let draggedTabPath: string | null = null;
let suppressTabClick = false;

type SidebarView = 'explorer' | 'debug' | 'commit';
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
  setSidebarVisible(true);
  if (view === 'commit') void git.refresh();
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
const clearOutputButton = element<HTMLButtonElement>('#clear-output');
const studioTerminal = new StudioTerminal(terminalHost, 'shell');
const agentTerminal = new StudioTerminal(agentHost, 'agent', 'agentExited');
// Glist Engine's installer, in its dialog; it runs once per click, never on a key.
const installTerminal = new StudioTerminal(element<HTMLDivElement>('#install-terminal'), 'install', 'terminalExited', false);
[studioTerminal, agentTerminal, installTerminal].forEach((panelTerminal) => {
  onThemeChange((theme) => panelTerminal.setTheme(terminalTheme(theme.palette, theme.kind)));
  onFontsChange((fonts) => panelTerminal.setFont(codeFontStack(fonts), panelFontSize(fonts)));
});
const terminalFor = (view: PanelView): StudioTerminal | null =>
  (view === 'terminal' ? studioTerminal : view === 'agent' ? agentTerminal : null);

const panelShowing = (view: PanelView): boolean => !appShell.classList.contains('output-hidden') && panelView === view;

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
  newTerminalButton.hidden = view === 'output' || view === 'git';
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
  scaleSlider.setAttribute('aria-valuetext', `${zoomPercentage}%`);
  scaleValue.textContent = `${zoomPercentage}%`;
  scaleDown.disabled = index === 0;
  scaleUp.disabled = index === zoomLevels.length - 1;
  scaleReset.disabled = zoomPercentage === defaultZoom;
  zoomIndicator.hidden = zoomPercentage === defaultZoom;
  const label = document.createElement('span');
  label.textContent = `${zoomPercentage}%`;
  zoomIndicator.replaceChildren(icon(zoomPercentage > defaultZoom ? 'zoom-in' : 'zoom-out'), label);
};

placeIcons();
registerCmakeLanguage();
applyTheme(getActiveTheme());

const setZoom = (percentage: number): void => {
  const closest = zoomLevels.reduce((best, level) => (
    Math.abs(level - percentage) < Math.abs(best - percentage) ? level : best
  ), defaultZoom);
  zoomPercentage = closest;
  try { window.localStorage.setItem('glist-studio-zoom', String(closest)); } catch { /* Storage may be unavailable. */ }
  void window.glistAPI.setZoomFactor(closest / 100);
  studioTerminal.setScale(pageZoom());
  showZoom();
};

const changeZoom = (direction: -1 | 1): void => {
  const currentIndex = zoomLevels.findIndex((level) => level === zoomPercentage);
  const nextIndex = Math.min(zoomLevels.length - 1, Math.max(0, currentIndex + direction));
  setZoom(zoomLevels[nextIndex]);
};

// A drag applies on release: zooming under the pointer would move the slider away from it.
const sliderZoom = (): number => zoomLevels[Number(scaleSlider.value)] ?? defaultZoom;
scaleSlider.addEventListener('input', () => { scaleValue.textContent = `${sliderZoom()}%`; });
scaleSlider.addEventListener('change', () => setZoom(sliderZoom()));
scaleDown.addEventListener('click', () => changeZoom(-1));
scaleUp.addEventListener('click', () => changeZoom(1));
scaleReset.addEventListener('click', () => setZoom(defaultZoom));
zoomIndicator.addEventListener('click', () => setZoom(defaultZoom));

applyLanguage(getLanguage());
void window.glistAPI.setLanguage(getLanguage());
void window.glistAPI.getPlatform().then((platform) => {
  setHostPlatform(platform);
  applyLanguage(getLanguage());
});
setZoom(zoomPercentage);

const refreshLanguage = (): void => {
  applyLanguage(getLanguage());
  if (!activeProject) {
    projectRootLabel.textContent = t('projectPlaceholder');
    if (output.textContent === '' || output.textContent.includes('Glist Studio is ready')
      || output.textContent.includes('Glist Studio hazır')) clearOutput(t('initialOutput'));
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
    if (submit) submit.textContent = titleKey === 'rename' ? t('rename') : t('create');
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

const editor = monaco.editor.create(editorHost, {
  automaticLayout: true,
  // Colors from clangd for functions, types, members and the like.
  'semanticHighlighting.enabled': true,
  // Matching brackets share a color, by how deep they are nested.
  bracketPairColorization: { enabled: true },
  minimap: { enabled: true, scale: 1 },
  // Room for breakpoints.
  glyphMargin: true,
  smoothScrolling: true,
  cursorSmoothCaretAnimation: 'on',
  padding: { top: 14, bottom: 20 },
  renderWhitespace: 'selection',
  scrollBeyondLastLine: false,
  tabSize: 4,
});

// Appends a text node; rewriting textContent made long builds quadratic.
let outputStyle = newOutputStyle();

const clearOutput = (text = ''): void => {
  output.textContent = text;
  outputStyle = newOutputStyle();
};

// Opens a file named in the output, relative to the project when not absolute.
const openOutputLocation = (filePath: string, line: number): void => {
  if (!activeProject) return;
  const absolute = /^([a-zA-Z]:[\\/]|[\\/])/.test(filePath) ? filePath : joinPath(activeProject.root, filePath);
  void revealLocation(pathUri(absolute), { lineNumber: line, column: 1 });
};

// Appends nodes; rewriting textContent made long builds quadratic.
const appendOutput = (text: string, kind: 'normal' | 'success' | 'error' = 'normal'): void => {
  if (kind === 'normal') output.append(...formatOutput(text, outputStyle, openOutputLocation));
  else {
    const message = document.createElement('span');
    message.className = kind === 'success' ? 'ansi-green' : 'ansi-red';
    message.append(...formatOutput(`${kind === 'success' ? '✓' : '✕'} ${text}`, newOutputStyle(), openOutputLocation));
    output.append('\n', message, '\n');
  }
  output.scrollTop = output.scrollHeight;
};

const setProcessStatus = (label: string, active: boolean, error = false): void => {
  processStatus.classList.toggle('active', active);
  processStatus.classList.toggle('error', error);
  const labelNode = processStatus.querySelector('span');
  if (labelNode) labelNode.textContent = label;
};

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
    cmake: { id: 'cmake', label: 'CMake' },
  };
  return languages[extension] ?? { id: 'plaintext', label: 'Plain Text' };
};

const isDirty = (tab: EditorTab): boolean => tab.kind === 'file' && tab.model.getAlternativeVersionId() !== tab.savedVersion;

const updateButtons = (): void => {
  const hasProject = Boolean(activeProject);
  saveButton.disabled = !activeFile();
  buildButton.disabled = !hasProject || isBuildRunning || isStarting;
  runButton.disabled = !hasProject || isRunRunning || isBuildRunning || isStarting;
  debugButton.disabled = !hasProject || isBuildRunning || isStarting || debug.active;
  debugStartButton.disabled = debugButton.disabled;
  stopButton.disabled = !isBuildRunning && !isRunRunning && !debug.active;
  debugControls.hidden = !debug.active || debug.state === 'starting';
  debugContinueButton.disabled = debug.state !== 'paused';
  debugPauseButton.disabled = debug.state !== 'running';
  debugStepButtons.forEach((button) => { button.disabled = debug.state !== 'paused'; });
  refreshButton.disabled = !hasProject;
  newFileButton.disabled = !hasProject;
  newFolderButton.disabled = !hasProject;
  deleteEntryButton.disabled = !selectedEntry;
};

const activateFile = (filePath: string): void => {
  const tab = openFiles.get(filePath);
  if (!tab) return;
  activeFilePath = filePath;
  welcome.hidden = true;
  if (tab.kind === 'diff') {
    editorHost.classList.remove('visible');
    showDiffTab(tab);
  } else {
    diffView.hidden = true;
    editor.setModel(tab.model);
    editor.updateOptions({ readOnly: tab.readOnly });
    editorHost.classList.add('visible');
    // Measured now, not on the next frame, so a line can be revealed right away.
    editor.layout();
  }
  renderTabs();
  updateButtons();
  if (tab.kind === 'file') editor.focus();
};

// The welcome screen, once no tab is left.
const showNoTab = (): void => {
  editor.setModel(null);
  diffEditor?.setModel(null);
  editorHost.classList.remove('visible');
  diffView.hidden = true;
  welcome.hidden = false;
};

const disposeTab = (tab: EditorTab): void => {
  if (tab.kind === 'file') { tab.model.dispose(); return; }
  if (diffEditor?.getModel()?.modified === tab.modified) diffEditor.setModel(null);
  tab.original.dispose();
  tab.modified.dispose();
};

const closeFile = (filePath: string): void => {
  const file = openFiles.get(filePath);
  if (!file) return;
  if (isDirty(file) && !window.confirm(`${file.name} ${t('confirmClose')}`)) return;
  const paths = [...openFiles.keys()];
  const closingIndex = paths.indexOf(filePath);
  openFiles.delete(filePath);
  disposeTab(file);
  if (activeFilePath === filePath) {
    const remaining = [...openFiles.keys()];
    const next = remaining[Math.min(closingIndex, remaining.length - 1)];
    activeFilePath = null;
    if (next) activateFile(next);
    else showNoTab();
  }
  renderTabs();
  updateButtons();
};

const clearTabDropIndicators = (): void => {
  tabsHost.classList.remove('drop-at-end');
  tabsHost.querySelectorAll('.drop-before, .drop-after').forEach((tab) => {
    tab.classList.remove('drop-before', 'drop-after');
  });
};

const moveOpenFileTab = (sourcePath: string, targetPath?: string, placeAfter = false): void => {
  if (sourcePath === targetPath) return;
  const sourceEntry = [...openFiles.entries()].find(([filePath]) => filePath === sourcePath);
  if (!sourceEntry) return;
  const reordered = [...openFiles.entries()].filter(([filePath]) => filePath !== sourcePath);
  if (targetPath) {
    const targetIndex = reordered.findIndex(([filePath]) => filePath === targetPath);
    if (targetIndex < 0) return;
    reordered.splice(targetIndex + (placeAfter ? 1 : 0), 0, sourceEntry);
  } else reordered.push(sourceEntry);
  openFiles.clear();
  reordered.forEach(([filePath, file]) => openFiles.set(filePath, file));
  renderTabs();
};

const renderTabs = (): void => {
  tabsHost.replaceChildren();
  openFiles.forEach((file) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.draggable = true;
    tab.className = 'editor-tab';
    tab.dataset.path = file.path;
    tab.classList.toggle('active', file.path === activeFilePath);
    tab.classList.toggle('read-only', file.kind === 'file' && file.readOnly);
    tab.classList.toggle('diff', file.kind === 'diff');
    if (file.kind === 'diff') tab.title = `${file.file}\n${file.leftLabel} / ${file.rightLabel}`;
    else tab.title = file.readOnly ? `${file.path} (${t('readOnly')})` : file.path;
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
    close.addEventListener('click', (event) => { event.stopPropagation(); closeFile(file.path); });
    let kind = fileIconElement(file.name);
    if (file.kind === 'diff') {
      kind = document.createElement('span');
      kind.className = 'file-icon diff';
      kind.append(icon('diff'));
    }
    tab.append(kind, label, dirty, close);
    tab.addEventListener('click', () => { if (!suppressTabClick) activateFile(file.path); });
    tab.addEventListener('dragstart', (event) => {
      draggedTabPath = file.path;
      suppressTabClick = true;
      event.dataTransfer?.setData('text/plain', file.path);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
      requestAnimationFrame(() => tab.classList.add('dragging'));
    });
    tab.addEventListener('dragover', (event) => {
      if (!draggedTabPath || draggedTabPath === file.path) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      clearTabDropIndicators();
      const bounds = tab.getBoundingClientRect();
      tab.classList.add(event.clientX < bounds.left + bounds.width / 2 ? 'drop-before' : 'drop-after');
    });
    tab.addEventListener('drop', (event) => {
      if (!draggedTabPath) return;
      event.preventDefault();
      event.stopPropagation();
      const bounds = tab.getBoundingClientRect();
      moveOpenFileTab(draggedTabPath, file.path, event.clientX >= bounds.left + bounds.width / 2);
      clearTabDropIndicators();
    });
    tab.addEventListener('dragend', () => {
      tab.classList.remove('dragging');
      draggedTabPath = null;
      clearTabDropIndicators();
      window.setTimeout(() => { suppressTabClick = false; }, 0);
    });
    tabsHost.append(tab);
  });
};

tabsHost.addEventListener('dragover', (event) => {
  if (!draggedTabPath) return;
  const bounds = tabsHost.getBoundingClientRect();
  if (event.clientX < bounds.left + 28) tabsHost.scrollLeft -= 14;
  else if (event.clientX > bounds.right - 28) tabsHost.scrollLeft += 14;
  if (event.target instanceof Element && event.target.closest('.editor-tab')) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  clearTabDropIndicators();
  tabsHost.classList.add('drop-at-end');
});

tabsHost.addEventListener('drop', (event) => {
  if (!draggedTabPath || (event.target instanceof Element && event.target.closest('.editor-tab'))) return;
  event.preventDefault();
  moveOpenFileTab(draggedTabPath);
  clearTabDropIndicators();
});

const isProjectPath = (filePath: string): boolean =>
  Boolean(activeProject && isWithin(filePath, activeProject.root));

const readContents = (filePath: string): Promise<string> => (isProjectPath(filePath)
  ? window.glistAPI.readFile(filePath) : window.glistAPI.readWorkspaceFile(filePath));

// The engine's and plugins' folders the open project names. Neither builds on
// its own, so their work happens from an app, and their files can be edited
// here; other files in the Glist folder, such as zbin's, stay read-only.
let dependencyFolders: string[] = [];
let dependenciesKnown: Promise<void> = Promise.resolve();

const learnDependencies = (): Promise<void> => {
  dependenciesKnown = window.glistAPI.listDependencies()
    .then((dependencies) => { dependencyFolders = dependencies.filter((dependency) => dependency.exists).map((dependency) => dependency.path); })
    .catch(() => { dependencyFolders = []; });
  return dependenciesKnown;
};

// The engine's or plugin's folder a file is in, if any.
const dependencyFolderOf = (filePath: string): string | undefined => dependencyFolders.find((folder) => isWithin(filePath, folder));

const isEditablePath = (filePath: string): boolean => isProjectPath(filePath) || Boolean(dependencyFolderOf(filePath));

// The first change to the engine or a plugin in a session says that it is shared.
const warnedShared = new Set<string>();
// Tabs being read again from disk, which is not a change anyone made.
const reloading = new Set<OpenFile>();

// clangd and the explorer may spell one path differently, the URI does not.
const findOpenFile = (uri: monaco.Uri): OpenFile | undefined =>
  fileTabs().find((file) => file.model.uri.toString() === uri.toString());

// Gives a file a tab without switching to it. Files outside the project, the
// engine and its plugins open read-only.
const loadFile = async (filePath: string): Promise<OpenFile> => {
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
  const added = addTab(filePath, model, !isEditablePath(filePath));
  renderTabs();
  return added;
};

const refreshDirtyMark = (file: OpenFile): void => {
  const tab = [...tabsHost.children].find((child) => (child as HTMLElement).dataset.path === file.path);
  const mark = tab?.querySelector('.dirty-dot');
  mark?.classList.toggle('visible', isDirty(file));
};

// Opens a tab on a model that matches the file on disk, without switching to it.
const addTab = (filePath: string, model: monaco.editor.ITextModel, readOnly: boolean): OpenFile => {
  const file: OpenFile = { kind: 'file', path: filePath, name: baseName(filePath), model, savedVersion: model.getAlternativeVersionId(), readOnly };
  openFiles.set(filePath, file);
  model.onDidChangeContent(() => {
    refreshDirtyMark(file);
    const folder = dependencyFolderOf(file.path);
    if (folder && !warnedShared.has(folder) && isDirty(file) && !reloading.has(file)) {
      warnedShared.add(folder);
      notify({ text: t('sharedEdit').replace('{name}', baseName(folder)) });
    }
  });
  clangd.track(model);
  return file;
};

// The text is taken once, so anything typed while it is written stays unsaved.
const saveFile = async (file: OpenFile): Promise<void> => {
  const version = file.model.getAlternativeVersionId();
  await window.glistAPI.writeFile(file.path, file.model.getValue());
  file.savedVersion = version;
  clangd.saved(file.model);
  refreshDirtyMark(file);
  if (baseName(file.path) === 'CMakeLists.txt' && isProjectPath(file.path)) void learnDependencies().then(refreshDependencies);
  void git.refresh();
};

// Opening a tab takes a moment; the last one asked for comes to the front,
// not whichever finished loading last.
let navigation = 0;

const openFile = async (filePath: string, name: string): Promise<boolean> => {
  navigation += 1;
  const ticket = navigation;
  try {
    const file = await loadFile(filePath);
    // Another tab was asked for meanwhile, so nothing is placed in this one.
    if (ticket !== navigation) return false;
    activateFile(file.path);
    return true;
  } catch (error) {
    appendOutput(`\n${t('fileOpenFailed')}: ${name}: ${error instanceof Error ? error.message : String(error)}\n`, 'error');
    return false;
  }
};

const revealLocation = async (uri: monaco.Uri, selection?: monaco.IRange | monaco.IPosition): Promise<boolean> => {
  const filePath = uriPath(uri);
  if (!(await openFile(filePath, baseName(filePath)))) return false;
  if (!selection) return true;
  if ('startLineNumber' in selection) {
    editor.setSelection(selection);
    editor.revealRangeInCenterIfOutsideViewport(selection);
  } else {
    editor.setPosition(selection);
    editor.revealPositionInCenterIfOutsideViewport(selection);
  }
  return true;
};

const clangd = new ClangdClient({
  loadModel: async (uri) => {
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
  },
  openForEdit: async (uri) => {
    const filePath = uriPath(uri);
    if (!isProjectPath(filePath)) return null;
    try { return (await loadFile(filePath)).model; } catch { return null; }
  },
  log: (text) => appendOutput(`\n${text}\n`),
  status: (text, busy) => {
    clangdStatus.hidden = !text;
    clangdStatus.classList.toggle('active', busy);
    const label = clangdStatus.querySelector('span');
    if (label) label.textContent = text ?? '';
  },
});

const debug = new Debugger({
  editor,
  openLocation: (filePath, line) => revealLocation(pathUri(filePath), { lineNumber: line, column: 1 }),
  log: (text, kind) => appendOutput(text, kind),
  changed: () => updateButtons(),
  views: {
    status: element<HTMLElement>('#debug-status'),
    variables: element<HTMLElement>('#debug-variables'),
    stack: element<HTMLElement>('#debug-stack'),
    breakpoints: element<HTMLElement>('#debug-breakpoints'),
  },
});

// Diff tabs share one diff editor, made the first time one opens.
let diffEditor: monaco.editor.IStandaloneDiffEditor | null = null;
let diffInline = ((): boolean => { try { return window.localStorage.getItem('glist-studio-diff-inline') === 'on'; } catch { return false; } })();

const diffFonts = (fonts: FontSettings): monaco.editor.IDiffEditorOptions => ({
  fontFamily: codeFontStack(fonts),
  fontSize: fonts.codeSize,
  lineHeight: Math.round(fonts.codeSize * 1.57),
  fontLigatures: fonts.ligatures,
});

const ensureDiffEditor = (): monaco.editor.IStandaloneDiffEditor => {
  if (diffEditor) return diffEditor;
  diffEditor = monaco.editor.createDiffEditor(diffHost, {
    automaticLayout: true,
    readOnly: true,
    originalEditable: false,
    renderSideBySide: !diffInline,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    ...diffFonts(loadFonts()),
  });
  onFontsChange((fonts) => diffEditor?.updateOptions(diffFonts(fonts)));
  return diffEditor;
};

const activeDiff = (): DiffTab | undefined => {
  const tab = activeFilePath ? openFiles.get(activeFilePath) : undefined;
  return tab?.kind === 'diff' ? tab : undefined;
};

const showDiffTab = (tab: DiffTab): void => {
  diffView.hidden = false;
  const viewer = ensureDiffEditor();
  element<HTMLElement>('#diff-left').textContent = tab.leftLabel;
  element<HTMLElement>('#diff-right').textContent = tab.rightLabel;
  diffMessage.hidden = !tab.message;
  diffMessage.textContent = tab.message;
  const change = git.changeOf(tab.file);
  diffRollbackButton.hidden = tab.target !== null || !change || change.state === 'untracked' || change.state === 'conflict';
  diffOpenButton.disabled = tab.target === null && change?.state === 'deleted';
  if (viewer.getModel()?.modified === tab.modified) return;
  viewer.setModel({ original: tab.original, modified: tab.modified });
  // A diff opens at its first change, once it is known.
  const shown = viewer.onDidUpdateDiff(() => {
    shown.dispose();
    if (viewer.getModel()?.modified === tab.modified) viewer.revealFirstDiff();
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
  tab.leftLabel = tab.base ? versionLabel(tab.base, left, tab.file) : t('diffMissing');
  tab.rightLabel = versionLabel(tab.target, right, tab.file);
  tab.message = [left, right].some((version) => version.binary) ? t('diffBinary')
    : [left, right].some((version) => version.tooLarge) ? t('diffTooLarge') : '';
  if (activeFilePath === tab.path) showDiffTab(tab);
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
  const existing = openFiles.get(key);
  if (existing?.kind === 'diff') {
    await fillDiff(existing);
    if (ticket === navigation) activateFile(key);
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
  await fillDiff(tab);
  if (ticket === navigation) activateFile(key);
  else renderTabs();
};

// A file against its last commit.
const openWorkingDiff = (filePath: string): Promise<void> => {
  const change = git.changeOf(filePath);
  return openGitDiff({ file: filePath, from: change?.from, base: git.repositoryOf(filePath)?.head ? 'HEAD' : null, target: null });
};

element<HTMLButtonElement>('#diff-previous').addEventListener('click', () => diffEditor?.goToDiff('previous'));
element<HTMLButtonElement>('#diff-next').addEventListener('click', () => diffEditor?.goToDiff('next'));
element<HTMLButtonElement>('#diff-layout').addEventListener('click', () => {
  diffInline = !diffInline;
  try { window.localStorage.setItem('glist-studio-diff-inline', diffInline ? 'on' : 'off'); } catch { /* Storage may be unavailable. */ }
  diffEditor?.updateOptions({ renderSideBySide: !diffInline });
});
diffOpenButton.addEventListener('click', () => {
  const tab = activeDiff();
  if (!tab) return;
  const line = diffEditor?.getModifiedEditor().getPosition()?.lineNumber
    ?? diffEditor?.getModifiedEditor().getVisibleRanges()[0]?.startLineNumber ?? 1;
  void revealLocation(pathUri(tab.file), { lineNumber: line, column: 1 });
});
diffRollbackButton.addEventListener('click', () => {
  const tab = activeDiff();
  if (!tab || !window.confirm(t('confirmRollbackOne').replace('{name}', tab.name))) return;
  void git.run({ kind: 'rollback', paths: [tab.file] }, { root: git.rootOf(tab.file) });
});

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
  const diff = activeDiff();
  if (diff) await fillDiff(diff);
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

// The engine and plugins, from their remotes. They are shared by every project, so
// this is its own command and asks first, instead of being part of Update Project.
const updateDependencies = async (): Promise<void> => {
  const targets = git.dependencies.filter((repository) => repository.upstream);
  if (targets.length === 0) { notify({ text: t('noDependencyUpstream') }); return; }
  if (!window.confirm(t('confirmUpdateDependencies').replace('{names}', targets.map((repository) => repository.name).join(', ')))) return;
  for (const repository of targets) {
    await git.run({ kind: 'pull', rebase: git.updateByRebase }, {
      root: repository.folder,
      busy: 'updating',
      success: t('updatedRepository').replace('{name}', repository.name).replace('{upstream}', repository.upstream ?? ''),
    });
  }
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
  if (hasDirtyFiles() && !window.confirm(t('confirmProjectSwitch'))) return;
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
    appendOutput(`\n✓ ${t('movedToTrash')}: ${filePath}\n`);
  } catch (error) {
    appendOutput(`\n${t('deleteFailed')}: ${errorText(error)}\n`, 'error');
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
      const line = opened ? (editor.getModel()?.getLinesContent().findIndex((text) => text.startsWith('<<<<<<<')) ?? -1) : -1;
      if (line < 0) return;
      editor.revealLineInCenter(line + 1);
      editor.setPosition({ lineNumber: line + 1, column: 1 });
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
  openCommitDiff: (file, base, commit) => { void openGitDiff({ file: file.path, from: file.from, base: file.state === 'added' ? null : base, target: commit }); },
  push: () => { void pushChanges(); },
  update: () => { void updateProject(); },
  newBranch: (start, label, root) => { void newBranch(start, label, root); },
  checkout: (ref, root) => { void checkoutRef(ref, root); },
});

const gitEditor = new GitEditor(editor, git, {
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

monaco.editor.registerEditorOpener({
  openCodeEditor: (_source, resource, selectionOrPosition) => revealLocation(resource, selectionOrPosition),
});

editor.addAction({
  id: 'glist.switchSourceHeader',
  label: t('switchSourceHeader'),
  keybindings: [monaco.KeyMod.Alt | monaco.KeyCode.KeyO],
  precondition: 'editorLangId == cpp',
  contextMenuGroupId: 'navigation',
  run: async () => {
    const model = editor.getModel();
    const target = model && await clangd.switchSourceHeader(model);
    if (target) await revealLocation(target);
  },
});

const selectTreeEntry = (entry: GlistFileEntry, row: HTMLButtonElement): void => {
  fileTree.querySelectorAll('.tree-row.selected').forEach((selectedRow) => {
    selectedRow.classList.remove('selected');
  });
  row.classList.add('selected');
  selectedEntry = entry;
  updateButtons();
};

const clearTreeSelection = (): void => {
  selectedEntry = null;
  fileTree.querySelectorAll('.tree-row.selected').forEach((row) => row.classList.remove('selected'));
  updateButtons();
};

const closeContextMenu = (): void => { contextMenu.hidden = true; };

const showContextMenu = (event: MouseEvent, entry?: GlistFileEntry, row?: HTMLButtonElement): void => {
  event.preventDefault();
  event.stopPropagation();
  if (entry && row) { selectTreeEntry(entry, row); row.focus({ preventScroll: true }); }
  if (!activeProject) return;
  contextMenu.replaceChildren();
  const addItem = (key: TranslationKey, action: () => void, danger = false): void => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `context-item${danger ? ' danger' : ''}`;
    item.textContent = t(key);
    item.addEventListener('click', () => { closeContextMenu(); action(); });
    contextMenu.append(item);
  };
  const addSubmenu = (key: TranslationKey, children: Array<{ key: TranslationKey; action: () => void }>): void => {
    const group = document.createElement('div');
    group.className = 'context-group';
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'context-item has-submenu';
    trigger.append(t(key), icon('chevron-right'));
    trigger.setAttribute('aria-haspopup', 'menu');
    trigger.addEventListener('click', (clickEvent) => {
      clickEvent.stopPropagation();
      group.classList.toggle('expanded');
    });
    const submenu = document.createElement('div');
    submenu.className = 'context-submenu';
    children.forEach(({ key: childKey, action }) => {
      const child = document.createElement('button');
      child.type = 'button';
      child.className = 'context-item';
      child.textContent = t(childKey);
      child.addEventListener('click', () => { closeContextMenu(); action(); });
      submenu.append(child);
    });
    group.append(trigger, submenu);
    contextMenu.append(group);
  };
  addSubmenu('newMenu', [
    { key: 'newFile', action: createFile },
    { key: 'newFolder', action: createFolder },
    { key: 'newCppClass', action: createClass },
  ]);
  if (entry) {
    const separator = document.createElement('div');
    separator.className = 'context-separator';
    contextMenu.append(separator);
    addItem('copy', copySelectedEntry);
  }
  if (copiedEntryPath) addItem('paste', pasteCopiedEntry);
  if (entry) {
    addItem('rename', renameSelectedEntry);
    addItem('delete', deleteSelectedEntry, true);
  }
  const separator = document.createElement('div');
  separator.className = 'context-separator';
  contextMenu.append(separator);
  addSubmenu('showIn', [
    { key: 'systemExplorer', action: showInExplorer },
    { key: 'commandPrompt', action: openCommandPrompt },
  ]);
  if (git.repository && entry) {
    const change = git.changeOf(entry.path);
    const items: Array<{ key: TranslationKey; action: () => void }> = [];
    if (!entry.isDirectory && change?.state !== 'untracked') {
      items.push({ key: 'showDiff', action: () => { void openWorkingDiff(entry.path); } });
      items.push({ key: 'showHistory', action: () => showGitHistory(entry.path) });
    }
    if (change && change.state !== 'untracked' && change.state !== 'conflict') {
      items.push({
        key: 'rollback',
        action: () => {
          if (window.confirm(t('confirmRollbackOne').replace('{name}', entry.name))) void git.run({ kind: 'rollback', paths: [entry.path] });
        },
      });
    }
    if (change?.state === 'untracked' || (entry.isDirectory && !git.isIgnored(entry.path))) {
      items.push({ key: 'addToGitignore', action: () => { void git.run({ kind: 'ignore', paths: [entry.path] }); } });
    }
    if (items.length > 0) addSubmenu('menuGit', items);
  }
  contextMenu.hidden = false;
  const zoom = pageZoom();
  const width = contextMenu.offsetWidth * zoom;
  const height = contextMenu.offsetHeight * zoom;
  const left = Math.max(0, Math.min(event.clientX, window.innerWidth - width - 6));
  contextMenu.classList.toggle('submenu-left', left + width + 210 * zoom > window.innerWidth);
  contextMenu.style.left = `${left / zoom}px`;
  contextMenu.style.top = `${Math.max(0, Math.min(event.clientY, window.innerHeight - height - 6)) / zoom}px`;
};

// Rows of the engine and plugins are read-only: they list through the
// workspace, offer no file operations, and open files read-only.
interface TreeRowOptions {
  readOnly?: boolean;
  // Instead of the folder icon, for the engine and plugins.
  icon?: IconName;
}

const createTreeRow = (entry: GlistFileEntry, depth: number, options: TreeRowOptions = {}): HTMLDivElement => {
  const container = document.createElement('div');
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'tree-row';
  row.style.paddingLeft = `${10 + depth * 14}px`;
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
  decorateTreeRow(row);
  const select = (): void => {
    if (!options.readOnly) { selectTreeEntry(entry, row); return; }
    // Selecting one would aim New File and Delete at the engine.
    clearTreeSelection();
    row.classList.add('selected');
  };
  if (!options.readOnly) row.addEventListener('contextmenu', (event) => showContextMenu(event, entry, row));

  if (entry.isDirectory) {
    const children = document.createElement('div');
    children.className = 'tree-children'; children.hidden = !expandedDirectories.has(entry.path); container.append(children);
    let loaded = false;
    const loadChildren = async (): Promise<void> => {
      if (!loaded) {
        loaded = true;
        try {
          const entries = await (options.readOnly ? window.glistAPI.listWorkspaceDirectory(entry.path) : window.glistAPI.listDirectory(entry.path));
          children.append(...entries.map((child) => createTreeRow(child, depth + 1, { readOnly: options.readOnly })));
        } catch (error) {
          children.textContent = error instanceof Error ? error.message : String(error);
        }
      }
    };
    const showExpanded = (): void => {
      arrow.classList.toggle('expanded', !children.hidden);
      if (!options.icon) kind.replaceChildren(icon(children.hidden ? 'folder' : 'folder-opened'));
    };
    if (!children.hidden) { showExpanded(); void loadChildren(); }
    row.addEventListener('click', async () => {
      select();
      children.hidden = !children.hidden;
      if (children.hidden) expandedDirectories.delete(entry.path);
      else expandedDirectories.add(entry.path);
      showExpanded();
      if (!children.hidden) await loadChildren();
    });
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
      return createTreeRow({ name: dependency.name, path: dependency.path, isDirectory: true }, 0, { readOnly: true, icon: dependencyIcon });
    }
    // Named in CMakeLists.txt but not downloaded: the build will stop on it.
    const missing = document.createElement('div');
    missing.className = 'tree-row missing';
    missing.style.paddingLeft = '10px';
    missing.title = t(dependency.kind === 'engine' ? 'engineMissing' : 'pluginMissing');
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
  if (generation === treeGeneration) fileTree.replaceChildren(...rows);
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
    appendOutput(`\n✓ ${t('fileCreated')}: ${createdPath}\n`);
  } catch (error) {
    appendOutput(`\n${t('createFailed')}: ${errorText(error)}\n`, 'error');
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
    appendOutput(`\n✓ ${t('folderCreated')}: ${createdPath}\n`);
  } catch (error) {
    appendOutput(`\n${t('createFailed')}: ${errorText(error)}\n`, 'error');
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
    appendOutput(`\n✓ ${t('classCreated')}: ${className}\n`);
  } catch (error) {
    appendOutput(`\n${t('createFailed')}: ${errorText(error)}\n`, 'error');
  }
};

const copySelectedEntry = (): void => {
  if (!selectedEntry) return;
  copiedEntryPath = selectedEntry.path;
  appendOutput(`\n✓ ${t('copied')}: ${selectedEntry.path}\n`);
};

const pasteCopiedEntry = async (): Promise<void> => {
  let directory = directoryForNewEntry();
  if (!copiedEntryPath || !directory) return;
  if (directory.toLowerCase() === copiedEntryPath.toLowerCase()) {
    directory = copiedEntryPath.replace(/[\\/][^\\/]+$/, '') || activeProject?.root || directory;
  }
  try {
    for (const file of fileTabs()) {
      if (isWithin(file.path, copiedEntryPath) && isDirty(file)) await saveFile(file);
    }
    const copiedPath = await window.glistAPI.copyEntry(copiedEntryPath, directory);
    if (activeProject && directory !== activeProject.root) expandedDirectories.add(directory);
    await loadProjectTree();
    appendOutput(`\n✓ ${t('pasted')}: ${copiedPath}\n`);
  } catch (error) {
    appendOutput(`\n${t('copyFailed')}: ${errorText(error)}\n`, 'error');
  }
};

const showInExplorer = async (): Promise<void> => {
  const target = selectedEntry?.path ?? activeProject?.root;
  if (!target) return;
  try { await window.glistAPI.showInExplorer(target); }
  catch (error) { appendOutput(`\n${t('showFailed')}: ${errorText(error)}\n`, 'error'); }
};

const openCommandPrompt = async (): Promise<void> => {
  const target = selectedEntry?.path ?? activeProject?.root;
  if (!target) return;
  try { await window.glistAPI.openCommandPrompt(target); }
  catch (error) { appendOutput(`\n${t('showFailed')}: ${errorText(error)}\n`, 'error'); }
};

const closeFilesUnderEntry = (entryPath: string): void => {
  let activeWasDeleted = false;
  openFiles.forEach((file, filePath) => {
    if (file.kind !== 'file' || !isWithin(filePath, entryPath)) return;
    if (activeFilePath === filePath) activeWasDeleted = true;
    file.model.dispose();
    openFiles.delete(filePath);
  });
  if (activeWasDeleted) {
    activeFilePath = null;
    const next = [...openFiles.keys()].at(-1);
    if (next) activateFile(next);
    else showNoTab();
  }
  renderTabs();
  updateButtons();
};

// Follows a rename on disk. Renamed tabs keep their place in the tab strip.
const relocateOpenFiles = (oldPath: string, newPath: string): void => {
  const tabs = [...openFiles.entries()];
  openFiles.clear();
  tabs.forEach(([filePath, file]) => {
    if (file.kind !== 'file' || !isWithin(filePath, oldPath)) { openFiles.set(filePath, file); return; }
    const nextPath = `${newPath}${filePath.slice(oldPath.length)}`;
    const nextUri = pathUri(nextPath);
    // Only a clangd preview of a file that used to be at the new path can be there.
    monaco.editor.getModel(nextUri)?.dispose();
    addTab(nextPath, monaco.editor.createModel(file.model.getValue(), languageForFile(nextPath).id, nextUri), false);
    file.model.dispose();
    if (activeFilePath === filePath) activeFilePath = nextPath;
  });
  const active = activeFile();
  if (active) editor.setModel(active.model);
  renderTabs();
};

const renameSelectedEntry = async (): Promise<void> => {
  if (!selectedEntry) return;
  const entry = selectedEntry;
  const newName = await requestName('rename', 'newName', entry.name);
  if (!newName || newName === entry.name) return;
  try {
    await saveOpenCmake();
    for (const file of fileTabs()) {
      if (isWithin(file.path, entry.path) && isDirty(file)) await saveFile(file);
    }
    const nextPath = await window.glistAPI.renameEntry(entry.path, newName);
    relocateOpenFiles(entry.path, nextPath);
    if (copiedEntryPath && isWithin(copiedEntryPath, entry.path)) {
      copiedEntryPath = `${nextPath}${copiedEntryPath.slice(entry.path.length)}`;
    }
    await reloadOpenCmake();
    expandedDirectories.clear();
    await loadProjectTree();
    appendOutput(`\n✓ ${t('renamed')}: ${entry.path} → ${nextPath}\n`);
  } catch (error) {
    appendOutput(`\n${t('renameFailed')}: ${errorText(error)}\n`, 'error');
  }
};

const deleteSelectedEntry = async (): Promise<void> => {
  if (!selectedEntry) return;
  const entry = selectedEntry;
  const description = `“${entry.name}”: ${t(entry.isDirectory ? 'confirmDeleteFolder' : 'confirmDeleteFile')}`;
  if (!window.confirm(description)) return;
  if ([...openFiles.values()].some((file) => isWithin(file.path, entry.path) && isDirty(file))
    && !window.confirm(t('confirmDirtyDelete'))) return;
  try {
    if (activeProject && !isWithin(entry.path, joinPath(activeProject.root, 'CMakeLists.txt'))) await saveOpenCmake();
    await window.glistAPI.deleteEntry(entry.path);
    if (copiedEntryPath && isWithin(copiedEntryPath, entry.path)) copiedEntryPath = null;
    closeFilesUnderEntry(entry.path);
    await reloadOpenCmake();
    await loadProjectTree();
    appendOutput(`\n✓ ${t('movedToTrash')}: ${entry.path}\n`);
  } catch (error) {
    appendOutput(`\n${t('deleteFailed')}: ${errorText(error)}\n`, 'error');
  }
};

const disposeOpenFiles = (): void => {
  showNoTab();
  openFiles.forEach(disposeTab);
  openFiles.clear(); activeFilePath = null; renderTabs();
  monaco.editor.getModels().forEach((model) => model.dispose());
};

const hasDirtyFiles = (): boolean => [...openFiles.values()].some(isDirty);

const openSelectedProject = async (selected: GlistProjectInfo): Promise<void> => {
  await debug.stop();
  disposeOpenFiles(); activeProject = selected;
  selectedEntry = null;
  copiedEntryPath = null;
  expandedDirectories.clear();
  projectRootLabel.textContent = selected.name.toUpperCase();
  document.title = `${selected.name} - Glist Studio`;
  studioTerminal.projectChanged();
  agentTerminal.projectChanged();
  dependencyFolders = [];
  warnedShared.clear();
  void learnDependencies();
  gitPanel.reload();
  void git.projectChanged().then(() => commitPane.restoreMessage());
  await loadProjectTree(); updateButtons();
  clearOutput(`Glist Studio\n${t('openedProject')}: ${selected.root}\n`);
  if (!selected.hasCMakeProject) appendOutput(`${t('noCmake')}\n`);
  void clangd.start(selected.root);
  debug.setProject(selected.root);
};

const openProjectWith = async (open: () => Promise<GlistProjectInfo | null>): Promise<void> => {
  try {
    const selected = await open();
    if (selected) await openSelectedProject(selected);
  } catch (error) {
    appendOutput(`\n${t('projectOpenFailed')}: ${errorText(error)}\n`, 'error');
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
}, (root) => { void openProjectWith(() => window.glistAPI.openProjectPath(joinPath(joinPath(root, 'myglistapps'), 'GlistApp'))); });
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
  if (hasDirtyFiles() && !window.confirm(t('confirmProjectSwitch'))) return;
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
    appendOutput(`\n${t('saveFailed')}: ${errorText(error)}\n`, 'error');
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
    appendOutput(`\n${t('saveFailed')}: ${errorText(error)}\n`, 'error');
    return false;
  }
};

// Keeps a second click from reaching the backend while the first is on its way.
const whileStarting = async (task: () => Promise<void>): Promise<void> => {
  isStarting = true;
  updateButtons();
  try { await task(); } finally { isStarting = false; updateButtons(); }
};

const buildProject = async (): Promise<void> => {
  if (!activeProject || isBuildRunning || isStarting) return;
  await whileStarting(async () => {
    if (!(await saveProjectFiles())) return;
    showPanel('output');
    appendOutput('\n── BUILD ────────────────────────────────────────\n');
    const result = await window.glistAPI.buildProject();
    clangd.buildFinished();
    appendOutput(result.message, result.success ? 'success' : 'error');
    setProcessStatus(t(result.success ? 'buildSucceeded' : 'buildFailed'), false, !result.success);
  });
};

const runProject = async (): Promise<void> => {
  if (!activeProject || isRunRunning || isBuildRunning || isStarting) return;
  await whileStarting(async () => {
    if (!(await saveProjectFiles())) return;
    showPanel('output');
    const result = await window.glistAPI.runProject();
    clangd.buildFinished();
    appendOutput(result.message, result.success ? 'success' : 'error');
  });
};

const debugProject = async (): Promise<void> => {
  if (!activeProject || debug.active || isBuildRunning || isStarting) return;
  await whileStarting(async () => {
    if (!(await saveProjectFiles())) return;
    showView('debug');
    showPanel('output');
    appendOutput('\n── DEBUG ────────────────────────────────────────\n');
    await debug.start();
    clangd.buildFinished();
  });
};

const stopProject = async (): Promise<void> => {
  // A running debug session goes first; while it builds, stopping the build ends it.
  const debugging = debug.active && debug.state !== 'starting';
  if (debugging) await debug.stop();
  const result = await window.glistAPI.stopProject();
  if (result.success || !debugging) appendOutput(result.message, result.success ? 'normal' : 'error');
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
      ],
      edit: [
        item(t('undo'), () => editor.trigger('menu', 'undo', null), { shortcut: 'Ctrl+Z', disabled: !activeFile() }),
        item(t('redo'), () => editor.trigger('menu', 'redo', null), { shortcut: isMac ? 'Cmd+Shift+Z' : 'Ctrl+Y', disabled: !activeFile() }),
        { kind: 'separator' },
        item(t('find'), () => editor.getAction('actions.find')?.run(), { shortcut: 'Ctrl+F', disabled: !activeFile() }),
      ],
      view: [
        { kind: 'heading', label: t('layout') },
        item(t(shell.classList.contains('sidebar-hidden') || sidebarView !== 'explorer' ? 'showExplorer' : 'hideExplorer'),
          toggleExplorer, { shortcut: 'Ctrl+B' }),
        item(t(panelShowing('output') ? 'hideOutput' : 'showOutput'), () => togglePanel('output'), { shortcut: 'Ctrl+J' }),
        item(t(panelShowing('terminal') ? 'hideTerminal' : 'showTerminal'), () => togglePanel('terminal'), {
          shortcut: isMac ? 'Control+`' : 'Ctrl+`',
        }),
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
          shortcut: 'Ctrl+0', hint: `${zoomPercentage}%`, disabled: zoomPercentage === defaultZoom,
        }),
        { kind: 'separator' },
        { kind: 'heading', label: t('preferences') },
        item(t('settings'), () => { settingsDialog.showModal(); void showGitSettings(); }),
      ],
      run: [
        item(t('build'), buildProject, {
          shortcut: 'Ctrl+Shift+B', disabled: !activeProject || isBuildRunning || isStarting,
        }),
        item(t('run'), runProject, {
          shortcut: 'F5', disabled: !activeProject || isRunRunning || isBuildRunning || isStarting,
        }),
        item(t('debug'), debugProject, {
          shortcut: 'F6', disabled: !activeProject || isBuildRunning || isStarting || debug.active,
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
    // Engine and plugin files count too, in their own repositories.
    const tracked = Boolean(file && git.repositoryOf(file.path) && change?.state !== 'untracked' && !git.isIgnored(file.path));
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
      { kind: 'separator' },
      { kind: 'heading', label: t('currentFile') },
      item(t('showDiff'), () => { if (file) void openWorkingDiff(file.path); }, { disabled: !tracked }),
      item(t('showHistory'), () => { if (file) showGitHistory(file.path); }, { disabled: !tracked }),
      item(t(gitEditor.isBlaming() ? 'hideAnnotate' : 'annotate'), () => { void gitEditor.toggleBlame(); }, { disabled: !tracked }),
      item(`${t('rollback')}...`, () => {
        if (file && window.confirm(t('confirmRollbackOne').replace('{name}', file.name))) {
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
    const remote = branches.filter((branch) => branch.remote).slice(0, 12);
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
buildButton.addEventListener('click', buildProject);
runButton.addEventListener('click', runProject);
stopButton.addEventListener('click', stopProject);
newFileButton.addEventListener('click', createFile);
newFolderButton.addEventListener('click', createFolder);
deleteEntryButton.addEventListener('click', deleteSelectedEntry);
refreshButton.addEventListener('click', loadProjectTree);
clearOutputButton.addEventListener('click', () => {
  const panelTerminal = terminalFor(panelView);
  if (panelTerminal) panelTerminal.clear();
  else clearOutput();
});
newTerminalButton.addEventListener('click', () => { void terminalFor(panelView)?.restart(); });
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
element<HTMLButtonElement>('#open-settings').addEventListener('click', () => {
  settingsDialog.showModal();
  // An agent may have been installed or removed outside the studio.
  void agentSettings.refresh();
  void showGitSettings();
});
element<HTMLButtonElement>('#settings-close').addEventListener('click', () => settingsDialog.close());
settingsLanguage.value = getLanguage();
settingsLanguage.addEventListener('change', () => {
  const next = settingsLanguage.value === 'tr' ? 'tr' : 'en';
  applyLanguage(next);
  refreshLanguage();
  agentSettings.render();
  commitPane.render();
  gitPanel.reload();
  setGitActions(git.enabled);
  void window.glistAPI.setLanguage(next);
});
setUpFontSettings(editor, {
  code: element<HTMLInputElement>('#font-code'),
  codeSize: element<HTMLInputElement>('#font-code-size'),
  ligatures: element<HTMLInputElement>('#font-ligatures'),
  interface: element<HTMLInputElement>('#font-interface'),
  codeList: element<HTMLDataListElement>('#font-code-list'),
  interfaceList: element<HTMLDataListElement>('#font-interface-list'),
});
setUpThemePicker({
  options: element<HTMLElement>('#theme-options'),
  importButton: element<HTMLButtonElement>('#theme-import'),
  fileInput: element<HTMLInputElement>('#theme-file'),
  error: element<HTMLElement>('#theme-error'),
});
element<HTMLButtonElement>('#project-cancel').addEventListener('click', () => projectDialog.close());
element<HTMLFormElement>('#new-project-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (hasDirtyFiles() && !window.confirm(t('confirmProjectSwitch'))) return;
  const name = element<HTMLInputElement>('#project-name-input').value.trim();
  const template = element<HTMLSelectElement>('#project-template').value as GlistTemplate;
  const errorHost = element<HTMLElement>('#project-dialog-error');
  try {
    const selected = await window.glistAPI.createProject(template, name);
    projectDialog.close();
    await openSelectedProject(selected);
    appendOutput(`\n✓ ${t('projectCreated')}: ${selected.root}\n`);
  } catch (error) {
    errorHost.textContent = errorText(error);
  }
});
fileTree.addEventListener('click', (event) => {
  if (event.target instanceof Element && event.target.closest('.tree-row')) return;
  clearTreeSelection();
});
fileTree.addEventListener('contextmenu', (event) => {
  if (event.target instanceof Element && event.target.closest('.tree-row')) return;
  clearTreeSelection();
  showContextMenu(event);
});
projectRootLabel.addEventListener('click', clearTreeSelection);
projectRootLabel.addEventListener('contextmenu', (event) => {
  clearTreeSelection();
  showContextMenu(event);
});
document.addEventListener('click', closeContextMenu);
window.addEventListener('blur', closeContextMenu);
window.addEventListener('resize', closeContextMenu);

window.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();
  if (primaryKey(event) && !event.altKey && (key === '+' || key === '=')) { event.preventDefault(); changeZoom(1); return; }
  if (primaryKey(event) && !event.altKey && key === '-') { event.preventDefault(); changeZoom(-1); return; }
  if (primaryKey(event) && !event.altKey && key === '0') { event.preventDefault(); setZoom(defaultZoom); return; }
}, { capture: true });

window.addEventListener('keydown', (event) => {
  if (inputDialog.open || projectDialog.open || settingsDialog.open) return;
  if (event.key === 'Escape') closeContextMenu();
  if (primaryKey(event) && event.key.toLowerCase() === 'c' && selectedEntry && fileTree.contains(document.activeElement)) { event.preventDefault(); copySelectedEntry(); }
  else if (primaryKey(event) && event.key.toLowerCase() === 'v' && copiedEntryPath && fileTree.contains(document.activeElement)) { event.preventDefault(); pasteCopiedEntry(); }
  else if (primaryKey(event) && event.key.toLowerCase() === 's') { event.preventDefault(); saveActiveFile(); }
  else if (primaryKey(event) && event.key.toLowerCase() === 'o') { event.preventDefault(); chooseProject(); }
  else if (primaryKey(event) && event.shiftKey && event.key.toLowerCase() === 'b') { event.preventDefault(); buildProject(); }
  else if (primaryKey(event) && event.key.toLowerCase() === 'b') { event.preventDefault(); toggleExplorer(); }
  else if (primaryKey(event) && event.key.toLowerCase() === 'j') { event.preventDefault(); togglePanel('output'); }
  // By the key's place left of 1, which types a different character on some layouts.
  else if (event.ctrlKey && event.code === 'Backquote') { event.preventDefault(); togglePanel('terminal'); }
  else if (event.shiftKey && event.key === 'F5') { event.preventDefault(); stopProject(); }
  else if (event.key === 'F5') { event.preventDefault(); if (debug.state === 'paused') debug.continue(); else runProject(); }
  else if (event.key === 'F6') { event.preventDefault(); debugProject(); }
  else if (event.key === 'F9') { event.preventDefault(); debug.toggleAtCursor(); }
  else if (event.key === 'F10') { event.preventDefault(); debug.stepOver(); }
  else if (event.shiftKey && event.key === 'F11') { event.preventDefault(); debug.stepOut(); }
  else if (event.key === 'F11') { event.preventDefault(); debug.stepInto(); }
  else if (event.key === 'F2' && selectedEntry && fileTree.contains(document.activeElement)) { event.preventDefault(); renameSelectedEntry(); }
  else if ((event.key === 'Delete' || (isMac && event.metaKey && event.key === 'Backspace')) && selectedEntry && fileTree.contains(document.activeElement)) { event.preventDefault(); deleteSelectedEntry(); }
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
window.addEventListener('beforeunload', (event) => {
  if (hasDirtyFiles()) { event.preventDefault(); event.returnValue = ''; }
});

window.glistAPI.onBuildOutput((text) => appendOutput(text));
// Settings > Build: CMake configures again when its files change, unless turned off.
const autoConfigureInput = element<HTMLInputElement>('#auto-configure');
autoConfigureInput.checked = ((): boolean => { try { return window.localStorage.getItem('glist-studio-auto-configure') !== 'off'; } catch { return true; } })();
void window.glistAPI.setAutoConfigure(autoConfigureInput.checked);
autoConfigureInput.addEventListener('change', () => {
  try { window.localStorage.setItem('glist-studio-auto-configure', autoConfigureInput.checked ? 'on' : 'off'); } catch { /* Storage may be unavailable. */ }
  void window.glistAPI.setAutoConfigure(autoConfigureInput.checked);
});
window.glistAPI.onCompileCommands(() => clangd.compileCommandsChanged());
// A failure says where to look.
window.glistAPI.onConfigured((result) => {
  clangd.buildFinished();
  appendOutput(result.message, result.success ? 'success' : 'error');
  if (!result.success) notify({ text: result.message, kind: 'error', actions: [{ label: t('showOutput'), run: () => showPanel('output') }] });
});
window.glistAPI.onBuildStatus((status) => {
  isBuildRunning = status.running; setProcessStatus(status.label, status.running); updateButtons();
});
window.glistAPI.onRunOutput((text) => appendOutput(text));
window.glistAPI.onSaveAndClose(async () => {
  if (await saveProjectFiles()) window.close();
});
window.glistAPI.onRunStatus((status) => {
  isRunRunning = status.running;
  const suffix = status.exitCode !== undefined ? ` · ${t('exit')} ${status.exitCode}` : '';
  setProcessStatus(status.running ? t('running') : `${t('ready')}${suffix}`, status.running);
  updateButtons();
});

// Git's pieces of the studio show while it is turned on in Settings.
let gitActions: monaco.IDisposable[] = [];
const setGitActions = (enabled: boolean): void => {
  gitActions.forEach((action) => action.dispose());
  gitActions = [];
  if (!enabled) return;
  const action = (id: string, label: TranslationKey, run: (file: OpenFile) => void): monaco.IDisposable => editor.addAction({
    id: `glist.git.${id}`,
    label: `Git: ${t(label)}`,
    contextMenuGroupId: '9_git',
    run: () => { const file = activeFile(); if (file && git.repository) run(file); },
  });
  gitActions = [
    action('diff', 'showDiff', (file) => { void openWorkingDiff(file.path); }),
    action('history', 'showHistory', (file) => showGitHistory(file.path)),
    action('annotate', 'annotate', () => { void gitEditor.toggleBlame(); }),
  ];
};

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
  setGitActions(enabled);
};

git.onEnabled(applyGitEnabled);
git.onStatus((status) => {
  renderBranchChip(status?.repository ?? null);
  fileTree.querySelectorAll<HTMLElement>('.tree-row[data-path]').forEach(decorateTreeRow);
  const diff = activeDiff();
  if (diff && diff.target === null) void fillDiff(diff);
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

// Settings > Git: turning it on, and the name and email commits are signed with.
const gitEnabledInput = element<HTMLInputElement>('#git-enabled');
const gitOptions = element<HTMLElement>('#git-options');
const gitVersion = element<HTMLElement>('#git-version');
const gitName = element<HTMLInputElement>('#git-name');
const gitEmail = element<HTMLInputElement>('#git-email');
const gitSettingsError = element<HTMLElement>('#git-settings-error');
const gitUpdateMerge = element<HTMLInputElement>('#git-update-merge');
const gitUpdateRebase = element<HTMLInputElement>('#git-update-rebase');
const showGitSettings = async (): Promise<void> => {
  gitEnabledInput.checked = git.enabled;
  gitOptions.hidden = !git.enabled;
  gitVersion.hidden = !git.enabled;
  gitUpdateMerge.checked = !git.updateByRebase;
  gitUpdateRebase.checked = git.updateByRebase;
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
[gitName, gitEmail].forEach((input) => input.addEventListener('change', async () => {
  const result = await window.glistAPI.gitRun({ kind: 'identity', name: gitName.value, email: gitEmail.value });
  gitSettingsError.textContent = result.success ? '' : result.message;
}));
[gitUpdateMerge, gitUpdateRebase].forEach((input) => input.addEventListener('change', () => { git.updateByRebase = gitUpdateRebase.checked; }));

configureResizers();
configureMenus();
updateButtons();
