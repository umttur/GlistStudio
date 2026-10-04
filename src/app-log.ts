import { promises as fs } from 'node:fs';
import { log, type LogLevel } from './log';
import { openLogFile, type LogFile } from './log-file';
import { logsFolder } from './studio-places';

// The app's log, which only its main process writes (log-file.ts): its own
// lines, and those its windows and their backends send it, each under its
// own name, so that two processes never write the same file.

let file: LogFile | null = null;

export interface AppFacts {
  version: string;
  commit: string | null;
  packaged: boolean;
  platform: string;
  arch: string;
  release: string;
  systemVersion?: string;
  versions: { electron?: string; chrome?: string; node: string };
}

// Opened once this is the one Glist Studio running, with what is running.
export const startAppLog = (facts: AppFacts): void => {
  file = openLogFile('glist-studio', 'main');
  log('info', `Glist Studio ${facts.version} started (commit ${facts.commit ?? 'unknown'}, ${facts.packaged ? 'packaged' : 'run from source'}), `
    + `${facts.platform}${facts.systemVersion ? ` ${facts.systemVersion}` : ''} ${facts.arch} (release ${facts.release}), Electron ${facts.versions.electron ?? '?'}, Chromium ${facts.versions.chrome ?? '?'}, Node ${facts.versions.node}`);
};

// A line from another process: a window's backend, or the window's page.
export const logAs = (who: string, level: LogLevel, text: string): void => { file?.write(who, level, String(text)); };

// The last lines, made safe, for the debug report.
export const logTail = (): Promise<string[]> => file?.tail() ?? Promise.resolve([]);

// What is waiting, written now: the app is quitting.
export const flushLog = (): void => { file?.flushSync(); };

// Git's name and email for the project a window opened, hidden from then on.
export const hideIdentity = (identity: unknown): void => { file?.addIdentity(identity); };

// Help > Open Logs Folder: there, even before anything was written.
export const logsFolderMade = async (): Promise<string> => {
  const folder = logsFolder();
  await fs.mkdir(folder, { recursive: true });
  return folder;
};

// Checking for updates, downloading, ready to install, going back: each
// change once, with the versions.
let lastUpdate = '';
export const logUpdate = (update: GlistUpdateState): void => {
  const version = update.version ?? '?';
  const back = update.rollback ? ' (going back)' : '';
  const said: Partial<Record<GlistUpdateState['state'], string>> = {
    checking: `checking for updates, running ${update.current ?? '?'}`,
    'up-to-date': `up to date, running ${update.current ?? '?'}${update.held ? `, gone back from ${update.held}` : ''}`,
    available: `update ${version} available, to download from its page`,
    downloading: `downloading ${version}${back}`,
    ready: `${version} ready, installs on quit${back}`,
    failed: `update failed: ${update.message ?? ''}`,
  };
  const text = said[update.state];
  if (!text || text === lastUpdate) return;
  lastUpdate = text;
  log(update.state === 'failed' ? 'warn' : 'info', text);
};
