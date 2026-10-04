// Runs the end-to-end flows in tests/e2e/flows against the browser build:
// builds the bundle once (build.ts), then runs the flows a few at a time, each
// with its own workspace and server (common.mjs), and prints what passed.
//   npm run e2e                     every flow
//   npm run e2e -- tabs search      the flows whose names contain these words
//   --jobs N        how many run at once (E2E_JOBS; half the CPUs, 2 to 6)
//   --retries N     runs a failed flow again up to N times, reported as flaky if it then passes
//   --no-build      uses the bundle already in out/e2e-web
//   --build-only    builds it and stops
// Each flow's output goes to out/e2e-artifacts/<flow>.log; a failed one also
// leaves its screenshots and server log in out/e2e-artifacts/<flow>/.
// Needs Playwright's Chromium: npx playwright install chromium.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repo = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const flowsDir = path.join(repo, 'tests', 'e2e', 'flows');
const artifacts = path.resolve(process.env.E2E_ARTIFACTS ?? path.join(repo, 'out', 'e2e-artifacts'));
const skipCode = 77;

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  if (at < 0) return fallback;
  const [, value] = args.splice(at, 2);
  return value;
};
const flag = (name) => {
  const at = args.indexOf(name);
  if (at >= 0) args.splice(at, 1);
  return at >= 0;
};
const cpus = os.availableParallelism?.() ?? os.cpus().length;
const jobs = Math.max(1, Number(option('--jobs', process.env.E2E_JOBS ?? Math.min(6, Math.max(2, Math.floor(cpus / 2))))));
const retries = Math.max(0, Number(option('--retries', process.env.E2E_RETRIES ?? 0)));
const timeout = Number(process.env.E2E_TIMEOUT ?? 240) * 1000;
const noBuild = flag('--no-build');
const buildOnly = flag('--build-only');
const filters = args;

try {
  require.resolve('playwright');
} catch {
  console.error('Playwright is not installed: npm ci installs it (a dev dependency), then npx playwright install chromium.');
  process.exit(2);
}

const children = new Set();
const stopAll = () => children.forEach((child) => { try { process.kill(-child.pid, 'SIGTERM'); } catch { /* gone */ } });
process.on('SIGINT', () => { stopAll(); process.exit(130); });
process.on('SIGTERM', () => { stopAll(); process.exit(143); });

const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`;
const startedAll = Date.now();

if (!noBuild || !fs.existsSync(path.join(repo, 'out', 'e2e-web', 'index.html'))) {
  const built = await new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(repo, 'node_modules', 'jiti', 'lib', 'jiti-cli.mjs'), path.join(repo, 'tests', 'e2e', 'build.ts')], { cwd: repo, stdio: 'inherit' });
    child.once('exit', (code) => resolve(code === 0));
  });
  if (!built) {
    console.error('The browser bundle did not build.');
    process.exit(1);
  }
}
if (buildOnly) process.exit(0);

const flows = fs.readdirSync(flowsDir).filter((name) => name.endsWith('.mjs')).sort()
  .filter((name) => filters.length === 0 || filters.some((filter) => name.includes(filter)));
if (flows.length === 0) {
  console.error(`No flow matches ${filters.join(', ')}.`);
  process.exit(2);
}
fs.rmSync(artifacts, { recursive: true, force: true });
fs.mkdirSync(artifacts, { recursive: true });
console.log(`${flows.length} flows, ${jobs} at a time.`);

// One run of a flow, in a process group of its own, so that whatever it started
// (Chromium, its server, the server's clangd and shells) can be ended with it.
const runFlow = (file) => new Promise((resolve) => {
  const name = path.basename(file, '.mjs');
  const started = Date.now();
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(flowsDir, file)], {
    cwd: repo, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, E2E_ARTIFACTS: artifacts },
  });
  children.add(child);
  let output = '';
  child.stdout.on('data', (data) => { output += data; });
  child.stderr.on('data', (data) => { output += data; });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* gone */ }
    setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ } }, 5000);
  }, timeout);
  child.once('close', (code) => {
    clearTimeout(timer);
    children.delete(child);
    // Whatever of the group is still there (a shell the server left behind).
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ }
    if (timedOut) output += `\nStopped after ${seconds(timeout)}.\n`;
    fs.appendFileSync(path.join(artifacts, `${name}.log`), output);
    resolve({ name, code: timedOut ? 1 : code, output, time: Date.now() - started });
  });
});

const results = [];
const queue = [...flows];
const worker = async () => {
  for (let file = queue.shift(); file; file = queue.shift()) {
    let result = await runFlow(file);
    let attempts = 1;
    while (result.code !== 0 && result.code !== skipCode && attempts <= retries) {
      console.log(`again ${result.name} (failed once)`);
      result = await runFlow(file);
      attempts += 1;
    }
    result.flaky = result.code === 0 && attempts > 1;
    results.push(result);
    if (result.code === 0) console.log(`ok    ${result.name} (${seconds(result.time)})${result.flaky ? ' flaky: passed on a later try' : ''}`);
    else if (result.code === skipCode) console.log(`skip  ${result.name}: ${(result.output.match(/^SKIP (.*)$/m) ?? [])[1] ?? ''}`);
    else {
      console.log(`FAIL  ${result.name} (${seconds(result.time)})`);
      const failures = result.output.split('\n').filter((line, index, lines) => /^FAIL /.test(line) || (/^ {7}/.test(line) && lines.slice(0, index).some((l) => /^FAIL /.test(l))));
      console.log((failures.length ? failures : result.output.trim().split('\n').slice(-15)).map((line) => `      ${line}`).join('\n'));
    }
  }
};
await Promise.all(Array.from({ length: Math.min(jobs, flows.length) }, worker));

const passed = results.filter((result) => result.code === 0);
const skipped = results.filter((result) => result.code === skipCode);
const failed = results.filter((result) => result.code !== 0 && result.code !== skipCode);
const flaky = passed.filter((result) => result.flaky);
console.log(`\n${passed.length} passed${flaky.length ? ` (${flaky.length} flaky: ${flaky.map((r) => r.name).join(', ')})` : ''}, `
  + `${failed.length} failed${failed.length ? `: ${failed.map((r) => r.name).join(', ')}` : ''}, `
  + `${skipped.length} skipped${skipped.length ? `: ${skipped.map((r) => r.name).join(', ')}` : ''}, in ${seconds(Date.now() - startedAll)}.`);
if (failed.length) console.log(`Logs, screenshots and server logs: ${path.relative(process.cwd(), artifacts) || artifacts}`);
process.exit(failed.length ? 1 : 0);
