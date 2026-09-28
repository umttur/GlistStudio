import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import { availableParallelism, homedir, userInfo } from 'node:os';
import path from 'node:path';
import type { Handlers } from './api';
import { findDebugAdapter } from './debug-adapters';
import { MessageProcess } from './message-process';
import { renderCppClass } from './class-template';
import { synchronizeCmake, type CmakeChange } from './cmake';

// What the backend needs from whoever hosts it: the Electron main process or
// the browser preview server.
export interface StudioHost {
  send(channel: string, payload: unknown): void;
  trashItem(entryPath: string): Promise<void>;
  showItemInFolder(entryPath: string): void;
  openPath(entryPath: string): Promise<unknown>;
  templateRoot: string;
  // Where new projects go when no open project points at a workspace.
  projectsDirectory: string;
}

// The myglistapps folder of a default Glist install.
export const defaultProjectsDirectory = (): string => (process.platform === 'win32'
  ? 'C:\\dev\\glist\\myglistapps' : path.join(homedir(), 'dev', 'glist', 'myglistapps'));

const currentUsername = (): string => {
  const environmentUsername = process.env.USERNAME || process.env.USER;
  if (environmentUsername) return environmentUsername;
  return userInfo().username;
};

interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

interface Toolchain {
  cmake: string;
  toolBin?: string;
  generator?: string;
}

interface ProcessResult {
  success: boolean;
  message: string;
}

type AppLanguage = 'en' | 'tr';
type ProjectTemplate = 'GlistApp' | 'GlistConsoleApp' | 'GlistGUIApp';

const templateNames = new Set<ProjectTemplate>(['GlistApp', 'GlistConsoleApp', 'GlistGUIApp']);
let language: AppLanguage = 'en';

const messages = {
  en: {
    noProject: 'Open a Glist project first.', invalidName: 'Enter a valid file or folder name.',
    outsideProject: 'Files outside the project cannot be accessed.',
    folderRequired: 'Select a folder to create an item.', rootDelete: 'The project root cannot be deleted.',
    alreadyExists: 'An item with this name already exists.',
    invalidClass: 'Enter a valid C++ class name (letters, numbers and underscores).',
    classSource: 'CMakeLists.txt does not contain source/header lists for this class.',
    invalidTemplate: 'Select a valid project template.',
    projectExists: 'A project with this name already exists.',
    openTitle: 'Open Glist project',
    newTitle: 'Create Glist project',
    buildRunning: 'A build is already running.', configuring: 'Configuring', building: 'Building', ready: 'Ready',
    configureFailed: 'CMake configuration stopped with code', buildFailed: 'Build stopped with code',
    buildSucceeded: 'Build completed successfully.', buildStartFailed: 'Could not start build',
    appRunning: 'The application is already running.', runCancelled: 'Run cancelled',
    executableMissing: 'Build completed, but no executable was found.', launched: 'launched',
    debugCancelled: 'Debugging cancelled',
    debuggerMissing: 'No debugger was found. Install LLVM (for lldb-dap) or GDB 14 or newer, and make sure it is on PATH.',
    debuggerFailed: 'The debugger could not be started',
    launchFailed: 'Could not launch application', stopped: 'Running process stopped.',
    nothingToStop: 'No running process to stop.', fileRequired: 'The selected path is not a file.',
    fileTooLarge: 'Files larger than 5 MB cannot be opened in this version.',
    copyIntoSelf: 'A folder cannot be copied into itself or one of its subfolders.',
    clangdMissing: 'clangd could not be started, so C++ code intelligence is off',
    clangdNoDatabase: 'clangd: build once so it can find the engine headers.',
    unsavedChanges: 'Some files have unsaved changes.', saveAndClose: 'Save and Close',
    closeWithoutSaving: 'Close Without Saving', cancel: 'Cancel',
    terminalMissing: 'No terminal was found. Set the TERMINAL environment variable to the one you use.',
  },
  tr: {
    noProject: 'Önce bir Glist projesi açın.', invalidName: 'Geçerli bir dosya veya klasör adı girin.',
    outsideProject: 'Proje klasörü dışındaki dosyalara erişilemez.',
    folderRequired: 'Öğe oluşturmak için bir klasör seçin.', rootDelete: 'Proje kök klasörü silinemez.',
    alreadyExists: 'Bu adda bir öğe zaten var.',
    invalidClass: 'Geçerli bir C++ sınıf adı girin (harf, sayı ve alt çizgi).',
    classSource: 'CMakeLists.txt içinde sınıf için kaynak/başlık listeleri bulunamadı.',
    invalidTemplate: 'Geçerli bir proje şablonu seçin.',
    projectExists: 'Bu adda bir proje zaten var.',
    openTitle: 'Glist projesini aç',
    newTitle: 'Glist projesi oluştur',
    buildRunning: 'Bir derleme zaten çalışıyor.', configuring: 'Yapılandırılıyor', building: 'Derleniyor', ready: 'Hazır',
    configureFailed: 'CMake yapılandırması şu kodla durdu', buildFailed: 'Derleme şu kodla durdu',
    buildSucceeded: 'Derleme başarıyla tamamlandı.', buildStartFailed: 'Derleme başlatılamadı',
    appRunning: 'Uygulama zaten çalışıyor.', runCancelled: 'Çalıştırma iptal edildi',
    executableMissing: 'Derleme tamamlandı ancak çalıştırılabilir dosya bulunamadı.', launched: 'başlatıldı',
    debugCancelled: 'Hata ayıklama iptal edildi',
    debuggerMissing: 'Hata ayıklayıcı bulunamadı. LLVM (lldb-dap için) veya GDB 14 ya da daha yenisini kurun ve PATH üzerinde olduğundan emin olun.',
    debuggerFailed: 'Hata ayıklayıcı başlatılamadı',
    launchFailed: 'Uygulama başlatılamadı', stopped: 'Çalışan işlem durduruldu.',
    nothingToStop: 'Durdurulacak işlem yok.', fileRequired: 'Seçilen yol bir dosya değil.',
    fileTooLarge: '5 MB üzerindeki dosyalar bu sürümde açılamıyor.',
    copyIntoSelf: 'Bir klasör kendi içine veya alt klasörlerinden birine kopyalanamaz.',
    clangdMissing: 'clangd başlatılamadı, C++ kod zekâsı kapalı',
    clangdNoDatabase: 'clangd: motor başlıklarını bulabilmesi için projeyi bir kez derleyin.',
    unsavedChanges: 'Bazı dosyalarda kaydedilmemiş değişiklikler var.', saveAndClose: 'Kaydet ve Kapat',
    closeWithoutSaving: 'Kaydetmeden Kapat', cancel: 'İptal',
    terminalMissing: 'Terminal bulunamadı. Kullandığınız terminali TERMINAL ortam değişkeniyle belirtin.',
  },
} as const;

export const msg = (key: keyof typeof messages.en): string => messages[language][key];

const ignoredDirectories = new Set([
  '.git', '.webpack', 'node_modules', 'out', 'build',
]);

let host: StudioHost;
let activeProjectRoot: string | null = null;
let buildProcess: ChildProcessWithoutNullStreams | null = null;
let runProcess: ChildProcessWithoutNullStreams | null = null;

export const initializeStudio = (studioHost: StudioHost): void => { host = studioHost; };

const sendToRenderer = (channel: string, payload: unknown): void => host.send(channel, payload);

const requireProjectRoot = (): string => {
  if (!activeProjectRoot) throw new Error(msg('noProject'));
  return activeProjectRoot;
};

const isInside = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

const assertPathInProject = (candidatePath: string): string => {
  const resolvedCandidate = path.resolve(candidatePath);
  if (!isInside(path.resolve(requireProjectRoot()), resolvedCandidate)) {
    throw new Error(msg('outsideProject'));
  }
  return resolvedCandidate;
};

const assertExistingPathInProject = async (candidatePath: string): Promise<string> => {
  const safePath = assertPathInProject(candidatePath);
  const realRoot = await fs.realpath(requireProjectRoot());
  if (!isInside(realRoot, await fs.realpath(safePath))) throw new Error(msg('outsideProject'));
  return safePath;
};

const listDirectory = async (directoryPath: string): Promise<FileEntry[]> => {
  const entries = await fs.readdir(await assertExistingPathInProject(directoryPath), { withFileTypes: true });
  return entries
    .filter((entry) => !entry.isDirectory() || !ignoredDirectories.has(entry.name))
    .map((entry) => ({
      name: entry.name,
      path: path.join(directoryPath, entry.name),
      isDirectory: entry.isDirectory(),
    }))
    .sort((left, right) => {
      if (left.isDirectory !== right.isDirectory) return left.isDirectory ? -1 : 1;
      return left.name.localeCompare(right.name, undefined, { sensitivity: 'base', numeric: true });
    });
};

const validateEntryName = (name: string): string => {
  const trimmed = name.trim();
  if (!trimmed || trimmed === '.' || trimmed === '..' || /[\\/:*?"<>|]/.test(trimmed)) {
    throw new Error(msg('invalidName'));
  }
  return trimmed;
};

const resolveNewEntryPath = async (directoryPath: string, name: string): Promise<string> => {
  const safeDirectory = await assertExistingPathInProject(directoryPath);
  const stats = await fs.stat(safeDirectory);
  if (!stats.isDirectory()) throw new Error(msg('folderRequired'));
  return assertPathInProject(path.join(safeDirectory, validateEntryName(name)));
};

const relativeProjectPath = (filePath: string): string =>
  path.relative(requireProjectRoot(), filePath).replace(/\\/g, '/');

const cmakeChange = async (change: CmakeChange): Promise<{
  path: string; before: string; after: string;
} | null> => {
  const cmakePath = path.join(requireProjectRoot(), 'CMakeLists.txt');
  if (!existsSync(cmakePath)) return null;
  const before = await fs.readFile(cmakePath, 'utf8');
  const after = synchronizeCmake(before, change, process.platform === 'linux');
  return { path: cmakePath, before, after };
};

const writeCmakeChange = async (change: Awaited<ReturnType<typeof cmakeChange>>): Promise<void> => {
  if (change && change.after !== change.before) await fs.writeFile(change.path, change.after, 'utf8');
};

const createProjectFile = async (directoryPath: string, name: string): Promise<string> => {
  const filePath = await resolveNewEntryPath(directoryPath, name);
  const change = await cmakeChange({ kind: 'add', paths: [relativeProjectPath(filePath)] });
  await fs.writeFile(filePath, '', { encoding: 'utf8', flag: 'wx' });
  try { await writeCmakeChange(change); }
  catch (error) { await fs.rm(filePath, { force: true }); throw error; }
  return filePath;
};

const createProjectDirectory = async (directoryPath: string, name: string): Promise<string> => {
  const newDirectoryPath = await resolveNewEntryPath(directoryPath, name);
  await fs.mkdir(newDirectoryPath);
  return newDirectoryPath;
};

const deleteProjectEntry = async (entryPath: string): Promise<boolean> => {
  const safePath = await assertExistingPathInProject(entryPath);
  if (safePath === path.resolve(requireProjectRoot())) {
    throw new Error(msg('rootDelete'));
  }
  const change = safePath === path.join(requireProjectRoot(), 'CMakeLists.txt')
    ? null : await cmakeChange({ kind: 'remove', path: relativeProjectPath(safePath) });
  await writeCmakeChange(change);
  try { await host.trashItem(safePath); }
  catch (error) {
    if (change && change.after !== change.before) await fs.writeFile(change.path, change.before, 'utf8');
    throw error;
  }
  return true;
};

const sameFile = async (left: string, right: string): Promise<boolean> => {
  const [leftStats, rightStats] = await Promise.all([fs.stat(left), fs.stat(right)]);
  return leftStats.dev === rightStats.dev && leftStats.ino === rightStats.ino;
};

const renameProjectEntry = async (entryPath: string, newName: string): Promise<string> => {
  const oldPath = await assertExistingPathInProject(entryPath);
  if (oldPath === path.resolve(requireProjectRoot())) throw new Error(msg('rootDelete'));
  const nextPath = assertPathInProject(path.join(path.dirname(oldPath), validateEntryName(newName)));
  if (oldPath === nextPath) return oldPath;
  // On file systems that ignore case, renaming foo.h to Foo.h finds itself.
  if (existsSync(nextPath) && !(await sameFile(oldPath, nextPath))) throw new Error(msg('alreadyExists'));
  const change = oldPath === path.join(requireProjectRoot(), 'CMakeLists.txt')
    ? null : await cmakeChange({ kind: 'rename', from: relativeProjectPath(oldPath), to: relativeProjectPath(nextPath) });
  await fs.rename(oldPath, nextPath);
  if (change) {
    try { await writeCmakeChange(change); }
    catch (error) { await fs.rename(nextPath, oldPath); throw error; }
  }
  return nextPath;
};

const createCppClass = async (directoryPath: string, className: string): Promise<{ header: string; source: string }> => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(className)) throw new Error(msg('invalidClass'));
  const header = await resolveNewEntryPath(directoryPath, `${className}.h`);
  const source = await resolveNewEntryPath(directoryPath, `${className}.cpp`);
  if (existsSync(header) || existsSync(source)) throw new Error(msg('alreadyExists'));
  const change = await cmakeChange({ kind: 'add', paths: [relativeProjectPath(source), relativeProjectPath(header)] });
  if (!change || change.after === change.before) throw new Error(msg('classSource'));
  const { headerContent, sourceContent } = renderCppClass(
    className, relativeProjectPath(header), currentUsername(), new Date(),
  );
  await fs.writeFile(header, headerContent, { flag: 'wx' });
  try {
    await fs.writeFile(source, sourceContent, { flag: 'wx' });
    await writeCmakeChange(change);
  } catch (error) {
    await fs.rm(header, { force: true });
    await fs.rm(source, { force: true });
    await fs.writeFile(change.path, change.before, 'utf8');
    throw error;
  }
  return { header, source };
};

const copyProjectEntry = async (entryPath: string, destinationDirectory: string): Promise<string> => {
  const source = await assertExistingPathInProject(entryPath);
  const destination = await assertExistingPathInProject(destinationDirectory);
  const sourceStats = await fs.stat(source);
  const destinationStats = await fs.stat(destination);
  if (!destinationStats.isDirectory()) throw new Error(msg('folderRequired'));
  const relative = path.relative(source, destination);
  if (sourceStats.isDirectory() && (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)))) {
    throw new Error(msg('copyIntoSelf'));
  }
  const parsed = path.parse(source);
  const originalName = path.basename(source);
  let copyName = originalName;
  let target = path.join(destination, copyName);
  for (let index = 1; existsSync(target); index += 1) {
    copyName = sourceStats.isDirectory()
      ? `${originalName} - Copy${index > 1 ? ` ${index}` : ''}`
      : `${parsed.name} - Copy${index > 1 ? ` ${index}` : ''}${parsed.ext}`;
    target = path.join(destination, copyName);
  }
  await fs.cp(source, target, { recursive: sourceStats.isDirectory(), force: false, errorOnExist: true });
  return target;
};

const showInSystemExplorer = async (entryPath: string): Promise<void> => {
  const safePath = await assertExistingPathInProject(entryPath);
  if (safePath === path.resolve(requireProjectRoot())) await host.openPath(safePath);
  else host.showItemInFolder(safePath);
};

// Linux has no single terminal; $TERMINAL is how tiling setups name theirs.
const terminals = (directory: string): Array<[string, string[]]> => {
  if (process.platform === 'win32') return [['cmd.exe', ['/K']]];
  if (process.platform === 'darwin') return [['open', ['-a', 'Terminal', directory]]];
  return [process.env.TERMINAL, 'x-terminal-emulator', 'gnome-terminal', 'konsole', 'kitty', 'alacritty', 'foot', 'xterm']
    .filter((command): command is string => Boolean(command))
    .map((command): [string, string[]] => [command, []]);
};

const openCommandPrompt = async (entryPath: string): Promise<void> => {
  const safePath = await assertExistingPathInProject(entryPath);
  const directory = (await fs.stat(safePath)).isDirectory() ? safePath : path.dirname(safePath);
  for (const [command, args] of terminals(directory)) {
    const child = spawn(command, args, { cwd: directory, detached: true, stdio: 'ignore', windowsHide: false });
    const started = await new Promise<boolean>((resolve) => {
      child.once('spawn', () => resolve(true));
      child.once('error', () => resolve(false));
    });
    if (started) { child.unref(); return; }
  }
  throw new Error(msg('terminalMissing'));
};

const createProjectFromTemplate = async (
  templateName: ProjectTemplate,
  projectName: string,
): Promise<{ root: string; name: string; hasCMakeProject: boolean }> => {
  if (!templateNames.has(templateName)) throw new Error(msg('invalidTemplate'));
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(projectName)) throw new Error(msg('invalidName'));
  const source = path.join(host.templateRoot, templateName);
  const directory = projectsDirectory();
  const target = path.join(directory, projectName);
  if (existsSync(target)) throw new Error(msg('projectExists'));
  await fs.mkdir(directory, { recursive: true });
  await fs.cp(source, target, { recursive: true, force: false, errorOnExist: true });
  const eclipsePath = path.join(target, '.project');
  if (existsSync(eclipsePath)) {
    const eclipse = await fs.readFile(eclipsePath, 'utf8');
    await fs.writeFile(eclipsePath, eclipse.replace(/<name>[^<]+<\/name>/, `<name>${projectName}</name>`), 'utf8');
  }
  activeProjectRoot = target;
  return { root: target, name: projectName, hasCMakeProject: true };
};

const findAncestorWith = (projectRoot: string, marker: string): string | null => {
  let cursor = path.resolve(projectRoot);
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(path.join(cursor, marker))) return cursor;
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return null;
};

// A project builds only from <workspace>/myglistapps, since the template reaches
// the engine through ../../GlistEngine. Prefer the workspace of the open project.
export const projectsDirectory = (): string => {
  const workspaceRoot = activeProjectRoot && findAncestorWith(activeProjectRoot, path.join('GlistEngine', 'engine'));
  return workspaceRoot ? path.join(workspaceRoot, 'myglistapps') : host.projectsDirectory;
};

const resolveToolchain = (projectRoot: string): Toolchain => {
  if (process.platform !== 'win32') return { cmake: 'cmake' };
  const workspaceRoot = findAncestorWith(projectRoot, path.join('zbin', 'glistzbin-win64', 'CMake', 'bin', 'cmake.exe'));
  if (!workspaceRoot) return { cmake: 'cmake', generator: 'MinGW Makefiles' };
  const distributionRoot = path.join(workspaceRoot, 'zbin', 'glistzbin-win64');
  return {
    cmake: path.join(distributionRoot, 'CMake', 'bin', 'cmake.exe'),
    toolBin: path.join(distributionRoot, 'clang64', 'bin'),
    generator: 'MinGW Makefiles',
  };
};

// Builds, clangd, the debugger, the app and the terminal all get this. Windows
// spells the variable Path, so it is replaced rather than joined by a second one.
const processEnvironment = (toolchain: Toolchain): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {};
  let searchPath = '';
  Object.entries(process.env).forEach(([key, value]) => {
    if (key.toUpperCase() === 'PATH') searchPath = value ?? '';
    else env[key] = value;
  });
  const cmakeBin = path.isAbsolute(toolchain.cmake) ? path.dirname(toolchain.cmake) : undefined;
  env.PATH = [toolchain.toolBin, cmakeBin, searchPath].filter(Boolean).join(path.delimiter);
  return env;
};

// Release for Build and Run; Debug, with symbols and no optimization, for the debugger.
type BuildType = 'Release' | 'Debug';

const buildDirectoryFor = (projectRoot: string, buildType: BuildType = 'Release'): string =>
  path.join(projectRoot, '_build', buildType);

// Builds and runs get a process group of their own on POSIX, so Stop can end
// what they started too: make, the compilers, and whatever the app spawns.
const ownProcessGroup = process.platform !== 'win32';

const killTree = (child: ChildProcessWithoutNullStreams): void => {
  if (child.pid === undefined) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      .once('error', () => child.kill());
    return;
  }
  try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill(); }
};

const runBuildCommand = (
  executable: string,
  args: string[],
  workingDirectory: string,
  toolchain: Toolchain,
): Promise<number> => new Promise((resolve, reject) => {
  sendToRenderer('build:output', `\n> ${path.basename(executable)} ${args.join(' ')}\n`);
  const child = spawn(executable, args, {
    cwd: workingDirectory,
    // Colored progress from CMake's makefiles, and colored diagnostics from the
    // compiler in build trees created from now on.
    env: { ...processEnvironment(toolchain), CLICOLOR_FORCE: '1', CMAKE_COLOR_DIAGNOSTICS: 'ON' },
    windowsHide: true,
    detached: ownProcessGroup,
  });
  buildProcess = child;
  child.stdout.on('data', (chunk: Buffer) => sendToRenderer('build:output', chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => sendToRenderer('build:output', chunk.toString()));
  // A stopped build may end after the next one started; leave that one alone.
  child.once('error', (error) => { if (buildProcess === child) buildProcess = null; reject(error); });
  child.once('close', (exitCode) => { if (buildProcess === child) buildProcess = null; resolve(exitCode ?? 1); });
});

// Stop bumps the generation, so a stopped build notices at its next step and
// leaves the build that follows it alone.
let building = false;
let buildGeneration = 0;

const configureAndBuild = async (buildType: BuildType = 'Release'): Promise<ProcessResult> => {
  if (building) return { success: false, message: msg('buildRunning') };
  building = true;
  buildGeneration += 1;
  const generation = buildGeneration;
  const stopped = (): boolean => generation !== buildGeneration;
  const projectRoot = requireProjectRoot();
  const toolchain = resolveToolchain(projectRoot);
  const buildDirectory = buildDirectoryFor(projectRoot, buildType);
  const configureArgs = [
    '-S', projectRoot, '-B', buildDirectory,
    `-DCMAKE_BUILD_TYPE=${buildType}`, '-DCMAKE_EXPORT_COMPILE_COMMANDS=ON',
  ];
  if (!existsSync(path.join(buildDirectory, 'CMakeCache.txt')) && toolchain.generator) {
    configureArgs.push('-G', toolchain.generator);
  }

  sendToRenderer('build:status', { running: true, label: msg('configuring') });
  try {
    const configureCode = await runBuildCommand(
      toolchain.cmake, configureArgs, projectRoot, toolchain,
    );
    if (stopped()) return { success: false, message: msg('stopped') };
    if (configureCode !== 0) {
      return { success: false, message: `${msg('configureFailed')}: ${configureCode}.` };
    }
    sendToRenderer('build:status', { running: true, label: msg('building') });
    const buildCode = await runBuildCommand(
      // A bare --parallel lets make start every job at once.
      toolchain.cmake, ['--build', buildDirectory, '--parallel', String(availableParallelism())], projectRoot, toolchain,
    );
    return buildCode === 0
      ? { success: true, message: msg('buildSucceeded') }
      : { success: false, message: `${msg('buildFailed')}: ${buildCode}.` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, message: `${msg('buildStartFailed')}: ${message}` };
  } finally {
    if (!stopped()) {
      building = false;
      sendToRenderer('build:status', { running: false, label: msg('ready') });
    }
  }
};

const readAppName = async (projectRoot: string): Promise<string> => {
  try {
    const cmake = await fs.readFile(path.join(projectRoot, 'CMakeLists.txt'), 'utf8');
    const appName = cmake.match(/set\s*\(\s*APP_NAME\s+["']?([^\s"')]+)/i);
    if (appName) return appName[1];
    return cmake.match(/project\s*\(\s*["']?([^\s"')]+)/i)?.[1] ?? path.basename(projectRoot);
  } catch {
    return path.basename(projectRoot);
  }
};

const findRunnable = async (projectRoot: string, buildType: BuildType = 'Release'): Promise<string | null> => {
  const buildDirectory = buildDirectoryFor(projectRoot, buildType);
  const appName = await readAppName(projectRoot);
  const expected = path.join(buildDirectory, process.platform === 'win32' ? `${appName}.exe` : appName);
  if (existsSync(expected)) return expected;
  try {
    const files = await fs.readdir(buildDirectory, { withFileTypes: true });
    for (const file of files) {
      if (!file.isFile() || file.name.toLowerCase().includes('shadertoheader')) continue;
      const candidate = path.join(buildDirectory, file.name);
      if (process.platform === 'win32' ? file.name.endsWith('.exe') : ((await fs.stat(candidate)).mode & 0o111) !== 0) {
        return candidate;
      }
    }
    return null;
  } catch {
    return null;
  }
};

const runProject = async (): Promise<ProcessResult> => {
  if (runProcess) return { success: false, message: msg('appRunning') };
  const projectRoot = requireProjectRoot();
  sendToRenderer('run:output', '\n── BUILD & RUN ──────────────────────────────────\n');
  const buildResult = await configureAndBuild();
  if (!buildResult.success) {
    return { success: false, message: `${msg('runCancelled')}: ${buildResult.message}` };
  }
  const executable = await findRunnable(projectRoot);
  if (!executable) {
    return { success: false, message: msg('executableMissing') };
  }
  const toolchain = resolveToolchain(projectRoot);
  sendToRenderer('run:output', `\n> ${executable}\n`);
  try {
    const child = spawn(executable, [], {
      // Glist resolves asset paths relative to the project directory. The
      // executable lives in _build/Release, but it must run from projectRoot.
      cwd: projectRoot,
      env: processEnvironment(toolchain),
      windowsHide: false,
      detached: ownProcessGroup,
    });
    runProcess = child;
    sendToRenderer('run:status', { running: true });
    child.stdout.on('data', (chunk: Buffer) => sendToRenderer('run:output', chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => sendToRenderer('run:output', chunk.toString()));
    child.once('error', (error) => sendToRenderer('run:output', `${msg('launchFailed')}: ${error.message}\n`));
    child.once('close', (exitCode) => {
      if (runProcess !== child) return;
      runProcess = null;
      // A stopped app has no exit code, only the signal that ended it.
      sendToRenderer('run:status', { running: false, exitCode: exitCode ?? undefined });
    });
    return { success: true, message: `${path.basename(executable)} ${msg('launched')}.` };
  } catch (error) {
    runProcess = null;
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, message: `${msg('launchFailed')}: ${message}` };
  }
};

export const stopProcesses = (): ProcessResult => {
  let stopped = false;
  if (building) {
    buildGeneration += 1;
    building = false;
    if (buildProcess) killTree(buildProcess);
    buildProcess = null;
    stopped = true;
  }
  if (runProcess) { killTree(runProcess); runProcess = null; stopped = true; }
  sendToRenderer('build:status', { running: false, label: msg('ready') });
  sendToRenderer('run:status', { running: false });
  return { success: stopped, message: msg(stopped ? 'stopped' : 'nothingToStop') };
};

export const openProjectAt = async (projectRoot: string): Promise<GlistProjectInfo> => {
  const root = path.resolve(projectRoot);
  if (!(await fs.stat(root)).isDirectory()) throw new Error(msg('folderRequired'));
  activeProjectRoot = root;
  return {
    root,
    name: path.basename(root),
    hasCMakeProject: existsSync(path.join(root, 'CMakeLists.txt')),
  };
};

const readTextFile = async (filePath: string): Promise<string> => {
  const stats = await fs.stat(filePath);
  if (!stats.isFile()) throw new Error(msg('fileRequired'));
  if (stats.size > 5 * 1024 * 1024) throw new Error(msg('fileTooLarge'));
  return fs.readFile(filePath, 'utf8');
};

const readProjectFile = async (filePath: string): Promise<string> =>
  readTextFile(await assertExistingPathInProject(filePath));

// Go to definition lands in engine and plugin headers, so files anywhere in
// the Glist workspace (the folder holding GlistEngine) may be read, never written.
const readWorkspaceFile = async (filePath: string): Promise<string> => {
  const workspaceRoot = findAncestorWith(requireProjectRoot(), path.join('GlistEngine', 'engine'));
  const realFile = await fs.realpath(path.resolve(filePath));
  if (!workspaceRoot || !isInside(await fs.realpath(workspaceRoot), realFile)) throw new Error(msg('outsideProject'));
  return readTextFile(realFile);
};

const writeProjectFile = async (filePath: string, contents: string): Promise<boolean> => {
  // A file deleted behind the editor's back is written again, into a folder that still exists.
  const target = existsSync(filePath)
    ? await assertExistingPathInProject(filePath)
    : path.join(await assertExistingPathInProject(path.dirname(assertPathInProject(filePath))), path.basename(filePath));
  await fs.writeFile(target, contents, 'utf8');
  return true;
};

const clangd = new MessageProcess(
  (message) => sendToRenderer('clangd:message', message),
  (status) => sendToRenderer('clangd:status', status),
);

const startClangd = async (): Promise<GlistClangdStatus> => {
  const projectRoot = requireProjectRoot();
  const toolchain = resolveToolchain(projectRoot);
  // A project may so far only have been built for debugging.
  const database = (['Release', 'Debug'] as const).map((type) => buildDirectoryFor(projectRoot, type))
    .find((directory) => existsSync(path.join(directory, 'compile_commands.json')));
  const buildDirectory = database ?? buildDirectoryFor(projectRoot);
  const compileCommands = Boolean(database);
  const args = [`--compile-commands-dir=${buildDirectory}`, '--background-index', '--log=error'];
  // Lets clangd ask the Glist clang for its system headers and target.
  if (toolchain.toolBin) args.push(`--query-driver=${path.join(toolchain.toolBin, '*').replace(/\\/g, '/')}`);
  const status = await clangd.start({ command: 'clangd', args, cwd: projectRoot, env: processEnvironment(toolchain) });
  if (!status.running) return { running: false, message: `${msg('clangdMissing')}: ${status.message}` };
  return { running: true, message: compileCommands ? '' : msg('clangdNoDatabase'), compileCommands };
};

export const stopClangd = (): void => clangd.stop();

const debugAdapter = new MessageProcess(
  (message) => sendToRenderer('debug:message', message),
  (status) => sendToRenderer('debug:status', status),
);

// Builds the Debug configuration and starts a debug adapter for it. The
// renderer then launches the program through the adapter.
const startDebugging = async (): Promise<GlistDebugStart> => {
  const projectRoot = requireProjectRoot();
  const build = await configureAndBuild('Debug');
  if (!build.success) return { success: false, message: `${msg('debugCancelled')}: ${build.message}` };
  const program = await findRunnable(projectRoot, 'Debug');
  if (!program) return { success: false, message: msg('executableMissing') };
  const env = processEnvironment(resolveToolchain(projectRoot));
  const adapter = await findDebugAdapter(env);
  if (!adapter) return { success: false, message: msg('debuggerMissing') };
  const status = await debugAdapter.start({ command: adapter.command, args: adapter.args, cwd: projectRoot, env });
  if (!status.running) return { success: false, message: `${msg('debuggerFailed')}: ${status.message}` };
  return { success: true, message: '', program, cwd: projectRoot, flavor: adapter.flavor };
};

export const stopDebugging = (): void => debugAdapter.stop();

const setLanguage = (nextLanguage: AppLanguage): AppLanguage => {
  language = nextLanguage === 'tr' ? 'tr' : 'en';
  return language;
};

// Calls that behave the same under every host.
export const studio: Handlers = {
  createProject: createProjectFromTemplate,
  listDirectory,
  createFile: createProjectFile,
  createDirectory: createProjectDirectory,
  deleteEntry: deleteProjectEntry,
  renameEntry: renameProjectEntry,
  createCppClass,
  copyEntry: copyProjectEntry,
  showInExplorer: showInSystemExplorer,
  openCommandPrompt,
  readFile: readProjectFile,
  readWorkspaceFile,
  getProjectsDirectory: projectsDirectory,
  getPlatform: () => process.platform,
  writeFile: writeProjectFile,
  buildProject: () => configureAndBuild('Release'),
  runProject,
  stopProject: stopProcesses,
  setLanguage,
  startClangd,
  sendClangd: (message: unknown) => clangd.send(message),
  startDebugging,
  sendDebug: (message: unknown) => debugAdapter.send(message),
  stopDebugging,
};
