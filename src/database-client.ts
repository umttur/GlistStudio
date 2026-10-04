import { fork } from 'node:child_process';

// A window's SQLite work runs in a process of its own (database-process.ts),
// apart from its backend. node:sqlite works synchronously: a big table counted,
// a long query or a comparison would otherwise stop everything else the backend
// does, terminals, builds and git with it, until it ended. A process rather
// than a worker thread, because only a process can be ended in the middle of a
// statement: SQLite runs one without coming back to JavaScript, and a worker
// thread ends only when it does (nor can the backend exit while one runs).
//
// The process is started when a database is first needed, and again after it
// ended. The databases stay open in it between calls, with the changes waiting
// in them, so when it ends, by itself or stopped, those are lost, and the
// window is told (database:lost).

// Where a database's file is, as the backend found it (studio.ts), which alone
// decides what may be opened, and how.
export interface Located { file: string; readOnly: boolean }

export type DatabaseMethod = 'schema' | 'rows' | 'query' | 'edit' | 'finish' | 'close' | 'closeAll' | 'compare';

export interface DatabaseRequest {
  id: number;
  method: DatabaseMethod;
  args: unknown[];
  // Where the file the first argument names is, for opening it.
  located?: Located;
}

// An error crosses as its message, which is all of it the window gets anyway.
export type DatabaseReply = { id: number; result: unknown } | { id: number; error: string };

// What the process says when node:sqlite is missing; said in the window's
// language on this side.
export const unavailableCode = 'glist-studio:sqlite-unavailable';

// The way to a database process, however it was started.
export interface DatabaseChannel {
  post(request: DatabaseRequest): void;
  // Each reply, and once the process is gone, however it went.
  listen(reply: (reply: DatabaseReply) => void, gone: () => void): void;
  // Ended at once, in the middle of a statement too.
  kill(): void;
  // Let go of: it closes its databases and ends by itself.
  release(): void;
}

// The browser build's: a Node.js child process running the script given.
export const forkedDatabase = (script: string): DatabaseChannel => {
  const child = fork(script, [], { serialization: 'advanced', stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
  // Not starting at all, or sending to one that ended, is told by its end.
  let ended = false;
  let gone = (): void => undefined;
  const end = (): void => {
    if (ended) return;
    ended = true;
    gone();
  };
  child.on('error', () => { if (child.pid === undefined) end(); });
  child.once('exit', end);
  return {
    post: (request) => { if (child.connected) child.send(request, () => undefined); },
    listen: (reply, onGone) => {
      gone = onGone;
      child.on('message', (message) => reply(message as DatabaseReply));
    },
    kill: () => { child.kill('SIGKILL'); },
    release: () => { if (child.connected) child.disconnect(); },
  };
};

export interface DatabaseClientOptions {
  start(): Promise<DatabaseChannel>;
  // Its databases, and the changes waiting in them, are gone: stopped when
  // asked to, or it ended by itself.
  lost(stopped: boolean): void;
  // What the calls it was answering fail with.
  stoppedMessage(): string;
  endedMessage(): string;
}

interface Waiting { resolve(value: unknown): void; reject(error: Error): void }

// Calls to the process, each answered by its id; one process at a time.
export class DatabaseClient {
  private channel: Promise<DatabaseChannel> | null = null;
  private open: DatabaseChannel | null = null;
  private readonly waiting = new Map<number, Waiting>();
  private calls = 0;

  constructor(private readonly options: DatabaseClientOptions) {}

  // Answered by the process, started first when there is none.
  call(method: DatabaseMethod, args: unknown[], located?: Located): Promise<unknown> {
    const channel = this.channel ?? this.begin();
    this.calls += 1;
    const id = this.calls;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      channel.then(
        (started) => { if (this.waiting.has(id)) started.post({ id, method, args, ...(located ? { located } : {}) }); },
        (error: unknown) => this.answered({ id, error: error instanceof Error ? error.message : String(error) }),
      );
    });
  }

  // Answered only by a process already running: with none, nothing is open.
  callRunning(method: DatabaseMethod, args: unknown[]): Promise<unknown> {
    return this.channel ? this.call(method, args) : Promise.resolve(undefined);
  }

  // Whether a call is being answered, or waits to be.
  get busy(): boolean {
    return this.waiting.size > 0;
  }

  // Ends the process in the middle of what it does; the calls waiting fail.
  // Nothing when it is not doing anything, so that no change is lost for a
  // query that had finished meanwhile.
  stop(): boolean {
    if (!this.channel || !this.busy) return false;
    this.end(this.channel, true);
    return true;
  }

  // As the backend stops: an idle process closes its databases itself, which
  // writes back what a WAL database holds beside the file; a busy one is
  // ended. The window is not told: it is going too.
  close(): void {
    const { channel, open } = this;
    if (!channel) return;
    if (open && !this.busy) {
      this.channel = null;
      this.open = null;
      open.release();
    } else this.end(channel, null);
  }

  private begin(): Promise<DatabaseChannel> {
    const started = this.options.start().then((channel) => {
      if (this.channel === started) this.open = channel;
      channel.listen((reply) => this.answered(reply), () => this.end(started, false));
      return channel;
    });
    this.channel = started;
    // One that could not start is tried again on the next call.
    started.catch((): void => { if (this.channel === started) this.channel = null; });
    return started;
  }

  private answered(reply: DatabaseReply): void {
    const waiting = this.waiting.get(reply.id);
    this.waiting.delete(reply.id);
    if ('error' in reply) waiting?.reject(new Error(reply.error));
    else waiting?.resolve(reply.result);
  }

  // The process ended, or is ended now: stopped is null when the window
  // need not hear of it. One that ended before is not this one.
  private end(channel: Promise<DatabaseChannel>, stopped: boolean | null): void {
    if (channel !== this.channel) return;
    const { open } = this;
    this.channel = null;
    this.open = null;
    if (open) open.kill();
    else void channel.then((late) => late.kill(), (): undefined => undefined);
    const waiting = [...this.waiting.values()];
    this.waiting.clear();
    const text = stopped ? this.options.stoppedMessage() : this.options.endedMessage();
    waiting.forEach((each) => each.reject(new Error(text)));
    if (stopped !== null) this.options.lost(stopped);
  }
}

// The window's databases as its backend has them, with the same calls as
// Databases (database.ts) has in the process: each file found first where it
// may be opened from, here, then read, changed and queried there.
export class WindowDatabases {
  private readonly client: DatabaseClient;

  constructor(
    private readonly locate: (filePath: string) => Promise<Located>,
    private readonly options: DatabaseClientOptions & { unavailable(): string },
  ) {
    this.client = new DatabaseClient(options);
  }

  // node:sqlite missing is said as the window says it.
  private said<T>(call: Promise<unknown>): Promise<T> {
    return call.then((result) => result as T, (error: Error) => {
      throw error.message === unavailableCode ? new Error(this.options.unavailable()) : error;
    });
  }

  private async opening<T>(method: DatabaseMethod, filePath: string, ...args: unknown[]): Promise<T> {
    const located = await this.locate(filePath);
    return this.said<T>(this.client.call(method, [filePath, ...args], located));
  }

  schema(filePath: string): Promise<GlistDatabaseSchema> {
    return this.opening('schema', filePath);
  }

  rows(filePath: string, table: string, options: GlistDatabaseRowsOptions): Promise<GlistDatabaseRows> {
    return this.opening('rows', filePath, table, options);
  }

  query(filePath: string, sql: string): Promise<GlistDatabaseResult[]> {
    return this.opening('query', filePath, sql);
  }

  edit(filePath: string, edit: GlistDatabaseEdit): Promise<{ changes: number; pending: GlistDatabasePending }> {
    return this.opening('edit', filePath, edit);
  }

  // A database not open has no changes waiting, and no process is started for it.
  async finish(filePath: string, commit: boolean): Promise<GlistDatabasePending> {
    return (await this.said<GlistDatabasePending | undefined>(this.client.callRunning('finish', [filePath, commit]))) ?? { open: false, changes: 0 };
  }

  // Answered once the process has let go of the file.
  async close(filePath: string): Promise<void> {
    await this.client.callRunning('close', [filePath]);
  }

  closeAll(): void {
    this.client.callRunning('closeAll', []).catch((): undefined => undefined);
  }

  // Two versions of a database compared (database-diff.ts), in the process too.
  compare(base: string | null, target: string | null, options: { scratch?: string; rows?: number }): Promise<GlistDatabaseDiff> {
    return this.said(this.client.call('compare', [base, target, { scratch: options.scratch, rows: options.rows }]));
  }

  stop(): boolean {
    return this.client.stop();
  }

  shutdown(): void {
    this.client.close();
  }
}
