// Glist Studio's log, as each process writes to it: the app's main process
// into the file (log-file.ts), a window's backend by sending its lines to the
// main process, the browser build's server into a file of its own. What is
// written goes wherever the process said (setLogSink); until it says, nowhere,
// as in tests.

export type LogLevel = 'info' | 'warn' | 'error';

export const isLogLevel = (value: unknown): value is LogLevel => value === 'info' || value === 'warn' || value === 'error';

let sink: (level: LogLevel, text: string) => void = () => undefined;

export const setLogSink = (next: (level: LogLevel, text: string) => void): void => { sink = next; };

// Never throws: a log that fails is no reason for anything else to.
export const log = (level: LogLevel, text: string): void => {
  try { sink(level, text); } catch { /* Not written, then. */ }
};

// An error as one line: its message and where it was thrown, the first few
// places of its stack.
export const errorText = (error: unknown): string => {
  const said = error && typeof error === 'object' ? error as { message?: unknown; stack?: unknown } : null;
  const message = typeof said?.message === 'string' ? said.message : String(error);
  const frames = typeof said?.stack === 'string'
    ? said.stack.split('\n').map((line) => line.trim()).filter((line) => line.startsWith('at ')).slice(0, 6) : [];
  return [message.trim(), ...frames].join(' | ');
};

// When a call counts as slow, and when one not answered yet is told of. Tests change them.
export const callTimes = { slow: 2000, waiting: 10000, check: 5000 };

// Calls long by design, whose progress shows on screen: builds, installs and
// what goes over the network. How long they took is said, never as a warning,
// and one still going is not told of.
const longByDesign = new Set([
  'buildProject', 'runProject', 'startDebugging', 'installDebugger', 'installAgent', 'installPlugin', 'updatePlugin', 'updateEngine',
  'engineCheckout', 'checkPluginUpdates', 'listPlugins', 'gitRun', 'gitClone', 'searchText',
]);

const seconds = (milliseconds: number): string => `${(milliseconds / 1000).toFixed(1)} s`;
// A method's name only, as the window sends it: never what it was given.
const methodName = (method: string): string => String(method).replace(/[^\w.-]/g, '').slice(0, 60) || '?';

interface Waiting { method: string; started: number; told: boolean; who: string }
const waiting = new Set<Waiting>();
let watching: ReturnType<typeof setInterval> | null = null;

// While calls wait, every few seconds: one waiting long is told of once, as a
// backend stuck in something that never ends would leave none to say so later.
const watch = (): void => {
  if (watching) return;
  watching = setInterval(() => {
    const now = Date.now();
    waiting.forEach((call) => {
      if (call.told || now - call.started < callTimes.waiting) return;
      call.told = true;
      log('warn', `${call.who}call ${call.method} still waiting after ${seconds(now - call.started)}`);
    });
    if (waiting.size === 0 && watching) { clearInterval(watching); watching = null; }
  }, callTimes.check);
  (watching as { unref?: () => void }).unref?.();
};

// A call to a backend, timed: one that takes long is written down with its
// method and how long it took, never its arguments. Returns the call itself.
export const timeCall = <T>(method: string, call: Promise<T>, who = ''): Promise<T> => {
  const entry: Waiting = { method: methodName(method), started: Date.now(), told: false, who };
  const long = longByDesign.has(entry.method);
  if (!long) { waiting.add(entry); watch(); }
  const settled = (failed: boolean): void => {
    waiting.delete(entry);
    const took = Date.now() - entry.started;
    if (took >= callTimes.slow) log(!long && took >= callTimes.waiting ? 'warn' : 'info', `${who}call ${entry.method} took ${seconds(took)}${failed ? ', failed' : ''}`);
  };
  call.then(() => settled(false), () => settled(true));
  return call;
};
