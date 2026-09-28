interface GlistFileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

declare module '*.ico' {
  const assetUrl: string;
  export default assetUrl;
}

interface GlistProjectInfo {
  root: string;
  name: string;
  hasCMakeProject: boolean;
}

interface GlistProcessResult {
  success: boolean;
  message: string;
}

interface GlistClangdStatus {
  running: boolean;
  message: string;
  // Whether the build directory had compile_commands.json when clangd started.
  compileCommands?: boolean;
}

type GlistTemplate = 'GlistApp' | 'GlistConsoleApp' | 'GlistGUIApp';
type GlistLanguage = 'en' | 'tr';
// The colors the window frame takes from the theme.
interface GlistWindowColors {
  kind: 'dark' | 'light';
  background: string;
  chrome: string;
  text: string;
}

interface Window {
  glistAPI: {
    openProject(): Promise<GlistProjectInfo | null>;
    createProject(templateName: GlistTemplate, projectName: string): Promise<GlistProjectInfo>;
    listDirectory(directoryPath: string): Promise<GlistFileEntry[]>;
    createFile(directoryPath: string, name: string): Promise<string>;
    createDirectory(directoryPath: string, name: string): Promise<string>;
    deleteEntry(entryPath: string): Promise<boolean>;
    renameEntry(entryPath: string, newName: string): Promise<string>;
    createCppClass(directoryPath: string, className: string): Promise<{ header: string; source: string }>;
    copyEntry(entryPath: string, destinationDirectory: string): Promise<string>;
    showInExplorer(entryPath: string): Promise<void>;
    openCommandPrompt(entryPath: string): Promise<void>;
    readFile(filePath: string): Promise<string>;
    readWorkspaceFile(filePath: string): Promise<string>;
    getProjectsDirectory(): Promise<string>;
    getPlatform(): Promise<string>;
    writeFile(filePath: string, contents: string): Promise<boolean>;
    buildProject(): Promise<GlistProcessResult>;
    runProject(): Promise<GlistProcessResult>;
    stopProject(): Promise<GlistProcessResult>;
    setLanguage(language: GlistLanguage): Promise<GlistLanguage>;
    setTheme(colors: GlistWindowColors): Promise<void>;
    setZoomFactor(factor: number): Promise<number>;
    openEngineSite(): Promise<void>;
    startClangd(): Promise<GlistClangdStatus>;
    sendClangd(message: unknown): Promise<void>;
    onBuildOutput(callback: (text: string) => void): () => void;
    onBuildStatus(callback: (status: { running: boolean; label: string }) => void): () => void;
    onRunOutput(callback: (text: string) => void): () => void;
    onRunStatus(callback: (status: { running: boolean; exitCode?: number }) => void): () => void;
    onClangdMessage(callback: (message: unknown) => void): () => void;
    onClangdStatus(callback: (status: GlistClangdStatus) => void): () => void;
    onSaveAndClose(callback: () => void): () => void;
  };
}
