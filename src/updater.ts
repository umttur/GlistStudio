import { accessSync, constants, existsSync, promises as fs, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { app, shell } from 'electron';
import { log } from './log';
import { studioHome } from './studio';
import {
  assetFor, download, heldBack, installMacApp, isNewer, keptAppImage, newerRelease, releaseAt, releases, replaceAppImage,
  rollBackSquirrel, rollbackChoices as choicesFrom, runWindowsSetup, squirrelPrefers, squirrelVersion, stageKeptMacApp, stageMacApp, type Release,
} from './update-release';

// Glist Studio updating itself from its published GitHub releases. A newer
// release is downloaded in the background and checked against GitHub's
// checksum, then installed when the app quits, or at once with Restart to
// Update. The renderer decides when to check (updates.ts).
//
// Going back works the same way, to a version chosen in Settings. The version
// an update replaces is kept on the computer, so going back to it needs
// nothing downloaded; others are downloaded as updates are. After going back,
// the version left is held: not installed again by itself until a newer one.

export const source = { site: 'https://github.com', api: 'https://api.github.com', repository: 'umttur/GlistStudio' };

interface Staged {
  version: string;
  rollback: boolean;
  install(relaunch: boolean): void;
}

let state: GlistUpdateState = { state: 'idle' };
let checking: Promise<GlistUpdateState> | null = null;
let staged: Staged | null = null;
let restartRequested = false;
let listener: (update: GlistUpdateState) => void = () => undefined;
let listed: Release[] = [];

const updatesFolder = (): string => path.join(studioHome(), 'updates');
const heldFile = (): string => path.join(updatesFolder(), 'held.json');

// The version gone back from, whose updates wait for a newer one.
const held = (): string | null => {
  try { return (JSON.parse(readFileSync(heldFile(), 'utf8')) as { from?: string }).from ?? null; } catch { return null; }
};
const hold = (version: string | null): void => {
  try {
    if (version) writeFileSync(heldFile(), JSON.stringify({ from: version }));
    else rmSync(heldFile(), { force: true });
  } catch { /* Not held, then; the next check finds what is newer. */ }
};

const publish = (next: Omit<GlistUpdateState, 'current'>): GlistUpdateState => {
  state = { ...next, current: app.getVersion(), held: held() ?? undefined };
  listener(state);
  return state;
};

const writable = (folder: string): boolean => {
  try { accessSync(folder, constants.W_OK); return true; } catch { return false; }
};

type Place = { kind: 'mac'; bundle: string } | { kind: 'windows'; root: string } | { kind: 'appimage'; file: string };

// Where this copy can replace itself, or null when only the download page can
// help: macOS running it from the disk image or a quarantined download, a copy
// not installed by its installer, or a folder this user cannot write to.
const placeToInstall = (): Place | null => {
  if (process.platform === 'darwin') {
    const bundle = path.resolve(process.execPath, '..', '..', '..');
    if (!bundle.endsWith('.app') || bundle.includes('/AppTranslocation/') || bundle.startsWith('/Volumes/')) return null;
    return writable(path.dirname(bundle)) && writable(bundle) ? { kind: 'mac', bundle } : null;
  }
  if (process.platform === 'win32') {
    const root = path.resolve(path.dirname(process.execPath), '..');
    return existsSync(path.join(root, 'Update.exe')) ? { kind: 'windows', root } : null;
  }
  const file = process.env.APPIMAGE;
  return process.platform === 'linux' && file && writable(path.dirname(file)) ? { kind: 'appimage', file } : null;
};

// Where a Mac keeps the app of a version, to go back to.
const keptBundle = (place: { bundle: string }, version: string): string => path.join(updatesFolder(), version, path.basename(place.bundle));

const listing = (folder: string): string[] => { try { return readdirSync(folder); } catch { return []; } };
const byVersion = (left: string, right: string): number => (isNewer(left, right) ? -1 : isNewer(right, left) ? 1 : 0);

// The versions this computer has kept, newest first: a Mac's kept apps and
// downloaded disk images, the AppImages renamed aside, or the app-<version>
// folders Squirrel keeps.
const keptVersions = (place: Place | null): string[] => {
  if (!place) return [];
  if (place.kind === 'mac') {
    return listing(updatesFolder()).filter((version) => existsSync(keptBundle(place, version))
      || listing(path.join(updatesFolder(), version)).some((name) => name.endsWith('.dmg'))).sort(byVersion);
  }
  if (place.kind === 'appimage') {
    const prefix = `.${path.basename(place.file)}.`;
    return listing(path.dirname(place.file)).filter((name) => name.startsWith(prefix) && name !== `${prefix}update`)
      .map((name) => name.slice(prefix.length)).sort(byVersion);
  }
  // Not the folder this copy runs from, whatever name Squirrel gave it.
  const running = path.basename(path.dirname(process.execPath));
  return listing(place.root).filter((name) => /^app-\d/.test(name) && name !== running).map(squirrelVersion).sort(byVersion);
};

// What was downloaded or kept, to the two newest versions besides those named.
// Squirrel keeps its own versions; a folder gone back from is not needed.
const prune = async (keep: string[] = []): Promise<void> => {
  const place = placeToInstall();
  if (place?.kind === 'windows') {
    await Promise.all(listing(place.root).filter((name) => name.startsWith('rolled-back-'))
      .map((name) => fs.rm(path.join(place.root, name), { recursive: true, force: true }).catch((): undefined => undefined)));
  }
  if (place?.kind === 'appimage') {
    const versions = keptVersions(place).filter((version) => !keep.includes(version));
    await Promise.all(versions.slice(2).map((version) => fs.rm(keptAppImage(place.file, version), { force: true })));
  }
  const folders = listing(updatesFolder()).filter((name) => name !== 'held.json' && !keep.includes(name)).sort(byVersion);
  await Promise.all(folders.slice(2).map((name) => fs.rm(path.join(updatesFolder(), name), { recursive: true, force: true })));
};

// A version made ready to take the running app's place when the app quits,
// from what was kept of it or from its release. Installing it keeps the
// running version; going back holds that version, going forward lets go.
const stage = async (version: string, place: Place, rollback: boolean, release: Release | null): Promise<Staged> => {
  const current = app.getVersion();
  const kept = keptVersions(place);
  const asset = release ? assetFor(release.assets, process.platform, process.arch) : undefined;
  const after = (): void => hold(rollback ? current : null);
  if (place.kind === 'windows') {
    if (rollback) {
      const folders = listing(place.root).filter((name) => /^app-\d/.test(name));
      const target = folders.find((name) => name !== path.basename(path.dirname(process.execPath)) && squirrelVersion(name) === version);
      if (!target) throw new Error(`Glist Studio ${version} is not kept on this computer`);
      const executable = path.basename(process.execPath);
      const setAside = folders.filter((name) => name !== target);
      return { version, rollback, install: (relaunch) => { after(); rollBackSquirrel(place.root, setAside, executable, process.pid, relaunch); } };
    }
    if (!asset) throw new Error(`No installer for this computer in ${version}`);
    const setup = path.join(updatesFolder(), version, asset.name);
    await fs.mkdir(path.dirname(setup), { recursive: true });
    await download(asset, setup);
    // Squirrel's setup starts the app when it is done, so it only runs when asked to.
    return { version, rollback, install: (relaunch) => { if (relaunch) { after(); runWindowsSetup(setup); } } };
  }
  if (place.kind === 'appimage') {
    // Beside the running AppImage, on the same disk, so installing is one rename.
    const next = path.join(path.dirname(place.file), `.${path.basename(place.file)}.update`);
    if (kept.includes(version)) await fs.copyFile(keptAppImage(place.file, version), next);
    else if (asset) await download(asset, next);
    else throw new Error(`No AppImage for this computer in ${version}`);
    await fs.chmod(next, 0o755);
    return { version, rollback, install: (relaunch) => { after(); replaceAppImage(next, place.file, relaunch, keptAppImage(place.file, current)); } };
  }
  const folder = path.join(updatesFolder(), version);
  await fs.mkdir(folder, { recursive: true });
  const image = listing(folder).find((name) => name.endsWith('.dmg'));
  let bundle: string;
  if (existsSync(keptBundle(place, version))) bundle = await stageKeptMacApp(keptBundle(place, version), version, path.join(folder, 'staged'));
  else if (asset) {
    const file = path.join(folder, asset.name);
    await download(asset, file);
    bundle = await stageMacApp(file, version);
  } else if (image) bundle = await stageMacApp(path.join(folder, image), version);
  else throw new Error(`No disk image in ${version}`);
  return { version, rollback, install: (relaunch) => { after(); installMacApp(bundle, place.bundle, process.pid, relaunch, keptBundle(place, current)); } };
};

// Previews: prereleases too, for those who asked for them in Settings.
const check = async (previews: boolean): Promise<GlistUpdateState> => {
  if (!app.isPackaged) return publish({ state: 'unavailable' });
  if (staged) return publish({ state: 'ready', version: staged.version, rollback: staged.rollback });
  publish({ state: 'checking' });
  try {
    const release = await newerRelease(source, app.getVersion(), previews);
    // Nothing newer than the version gone back from is up to date too, as chosen.
    if (!release || heldBack(release.version, held())) {
      await prune();
      return publish({ state: 'up-to-date' });
    }
    const place = placeToInstall();
    if (!assetFor(release.assets, process.platform, process.arch) || !place) {
      return publish({ state: 'available', version: release.version, page: release.page });
    }
    publish({ state: 'downloading', version: release.version });
    staged = await stage(release.version, place, false, release);
    await prune([release.version]);
    return publish({ state: 'ready', version: release.version });
  } catch (error) {
    return publish({ state: 'failed', message: error instanceof Error ? error.message : String(error) });
  }
};

export const setUpdateListener = (next: (update: GlistUpdateState) => void): void => { listener = next; };

export const updateState = (): GlistUpdateState => (app.isPackaged
  ? { ...state, current: app.getVersion(), held: held() ?? undefined } : { state: 'unavailable' });

// A check already running is joined rather than started again.
export const checkForUpdates = (previews?: unknown): Promise<GlistUpdateState> => {
  if (!checking) checking = check(previews === true).finally(() => { checking = null; });
  return checking;
};

// The versions Settings offers to go back to, from GitHub and from what is kept.
export const rollbackChoices = async (previews?: unknown): Promise<GlistRollbackChoice[]> => {
  if (!app.isPackaged) return [];
  const place = placeToInstall();
  const kept = keptVersions(place);
  listed = await releases(source).catch((): Release[] => []);
  return choicesFrom(listed, app.getVersion(), previews === true, kept, (version, release, isKept) => {
    if (!place) return false;
    // Every other app-<version> is set aside, so Squirrel can start any one kept.
    if (place.kind === 'windows') return isKept;
    return isKept || Boolean(release && assetFor(release.assets, process.platform, process.arch));
  });
};

// Goes back to a version: made ready like an update, then installed on quit or
// with Restart to Roll Back. One this computer cannot install itself opens its
// release page instead.
export const rollBack = async (version?: unknown): Promise<GlistUpdateState> => {
  if (!app.isPackaged) return updateState();
  const place = placeToInstall();
  const choice = (await rollbackChoices(true)).find((each) => each.version === version);
  if (!choice) return publish({ state: 'failed', message: `Glist Studio ${String(version)} cannot be gone back to` });
  if (!choice.installable || !place) {
    if (choice.page.startsWith(`${source.site}/${source.repository}/`)) void shell.openExternal(choice.page);
    return state;
  }
  publish({ state: 'downloading', version: choice.version, rollback: true });
  try {
    const release = listed.find((each) => each.version === choice.version)
      ?? await releaseAt(source, `v${choice.version}`).catch((): null => null);
    staged = await stage(choice.version, place, true, release);
    await prune([choice.version, app.getVersion()]);
    return publish({ state: 'ready', version: choice.version, rollback: true });
  } catch (error) {
    return publish({ state: 'failed', message: error instanceof Error ? error.message : String(error) });
  }
};

// Windows: an older app-<version> that Squirrel would start instead of this
// one, as it started app-0.0.9-dev6 over app-0.0.9-dev16, is set aside, so the
// shortcut starts the version that is running now. On each start.
export const tidySquirrelFolders = async (): Promise<void> => {
  const place = app.isPackaged ? placeToInstall() : null;
  if (place?.kind !== 'windows') return;
  const running = path.basename(path.dirname(process.execPath));
  const current = squirrelVersion(running);
  await Promise.all(listing(place.root)
    .filter((name) => /^app-\d/.test(name) && name !== running && squirrelPrefers(name, running) && isNewer(current, squirrelVersion(name)))
    .map((name) => fs.rename(path.join(place.root, name), path.join(place.root, `rolled-back-${name.replace(/^app-/, '')}`)).catch((): undefined => undefined)));
};

// Update Again: the hold let go of, and a check at once.
export const releaseHold = (previews?: unknown): Promise<GlistUpdateState> => {
  hold(null);
  return checkForUpdates(previews);
};

// Restart to Update: quitting asks about unsaved files as usual, then installs.
export const installUpdate = (): void => {
  if (!staged) return;
  restartRequested = true;
  app.quit();
};

export const restartingToUpdate = (): boolean => restartRequested;

export const openUpdatePage = (): void => {
  if (state.page?.startsWith(`${source.site}/${source.repository}/`)) void shell.openExternal(state.page);
};

// On quit: a downloaded update takes the app's place, and opens if that was asked.
export const installOnQuit = (): void => {
  if (!staged) return;
  log('info', `installing ${staged.version}${staged.rollback ? ' (going back)' : ''}${restartRequested ? ', then restarting' : ''}`);
  try {
    staged.install(restartRequested);
  } catch (error) {
    // It stays downloaded, and the next start offers it again.
    log('warn', `installing ${staged.version} failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  staged = null;
};
