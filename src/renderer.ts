// Monaco's package root selects its AMD build in Electron's CommonJS context.
// The explicit ESM entry prevents a runtime `define is not defined` failure.
// eslint-disable-next-line import/no-unresolved
import * as monaco from 'monaco-editor/editor/editor.api';
// Semantic tokens for whole documents, which clangd sends. Monaco's own
// semanticTokens feature loads only the variant for visible ranges.
// eslint-disable-next-line import/no-unresolved
import 'monaco-editor/editor/contrib/semanticTokens/browser/documentSemanticTokens';
import appIconUrl from '../assets/glistengine.ico';
import { applyTheme, getActiveTheme, setUpThemePicker } from './appearance';
import { ClangdClient } from './clangd';
import { setHostPlatform } from './host';
import { baseName, isWithin, joinPath, pathUri, uriPath } from './paths';
import { isMac, primaryKey, shortcutLabel } from './shortcuts';
import { applyLanguage, getLanguage, t, type TranslationKey } from './localization';
import './index.css';

interface OpenFile {
  path: string;
  name: string;
  model: monaco.editor.ITextModel;
  // The model's alternative version id when it matched the file on disk.
  savedVersion: number;
  readOnly: boolean;
}

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
const newFileButton = element<HTMLButtonElement>('#new-file');
const newFolderButton = element<HTMLButtonElement>('#new-folder');
const deleteEntryButton = element<HTMLButtonElement>('#delete-entry');
const refreshButton = element<HTMLButtonElement>('#refresh-tree');
const appShell = element<HTMLElement>('#app-shell');
const explorerActivityButton = element<HTMLButtonElement>('[data-view="explorer"]');
const fileTree = element<HTMLDivElement>('#file-tree');
const tabsHost = element<HTMLDivElement>('#editor-tabs');
const editorHost = element<HTMLDivElement>('#editor-host');
const welcome = element<HTMLDivElement>('#welcome');
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
const openFiles = new Map<string, OpenFile>();
const expandedDirectories = new Set<string>();
let draggedTabPath: string | null = null;
let suppressTabClick = false;

const setExplorerVisible = (visible: boolean): void => {
  appShell.classList.toggle('sidebar-hidden', !visible);
  explorerActivityButton.classList.toggle('active', visible);
  explorerActivityButton.setAttribute('aria-pressed', String(visible));
};

const toggleExplorer = (): void => setExplorerVisible(appShell.classList.contains('sidebar-hidden'));
const setOutputVisible = (visible: boolean): void => {
  appShell.classList.toggle('output-hidden', !visible);
};
const toggleOutput = (): void => setOutputVisible(appShell.classList.contains('output-hidden'));

const zoomLevels = [50, 67, 80, 90, 100, 110, 125, 150, 175, 200] as const;
const defaultZoom = 100;

const loadZoom = (): number => {
  try {
    const saved = Number(window.localStorage.getItem('glist-studio-zoom'));
    if (zoomLevels.some((level) => level === saved)) return saved;
  } catch { /* Storage may be unavailable. */ }
  return defaultZoom;
};

let zoomPercentage = loadZoom();

applyTheme(getActiveTheme());

const setZoom = (percentage: number): void => {
  const closest = zoomLevels.reduce((best, level) => (
    Math.abs(level - percentage) < Math.abs(best - percentage) ? level : best
  ), defaultZoom);
  zoomPercentage = closest;
  try { window.localStorage.setItem('glist-studio-zoom', String(closest)); } catch { /* Storage may be unavailable. */ }
  void window.glistAPI.setZoomFactor(closest / 100);
};

const changeZoom = (direction: -1 | 1): void => {
  const currentIndex = zoomLevels.findIndex((level) => level === zoomPercentage);
  const nextIndex = Math.min(zoomLevels.length - 1, Math.max(0, currentIndex + direction));
  setZoom(zoomLevels[nextIndex]);
};

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
      || output.textContent.includes('Glist Studio hazır')) output.textContent = t('initialOutput');
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
  fontFamily: "'Cascadia Code', Consolas, monospace",
  fontSize: 14,
  lineHeight: 22,
  minimap: { enabled: true, scale: 1 },
  smoothScrolling: true,
  cursorSmoothCaretAnimation: 'on',
  padding: { top: 14, bottom: 20 },
  renderWhitespace: 'selection',
  scrollBeyondLastLine: false,
  tabSize: 4,
});

// Appends a text node; rewriting textContent made long builds quadratic.
const appendOutput = (text: string, kind: 'normal' | 'success' | 'error' = 'normal'): void => {
  output.append(kind === 'normal' ? text : `\n${kind === 'success' ? '✓' : '✕'} ${text}\n`);
  output.scrollTop = output.scrollHeight;
};

const setProcessStatus = (label: string, active: boolean, error = false): void => {
  processStatus.classList.toggle('active', active);
  processStatus.classList.toggle('error', error);
  const labelNode = processStatus.querySelector('span');
  if (labelNode) labelNode.textContent = label;
};

const languageForFile = (filePath: string): { id: string; label: string } => {
  if (filePath.endsWith('CMakeLists.txt')) return { id: 'plaintext', label: 'CMake' };
  const extension = filePath.split('.').pop()?.toLowerCase() ?? '';
  const languages: Record<string, { id: string; label: string }> = {
    c: { id: 'cpp', label: 'C' }, cc: { id: 'cpp', label: 'C++' },
    cpp: { id: 'cpp', label: 'C++' }, cxx: { id: 'cpp', label: 'C++' },
    h: { id: 'cpp', label: 'C++ Header' }, hh: { id: 'cpp', label: 'C++ Header' },
    hpp: { id: 'cpp', label: 'C++ Header' }, json: { id: 'json', label: 'JSON' },
    md: { id: 'markdown', label: 'Markdown' }, xml: { id: 'xml', label: 'XML' },
    yml: { id: 'yaml', label: 'YAML' }, yaml: { id: 'yaml', label: 'YAML' },
  };
  return languages[extension] ?? { id: 'plaintext', label: 'Plain Text' };
};

const isDirty = (file: OpenFile): boolean => file.model.getAlternativeVersionId() !== file.savedVersion;

const updateButtons = (): void => {
  const hasProject = Boolean(activeProject);
  saveButton.disabled = !activeFilePath;
  buildButton.disabled = !hasProject || isBuildRunning || isStarting;
  runButton.disabled = !hasProject || isRunRunning || isBuildRunning || isStarting;
  stopButton.disabled = !isBuildRunning && !isRunRunning;
  refreshButton.disabled = !hasProject;
  newFileButton.disabled = !hasProject;
  newFolderButton.disabled = !hasProject;
  deleteEntryButton.disabled = !selectedEntry;
};

const activateFile = (filePath: string): void => {
  const file = openFiles.get(filePath);
  if (!file) return;
  activeFilePath = filePath;
  editor.setModel(file.model);
  editor.updateOptions({ readOnly: file.readOnly });
  welcome.hidden = true;
  editorHost.classList.add('visible');
  renderTabs();
  updateButtons();
  editor.focus();
};

const closeFile = (filePath: string): void => {
  const file = openFiles.get(filePath);
  if (!file) return;
  if (isDirty(file) && !window.confirm(`${file.name} ${t('confirmClose')}`)) return;
  const paths = [...openFiles.keys()];
  const closingIndex = paths.indexOf(filePath);
  openFiles.delete(filePath);
  file.model.dispose();
  if (activeFilePath === filePath) {
    const remaining = [...openFiles.keys()];
    const next = remaining[Math.min(closingIndex, remaining.length - 1)];
    activeFilePath = null;
    if (next) activateFile(next);
    else {
      editor.setModel(null);
      editorHost.classList.remove('visible');
      welcome.hidden = false;
    }
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
    tab.classList.toggle('read-only', file.readOnly);
    tab.title = file.readOnly ? `${file.path} (${t('readOnly')})` : file.path;
    const label = document.createElement('span');
    label.className = 'tab-label';
    label.textContent = file.name;
    const dirty = document.createElement('span');
    dirty.className = 'dirty-dot';
    dirty.textContent = isDirty(file) ? '●' : '';
    const close = document.createElement('span');
    close.className = 'tab-close';
    close.draggable = false;
    const closeSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    closeSvg.setAttribute('viewBox', '0 0 16 16');
    closeSvg.setAttribute('aria-hidden', 'true');
    const closePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    closePath.setAttribute('d', 'M3.5 3.5 12.5 12.5M12.5 3.5 3.5 12.5');
    closeSvg.append(closePath);
    close.append(closeSvg);
    close.addEventListener('click', (event) => { event.stopPropagation(); closeFile(file.path); });
    tab.append(label, dirty, close);
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

// clangd and the explorer may spell one path differently, the URI does not.
const findOpenFile = (uri: monaco.Uri): OpenFile | undefined =>
  [...openFiles.values()].find((file) => file.model.uri.toString() === uri.toString());

// Gives a file a tab without switching to it. Files outside the project open read-only.
const loadFile = async (filePath: string): Promise<OpenFile> => {
  const uri = pathUri(filePath);
  let file = findOpenFile(uri);
  if (file) return file;
  const contents = await readContents(filePath);
  file = findOpenFile(uri);
  if (file) return file;
  // clangd may already hold a model of this file for a preview.
  const model = monaco.editor.getModel(uri) ?? monaco.editor.createModel(contents, languageForFile(filePath).id, uri);
  if (model.getValue() !== contents) model.setValue(contents);
  const added = addTab(filePath, model, !isProjectPath(filePath));
  renderTabs();
  return added;
};

const refreshDirtyMark = (file: OpenFile): void => {
  const tab = [...tabsHost.children].find((child) => (child as HTMLElement).dataset.path === file.path);
  const mark = tab?.querySelector('.dirty-dot');
  if (mark) mark.textContent = isDirty(file) ? '●' : '';
};

// Opens a tab on a model that matches the file on disk, without switching to it.
const addTab = (filePath: string, model: monaco.editor.ITextModel, readOnly: boolean): OpenFile => {
  const file: OpenFile = { path: filePath, name: baseName(filePath), model, savedVersion: model.getAlternativeVersionId(), readOnly };
  openFiles.set(filePath, file);
  model.onDidChangeContent(() => refreshDirtyMark(file));
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
};

const openFile = async (filePath: string, name: string): Promise<boolean> => {
  try {
    activateFile((await loadFile(filePath)).path);
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
        if (findOpenFile(uri) || !isProjectPath(filePath)) return;
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
    trigger.textContent = t(key);
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
  contextMenu.hidden = false;
  const width = contextMenu.offsetWidth;
  const height = contextMenu.offsetHeight;
  const left = Math.max(0, Math.min(event.clientX, window.innerWidth - width - 6));
  contextMenu.classList.toggle('submenu-left', left + width + 210 > window.innerWidth);
  contextMenu.style.left = `${left}px`;
  contextMenu.style.top = `${Math.max(0, Math.min(event.clientY, window.innerHeight - height - 6))}px`;
};

const createTreeRow = (entry: GlistFileEntry, depth: number): HTMLDivElement => {
  const container = document.createElement('div');
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'tree-row';
  row.style.paddingLeft = `${10 + depth * 14}px`;
  const arrow = document.createElement('span');
  arrow.className = `tree-arrow${entry.isDirectory ? '' : ' is-file'}`;
  const lowerName = entry.name.toLowerCase();
  const extension = lowerName.includes('.') ? lowerName.split('.').pop() ?? '' : '';
  let iconKind = 'file-text';
  if (entry.isDirectory) iconKind = 'folder';
  else if (lowerName === 'cmakelists.txt' || extension === 'cmake') iconKind = 'file-cmake';
  else if (['cpp', 'cc', 'cxx', 'c++'].includes(extension)) iconKind = 'file-cpp';
  else if (['h', 'hh', 'hpp', 'hxx'].includes(extension)) iconKind = 'file-header';
  else if (['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'wma', 'opus'].includes(extension)) iconKind = 'file-audio';
  else if (['mp4', 'webm', 'mkv', 'mov', 'avi', 'wmv', 'm4v', 'mpeg', 'mpg'].includes(extension)) iconKind = 'file-video';
  else if (['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'tif', 'tiff', 'ico', 'svg'].includes(extension)) iconKind = 'file-image';
  const icon = document.createElement('span'); icon.className = `file-icon ${iconKind}`;
  const label = document.createElement('span'); label.className = 'tree-label'; label.textContent = entry.name;
  row.append(arrow, icon, label);
  container.append(row);
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
    if (!children.hidden) { arrow.classList.add('expanded'); void loadChildren(); }
    row.addEventListener('click', async () => {
      selectTreeEntry(entry, row);
      children.hidden = !children.hidden;
      if (children.hidden) expandedDirectories.delete(entry.path);
      else expandedDirectories.add(entry.path);
      arrow.classList.toggle('expanded', !children.hidden);
      if (!children.hidden) await loadChildren();
    });
  } else {
    row.addEventListener('click', () => selectTreeEntry(entry, row));
    row.addEventListener('dblclick', () => {
      selectTreeEntry(entry, row);
      void openFile(entry.path, entry.name);
    });
  }
  return container;
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
  if (generation === treeGeneration) fileTree.replaceChildren(...rows);
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
    for (const file of openFiles.values()) {
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
    if (!isWithin(filePath, entryPath)) return;
    if (activeFilePath === filePath) activeWasDeleted = true;
    file.model.dispose();
    openFiles.delete(filePath);
  });
  if (activeWasDeleted) {
    activeFilePath = null;
    const next = [...openFiles.keys()].at(-1);
    if (next) activateFile(next);
    else {
      editor.setModel(null);
      editorHost.classList.remove('visible');
      welcome.hidden = false;
    }
  }
  renderTabs();
  updateButtons();
};

// Follows a rename on disk. Renamed tabs keep their place in the tab strip.
const relocateOpenFiles = (oldPath: string, newPath: string): void => {
  const tabs = [...openFiles.entries()];
  openFiles.clear();
  tabs.forEach(([filePath, file]) => {
    if (!isWithin(filePath, oldPath)) { openFiles.set(filePath, file); return; }
    const nextPath = `${newPath}${filePath.slice(oldPath.length)}`;
    const nextUri = pathUri(nextPath);
    // Only a clangd preview of a file that used to be at the new path can be there.
    monaco.editor.getModel(nextUri)?.dispose();
    addTab(nextPath, monaco.editor.createModel(file.model.getValue(), languageForFile(nextPath).id, nextUri), false);
    file.model.dispose();
    if (activeFilePath === filePath) activeFilePath = nextPath;
  });
  if (activeFilePath) editor.setModel(openFiles.get(activeFilePath)?.model ?? null);
  renderTabs();
};

const renameSelectedEntry = async (): Promise<void> => {
  if (!selectedEntry) return;
  const entry = selectedEntry;
  const newName = await requestName('rename', 'newName', entry.name);
  if (!newName || newName === entry.name) return;
  try {
    await saveOpenCmake();
    for (const file of openFiles.values()) {
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
  openFiles.forEach((file) => file.model.dispose());
  openFiles.clear(); activeFilePath = null; editor.setModel(null); renderTabs();
  monaco.editor.getModels().forEach((model) => model.dispose());
  editorHost.classList.remove('visible'); welcome.hidden = false;
};

const hasDirtyFiles = (): boolean => [...openFiles.values()].some(isDirty);

const openSelectedProject = async (selected: GlistProjectInfo): Promise<void> => {
  disposeOpenFiles(); activeProject = selected;
  selectedEntry = null;
  copiedEntryPath = null;
  expandedDirectories.clear();
  projectRootLabel.textContent = selected.name.toUpperCase();
  document.title = `${selected.name} - Glist Studio`;
  await loadProjectTree(); updateButtons();
  output.textContent = `Glist Studio\n${t('openedProject')}: ${selected.root}\n`;
  if (!selected.hasCMakeProject) appendOutput(`${t('noCmake')}\n`);
  void clangd.start(selected.root);
};

const chooseProject = async (): Promise<void> => {
  if (hasDirtyFiles() && !window.confirm(t('confirmProjectSwitch'))) return;
  try {
    const selected = await window.glistAPI.openProject();
    if (selected) await openSelectedProject(selected);
  } catch (error) {
    appendOutput(`\n${t('projectOpenFailed')}: ${errorText(error)}\n`, 'error');
  }
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
  const file = activeFilePath ? openFiles.get(activeFilePath) : undefined;
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
    for (const file of openFiles.values()) {
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
    const result = await window.glistAPI.runProject();
    clangd.buildFinished();
    appendOutput(result.message, result.success ? 'success' : 'error');
  });
};

const stopProject = async (): Promise<void> => {
  const result = await window.glistAPI.stopProject();
  appendOutput(result.message, result.success ? 'normal' : 'error');
};

const configureResizers = (): void => {
  const shell = element<HTMLElement>('#app-shell');
  const sidebarResizer = element<HTMLDivElement>('#sidebar-resizer');
  const panelResizer = element<HTMLDivElement>('#panel-resizer');
  sidebarResizer.addEventListener('pointerdown', (downEvent) => {
    const startX = downEvent.clientX;
    const current = parseInt(getComputedStyle(shell).getPropertyValue('--sidebar-width'), 10);
    const onMove = (moveEvent: PointerEvent): void => shell.style.setProperty('--sidebar-width', `${Math.min(460, Math.max(180, current + moveEvent.clientX - startX))}px`);
    const onUp = (): void => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
  });
  panelResizer.addEventListener('pointerdown', (downEvent) => {
    const startY = downEvent.clientY;
    const current = parseInt(getComputedStyle(shell).getPropertyValue('--panel-height'), 10);
    const onMove = (moveEvent: PointerEvent): void => shell.style.setProperty('--panel-height', `${Math.min(430, Math.max(110, current + startY - moveEvent.clientY))}px`);
    const onUp = (): void => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
  });
};

const configureMenus = (): void => {
  const shell = element<HTMLElement>('#app-shell');
  const popover = element<HTMLDivElement>('#menu-popover');
  const menuButtons = [...document.querySelectorAll<HTMLButtonElement>('.menu-button')];

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
        item(t('save'), saveActiveFile, { shortcut: 'Ctrl+S', disabled: !activeFilePath }),
      ],
      edit: [
        item(t('undo'), () => editor.trigger('menu', 'undo', null), { shortcut: 'Ctrl+Z', disabled: !activeFilePath }),
        item(t('redo'), () => editor.trigger('menu', 'redo', null), { shortcut: isMac ? 'Cmd+Shift+Z' : 'Ctrl+Y', disabled: !activeFilePath }),
        { kind: 'separator' },
        item(t('find'), () => editor.getAction('actions.find')?.run(), { shortcut: 'Ctrl+F', disabled: !activeFilePath }),
      ],
      view: [
        { kind: 'heading', label: t('layout') },
        item(t(shell.classList.contains('sidebar-hidden') ? 'showExplorer' : 'hideExplorer'),
          toggleExplorer, { shortcut: 'Ctrl+B' }),
        item(t(shell.classList.contains('output-hidden') ? 'showOutput' : 'hideOutput'),
          toggleOutput, { shortcut: 'Ctrl+J' }),
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
        item(t('settings'), () => settingsDialog.showModal()),
      ],
      run: [
        item(t('build'), buildProject, {
          shortcut: 'Ctrl+Shift+B', disabled: !activeProject || isBuildRunning || isStarting,
        }),
        item(t('run'), runProject, {
          shortcut: 'F5', disabled: !activeProject || isRunRunning || isBuildRunning || isStarting,
        }),
        { kind: 'separator' },
        item(t('stop'), stopProject, { shortcut: 'Shift+F5', disabled: !isRunRunning && !isBuildRunning }),
      ],
      help: [
        item(t('engineAbout'), () => { void window.glistAPI.openEngineSite(); }),
      ],
    };
    return menus[menu] ?? [];
  };

  const closeMenu = (): void => {
    popover.hidden = true;
    menuButtons.forEach((button) => {
      button.classList.remove('active');
      button.setAttribute('aria-expanded', 'false');
    });
  };

  const openMenu = (button: HTMLButtonElement): void => {
    const menu = button.dataset.menu ?? '';
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
    popover.style.left = `${bounds.left}px`;
    popover.hidden = false;
    button.classList.add('active');
    button.setAttribute('aria-expanded', 'true');
  };

  menuButtons.forEach((button) => {
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', 'false');
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const wasOpen = button.classList.contains('active') && !popover.hidden;
      closeMenu();
      if (wasOpen) return;
      openMenu(button);
    });
    button.addEventListener('pointerenter', () => {
      if (!popover.hidden && !button.classList.contains('active')) {
        closeMenu();
        openMenu(button);
      }
    });
    button.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowDown') return;
      event.preventDefault();
      if (popover.hidden || !button.classList.contains('active')) {
        closeMenu();
        openMenu(button);
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
  explorerActivityButton.addEventListener('click', toggleExplorer);
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
element<HTMLButtonElement>('#clear-output').addEventListener('click', () => { output.textContent = ''; });
element<HTMLButtonElement>('#close-explorer').addEventListener('click', () => setExplorerVisible(false));
element<HTMLButtonElement>('#close-output').addEventListener('click', () => setOutputVisible(false));
element<HTMLButtonElement>('#open-settings').addEventListener('click', () => settingsDialog.showModal());
element<HTMLButtonElement>('#settings-close').addEventListener('click', () => settingsDialog.close());
settingsLanguage.value = getLanguage();
settingsLanguage.addEventListener('change', () => {
  const next = settingsLanguage.value === 'tr' ? 'tr' : 'en';
  applyLanguage(next);
  refreshLanguage();
  void window.glistAPI.setLanguage(next);
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
  else if (primaryKey(event) && event.key.toLowerCase() === 'j') { event.preventDefault(); toggleOutput(); }
  else if (event.shiftKey && event.key === 'F5') { event.preventDefault(); stopProject(); }
  else if (event.key === 'F5') { event.preventDefault(); runProject(); }
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

configureResizers();
configureMenus();
updateButtons();
