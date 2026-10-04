import { timingSafeEqual } from 'node:crypto';
import { createReadStream, promises as fs, readFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { eventChannels, type Handlers } from '../api';
import { appError } from '../backend-protocol';
import { mediaIdOf, type MediaSource } from '../media';
import { mediaFile, MediaGrants } from '../media-serve';
import { readRepositoryHead } from '../repository-head';
import { initializeStudio } from '../studio';
import { logsFolder } from '../studio-places';
import { answer, backendHandlers, stopBackend, type BackendCall } from '../studio-rpc';
import { errorText, isLogLevel, log, timeCall } from '../log';
import { openLogFile } from '../log-file';

export interface WebServerOptions {
  port: number;
  // The browser bundle built by webpack.web.config.ts.
  staticRoot: string;
  templateRoot: string;
  projectsDirectory: string;
  token: string;
  // The checkout it runs from, whose version and commit Settings > About shows.
  sourceRoot: string;
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
  const version = (JSON.parse(readFileSync(path.join(options.sourceRoot, 'package.json'), 'utf8')) as { version: string }).version;

  // The server's own log, beside the app's (log-file.ts). An error nothing
  // caught ends the server: it is written down before it does.
  const logFile = openLogFile('glist-studio-web', 'web');
  process.on('uncaughtExceptionMonitor', (error) => {
    log('error', `uncaught error: ${errorText(error)}`);
    logFile.flushSync();
  });

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
    version,
    // Read each time: the checkout can move while the server runs.
    studioHead: () => readRepositoryHead(options.sourceRoot),
  });

  const handlers: Handlers = {
    ...backendHandlers,
    setTheme: () => undefined,
    // The log: the page's lines, the last ones for the debug report, and where
    // it is, which the browser cannot open.
    writeLog: (level: unknown, text: unknown) => { if (isLogLevel(level)) logFile.write('page', level, String(text)); },
    logTail: () => logFile.tail(),
    openLogsFolder: async () => {
      await fs.mkdir(logsFolder(), { recursive: true });
      return logsFolder();
    },
  };
  // Videos and sounds play from /media/<name>/<file>, by names given to the
  // page that asked and forgotten when it goes (media-serve.ts).
  const media = new MediaGrants<WebSocket>();
  // A promise nothing waited on would stop the server; the page is told of it
  // instead, as the app's window is of its backend's.
  process.on('unhandledRejection', (reason) => {
    console.error(reason);
    log('error', `unhandled rejection: ${errorText(reason)}`);
    send({ channel: eventChannels.onAppError, payload: appError('backend', reason) });
  });

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
    const mediaPath = /^\/media\/([^/]*)(?:\/[^/]*)?$/.exec(url.pathname);
    if (mediaPath) {
      const answer = await media.open(mediaPath[1], request.headers.range, request.method);
      response.writeHead(answer.status, answer.headers);
      if (answer.body) pipeline(answer.body, response, () => undefined);
      else response.end();
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
    log('info', 'page connected');
    const socketHandlers: Handlers = {
      ...handlers,
      openMedia: async (filePath: unknown) => {
        const source = await backendHandlers.openMedia?.(filePath) as MediaSource;
        return mediaFile(source, '/media', media.grant(socket, source));
      },
      releaseMedia: (url: unknown) => media.release(socket, mediaIdOf(url)),
    };
    socket.on('message', async (data) => {
      let request: BackendCall;
      try { request = JSON.parse(data.toString()); } catch { return; }
      // A call that takes long is logged, with its method and how long only.
      const reply = await timeCall(request.method, answer(socketHandlers, request));
      // A project opened: its folder's name, and git's name and email there hidden in the log from now on.
      const root = 'result' in reply ? (reply.result as { root?: unknown } | null)?.root : undefined;
      if (typeof root === 'string' && /^(?:openProject|openProjectPath|createProject)$/.test(String(request.method))) {
        log('info', `opened project ${path.basename(root)}`);
        void Promise.resolve(backendHandlers.gitIdentity?.()).then((identity) => logFile.addIdentity(identity), (): undefined => undefined);
      }
      if (socket === client) send(reply);
    });
    socket.on('close', () => {
      log('info', 'page closed');
      media.releaseOwner(socket);
      if (socket === client) client = null;
    });
  });

  server.on('close', stopBackend);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, '127.0.0.1', () => {
      void readRepositoryHead(options.sourceRoot).catch((): null => null).then((head) => log('info',
        `Glist Studio ${version} web server started on port ${options.port} (commit ${head?.commit ?? 'unknown'}), `
        + `${process.platform} ${process.arch} (release ${os.release()}), Node ${process.versions.node}`));
      resolve(server);
    });
  });
};
