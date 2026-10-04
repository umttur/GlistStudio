import { appendFileSync, closeSync, mkdirSync, openSync, promises as fs, readSync, renameSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { redactText } from './debug-report';
import { setLogSink, type LogLevel } from './log';
import { logsFolder } from './studio-places';

// Glist Studio's log file, so that a problem on someone's computer can be
// understood afterwards. One process writes each file: the app's main process
// glist-studio.log, for its windows and their backends too, and the browser
// build's server glist-studio-web.log, in the same folder.
//
// It never grows without limit, and never stays for good: past about 1 MB the
// file becomes glist-studio.1.log, and that glist-studio.2.log, and the one
// before goes, so the folder holds about 3 MB at most; files older than two
// weeks are deleted. Lines are written a second later, together, and nothing
// here ever throws: on a full disk or a folder it cannot write, it quietly
// stops. An error repeating in a loop is written once, with how many times it
// came again, and past a few lines a second the rest are counted, not written.
//
// Each line is made safe as the debug report is (debug-report.ts): the home
// folder written ~, git's name and email, mail addresses and tokens hidden.

export interface LogFileOptions {
  folder: string;
  // Without .log: glist-studio, before glist-studio.1.log and glist-studio.2.log.
  name: string;
  // Written ~.
  home?: string;
  // A file grows to about this, then starts again.
  maxBytes?: number;
  // The files kept before the one being written.
  keep?: number;
  // Files older than this, in milliseconds, are deleted.
  maxAge?: number;
  flushDelay?: number;
  // What may be written at once, and then each minute, in characters.
  burst?: number;
  perMinute?: number;
  // A longer line is cut.
  maxLine?: number;
  // For tests.
  now?: () => number;
}

const day = 24 * 60 * 60 * 1000;
// Every log file Glist Studio writes, the app's and the browser build's, and
// only those: something else left in the folder is never deleted.
const logName = /^glist-studio(?:-web)?(?:\.(\d+))?\.log$/;
// A line's length in the file: the time, level and process around its text.
const lineLength = (who: string, level: string, text: string): number => 30 + level.length + who.length + text.length;
// A tail reads this much of the end of a file.
const tailBytes = 64 * 1024;

type Step = { kind: 'append'; text: string } | { kind: 'rotate' };

// Lines added to a file of the size given, starting a new file wherever the
// next line would take it past the most.
const plan = (size: number, lines: string[], most: number): Step[] => {
  const steps: Step[] = [];
  let used = size;
  let text = '';
  lines.forEach((line) => {
    const bytes = Buffer.byteLength(line);
    if (used > 0 && used + bytes > most) {
      if (text) steps.push({ kind: 'append', text });
      steps.push({ kind: 'rotate' });
      used = 0;
      text = '';
    }
    text += line;
    used += bytes;
  });
  if (text) steps.push({ kind: 'append', text });
  return steps;
};

const missing = (error: unknown): boolean => (error as NodeJS.ErrnoException)?.code === 'ENOENT';

// The last lines of a file, none when it is not there.
const lastLines = (file: string, count: number): string[] => {
  if (count <= 0) return [];
  let handle: number;
  try { handle = openSync(file, 'r'); } catch (error) { if (missing(error)) return []; throw error; }
  try {
    const size = statSync(file).size;
    const length = Math.min(size, tailBytes);
    const buffer = Buffer.alloc(length);
    readSync(handle, buffer, 0, length, size - length);
    const lines = buffer.toString('utf8').split('\n');
    // The first may be the end of a line cut off.
    if (length < size) lines.shift();
    return lines.filter((line) => line.trim()).slice(-count);
  } finally {
    closeSync(handle);
  }
};

export class LogFile {
  private readonly folder: string;
  private readonly name: string;
  private readonly home: string;
  private readonly maxBytes: number;
  private readonly keep: number;
  private readonly maxAge: number;
  private readonly flushDelay: number;
  private readonly burst: number;
  private readonly perMinute: number;
  private readonly maxLine: number;
  private readonly now: () => number;

  private buffer: string[] = [];
  private bufferBytes = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writing: Promise<void> = Promise.resolve();
  private ready: Promise<void> | null = null;
  private halted = false;
  private readonly personal = new Set<string>();
  // The last lines written, for a tail when the file cannot be read.
  private recent: string[] = [];
  // The line before, whether it was written, and how often it came again since that was said.
  private last = '';
  private lastLine: { who: string; level: LogLevel } | null = null;
  private lastWritten = false;
  private repeats = 0;
  private repeatsSince = 0;
  // What the rate allows now, and the lines left out since a line was last let through.
  private allowance: number;
  private refilled: number;
  private dropped = 0;

  constructor(options: LogFileOptions) {
    this.folder = options.folder;
    this.name = options.name;
    this.home = options.home ?? '';
    this.maxBytes = options.maxBytes ?? 1024 * 1024;
    this.keep = Math.max(0, options.keep ?? 2);
    this.maxAge = options.maxAge ?? 14 * day;
    this.flushDelay = options.flushDelay ?? 1000;
    this.burst = options.burst ?? 64 * 1024;
    this.perMinute = options.perMinute ?? 16 * 1024;
    this.maxLine = options.maxLine ?? 2000;
    this.now = options.now ?? Date.now;
    this.allowance = this.burst;
    this.refilled = this.now();
  }

  // The file being written.
  get file(): string { return path.join(this.folder, `${this.name}.log`); }

  // True once it gave up, the disk full or the folder not writable.
  get stopped(): boolean { return this.halted; }

  private older(index: number): string { return path.join(this.folder, `${this.name}.${index}.log`); }

  // Git's name and email, hidden from here on.
  addPersonal(values: Array<string | null | undefined>): void {
    values.forEach((value) => {
      const kept = typeof value === 'string' ? value.trim() : '';
      if (kept.length >= 3 && this.personal.size < 20) this.personal.add(kept);
    });
  }

  // Git's name and email as gitIdentity says them (git-service.ts), for a project opened.
  addIdentity(identity: unknown): void {
    const said = identity && typeof identity === 'object' ? identity as Partial<Record<'name' | 'email' | 'suggestedName', unknown>> : {};
    this.addPersonal([said.name, said.email, said.suggestedName].map((value) => (typeof value === 'string' ? value : '')));
  }

  private redact(text: string): string {
    return redactText(text, this.home, [...this.personal]);
  }

  // A line from a process: main, the backend of a window, the browser build's server.
  write(who: string, level: LogLevel, text: string): void {
    if (this.halted) return;
    try {
      const now = this.now();
      let line = String(text).replace(/\s*[\r\n]+\s*/g, ' | ').trim();
      if (line.length > this.maxLine) line = `${line.slice(0, this.maxLine)}… (${line.length} characters)`;
      const key = `${who}\n${level}\n${line}`;
      if (key === this.last) {
        this.repeats += 1;
        // A repeat that goes on is said once a minute, not with every write.
        if (now - this.repeatsSince >= 60000) this.sayRepeats(now);
        return;
      }
      if (this.repeats > 0) this.sayRepeats(now);
      this.last = key;
      this.lastLine = { who, level };
      this.repeatsSince = now;
      this.lastWritten = this.admit(now, who, level, line);
    } catch {
      // Never into the app.
    }
  }

  private sayRepeats(now: number): void {
    const count = this.repeats;
    this.repeats = 0;
    this.repeatsSince = now;
    if (!this.lastLine) return;
    // A line not written is not said to repeat: its repeats were left out too.
    if (!this.lastWritten) { this.dropped += count; return; }
    this.admit(now, this.lastLine.who, this.lastLine.level, `last line repeated ${count} more ${count === 1 ? 'time' : 'times'}`);
  }

  // A line let through if the rate allows it; those left out are counted and
  // said before the next one let through.
  private admit(now: number, who: string, level: LogLevel, line: string): boolean {
    this.allowance = Math.min(this.burst, this.allowance + ((now - this.refilled) * this.perMinute) / 60000);
    this.refilled = now;
    const cost = lineLength(who, level, line);
    if (this.allowance < cost) {
      this.dropped += 1;
      return false;
    }
    this.sayDropped(now);
    this.allowance -= cost;
    this.add(now, who, level, line);
    return true;
  }

  private sayDropped(now: number): void {
    if (this.dropped === 0) return;
    const note = `${this.dropped} ${this.dropped === 1 ? 'line' : 'lines'} left out, too many at once`;
    this.allowance -= lineLength('log', 'warn', note);
    this.dropped = 0;
    this.add(now, 'log', 'warn', note);
  }

  private add(now: number, who: string, level: LogLevel, line: string): void {
    const text = `${new Date(now).toISOString()} ${level} [${who}] ${this.redact(line)}`;
    this.recent.push(text);
    if (this.recent.length > 40) this.recent.shift();
    this.buffer.push(`${text}\n`);
    this.bufferBytes += text.length + 1;
    if (this.bufferBytes >= tailBytes) void this.flush();
    else if (!this.timer) {
      this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, this.flushDelay);
      (this.timer as { unref?: () => void }).unref?.();
    }
  }

  private halt(): void {
    this.halted = true;
    this.buffer = [];
    this.bufferBytes = 0;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  // What is waiting, written; settles once it is, or once writing gave up.
  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.writing = this.writing.then(() => this.writeOut()).catch(() => this.halt());
    return this.writing;
  }

  // The folder made, and files too old deleted, once, before anything is written.
  private prepare(): Promise<void> {
    this.ready ??= (async () => {
      await fs.mkdir(this.folder, { recursive: true });
      await this.tidy();
    })();
    return this.ready;
  }

  // Log files older than they may be, and this one's kept beyond the number kept.
  private async tidy(): Promise<void> {
    const names = await fs.readdir(this.folder).catch((): string[] => []);
    const oldest = this.now() - this.maxAge;
    await Promise.all(names.map(async (entry) => {
      const match = logName.exec(entry);
      if (!match) return;
      const file = path.join(this.folder, entry);
      const extra = entry.startsWith(`${this.name}.`) && match[1] !== undefined && Number(match[1]) > this.keep;
      const stat = await fs.stat(file).catch((): null => null);
      if (stat?.isFile() && (extra || stat.mtimeMs < oldest)) await fs.rm(file, { force: true }).catch((): undefined => undefined);
    }));
  }

  private async writeOut(): Promise<void> {
    if (this.halted) return;
    await this.prepare();
    if (this.halted || this.buffer.length === 0) return;
    // Taken now, so that a write at exit (flushSync) does not write them again.
    const lines = this.buffer;
    this.buffer = [];
    this.bufferBytes = 0;
    // Asked each time rather than counted: another server on the same folder may write it too.
    const size = await fs.stat(this.file).then((stat) => stat.size, (error) => { if (missing(error)) return 0; throw error; });
    for (const step of plan(size, lines, this.maxBytes)) {
      if (step.kind === 'append') await fs.appendFile(this.file, step.text, 'utf8');
      else await this.rotate();
    }
  }

  // The file becomes .1, .1 becomes .2, and the last kept goes. One that
  // cannot be renamed stops the log, rather than letting it grow.
  private async rotate(): Promise<void> {
    if (this.keep === 0) { await fs.rm(this.file, { force: true }); return; }
    await fs.rm(this.older(this.keep), { force: true });
    for (let index = this.keep - 1; index >= 1; index -= 1) {
      await fs.rename(this.older(index), this.older(index + 1)).catch((error) => { if (!missing(error)) throw error; });
    }
    await fs.rename(this.file, this.older(1));
    await this.tidy();
  }

  private rotateSync(): void {
    if (this.keep === 0) { rmSync(this.file, { force: true }); return; }
    rmSync(this.older(this.keep), { force: true });
    for (let index = this.keep - 1; index >= 1; index -= 1) {
      try { renameSync(this.older(index), this.older(index + 1)); } catch (error) { if (!missing(error)) throw error; }
    }
    renameSync(this.file, this.older(1));
  }

  // What is waiting, written at once, as the process ends.
  flushSync(): void {
    if (this.halted) return;
    try {
      if (this.repeats > 0) this.sayRepeats(this.now());
      // Lines left out are said at the end even without another let through.
      this.sayDropped(this.now());
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      if (this.buffer.length === 0) return;
      const lines = this.buffer;
      this.buffer = [];
      this.bufferBytes = 0;
      mkdirSync(this.folder, { recursive: true });
      let size = 0;
      try { size = statSync(this.file).size; } catch (error) { if (!missing(error)) throw error; }
      for (const step of plan(size, lines, this.maxBytes)) {
        if (step.kind === 'append') appendFileSync(this.file, step.text, 'utf8');
        else this.rotateSync();
      }
    } catch {
      this.halt();
    }
  }

  // The last lines, from the file and the one before it, for the debug
  // report: earlier runs' too. Made safe again, with git's name and email as
  // known now.
  async tail(count = 40): Promise<string[]> {
    try {
      if (this.repeats > 0) this.sayRepeats(this.now());
      await this.flush();
      if (this.halted) return this.recent.slice(-count).map((line) => this.redact(line));
      const lines = lastLines(this.file, count);
      if (lines.length < count) lines.unshift(...lastLines(this.older(1), count - lines.length));
      return lines.map((line) => this.redact(line));
    } catch {
      return this.recent.slice(-count).map((line) => this.redact(line));
    }
  }
}

// This process's log, in Glist Studio's folder: everything it logs (log.ts)
// is written there as the process named, and what is waiting is written as it
// ends. Files too old go at once.
export const openLogFile = (name: string, who: string): LogFile => {
  const file = new LogFile({ folder: logsFolder(), name, home: homedir() });
  setLogSink((level, text) => file.write(who, level, text));
  process.on('exit', () => file.flushSync());
  void file.flush();
  return file;
};
