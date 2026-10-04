// npm test's commands one by one, each with a time limit, going on past one
// that fails: for a pull request's checks (.github/workflows/checks.yml), so
// they show every test that fails, not only the first, and a test that hangs
// fails by itself instead of holding the job until it is cancelled.
// TEST_TIME_LIMIT sets the limit in seconds; 300 if not.
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const limit = Number(process.env.TEST_TIME_LIMIT ?? 300) * 1000;
const commands = JSON.parse(readFileSync('package.json', 'utf8')).scripts.test.split('&&').map((command) => command.trim()).filter(Boolean);
const actions = Boolean(process.env.GITHUB_ACTIONS);
// As npm runs scripts: its .bin first on PATH, whatever case Windows names PATH in.
const pathKey = Object.keys(process.env).find((name) => name.toUpperCase() === 'PATH') ?? 'PATH';
const env = { ...process.env, [pathKey]: `${path.resolve('node_modules', '.bin')}${path.delimiter}${process.env[pathKey] ?? ''}` };

// Ends a command and what it started: on Windows the shell's children outlive it otherwise.
const end = (child) => {
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Gone already. */ }
};

const run = (command) => new Promise((resolve) => {
  const started = Date.now();
  const child = spawn(command, { shell: true, stdio: 'inherit', env, detached: process.platform !== 'win32' });
  const timer = setTimeout(() => { end(child); resolve({ ok: false, why: `still running after ${limit / 1000} s` }); }, limit);
  child.on('exit', (code, signal) => {
    clearTimeout(timer);
    resolve(code === 0 ? { ok: true, seconds: (Date.now() - started) / 1000 } : { ok: false, why: signal ? `ended by ${signal}` : `exit code ${code}` });
  });
});

const failed = [];
for (const command of commands) {
  if (actions) console.log(`::group::${command}`);
  const result = await run(command);
  if (actions) console.log('::endgroup::');
  if (!result.ok) {
    failed.push(`${command}: ${result.why}`);
    console.log(actions ? `::error::${command}: ${result.why}` : `FAILED ${command}: ${result.why}`);
  }
}
console.log(failed.length ? `\n${failed.length} of ${commands.length} failed:\n${failed.join('\n')}` : `\nAll ${commands.length} passed.`);
process.exit(failed.length ? 1 : 0);
