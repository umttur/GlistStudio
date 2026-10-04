/* global BigInt */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Databases, cellOf, countedRows, statementStart, writes } from '../src/database.ts';
import { WindowDatabases, forkedDatabase } from '../src/database-client.ts';
import { createTableSql, quoteName } from '../src/database-sql.ts';
import { isDatabaseSideFile } from '../src/databases.ts';
import { isHiddenFolder } from '../src/hidden-folders.ts';

// What crosses to the window: big integers as text, BLOBs as their size.
assert.equal(cellOf(BigInt(42)), 42);
assert.equal(cellOf(BigInt('9007199254740993')), '9007199254740993');
assert.deepEqual(cellOf(new Uint8Array([1, 2, 3])), { blob: 3 });
assert.equal(cellOf(undefined), null);
assert.equal(statementStart('  -- note\n /* block */ ;; select 1'), 'select 1');
assert.equal(statementStart('-- only a comment'), '');

// The New Table form's SQL: names quoted, one INTEGER key left as the rowid,
// several made one key together, defaults as text unless numbers or keywords.
const column = (name, type, more = {}) => ({ name, type, primaryKey: false, notNull: false, unique: false, defaultValue: '', ...more });
assert.equal(quoteName('say "hi"'), '"say ""hi"""');
assert.equal(createTableSql('items', [
  column('id', 'INTEGER', { primaryKey: true }),
  column('label', 'TEXT', { notNull: true, unique: true, defaultValue: "it's" }),
  column('made', 'TEXT', { defaultValue: 'current_timestamp' }),
  column('', 'TEXT'),
]), `CREATE TABLE "items" (\n  "id" INTEGER PRIMARY KEY,\n  "label" TEXT NOT NULL UNIQUE DEFAULT 'it''s',\n  "made" TEXT DEFAULT current_timestamp\n);`);
assert.equal(createTableSql('pairs', [column('a', 'INTEGER', { primaryKey: true }), column('b', 'TEXT', { primaryKey: true, defaultValue: '-1.5' })]),
  `CREATE TABLE "pairs" (\n  "a" INTEGER,\n  "b" TEXT DEFAULT -1.5,\n  PRIMARY KEY ("a", "b")\n);`);

// What writes to the file, as SQLite's program for it says: not a read, an
// EXPLAIN, a TEMP table or VACUUM; a change of rows, PRAGMA user_version and ANALYZE.
const { DatabaseSync } = await import('node:sqlite');
const probe = new DatabaseSync(':memory:');
probe.exec('CREATE TABLE t (a)');
assert.deepEqual(['SELECT * FROM t', 'INSERT INTO t VALUES (1)', 'EXPLAIN INSERT INTO t VALUES (1)', 'CREATE TEMP TABLE x (a)', 'VACUUM', 'PRAGMA user_version = 1', 'ANALYZE']
  .map((sql) => writes(probe, sql)), [false, true, false, false, false, true, true]);
probe.close();

const root = mkdtempSync(path.join(tmpdir(), 'glist-database-'));
const file = path.join(root, 'game.db');
const elsewhere = path.join(root, 'engine.db');
const notSqlite = path.join(root, 'notes.db');
writeFileSync(notSqlite, 'just some text');
const databases = new Databases(async (filePath) => {
  if (filePath === notSqlite) throw new Error('not a database');
  return { file: filePath, readOnly: filePath === elsewhere };
}, () => 'unavailable');
// What the file itself holds, read beside the studio.
const inFile = (sql) => {
  const reader = new DatabaseSync(file, { readOnly: true });
  try { return reader.prepare(sql).all(); } finally { reader.close(); }
};
const pending = async () => (await databases.schema(file)).pending;
let other;

try {
  // The console: statements run in order, each before the next is read, a
  // trigger's body kept whole, results and changes per statement.
  const made = await databases.query(file, `
    CREATE TABLE players (id INTEGER PRIMARY KEY, name TEXT NOT NULL, score REAL DEFAULT 0, avatar BLOB, big INTEGER);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT) WITHOUT ROWID;
    CREATE VIEW leaders AS SELECT name, score FROM players ORDER BY score DESC;
    CREATE TABLE log (what TEXT);
    CREATE TRIGGER logged AFTER INSERT ON players BEGIN INSERT INTO log VALUES ('added ' || new.name); SELECT 1; END;
    -- a comment between
    INSERT INTO players (name, score, avatar, big) VALUES ('ada', 12.5, x'00ff', 9007199254740993), ('linus', 7, NULL, 1);
    INSERT INTO settings VALUES ('volume', '7');
    SELECT name, score, avatar, big FROM players ORDER BY id`);
  assert.equal(made.length, 8, JSON.stringify(made));
  assert.ok(made.every((result) => !('error' in result)), JSON.stringify(made));
  assert.equal(made[5].changes, 2);
  assert.deepEqual(made[7].columns, ['name', 'score', 'avatar', 'big']);
  assert.deepEqual(made[7].rows, [['ada', 12.5, { blob: 2 }, '9007199254740993'], ['linus', 7, null, 1]]);
  assert.match(made[4].sql, /BEGIN INSERT INTO log .* END;$/);

  // It stops at the first statement that fails, saying which.
  const failed = await databases.query(file, "SELECT 1; SELECT nope FROM players; SELECT 2");
  assert.equal(failed.length, 2);
  assert.match(failed[1].error, /no such column: nope/);

  // The schema: tables and views, columns, row counts, triggers.
  const schema = await databases.schema(file);
  assert.deepEqual(schema.tables.map((table) => `${table.kind}:${table.name}:${table.rows}`), ['table:log:2', 'table:players:2', 'table:settings:1', 'view:leaders:null']);
  const players = schema.tables.find((table) => table.name === 'players');
  assert.deepEqual(players.columns.map((column) => [column.name, column.type, column.notNull, column.primaryKey, column.defaultValue]),
    [['id', 'INTEGER', false, 1, null], ['name', 'TEXT', true, 0, null], ['score', 'REAL', false, 0, '0'], ['avatar', 'BLOB', false, 0, null], ['big', 'INTEGER', false, 0, null]]);
  assert.equal(schema.tables.find((table) => table.name === 'settings').withoutRowid, true);
  assert.deepEqual(schema.triggers.map((trigger) => trigger.name), ['logged']);
  assert.equal(schema.readOnly, false);

  // Rows a page at a time, sorted and filtered, with their keys.
  const page = await databases.rows(file, 'players', { orderBy: 'score', descending: true, where: 'score > 1 -- a note that must not end the LIMIT' });
  assert.deepEqual(page.columns, ['id', 'name', 'score', 'avatar', 'big']);
  assert.deepEqual(page.rows.map((row) => row[1]), ['ada', 'linus']);
  assert.deepEqual(page.keyColumns, ['rowid']);
  assert.deepEqual(page.keys, [[1], [2]]);
  assert.equal(page.total, 2);
  const view = await databases.rows(file, 'leaders', {});
  assert.equal(view.keys, null);
  const keyed = await databases.rows(file, 'settings', {});
  assert.deepEqual([keyed.keyColumns, keyed.keys], [['key'], [['volume']]]);

  // Edits: a value changed (SQLite's affinity makes '30' a number in a REAL
  // column), NULL set, a row added and rows deleted; a WITHOUT ROWID table by
  // its key; a view refused.
  assert.equal((await databases.edit(file, { kind: 'update', table: 'players', key: [2], column: 'score', value: '30' })).changes, 1);
  await databases.edit(file, { kind: 'update', table: 'players', key: [1], column: 'avatar', value: null });
  await databases.edit(file, { kind: 'insert', table: 'players', values: { name: 'grace' } });
  await databases.edit(file, { kind: 'update', table: 'settings', key: ['volume'], column: 'value', value: '9' });
  const after = await databases.query(file, "SELECT name, score, typeof(score), avatar FROM players ORDER BY id; SELECT value FROM settings; SELECT count(*) FROM log");
  assert.deepEqual(after[0].rows, [['ada', 12.5, 'real', null], ['linus', 30, 'real', null], ['grace', 0, 'real', null]]);
  assert.deepEqual(after[1].rows, [['9']]);
  assert.deepEqual(after[2].rows, [[3]]);
  assert.equal((await databases.edit(file, { kind: 'delete', table: 'players', keys: [[1], [3]] })).changes, 2);
  await assert.rejects(databases.edit(file, { kind: 'update', table: 'leaders', key: [1], column: 'name', value: 'x' }), /view/);
  await assert.rejects(databases.edit(file, { kind: 'insert', table: 'players', values: { score: '1' } }), /NOT NULL/);

  // All of it waits in one transaction, each statement that wrote and each
  // edit a change: the tab reads them, the file does not have them yet, and
  // another connection cannot write meanwhile. Committed, the file has them.
  assert.deepEqual(await pending(), { open: true, changes: 12 });
  assert.deepEqual(inFile('SELECT name FROM sqlite_schema'), []);
  other = new DatabaseSync(file, { timeout: 100 });
  assert.throws(() => other.exec('CREATE TABLE beside (a)'), /locked/);
  assert.deepEqual(databases.finish(file, true), { open: false, changes: 0 });
  assert.deepEqual(inFile('SELECT name FROM players ORDER BY id').map((found) => found.name), ['linus']);

  // Discarded, they are gone; and closed with changes waiting, as when the
  // backend stops, the file never gets them.
  await databases.edit(file, { kind: 'update', table: 'players', key: [2], column: 'name', value: 'changed' });
  assert.equal((await databases.rows(file, 'players', {})).rows[0][1], 'changed');
  assert.equal(inFile('SELECT name FROM players')[0].name, 'linus');
  assert.deepEqual(databases.finish(file, false), { open: false, changes: 0 });
  assert.equal((await databases.rows(file, 'players', {})).rows[0][1], 'linus');
  await databases.query(file, "INSERT INTO log VALUES ('closing')");
  databases.close(file);
  assert.deepEqual(await pending(), { open: false, changes: 0 });
  assert.equal(inFile("SELECT count(*) AS n FROM log WHERE what = 'closing'")[0].n, 0);
  // A database not open has nothing waiting, and is not opened to say so.
  assert.deepEqual(databases.finish(path.join(root, 'never.db'), true), { open: false, changes: 0 });
  assert.equal(existsSync(path.join(root, 'never.db')), false);

  // Reading leaves no transaction open: another connection writes at once.
  const read = await databases.query(file, 'SELECT * FROM players; PRAGMA user_version; EXPLAIN SELECT 1; SELECT * FROM leaders');
  assert.ok(read.every((result) => 'columns' in result), JSON.stringify(read));
  assert.deepEqual(await pending(), { open: false, changes: 0 });
  other.exec("INSERT INTO log VALUES ('beside')");

  // VACUUM, which SQLite runs only outside a transaction, runs as typed while
  // nothing waits, and says why not while something does; a TEMP table is not
  // the file's; PRAGMA user_version, which changes no row, waits like the rest.
  const vacuumed = await databases.query(file, 'VACUUM; CREATE TEMP TABLE scratch (a); PRAGMA user_version = 7');
  assert.ok(vacuumed.every((result) => !('error' in result)), JSON.stringify(vacuumed));
  assert.deepEqual(await pending(), { open: true, changes: 1 });
  assert.equal(inFile('PRAGMA user_version')[0].user_version, 0);
  assert.match((await databases.query(file, 'VACUUM'))[0].error, /cannot VACUUM from within a transaction/);
  databases.finish(file, true);
  assert.equal(inFile('PRAGMA user_version')[0].user_version, 7);

  // BEGIN, COMMIT and ROLLBACK typed run as typed: begun and committed in one
  // run, nothing is left waiting; left open, it waits, its changes counted
  // from none; BEGIN again says one is open, and ROLLBACK discards it. A run
  // that commits and begins again counts only what came after.
  await databases.query(file, "BEGIN IMMEDIATE; INSERT INTO log VALUES ('typed'); COMMIT");
  await databases.query(file, "SAVEPOINT one; INSERT INTO log VALUES ('saved'); RELEASE one");
  assert.deepEqual(await pending(), { open: false, changes: 0 });
  assert.equal(inFile("SELECT count(*) AS n FROM log WHERE what IN ('typed', 'saved')")[0].n, 2);
  await databases.query(file, 'BEGIN');
  assert.deepEqual(await pending(), { open: true, changes: 0 });
  await databases.query(file, 'ROLLBACK');
  await databases.query(file, "BEGIN; INSERT INTO log VALUES ('left open'); SELECT 1");
  assert.deepEqual(await pending(), { open: true, changes: 1 });
  assert.match((await databases.query(file, 'BEGIN'))[0].error, /within a transaction/);
  await databases.query(file, 'ROLLBACK');
  assert.deepEqual(await pending(), { open: false, changes: 0 });
  assert.deepEqual((await databases.query(file, "SELECT count(*) FROM log WHERE what = 'left open'"))[0].rows, [[0]]);
  await databases.query(file, "INSERT INTO log VALUES ('first'); COMMIT; BEGIN; INSERT INTO log VALUES ('second')");
  assert.deepEqual(await pending(), { open: true, changes: 1 });
  databases.finish(file, false);
  assert.deepEqual(inFile("SELECT what FROM log WHERE what IN ('first', 'second')").map((found) => found.what), ['first']);

  // A change that fails leaves what waits as it was, and as the first begins
  // nothing; one that undoes the whole transaction itself (OR ROLLBACK) leaves
  // nothing waiting.
  assert.match((await databases.query(file, "INSERT INTO settings VALUES ('volume', 'again')"))[0].error, /UNIQUE/);
  assert.deepEqual(await pending(), { open: false, changes: 0 });
  await databases.edit(file, { kind: 'insert', table: 'settings', values: { key: 'speed', value: '1' } });
  assert.match((await databases.query(file, "INSERT INTO settings VALUES ('speed', '2')"))[0].error, /UNIQUE/);
  assert.deepEqual(await pending(), { open: true, changes: 1 });
  await databases.query(file, "INSERT OR ROLLBACK INTO settings VALUES ('speed', '3')");
  assert.deepEqual(await pending(), { open: false, changes: 0 });
  assert.deepEqual(inFile("SELECT value FROM settings WHERE key = 'speed'"), []);

  // One elsewhere is only read; a file that is not SQLite is refused.
  await databases.query(elsewhere, 'SELECT 1').catch(() => undefined);
  databases.close(elsewhere);
  new DatabaseSync(elsewhere).exec('CREATE TABLE t (a); INSERT INTO t VALUES (1)');
  assert.equal((await databases.schema(elsewhere)).readOnly, true);
  const refused = await databases.query(elsewhere, 'INSERT INTO t VALUES (2)');
  assert.match(refused[0].error, /readonly/);
  assert.deepEqual((await databases.schema(elsewhere)).pending, { open: false, changes: 0 });
  await assert.rejects(databases.schema(notSqlite), /not a database/);
} finally {
  other?.close();
  databases.closeAll();
  rmSync(root, { recursive: true, force: true });
}

// A big table's rows are counted only so far, so that it opens fast: past
// that, "more". A page's total is counted as far past the page, so Next goes
// on; a filter counts what it lets through.
{
  const bigRoot = mkdtempSync(path.join(tmpdir(), 'glist-database-big-'));
  const big = path.join(bigRoot, 'big.db');
  const maker = new DatabaseSync(big);
  maker.exec(`CREATE TABLE events (id INTEGER PRIMARY KEY, kind TEXT); CREATE TABLE few (a);
    WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < ${countedRows + 5}) INSERT INTO events (kind) SELECT 'k' || (x % 3) FROM c;
    INSERT INTO few VALUES (1), (2)`);
  maker.close();
  const counting = new Databases(async (filePath) => ({ file: filePath, readOnly: true }), () => 'unavailable');
  try {
    const tables = (await counting.schema(big)).tables;
    assert.deepEqual(tables.map((table) => [table.name, table.rows, table.moreRows]), [['events', countedRows, true], ['few', 2, false]]);
    const first = await counting.rows(big, 'events', {});
    assert.deepEqual([first.total, first.moreRows, first.rows.length], [countedRows, true, 100]);
    const last = await counting.rows(big, 'events', { offset: countedRows });
    assert.deepEqual([last.total, last.moreRows, last.rows.length], [countedRows + 5, false, 5]);
    const filtered = await counting.rows(big, 'events', { where: 'id <= 250' });
    assert.deepEqual([filtered.total, filtered.moreRows], [250, false]);
  } finally {
    counting.closeAll();
    rmSync(bigRoot, { recursive: true, force: true });
  }
}

// The databases' own process, as the backend uses it (database-client.ts),
// forked from the browser build's script: calls answered, errors with their
// messages, values as the window gets them, changes waiting between calls;
// the process ended by itself in the middle of a call, or stopped, losing
// what waited and saying so, and a new one for the next call; let go of when
// idle, it closes its databases itself.
{
  const clientRoot = mkdtempSync(path.join(tmpdir(), 'glist-database-client-'));
  const game = path.join(clientRoot, 'game.db');
  const text = path.join(clientRoot, 'notes.db');
  writeFileSync(text, 'just some text');
  const script = fileURLToPath(new URL('../src/web/database-process.cjs', import.meta.url));
  const processes = [];
  const lost = [];
  const located = [];
  const windowDatabases = new WindowDatabases(async (filePath) => {
    located.push(filePath);
    if (filePath === text) throw new Error('not a database');
    return { file: filePath, readOnly: false };
  }, {
    start: async () => {
      const channel = forkedDatabase(script);
      const started = { channel, gone: false };
      processes.push(started);
      return { ...channel, listen: (reply, gone) => channel.listen(reply, () => { started.gone = true; gone(); }) };
    },
    lost: (stopped) => lost.push(stopped),
    unavailable: () => 'unavailable here',
    stoppedMessage: () => 'stopped here',
    endedMessage: () => 'ended here',
  });
  const until = async (ready, what) => {
    for (const started = Date.now(); !ready(); await new Promise((resolve) => { setTimeout(resolve, 20); })) {
      if (Date.now() - started > 10000) throw new Error(`timed out waiting for ${what}`);
    }
  };
  const inGame = (sql) => {
    const reader = new DatabaseSync(game, { readOnly: true });
    try { return reader.prepare(sql).all(); } finally { reader.close(); }
  };
  const endless = 'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c) SELECT count(*) FROM c';
  try {
    // Nothing is started for what has nothing open, nor for a file the backend refuses.
    assert.deepEqual(await windowDatabases.finish(game, true), { open: false, changes: 0 });
    await windowDatabases.close(game);
    await assert.rejects(windowDatabases.schema(text), { message: 'not a database' });
    assert.equal(processes.length, 0);

    // Answered there, values as the window gets them.
    const made = await windowDatabases.query(game, `PRAGMA journal_mode = WAL; CREATE TABLE players (id INTEGER PRIMARY KEY, name TEXT, big INTEGER, avatar BLOB);
      INSERT INTO players (name, big, avatar) VALUES ('ada', 9007199254740993, x'00ff00'); SELECT name, big, avatar FROM players`);
    assert.ok(made.every((result) => !('error' in result)), JSON.stringify(made));
    assert.deepEqual(made.at(-1).rows, [['ada', '9007199254740993', { blob: 3 }]]);
    assert.equal(processes.length, 1);
    await windowDatabases.finish(game, true);

    // An error crosses with its message, as one in the backend had it.
    await assert.rejects(windowDatabases.rows(game, 'nope', {}), { message: 'no such table: nope' });
    assert.match((await windowDatabases.query(game, 'SELECT nope FROM players'))[0].error, /no such column: nope/);

    // A change waits between calls, in the process, until committed.
    const edited = await windowDatabases.edit(game, { kind: 'update', table: 'players', key: [1], column: 'name', value: 'grace' });
    assert.deepEqual(edited.pending, { open: true, changes: 1 });
    assert.deepEqual((await windowDatabases.schema(game)).pending, { open: true, changes: 1 });
    assert.equal((await windowDatabases.rows(game, 'players', {})).rows[0][1], 'grace');
    assert.equal(inGame('SELECT name FROM players')[0].name, 'ada');
    assert.deepEqual(await windowDatabases.finish(game, true), { open: false, changes: 0 });
    assert.equal(inGame('SELECT name FROM players')[0].name, 'grace');
    // Each call that opens finds the file again, here.
    assert.ok(located.filter((filePath) => filePath === game).length >= 4);

    // Ended by itself in the middle of a call: the call fails, the change
    // waiting is lost and the window told, and the next call has a new one.
    await windowDatabases.edit(game, { kind: 'update', table: 'players', key: [1], column: 'name', value: 'lost' });
    const cut = windowDatabases.query(game, endless);
    await new Promise((resolve) => { setTimeout(resolve, 300); });
    processes[0].channel.kill();
    await assert.rejects(cut, { message: 'ended here' });
    assert.deepEqual(lost, [false]);
    assert.deepEqual((await windowDatabases.schema(game)).pending, { open: false, changes: 0 });
    assert.equal(processes.length, 2);
    assert.equal(inGame('SELECT name FROM players')[0].name, 'grace');

    // Stop does nothing while nothing runs; while something does, the
    // process itself is ended, in the middle of a statement, and so is what
    // waited; the next call has a new one.
    assert.equal(windowDatabases.stop(), false);
    assert.equal(processes[1].gone, false);
    await windowDatabases.edit(game, { kind: 'update', table: 'players', key: [1], column: 'name', value: 'stopped' });
    const long = windowDatabases.query(game, endless);
    const comparing = windowDatabases.compare(game, game, {});
    await new Promise((resolve) => { setTimeout(resolve, 300); });
    assert.equal(windowDatabases.stop(), true);
    await assert.rejects(long, { message: 'stopped here' });
    await assert.rejects(comparing, { message: 'stopped here' });
    assert.deepEqual(lost, [false, true]);
    await until(() => processes[1].gone, 'the stopped process to end');
    assert.equal(inGame('SELECT name FROM players')[0].name, 'grace');
    assert.deepEqual((await windowDatabases.schema(game)).pending, { open: false, changes: 0 });
    assert.equal(processes.length, 3);

    // Comparisons run there too.
    const diff = await windowDatabases.compare(null, game, {});
    assert.deepEqual(diff.tables.map((table) => [table.name, table.state, table.rows.added]), [['players', 'added', 1]]);

    // Let go of while idle, it closes its databases and ends by itself: the
    // WAL database's changes are written back to the file.
    await windowDatabases.query(game, "UPDATE players SET name = 'kept'");
    await windowDatabases.finish(game, true);
    assert.ok(statSync(`${game}-wal`).size > 0);
    windowDatabases.shutdown();
    await until(() => processes[2].gone, 'the released process to end');
    assert.equal(existsSync(`${game}-wal`), false);
    assert.equal(inGame('SELECT name FROM players')[0].name, 'kept');
    assert.deepEqual(lost, [false, true]);
  } finally {
    windowDatabases.shutdown();
    rmSync(clientRoot, { recursive: true, force: true });
  }
}

// SQLite's journal and write-ahead files beside a database, left out of the explorer and commits.
for (const name of ['game.db-journal', 'game.db-wal', 'game.db-shm', 'save.sqlite3-journal', 'GAME.DB-WAL', 'assets/level.s3db-shm']) {
  assert.ok(isDatabaseSideFile(name), name);
}
for (const name of ['game.db', 'travel-journal', 'notes.txt-journal', 'game.dbx-wal', 'game.db-journal.txt', 'wal']) assert.ok(!isDatabaseSideFile(name), name);
assert.ok(isHiddenFolder('game.db-journal') && isHiddenFolder('game.db-wal') && !isHiddenFolder('game.db'));

console.log('Database tests passed.');
