import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import { log } from './log';

export interface ProcessLaunch {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export interface ProcessStatus {
  running: boolean;
  message: string;
}

const headerEnd = Buffer.from('\r\n\r\n');
const stderrLines = 20;

// Runs a program that speaks JSON messages framed by Content-Length headers
// over stdio: clangd (LSP) or a debug adapter (DAP). The protocol itself is
// spoken by the renderer; this side only frames and unframes JSON.
export class MessageProcess {
  private child: ChildProcessWithoutNullStreams | null = null;
  private pending = Buffer.alloc(0);
  private stderr: string[] = [];

  // Named, its start and exit are logged (log.ts): clangd's.
  constructor(
    private readonly onMessage: (message: unknown) => void,
    private readonly onExit: (status: ProcessStatus) => void,
    private readonly name = '',
  ) {}

  start(launch: ProcessLaunch): Promise<ProcessStatus> {
    this.stop();
    const child = spawn(launch.command, launch.args, { cwd: launch.cwd, env: launch.env, windowsHide: true });
    this.child = child;
    this.pending = Buffer.alloc(0);
    this.stderr = [];
    return new Promise((resolve) => {
      let started = false;
      child.once('spawn', () => {
        started = true;
        if (this.name) log('info', `${this.name} started (pid ${child.pid})`);
        resolve({ running: true, message: '' });
      });
      child.once('error', (error) => {
        if (this.name && !started) log('warn', `${this.name} did not start: ${error.message}`);
        if (this.child !== child) return;
        this.child = null;
        if (started) this.onExit({ running: false, message: error.message });
        else resolve({ running: false, message: error.message });
      });
      child.once('exit', (code, signal) => {
        // Stopped, it is no longer this one's.
        if (this.name && started) log(this.child === child ? 'warn' : 'info', `${this.name} ${this.child === child ? 'exited' : 'stopped'} (${signal ?? `code ${code}`})`);
        if (this.child !== child) return;
        this.child = null;
        const detail = this.stderr.length > 0 ? `\n${this.stderr.join('\n')}` : '';
        this.onExit({ running: false, message: `${path.basename(launch.command)} exited (${signal ?? code})${detail}` });
      });
      child.stdin.on('error', () => { /* Reported through 'exit'. */ });
      child.stdout.on('data', (chunk: Buffer) => { if (this.child === child) this.receive(chunk); });
      child.stderr.on('data', (chunk: Buffer) => {
        this.stderr.push(...chunk.toString().split(/\r?\n/).filter(Boolean));
        this.stderr.splice(0, Math.max(0, this.stderr.length - stderrLines));
      });
    });
  }

  // Started, and not exited since.
  get running(): boolean {
    return this.child !== null;
  }

  send(message: unknown): void {
    if (!this.child) return;
    const body = Buffer.from(JSON.stringify(message), 'utf8');
    this.child.stdin.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body]));
  }

  stop(): void {
    const child = this.child;
    this.child = null;
    child?.kill();
  }

  // Stopped, once it has exited: at most three seconds, then it is ended outright.
  async stopAndWait(): Promise<void> {
    const child = this.child;
    this.stop();
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  }

  private receive(chunk: Buffer): void {
    this.pending = Buffer.concat([this.pending, chunk]);
    for (;;) {
      const end = this.pending.indexOf(headerEnd);
      if (end < 0) return;
      const length = Number(/Content-Length:\s*(\d+)/i.exec(this.pending.subarray(0, end).toString('ascii'))?.[1]);
      const start = end + headerEnd.length;
      if (!Number.isFinite(length)) { this.pending = this.pending.subarray(start); continue; }
      if (this.pending.length < start + length) return;
      const body = this.pending.subarray(start, start + length).toString('utf8');
      this.pending = this.pending.subarray(start + length);
      let message: unknown;
      try { message = JSON.parse(body); } catch { continue; }
      this.onMessage(message);
    }
  }
}
