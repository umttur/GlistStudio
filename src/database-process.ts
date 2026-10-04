import { Worker } from 'node:worker_threads';
import { Databases } from './database';
import { compareDatabases } from './database-diff';
import { unavailableCode, type DatabaseMethod, type DatabaseReply, type DatabaseRequest, type Located } from './database-client';

// A window's SQLite work, in a process of its own (database-client.ts): the
// app's main process starts it for the window's backend, and the browser
// build's server forks it (web/database-process.cjs). It answers the backend's
// calls, keeping the databases open between them, and ends when the backend
// lets go of it, or is ended by it in the middle of a statement.

// Where each file is, as the backend found it with the call that opens it.
const located = new Map<string, Located>();
const databases = new Databases(async (filePath) => {
  const found = located.get(filePath);
  if (!found) throw new Error(`${filePath} was not located`);
  return found;
}, () => unavailableCode);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const methods: Record<DatabaseMethod, (...args: any[]) => unknown> = {
  schema: (filePath: string) => databases.schema(filePath),
  rows: (filePath: string, table: string, options: GlistDatabaseRowsOptions) => databases.rows(filePath, table, options ?? {}),
  query: (filePath: string, sql: string) => databases.query(filePath, sql),
  edit: (filePath: string, edit: GlistDatabaseEdit) => databases.edit(filePath, edit),
  finish: (filePath: string, commit: boolean) => databases.finish(filePath, commit),
  close: (filePath: string) => {
    databases.close(filePath);
    located.delete(filePath);
  },
  closeAll: () => {
    databases.closeAll();
    located.clear();
  },
  compare: (base: string | null, target: string | null, options: { scratch?: string; rows?: number }) =>
    compareDatabases(base, target, { ...options, unavailable: () => unavailableCode }),
};

const answer = async ({ id, method, args, located: found }: DatabaseRequest): Promise<DatabaseReply> => {
  try {
    if (!Object.prototype.hasOwnProperty.call(methods, method)) throw new Error(`Unknown method ${method}`);
    if (found && typeof args[0] === 'string') located.set(args[0], found);
    return { id, result: (await methods[method](...args)) ?? null };
  } catch (error) {
    return { id, error: error instanceof Error ? error.message : String(error) };
  }
};

// Let go of: its databases are closed, which rolls back what was not
// committed and writes back what a WAL database holds beside the file.
const end = (): void => {
  databases.closeAll();
  process.exit(0);
};

if (process.parentPort) {
  // The app's, given a port to its backend by the main process.
  process.parentPort.once('message', ({ ports: [port] }) => {
    port.on('message', ({ data }) => { void answer(data as DatabaseRequest).then((reply) => port.postMessage(reply)); });
    port.on('close', end);
    port.start();
  });
} else {
  process.on('message', (request) => { void answer(request as DatabaseRequest).then((reply) => process.send?.(reply)); });
  process.on('disconnect', end);
  // Left behind by a server that was killed, it ends too, even in the middle of
  // a statement, which nothing on this thread could interrupt; a thread of its
  // own looks. (The app's main process ends the app's.)
  new Worker(`const { workerData: parent } = require('node:worker_threads');
setInterval(() => {
  let alive = process.ppid === parent;
  try { process.kill(parent, 0); } catch { alive = false; }
  if (!alive) process.kill(process.pid, 'SIGKILL');
}, 1000);`, { eval: true, workerData: process.ppid }).unref();
}
