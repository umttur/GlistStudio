import { homedir } from 'node:os';
import path from 'node:path';

// Where Glist and Glist Studio's own files are, for the backend (studio.ts) and
// for the app's main process, which needs them before any backend runs.

// The folder the Glist install scripts set up: the engine, zbin and myglistapps.
export const glistRoot = (): string => (process.platform === 'win32'
  ? 'C:\\dev\\glist' : path.join(homedir(), 'dev', 'glist'));

// The myglistapps folder of a default Glist install.
export const defaultProjectsDirectory = (): string => path.join(glistRoot(), 'myglistapps');

// Glist Studio's own folder in the Glist one: its settings, and the agents and
// the Node.js runtime Settings installs. GLIST_STUDIO_HOME moves it, for tests.
export const studioHome = (): string => (process.env.GLIST_STUDIO_HOME
  ? path.resolve(process.env.GLIST_STUDIO_HOME) : path.join(glistRoot(), 'GlistStudio'));

// Its log files (log-file.ts), which Help > Open Logs Folder opens.
export const logsFolder = (): string => path.join(studioHome(), 'logs');
