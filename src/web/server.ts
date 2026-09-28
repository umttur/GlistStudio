import { timingSafeEqual } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Handler, Handlers } from '../api';
import { initializeStudio, openProjectAt, stopClangd, stopDebugging, stopProcesses, stopTerminal, studio } from '../studio';

export interface WebServerOptions {
  port: number;
  // The browser bundle built by webpack.web.config.ts.
  staticRoot: string;
  templateRoot: string;
  projectsDirectory: string;
  token: string;
}

const cookieName = 'glist-studio';
const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.map': 'application/json', '.ttf': 'font/ttf', '.png': 'image/png',
  '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
};

const sameSecret = (candidate: string | undefined, token: string): boolean =>
  candidate !== undefined && candidate.length === token.length && timingSafeEqual(Buffer.from(candidate), Buffer.from(token));

const cookieToken = (request: http.IncomingMessage): string | undefined =>
  request.headers.cookie?.split(';').map((part) => part.trim().split('='))
    .find(([name]) => name === cookieName)?.[1];

// Serves the studio to a browser, for using it on another machine. Everything
// the Electron preload bridge would carry goes over one WebSocket instead.
export const startWebServer = (options: WebServerOptions): Promise<http.Server> => {
  let client: WebSocket | null = null;
  const send = (message: unknown): void => {
    if (client && client.readyState === client.OPEN) client.send(JSON.stringify(message));
  };
  const unavailable = (): never => { throw new Error('Not available in the browser.'); };
  const trashDirectory = path.join(os.tmpdir(), 'glist-studio-trash');

  initializeStudio({
    send: (channel, payload) => send({ channel, payload }),
    trashItem: async (entryPath) => {
      await fs.mkdir(trashDirectory, { recursive: true });
      const target = path.join(trashDirectory, `${Date.now()}-${path.basename(entryPath)}`);
      try {
        await fs.rename(entryPath, target);
      } catch (error) {
        // The temporary folder is often another file system, a tmpfs on Linux.
        if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
        await fs.cp(entryPath, target, { recursive: true });
        await fs.rm(entryPath, { recursive: true });
      }
    },
    showItemInFolder: unavailable,
    openPath: async () => unavailable(),
    templateRoot: options.templateRoot,
    projectsDirectory: options.projectsDirectory,
  });

  const handlers: Handlers = {
    ...studio,
    openProject: (projectRoot: string) => openProjectAt(projectRoot),
    openCommandPrompt: unavailable,
    setTheme: () => undefined,
  };

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const queryToken = url.searchParams.get('token') ?? undefined;
    if (sameSecret(queryToken, options.token)) {
      response.writeHead(302, {
        'Set-Cookie': `${cookieName}=${options.token}; HttpOnly; SameSite=Strict; Path=/`,
        Location: '/',
      });
      response.end();
      return;
    }
    if (!sameSecret(cookieToken(request), options.token)) {
      response.writeHead(401, { 'Content-Type': 'text/plain' });
      response.end('Open the link printed by npm run web, including its token.\n');
      return;
    }
    let filePath = '';
    try {
      const relative = decodeURIComponent(url.pathname).replace(/^[\\/]+/, '') || 'index.html';
      filePath = path.resolve(options.staticRoot, relative);
      const inside = path.relative(options.staticRoot, filePath);
      if (inside.startsWith('..') || path.isAbsolute(inside)) throw new Error('outside the bundle');
      if (!(await fs.stat(filePath)).isFile()) throw new Error('not a file');
    } catch {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, {
      'Content-Type': contentTypes[path.extname(filePath)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    createReadStream(filePath).pipe(response);
  });

  const sockets = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request, socket, head) => {
    const origin = request.headers.origin ? new URL(request.headers.origin).host : undefined;
    const forwardedHost = request.headers['x-forwarded-host'];
    const hosts = [request.headers.host, ...(Array.isArray(forwardedHost) ? forwardedHost : [forwardedHost])];
    if (request.url !== '/api' || !sameSecret(cookieToken(request), options.token) || !hosts.includes(origin)) {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    sockets.handleUpgrade(request, socket, head, (socketClient) => sockets.emit('connection', socketClient));
  });

  sockets.on('connection', (socket: WebSocket) => {
    // One page drives the backend at a time; a newer one takes over.
    client?.close(4000, 'Glist Studio was opened in another tab.');
    client = socket;
    socket.on('message', async (data) => {
      let request: { id: number; method: string; args: unknown[] };
      try { request = JSON.parse(data.toString()); } catch { return; }
      const { id, method, args } = request;
      const handler = (handlers as Record<string, Handler | undefined>)[method];
      try {
        if (!handler) throw new Error(`Unknown method ${method}`);
        const result = await handler(...args);
        if (socket === client) send({ id, result: result ?? null });
      } catch (error) {
        if (socket === client) send({ id, error: error instanceof Error ? error.message : String(error) });
      }
    });
    socket.on('close', () => { if (socket === client) client = null; });
  });

  server.on('close', () => { stopProcesses(); stopClangd(); stopDebugging(); stopTerminal(); });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, '127.0.0.1', () => resolve(server));
  });
};
