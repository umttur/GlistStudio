type GlistAPI = Window['glistAPI'];
export type EventMethod = Extract<keyof GlistAPI, `on${string}`>;
export type InvokeMethod = Exclude<keyof GlistAPI, EventMethod>;

// Arguments arrive untyped over IPC; each handler declares what it expects.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Handler = (...args: any[]) => unknown;
export type Handlers = Partial<Record<InvokeMethod, Handler>>;

// Every renderer call and the channel that carries it. The preload bridge and
// the browser transport are both generated from these tables.
export const invokeChannels: Record<InvokeMethod, string> = {
  openProject: 'project:open',
  createProject: 'project:create',
  listDirectory: 'project:list-directory',
  createFile: 'project:create-file',
  createDirectory: 'project:create-directory',
  deleteEntry: 'project:delete-entry',
  renameEntry: 'project:rename-entry',
  createCppClass: 'project:create-cpp-class',
  copyEntry: 'project:copy-entry',
  showInExplorer: 'project:show-in-explorer',
  openCommandPrompt: 'project:open-command-prompt',
  readFile: 'project:read-file',
  readWorkspaceFile: 'project:read-workspace-file',
  getProjectsDirectory: 'project:projects-directory',
  getPlatform: 'app:platform',
  writeFile: 'project:write-file',
  buildProject: 'project:build',
  runProject: 'project:run',
  stopProject: 'project:stop',
  setLanguage: 'settings:set-language',
  setTheme: 'settings:set-theme',
  setZoomFactor: 'view:set-zoom-factor',
  openEngineSite: 'app:open-engine-site',
  startClangd: 'clangd:start',
  sendClangd: 'clangd:send',
  startDebugging: 'debug:start',
  sendDebug: 'debug:send',
  stopDebugging: 'debug:stop',
  startTerminal: 'terminal:start',
  writeTerminal: 'terminal:write',
  resizeTerminal: 'terminal:resize',
  stopTerminal: 'terminal:stop',
};

export const eventChannels: Record<EventMethod, string> = {
  onBuildOutput: 'build:output',
  onBuildStatus: 'build:status',
  onRunOutput: 'run:output',
  onRunStatus: 'run:status',
  onClangdMessage: 'clangd:message',
  onClangdStatus: 'clangd:status',
  onSaveAndClose: 'app:save-and-close',
  onDebugMessage: 'debug:message',
  onDebugStatus: 'debug:status',
  onTerminalData: 'terminal:data',
  onTerminalExit: 'terminal:exit',
};
