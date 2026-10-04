import type { RepositoryHead } from './repository-head';
import type { BackendCall, BackendReply } from './studio-rpc';

// The messages between the main process and a window's backend process
// (backend.ts), apart from either, so each can import them without the other.

// What the main process gives a backend to start, as one argument.
export const backendStartArgument = '--glist-backend=';

export interface BackendStart {
  templateRoot: string;
  projectsDirectory: string;
  version: string;
  studioHead: RepositoryHead | null;
}

// A database process asked for comes with the port to it among the message's
// ports, or with none when it could not start (database-client.ts).
export type ToBackend =
  | { kind: 'call'; call: BackendCall }
  | { kind: 'host-reply'; id: number; error?: string }
  | { kind: 'database'; id: number }
  | { kind: 'shutdown' };

// Host requests are what only Electron, in the main process, can do, such as
// starting and ending the backend's database process. A crash is the error
// about to stop the backend, which the window is told of once a new backend
// has started.
export type FromBackend =
  | { kind: 'reply'; reply: BackendReply }
  | { kind: 'event'; channel: string; payload: unknown }
  | { kind: 'host'; id: number; op: 'trash' | 'showItemInFolder' | 'openPath'; path: string }
  | { kind: 'database'; op: 'start' | 'stop'; id: number }
  | { kind: 'crash'; error: GlistAppError };

// An error nothing caught, as the window hears of it.
export const appError = (source: GlistAppError['source'], error: unknown): GlistAppError => ({
  source,
  message: error instanceof Error ? error.message : String(error),
  ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
});
