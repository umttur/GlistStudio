import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { formatReport } from '../src/debug-report.ts';
import { callTimes, errorText, log, setLogSink, timeCall } from '../src/log.ts';
import { LogFile } from '../src/log-file.ts';
import { logUpdate } from '../src/app-log.ts';

// Glist Studio's log file: one line each, made safe; a new file past the size,
// never more than the files kept; old files deleted; repeats and floods kept
// short; a folder it cannot write never throwing. Run with jiti.

const root = mkdtempSync(path.join(tmpdir(), 'gs-log-test-'));
const wait = (milliseconds) => new Promise((resolve) => { setTimeout(resolve, milliseconds); });
const read = (file) => (existsSync(file) ? readFileSync(file, 'utf8') : '');
const lines = (file) => read(file).split('\n').filter(Boolean);
const total = (folder) => readdirSync(folder).reduce((sum, name) => sum + statSync(path.join(folder, name)).size, 0);
const open = (name, options = {}) => new LogFile({
  folder: path.join(root, name), name: 'glist-studio', home: '/Users/ada', burst: Infinity, perMinute: Infinity, flushDelay: 5, ...options,
});
const older = (file, index) => file.file.replace(/\.log$/, `.${index}.log`);

try {
  // One line each: the time, the level, the process, and the text, a stack on the same line.
  {
    const file = open('format');
    file.write('main', 'info', 'Glist Studio started');
    file.write('backend 3', 'error', 'crashed: TypeError: x\n    at f (/Users/ada/a.js:1:2)\n    at g');
    await file.flush();
    const written = lines(file.file);
    assert.equal(written.length, 2);
    assert.match(written[0], /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z info \[main\] Glist Studio started$/);
    assert.match(written[1], / error \[backend 3\] crashed: TypeError: x \| at f \(~\/a\.js:1:2\) \| at g$/);
    // A long line is cut.
    file.write('main', 'warn', 'z'.repeat(10000));
    await file.flush();
    const long = lines(file.file)[2];
    assert.ok(long.length < 2100 && long.endsWith('… (10000 characters)'), long.slice(-40));
  }

  // Past the size the file starts again, the one before kept as .1 and that one as .2, in order.
  {
    const file = open('rotate', { maxBytes: 1000 });
    for (let index = 0; index < 30; index += 1) file.write('main', 'info', `line ${index} ${'x'.repeat(40)}`);
    await file.flush();
    for (const each of [file.file, older(file, 1), older(file, 2)]) assert.ok(statSync(each).size <= 1000, each);
    const all = [...lines(older(file, 2)), ...lines(older(file, 1)), ...lines(file.file)].map((line) => Number(/line (\d+) /.exec(line)[1]));
    assert.deepEqual(all, Array.from({ length: 30 }, (_unused, index) => index));
  }

  // Never more than the files kept, each under the size, after writing well over a hundred times as much.
  {
    const file = open('cap', { maxBytes: 4000 });
    const folder = path.join(root, 'cap');
    for (let round = 0; round < 50; round += 1) {
      for (let index = 0; index < 100; index += 1) file.write('main', 'info', `round ${round} line ${index} ${'y'.repeat(60)}`);
      if (round % 2) await file.flush();
      else file.flushSync();
      assert.ok(total(folder) <= 3 * 4000, `${total(folder)} bytes after round ${round}`);
    }
    assert.deepEqual(readdirSync(folder).sort(), ['glist-studio.1.log', 'glist-studio.2.log', 'glist-studio.log']);
    assert.match(lines(file.file).at(-1), /round 49 line 99 y+$/);
  }

  // Log files older than two weeks go at start; others in the folder stay, as
  // do recent ones; this log's files beyond those kept go too.
  {
    const folder = path.join(root, 'age');
    mkdirSync(folder, { recursive: true });
    const old = Date.now() / 1000 - 20 * 24 * 60 * 60;
    for (const name of ['glist-studio.log', 'glist-studio.1.log', 'glist-studio-web.2.log', 'notes.txt', 'glist-studio-backup.log']) {
      writeFileSync(path.join(folder, name), 'old\n');
      utimesSync(path.join(folder, name), old, old);
    }
    writeFileSync(path.join(folder, 'glist-studio-web.log'), 'recent\n');
    writeFileSync(path.join(folder, 'glist-studio.7.log'), 'beyond those kept\n');
    const file = open('age');
    await file.flush();
    assert.deepEqual(readdirSync(folder).sort(), ['glist-studio-backup.log', 'glist-studio-web.log', 'notes.txt']);
  }

  // A line repeating is written once, and how many times it came again.
  {
    const file = open('repeat');
    for (let index = 0; index < 533; index += 1) file.write('backend 2', 'error', 'unhandled rejection: boom');
    file.write('backend 2', 'warn', 'unhandled rejection: boom');
    file.write('main', 'info', 'something else');
    await file.flush();
    const written = lines(file.file);
    assert.equal(written.length, 4);
    assert.match(written[0], / error \[backend 2\] unhandled rejection: boom$/);
    assert.match(written[1], / error \[backend 2\] last line repeated 532 more times$/);
    assert.match(written[2], / warn \[backend 2\] unhandled rejection: boom$/);
    assert.match(written[3], / info \[main\] something else$/);
  }

  // A repeat that goes on is said once a minute, not with every write, and at the end.
  {
    let now = 1000000;
    const file = open('repeat-minute', { now: () => now });
    for (let index = 0; index < 10000; index += 1) { file.write('main', 'error', 'loop'); now += 30; }
    file.flushSync();
    const written = lines(file.file);
    assert.match(written[0], /\[main\] loop$/);
    const counts = written.slice(1).map((line) => Number(/last line repeated (\d+) more times$/.exec(line)?.[1]));
    assert.ok(written.length <= 7, written.join('\n'));
    assert.equal(counts.reduce((sum, count) => sum + count, 0), 9999);
  }

  // A flood: past the burst, lines are counted, not written, and said when the rate lets a line through again.
  {
    let now = 0;
    const file = open('rate', { now: () => now, burst: 1000, perMinute: 600 });
    for (let index = 0; index < 100; index += 1) file.write('page', 'error', `error number ${index}`);
    await file.flush();
    const kept = lines(file.file).length;
    assert.ok(kept >= 15 && kept <= 20, `${kept} lines`);
    now += 60000;
    file.write('page', 'info', 'after the flood');
    await file.flush();
    const written = lines(file.file);
    assert.match(written.at(-2), new RegExp(` warn \\[log\\] ${100 - kept} lines left out, too many at once$`));
    assert.match(written.at(-1), / info \[page\] after the flood$/);
    // As the process ends, lines left out are said even with none let through after them.
    for (let index = 0; index < 100; index += 1) file.write('page', 'error', `again ${index}`);
    file.flushSync();
    assert.match(lines(file.file).at(-1), / warn \[log\] \d+ lines left out, too many at once$/);
  }

  // Ten minutes of different errors, two hundred a second, write no more than the burst and the rate allow.
  {
    let now = 0;
    const file = open('flood', { now: () => now, burst: 64 * 1024, perMinute: 16 * 1024 });
    for (let index = 0; index < 120000; index += 1) {
      file.write('backend 1', 'error', `unhandled rejection: failed to read item ${index}`);
      now += 5;
      if (index % 20000 === 0) await file.flush();
    }
    await file.flush();
    const bytes = statSync(file.file).size;
    assert.ok(bytes <= 64 * 1024 + 10 * 16 * 1024 + 2048, `${bytes} bytes`);
    assert.ok(read(file.file).includes('lines left out, too many at once'));
  }

  // Made safe as the debug report is: the home folder ~, git's name and email, mail addresses and tokens hidden.
  {
    const file = open('redact');
    file.addPersonal(['Ada Lovelace', 'ada@example.org']);
    file.write('window 1', 'error', 'failed at /Users/ada/dev/glist/myglistapps/Game/src/main.cpp by Ada Lovelace <ada@example.org> '
      + 'with ghp_abcdefghijklmnopqrstuvwxyz0123456789, GITHUB_TOKEN=abc123 and https://ada:s3cret@github.com/a/b.git');
    await file.flush();
    const text = read(file.file);
    assert.ok(text.includes('failed at ~/dev/glist/myglistapps/Game/src/main.cpp by [hidden] <[hidden]>'), text);
    for (const secret of ['/Users/ada', 'Ada Lovelace', 'ada@example.org', 'ghp_', 'abc123', 's3cret']) assert.ok(!text.includes(secret), secret);
    // A name learnt after a line was written is hidden in the tail the report gets.
    const late = open('redact-late');
    late.write('main', 'info', 'committed as Grace Hopper');
    await late.flush();
    late.addPersonal(['Grace Hopper']);
    assert.match((await late.tail())[0], / info \[main\] committed as \[hidden\]$/);
  }

  // The tail: the last lines, from the file before too, in order.
  {
    const file = open('tail', { maxBytes: 400 });
    for (let index = 0; index < 12; index += 1) file.write('main', 'info', `tail line ${index}`);
    const five = await file.tail(5);
    assert.deepEqual(five.map((line) => /tail line (\d+)$/.exec(line)[1]), ['7', '8', '9', '10', '11']);
    assert.ok(existsSync(older(file, 1)));
    assert.equal((await file.tail(40)).length, 12);
  }

  // Written at once as the process ends, with the repeat not said yet.
  {
    const file = open('sync', { flushDelay: 60000 });
    for (let index = 0; index < 3; index += 1) file.write('main', 'info', 'before quitting');
    file.flushSync();
    const written = lines(file.file);
    assert.equal(written.length, 2);
    assert.match(written[1], / info \[main\] last line repeated 2 more times$/);
  }

  // A folder it cannot write: nothing throws, and it quietly stops.
  {
    const blocker = path.join(root, 'blocker');
    writeFileSync(blocker, 'a file, not a folder');
    for (const folder of [path.join(blocker, 'logs'), '/dev/null/logs']) {
      const file = new LogFile({ folder, name: 'glist-studio', flushDelay: 1 });
      file.write('main', 'info', 'nowhere');
      await file.flush();
      assert.equal(file.stopped, true, folder);
      file.write('main', 'info', 'still nowhere');
      file.flushSync();
      assert.ok(Array.isArray(await file.tail()));
    }
    const syncOnly = new LogFile({ folder: path.join(blocker, 'logs'), name: 'glist-studio' });
    syncOnly.write('main', 'info', 'at exit');
    syncOnly.flushSync();
    assert.equal(syncOnly.stopped, true);
    if (process.getuid?.() !== 0) {
      const locked = path.join(root, 'locked');
      mkdirSync(locked);
      chmodSync(locked, 0o500);
      const file = new LogFile({ folder: locked, name: 'glist-studio', flushDelay: 1 });
      file.write('main', 'info', 'not allowed');
      await wait(30);
      await file.flush();
      assert.equal(file.stopped, true);
      assert.deepEqual(readdirSync(locked), []);
      chmodSync(locked, 0o700);
    }
    // A file that cannot be moved aside stops the log rather than letting it grow.
    const stuck = open('stuck', { maxBytes: 300, keep: 1 });
    mkdirSync(older(stuck, 1), { recursive: true });
    writeFileSync(path.join(older(stuck, 1), 'inside'), 'x');
    for (let index = 0; index < 20; index += 1) stuck.write('main', 'info', `line ${index} ${'s'.repeat(30)}`);
    await stuck.flush();
    assert.equal(stuck.stopped, true);
    assert.ok(statSync(stuck.file).size <= 300);
  }

  // log() never throws, whatever the sink does; errors are one line with where they were thrown.
  {
    setLogSink(() => { throw new Error('sink broke'); });
    log('info', 'nothing happens');
    setLogSink(() => undefined);
    assert.equal(errorText('plain'), 'plain');
    const error = new Error('boom');
    error.stack = 'Error: boom\n    at a (x.js:1:1)\n    at b (y.js:2:2)';
    assert.equal(errorText(error), 'boom | at a (x.js:1:1) | at b (y.js:2:2)');
    assert.equal(errorText({ source: 'backend', message: 'gone', stack: 'TypeError: gone\n    at c (z.js:3:3)' }), 'gone | at c (z.js:3:3)');
  }

  // Slow calls: the method and how long, never the arguments; one never answered is told while it waits.
  {
    const said = [];
    setLogSink((level, text) => said.push(`${level} ${text}`));
    const before = { ...callTimes };
    Object.assign(callTimes, { slow: 30, waiting: 80, check: 10 });
    const secret = "SELECT * FROM players WHERE name = 'Ada'";
    const query = (sql) => timeCall('databaseQuery', new Promise((resolve) => { setTimeout(() => resolve(sql.length), 50); }), 'backend of window 1: ');
    assert.equal(await query(secret), secret.length);
    await timeCall('readFile', Promise.resolve('fast'));
    let fail;
    void timeCall('ping', new Promise((_resolve, reject) => { fail = reject; })).catch(() => undefined);
    await wait(150);
    fail(new Error('backend stopped'));
    await wait(5);
    await timeCall('odd;name\n', Promise.resolve());
    // A build is long by design: its time is said, not as a warning, and not while it goes.
    await timeCall('buildProject', new Promise((resolve) => { setTimeout(resolve, 150); }));
    Object.assign(callTimes, before);
    setLogSink(() => undefined);
    assert.equal(said.length, 4, said.join('\n'));
    assert.match(said[3], /^info call buildProject took 0\.\d s$/);
    assert.match(said[0], /^info backend of window 1: call databaseQuery took 0\.\d s$/);
    assert.match(said[1], /^warn call ping still waiting after 0\.\d s$/);
    assert.match(said[2], /^warn call ping took 0\.\d s, failed$/);
    assert.ok(!said.join('\n').includes('players'));
  }

  // Updates: each change once, with the versions; going back says so.
  {
    const said = [];
    setLogSink((level, text) => said.push(`${level} ${text}`));
    logUpdate({ state: 'checking', current: '0.1.0' });
    logUpdate({ state: 'checking', current: '0.1.0' });
    logUpdate({ state: 'downloading', current: '0.1.0', version: '0.2.0' });
    logUpdate({ state: 'ready', current: '0.1.0', version: '0.2.0' });
    logUpdate({ state: 'ready', current: '0.1.0', version: '0.2.0' });
    logUpdate({ state: 'unavailable' });
    logUpdate({ state: 'downloading', current: '0.2.0', version: '0.1.0', rollback: true });
    logUpdate({ state: 'failed', current: '0.2.0', message: 'checksum differs' });
    logUpdate({ state: 'up-to-date', current: '0.1.0', held: '0.2.0' });
    setLogSink(() => undefined);
    assert.deepEqual(said, [
      'info checking for updates, running 0.1.0', 'info downloading 0.2.0', 'info 0.2.0 ready, installs on quit',
      'info downloading 0.1.0 (going back)', 'warn update failed: checksum differs', 'info up to date, running 0.1.0, gone back from 0.2.0',
    ]);
  }

  // Copy Debug Info's ### Log: the lines, made safe once more with the report's names.
  {
    const report = formatReport({
      time: '2026-10-04T10:00:00.000Z',
      app: { version: '0.1.0', commit: null, packaged: true, platform: 'darwin', arch: 'arm64', release: '25.0.0', systemVersion: '26.0', versions: { node: '24' }, home: '/Users/ada' },
      about: null,
      window: { project: null, zoom: 100, theme: 'Dark', language: 'en' },
      settings: [],
      personal: ['Ada Lovelace'],
      log: ['2026-10-04T09:59:00.000Z info [main] Glist Studio 0.1.0 started', '2026-10-04T09:59:01.000Z error [window 1] committed as Ada Lovelace in /Users/ada/x'],
    });
    assert.ok(report.endsWith('### Log\n```text\n2026-10-04T09:59:00.000Z info [main] Glist Studio 0.1.0 started\n'
      + '2026-10-04T09:59:01.000Z error [window 1] committed as [hidden] in ~/x\n```\n'), report);
    const none = formatReport({ time: 't', app: null, about: null, window: { project: null, zoom: 100, theme: '', language: '' }, settings: [], personal: [] });
    assert.ok(!none.includes('### Log'));
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('Log file tests passed.');
