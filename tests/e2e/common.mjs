// What every end-to-end flow shares: a workspace of its own in a temporary
// folder, a server of its own for the browser build on a free port with its own
// token, a page driven by Playwright, checks that keep going after one fails, and
// cleaning up after. A flow is a file in flows/ that calls e2e(); run.mjs runs
// them all, or run one by itself: node tests/e2e/flows/<name>.mjs (after
// npm run e2e has built the bundle once).
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
export const { chromium } = require('playwright');

export const repo = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const bundle = path.resolve(process.env.E2E_BUNDLE ?? path.join(repo, 'out', 'e2e-web'));
export const flowName = path.basename(process.argv[1] ?? 'flow', '.mjs');
const artifactsRoot = path.resolve(process.env.E2E_ARTIFACTS ?? path.join(repo, 'out', 'e2e-artifacts'));
export const artifacts = path.join(artifactsRoot, flowName);
// Ctrl or Cmd, as the studio's shortcuts take them.
export const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
export const docEnd = process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End';
// Exit code a flow ends with when what it needs is missing (clangd); run.mjs counts it as skipped.
export const skipCode = 77;

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// Ports the owner and other agents on the development machine use; a port the
// system hands out is never one of these, but make sure.
const reserved = new Set([8443, 8444, 8787, 8790, 8795, 8796]);
const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.unref();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    server.close(() => resolve(port));
  });
});

// A folder of its own under the system's temporary folder, laid out as Glist's
// installer lays out a real one, with HOME inside it: glistRoot() is
// $HOME/dev/glist, so nothing of a real installation is ever read. Its real path,
// since clangd answers with real paths (/var is /private/var on macOS).
export const makeWorkspace = () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `gs-e2e-${flowName}-`)));
  const home = path.join(root, 'home');
  const glist = path.join(home, 'dev', 'glist');
  const w = {
    root, home, glist,
    projects: path.join(glist, 'myglistapps'),
    engine: path.join(glist, 'GlistEngine'),
    plugins: path.join(glist, 'glistplugins'),
    studio: path.join(root, 'studio'),
    tmp: path.join(root, 'tmp'),
    gitConfig: path.join(home, '.gitconfig'),
  };
  for (const dir of [w.projects, w.studio, w.tmp]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(w.gitConfig, [
    '[user]', '\tname = Glist Studio Tests', '\temail = tests@example.invalid',
    '[init]', '\tdefaultBranch = main',
    '[commit]', '\tgpgsign = false',
    '[core]', '\tautocrlf = false',
    '',
  ].join('\n'));
  return w;
};

// Git for setting a workspace up, with the workspace's settings and none of the machine's.
// No optional locks: a status read while the studio runs git would otherwise hold index.lock
// and make the studio's command fail ("Unable to create .git/index.lock").
export const gitEnv = (w) => ({
  ...process.env, HOME: w.home, GIT_CONFIG_GLOBAL: w.gitConfig, GIT_CONFIG_NOSYSTEM: '1', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C', LANGUAGE: '',
});
export const git = (w, cwd, ...args) => execFileSync('git', args, { cwd, env: gitEnv(w), encoding: 'utf8' }).trim();

// A program on PATH, or null: which('clangd').
export const which = (name) => (process.env.PATH ?? '').split(path.delimiter).map((dir) => path.join(dir, name))
  .find((file) => { try { fs.accessSync(file, fs.constants.X_OK); return true; } catch { return false; } }) ?? null;

// compile_commands.json for a project's sources, where a Release build would write it, so that
// clangd knows them without CMake or a compiler.
export const compileCommands = (dir, files, flags = '-std=c++17') => {
  const build = path.join(dir, '_build', 'Release');
  fs.mkdirSync(build, { recursive: true });
  fs.writeFileSync(path.join(build, 'compile_commands.json'), JSON.stringify(files.map((file) => ({
    directory: build, file: path.join(dir, file), command: `clang++ ${flags} -I${path.join(dir, 'src')} -c ${path.join(dir, file)}`,
  })), null, 1));
};

// Writes files under a folder: { 'src/main.cpp': '...' }.
export const writeFiles = (dir, files) => {
  for (const [name, contents] of Object.entries(files)) {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
  }
};

// A small Glist app, as the template makes one: a canvas class, main.cpp and the
// CMakeLists.txt that lists them. More files, or other contents, in `files`.
export const glistApp = (w, name, files = {}) => {
  const dir = path.join(w.projects, name);
  writeFiles(dir, {
    'CMakeLists.txt': [
      'cmake_minimum_required(VERSION 3.10.2)', `project(${name})`, 'set(PLUGINS)',
      'set(GlistApp_SOURCES', '\t${APP_DIR}/src/main.cpp', '\t${APP_DIR}/src/gCanvas.cpp', ')',
      'set(GlistApp_HEADERS', '\t${APP_DIR}/src/gCanvas.h', ')', '',
    ].join('\n'),
    'src/main.cpp': '#include "gCanvas.h"\n\nint main() {\n\tgCanvas canvas;\n\tcanvas.setup();\n\treturn 0;\n}\n',
    'src/gCanvas.h': '#pragma once\n\nclass gCanvas {\npublic:\n\tvoid setup();\n\tvoid draw();\nprivate:\n\tint score = 0;\n};\n',
    'src/gCanvas.cpp': '#include "gCanvas.h"\n\nvoid gCanvas::setup() {\n\tscore = 0;\n}\n\nvoid gCanvas::draw() {\n\tscore += 1;\n}\n',
    ...files,
  });
  return dir;
};

// A repository with everything in the folder committed once.
export const gitRepo = (w, dir, message = 'first') => {
  git(w, dir, 'init', '-q', '-b', 'main');
  git(w, dir, 'add', '-A');
  git(w, dir, 'commit', '-q', '-m', message);
  return dir;
};

// The browser build's server for one workspace: tests/e2e/serve.ts, which
// serves the bundle run.mjs built, under jiti as npm run web is. Its output goes
// to server.log in the workspace, kept with the artifacts when a flow fails.
export const startServer = async (w) => {
  if (!fs.existsSync(path.join(bundle, 'index.html'))) {
    throw new Error(`No bundle in ${bundle}: run npm run e2e, which builds it, or node tests/e2e/run.mjs --build-only.`);
  }
  const token = randomBytes(18).toString('base64url');
  const logFile = path.join(w.root, 'server.log');
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(GLIST_STUDIO_|GIT_)/.test(key)) delete env[key];
  Object.assign(env, {
    HOME: w.home,
    GLIST_STUDIO_HOME: w.studio,
    GLIST_STUDIO_PROJECTS: w.projects,
    GLIST_STUDIO_TOKEN: token,
    E2E_BUNDLE: bundle,
    // The trash (os.tmpdir()/glist-studio-trash) and anything else temporary stays in the workspace.
    TMPDIR: w.tmp,
    // One shell everywhere, without a first-run prompt or macOS's note about zsh.
    SHELL: '/bin/bash',
    BASH_SILENCE_DEPRECATION_WARNING: '1',
    GIT_CONFIG_NOSYSTEM: '1',
  });
  for (let attempt = 0; ; attempt += 1) {
    let port = await freePort();
    while (reserved.has(port)) port = await freePort();
    env.GLIST_STUDIO_PORT = String(port);
    const log = fs.openSync(logFile, 'a');
    const child = spawn(process.execPath, [path.join(repo, 'node_modules', 'jiti', 'lib', 'jiti-cli.mjs'), path.join(repo, 'tests', 'e2e', 'serve.ts')], {
      cwd: repo, env, stdio: ['ignore', 'pipe', log],
    });
    let output = '';
    const started = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 60000);
      child.stdout.on('data', (data) => {
        output += data;
        fs.appendFileSync(logFile, data);
        if (/listening on/.test(output)) { clearTimeout(timer); resolve(true); }
      });
      child.once('exit', () => { clearTimeout(timer); resolve(false); });
    });
    fs.closeSync(log);
    if (started) {
      return {
        port, token, child, logFile,
        url: `http://127.0.0.1:${port}/?token=${token}`,
        stop: () => stopProcess(child),
      };
    }
    child.kill('SIGKILL');
    // Another program took the port between choosing it and listening: try another.
    if (attempt < 3 && /EADDRINUSE/.test(fs.readFileSync(logFile, 'utf8'))) continue;
    throw new Error(`The server did not start:\n${fs.readFileSync(logFile, 'utf8').slice(-2000)}`);
  }
};

// The processes a process started, and theirs: the server's clangd, git, CMake and shells.
const descendants = (pid) => {
  let table = [];
  try {
    table = execFileSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8' }).trim().split('\n')
      .map((line) => line.trim().split(/\s+/).map(Number));
  } catch { return []; }
  const found = [];
  for (let parents = [pid]; parents.length;) {
    const children = table.filter(([, parent]) => parents.includes(parent)).map(([child]) => child);
    found.push(...children);
    parents = children;
  }
  return found;
};
const signal = (pids, name) => pids.forEach((pid) => { try { process.kill(pid, name); } catch { /* gone */ } });

// Ends a process this flow started, and what it started, gently and then not. Anything left
// running (a CMake configure) would write into the workspace after it is deleted.
const stopProcess = async (child) => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const below = descendants(child.pid);
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  signal(below, 'SIGTERM');
  if (!(await Promise.race([exited.then(() => true), sleep(3000).then(() => false)]))) {
    child.kill('SIGKILL');
    await exited;
  }
  signal(below, 'SIGKILL');
};

// One flow: makes the workspace (setup writes its projects), starts the server
// and a browser page, runs the body with the helpers below, and cleans up
// whatever happens. Exits 1 when a check failed or the body threw.
//   options.setup(w)     writes the workspace's projects (w from makeWorkspace)
//   options.language     the studio's language, 'en'
//   options.storage      more localStorage entries to start with, { key: value }, or (w) => them
//   options.viewport     { width, height }, 1440 x 900
//   options.webgl        start Chromium with software WebGL
//   options.init         a script for every page load, before the studio's (page.addInitScript)
//   options.clipboard    lets the page read and write the clipboard
//   options.pageErrors   false when the flow checks page errors itself
export const e2e = async (options, body) => {
  const started = Date.now();
  const results = [];
  const shots = [];
  const errors = [];
  let w = null;
  let server = null;
  let browser = null;
  let page = null;
  let skipped = null;
  fs.rmSync(artifacts, { recursive: true, force: true });

  const shoot = (label) => {
    if (!page || shots.length >= 6) return;
    fs.mkdirSync(artifacts, { recursive: true });
    const file = path.join(artifacts, `${String(shots.length + 1).padStart(2, '0')}-${label.replace(/[^\w-]+/g, '-').slice(0, 60)}.png`);
    shots.push(page.screenshot({ path: file }).catch(() => undefined));
  };
  const check = (name, ok, detail = '') => {
    const passed = Boolean(ok);
    results.push({ name, passed });
    const text = typeof detail === 'string' ? detail : JSON.stringify(detail);
    const time = process.env.E2E_TIMES ? ` [${((Date.now() - started) / 1000).toFixed(1)} s]` : '';
    console.log(`${passed ? 'ok  ' : 'FAIL'} ${name}${time}${passed || !text ? '' : `\n       ${text.slice(0, 1500).replace(/\n/g, '\n       ')}`}`);
    if (!passed) shoot(name);
    return passed;
  };
  // Reads until test(value) holds or the time is up, and gives the last value read.
  const settle = async (read, test, timeout = 5000) => {
    const end = Date.now() + timeout;
    let value = await read();
    while (!test(value) && Date.now() < end) {
      await sleep(100);
      value = await read();
    }
    return value;
  };
  // A check of something that comes in its own time.
  const eventually = async (name, read, test, timeout = 5000) => {
    const value = await settle(read, test, timeout);
    return check(name, test(value), value);
  };

  const t = {
    check, settle, eventually, shoot, errors,
    get w() { return w; },
    get page() { return page; },
    get server() { return server; },
    get browser() { return browser; },
    // When something the flow needs is not there (clangd): skipped, not failed.
    skip: (reason) => { skipped = reason; throw Object.assign(new Error(reason), { skip: true }); },
    git: (cwd, ...args) => git(w, cwd, ...args),
    project: (name) => path.join(w.projects, name),
    read: (file) => fs.readFileSync(file, 'utf8'),
    // Loads the studio (again), seeding localStorage only on the tab's first load.
    load: async () => {
      await page.goto(server.url);
      await page.locator('#open-project').waitFor();
    },
    // Opens a project from the Open Project list, and waits for its explorer.
    openProject: async (name) => {
      await page.locator('#open-project').click();
      await page.locator('#open-project-dialog[open] .project-item', { hasText: name }).first().click();
      await page.locator('#project-root-label', { hasText: name.toUpperCase() }).waitFor();
      await page.locator('#file-tree .tree-row[data-path]').first().waitFor();
    },
    // The explorer's row of a file or folder, its folders opened first.
    reveal: async (file) => {
      // myglistapps/<project>/<folder>/.../<file>: the folders below the project's.
      const parts = path.relative(w.projects, file).split(path.sep);
      for (let depth = 2; depth < parts.length; depth += 1) {
        const row = page.locator(`#file-tree .tree-row[data-path="${path.join(w.projects, ...parts.slice(0, depth))}"]`);
        await row.waitFor();
        if (!(await row.locator('.tree-arrow.expanded').count())) await row.locator('.tree-arrow').click();
      }
      const row = page.locator(`#file-tree .tree-row[data-path="${file}"]`);
      await row.waitFor();
      return row;
    },
    // Opens a file from the explorer, as a double click does, and waits for its tab.
    openFile: async (file) => {
      await (await t.reveal(file)).dblclick();
      await page.locator(`.editor-tab[data-path="${file}"]`).first().waitFor();
    },
    // The text in the focused side's editor, line by line as drawn.
    editorText: (scope = '.editor-group.focused') => page.evaluate((selector) => {
      const host = document.querySelector(`${selector} .editor-host`) ?? document.querySelector('#editor-host');
      return [...(host?.querySelectorAll('.view-line') ?? [])].sort((a, b) => parseFloat(a.style.top) - parseFloat(b.style.top))
        .map((line) => line.textContent.replace(/\u00a0/g, ' ')).join('\n');
    }, scope),
    // Answers the studio's own yes-or-no dialog (src/confirm-dialog.ts).
    confirm: async (yes = true) => {
      const dialog = page.locator('dialog.confirm-dialog[open]');
      await dialog.waitFor();
      await dialog.locator(yes ? 'button.primary' : 'button:not(.primary)').click();
      await dialog.waitFor({ state: 'detached' }).catch(() => dialog.waitFor({ state: 'hidden' }));
    },
    // A command from the title bar's menus, by the menu's key: menu('git', 'Show Diff').
    menu: async (menu, item) => {
      await page.locator(`.menu-button[data-menu="${menu}"]`).click();
      await page.locator('#menu-popover .menu-item', { hasText: item }).first().click();
    },
    // Shows a side bar view (explorer, commit, debug, engine, plugins); its button hides it when it shows already.
    showView: async (view) => {
      const button = page.locator(`.activity-button[data-view="${view}"]`);
      if (await button.getAttribute('aria-pressed') !== 'true' || await page.locator('#app-shell.sidebar-hidden').count() > 0) await button.click();
    },
    contextItem: (text) => page.locator('.context-menu:not([hidden]) .context-item', { hasText: text }).first(),
    // Picks an option of one of the studio's dropdowns (select-menu.ts) by its words: the button
    // standing in for the <select> opens the options in the studio's menu. The select's classes
    // move to the button; one with an id keeps it, its button right after it ('#id + .select-button').
    choose: async (button, label) => {
      await page.locator(button).first().click();
      await page.locator('.context-menu:not([hidden]) .context-item').filter({ has: page.getByText(label, { exact: true }) }).first().click();
    },
  };

  const cleanUp = async () => {
    await Promise.all(shots);
    await browser?.close().catch(() => undefined);
    if (server) await server.stop().catch(() => undefined);
    const failed = results.some((result) => !result.passed);
    if (w) {
      if (failed && fs.existsSync(path.join(w.root, 'server.log'))) {
        fs.mkdirSync(artifacts, { recursive: true });
        fs.copyFileSync(path.join(w.root, 'server.log'), path.join(artifacts, 'server.log'));
      }
      if (process.env.E2E_KEEP) console.log(`workspace kept: ${w.root}`);
      else fs.rmSync(w.root, { recursive: true, force: true, maxRetries: 3 });
    }
  };
  // Stopped from outside (run.mjs's time limit, Ctrl+C): still end the server and clean up.
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.once(signal, () => { void cleanUp().finally(() => process.exit(1)); });
  }
  // And whatever else ends the process (an error nothing caught): the server goes with it.
  process.once('exit', () => {
    if (server && server.child.exitCode === null && server.child.signalCode === null) {
      signal(descendants(server.child.pid), 'SIGKILL');
      server.child.kill('SIGKILL');
    }
    if (w && !process.env.E2E_KEEP) fs.rmSync(w.root, { recursive: true, force: true });
  });

  try {
    w = makeWorkspace();
    await options.setup?.(w, t);
    server = await startServer(w);
    browser = await chromium.launch({
      args: options.webgl ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : [],
    });
    const context = await browser.newContext({ viewport: options.viewport ?? { width: 1440, height: 900 } });
    if (options.clipboard) await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: `http://127.0.0.1:${server.port}` });
    page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(([language, storage]) => {
      if (sessionStorage.getItem('e2e-seeded')) return;
      // The star prompt opens a modal over everything once a project opens.
      localStorage.setItem('glist-studio-star-prompt', 'done');
      // No CMake configure started by itself when CMakeLists.txt changes: no flow needs one,
      // and CMake is not everywhere.
      localStorage.setItem('glist-studio-auto-configure', 'off');
      localStorage.setItem('glist-studio-language', language);
      for (const [key, value] of Object.entries(storage)) localStorage.setItem(key, value);
      sessionStorage.setItem('e2e-seeded', '1');
    }, [options.language ?? 'en', (typeof options.storage === 'function' ? options.storage(w) : options.storage) ?? {}]);
    if (options.init) await page.addInitScript(options.init);
    await t.load();
    await body(t);
    if (options.pageErrors !== false) check('no page errors', errors.length === 0, errors.join(' | '));
  } catch (error) {
    if (error?.skip) console.log(`SKIP ${skipped}`);
    else check('the flow ran to its end', false, error?.stack ?? String(error));
  }
  await cleanUp();
  const failed = results.filter((result) => !result.passed).length;
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (skipped && !failed) {
    console.log(`skipped (${seconds} s): ${skipped}`);
    process.exit(skipCode);
  }
  console.log(failed ? `${failed} of ${results.length} checks failed (${seconds} s)` : `all ${results.length} checks passed (${seconds} s)`);
  process.exit(failed ? 1 : 0);
};
