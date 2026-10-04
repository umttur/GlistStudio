import type { MessagePortMain } from 'electron';
import { eventChannels } from './api';
import { appError, backendStartArgument, type BackendStart, type FromBackend, type ToBackend } from './backend-protocol';
import type { DatabaseChannel } from './database-client';
import { initializeStudio, msg } from './studio';
import { answer, backendHandlers, stopBackend } from './studio-rpc';

// One window's backend, in a utility process of its own that the main process
// starts with the window (index.ts): its project, builds, runs, terminals,
// debugger and clangd, apart from every other window's. It hears calls from
// the window and answers them, sends the window its events, and asks the main
// process for what only Electron does, such as moving a file to the trash.

const port = process.parentPort;
const post = (message: FromBackend): void => port.postMessage(message);

// An error nothing caught stops the backend, and the main process starts a new
// one; it hears of the error first, for the window. A promise nothing waited
// on only warns, so the window hears of it and the backend goes on.
process.on('uncaughtExceptionMonitor', (error) => post({ kind: 'crash', error: appError('backend', error) }));
process.on('unhandledRejection', (reason) => post({ kind: 'event', channel: eventChannels.onAppError, payload: appError('backend', reason) }));
const start = JSON.parse(process.argv.find((arg) => arg.startsWith(backendStartArgument))?.slice(backendStartArgument.length) ?? '{}') as BackendStart;

const asked = new Map<number, { resolve(): void; reject(error: Error): void }>();
let askedCount = 0;
const askMain = (op: 'trash' | 'showItemInFolder' | 'openPath', target: string): Promise<void> => new Promise((resolve, reject) => {
  askedCount += 1;
  asked.set(askedCount, { resolve, reject });
  post({ kind: 'host', id: askedCount, op, path: target });
});

// SQLite's work, in a process the main process starts and ends for this one
// (database-client.ts), which talks to it over a port of its own.
const databasesStarting = new Map<number, (databasePort: MessagePortMain | undefined) => void>();
let databaseCount = 0;
const startDatabase = (): Promise<DatabaseChannel> => new Promise((resolve, reject) => {
  databaseCount += 1;
  const id = databaseCount;
  databasesStarting.set(id, (databasePort) => {
    if (!databasePort) { reject(new Error(msg('databaseEnded'))); return; }
    resolve({
      post: (request) => databasePort.postMessage(request),
      listen: (reply, gone) => {
        databasePort.on('message', ({ data }) => reply(data));
        databasePort.on('close', gone);
        databasePort.start();
      },
      kill: () => post({ kind: 'database', op: 'stop', id }),
      release: () => databasePort.close(),
    });
  });
  post({ kind: 'database', op: 'start', id });
});

initializeStudio({
  send: (channel, payload) => post({ kind: 'event', channel, payload }),
  trashItem: (entryPath) => askMain('trash', entryPath),
  showItemInFolder: (entryPath) => { void askMain('showItemInFolder', entryPath); },
  openPath: (entryPath) => askMain('openPath', entryPath),
  templateRoot: start.templateRoot,
  projectsDirectory: start.projectsDirectory,
  version: start.version,
  studioHead: async () => start.studioHead,
  startDatabase,
});

port.on('message', ({ data, ports }: { data: ToBackend; ports: MessagePortMain[] }) => {
  if (data.kind === 'call') void answer(backendHandlers, data.call).then((reply) => post({ kind: 'reply', reply }));
  else if (data.kind === 'database') {
    const started = databasesStarting.get(data.id);
    databasesStarting.delete(data.id);
    started?.(ports[0]);
  } else if (data.kind === 'host-reply') {
    const waiting = asked.get(data.id);
    asked.delete(data.id);
    if (data.error) waiting?.reject(new Error(data.error));
    else waiting?.resolve();
  } else if (data.kind === 'shutdown') {
    stopBackend();
    process.exit(0);
  }
});
