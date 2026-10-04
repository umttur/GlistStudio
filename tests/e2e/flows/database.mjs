// SQLite databases open in a tab of their own: tables and views listed with their rows counted, a
// page at a time; filtered with an SQL condition (a bad one says why); a value changed in place
// and one set to NULL wait until Commit writes them to the file; a row refused for NOT NULL, one
// added; rows deleted after asking, and Discard putting them back; the SQL console, a result per
// statement, stopping at an error; closing the tab with changes waiting asks (Cancel keeps it,
// Discard leaves the file as it was, Commit saves). Each change is checked in the file itself.
// (gs-database.mjs)
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { e2e, glistApp } from '../common.mjs';

// players: 250 rows, a BLOB, a NULL and an integer too big for a double; settings WITHOUT ROWID; a view.
const gameDatabase = (file) => {
  fs.mkdirSync(file.replace(/[/\\][^/\\]+$/, ''), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE players (id INTEGER PRIMARY KEY, name TEXT NOT NULL, score REAL, avatar BLOB, big INTEGER);
    CREATE INDEX players_score ON players(score);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT) WITHOUT ROWID;
    INSERT INTO settings VALUES ('theme', 'dark'), ('volume', '7');
    CREATE VIEW leaders AS SELECT name, score FROM players ORDER BY score DESC LIMIT 10;`);
  const insert = db.prepare('INSERT INTO players (id, name, score, avatar, big) VALUES (?, ?, ?, ?, ?)');
  db.exec('BEGIN');
  for (let id = 1; id <= 250; id += 1) insert.run(id, `player${String(id).padStart(3, '0')}`, id % 37, id === 2 ? null : Buffer.from([1, 2, 3, id % 256]), id === 1 ? 9007199254740993n : id);
  db.exec('COMMIT');
  db.close();
};

let file = '';

await e2e({
  clipboard: true,
  setup: (w) => {
    file = `${glistApp(w, 'DbApp')}/assets/game.db`;
    gameDatabase(file);
  },
}, async (t) => {
  const { page } = t;
  // What the file itself holds now, read beside the studio (waiting while it writes).
  const inFile = (sql) => { const db = new DatabaseSync(file, { readOnly: true, timeout: 5000 }); try { return db.prepare(sql).all(); } finally { db.close(); } };
  const firstName = () => inFile('SELECT name FROM players ORDER BY id LIMIT 1')[0]?.name;
  const view = '.readme-view:not([hidden])';
  const range = () => page.locator(`${view} .database-range`).innerText().catch(() => '');
  const status = () => page.locator(`${view} .database-status`).innerText().catch(() => '');
  const cell = (line, column) => page.locator(`${view} .database-grid-host tbody tr`).nth(line).locator('td').nth(column);
  const filter = async (text) => { await page.fill(`${view} .database-filter`, text); await page.press(`${view} .database-filter`, 'Enter'); };
  const question = () => page.locator('dialog.confirm-dialog[open] .confirm-message').innerText({ timeout: 5000 }).catch(() => '');
  // Yes is the primary button; no the one before it: Discard in the database's question.
  const answer = async (yes) => {
    await page.locator(`dialog.confirm-dialog[open] button${yes ? '.primary' : ':not(.primary)'}`).last().click();
    await page.locator('dialog.confirm-dialog[open]').waitFor({ state: 'detached' }).catch(() => undefined);
  };
  const waiting = () => page.locator(`${view} .database-pending:not([hidden]) .database-pending-text`).innerText({ timeout: 500 }).catch(() => '');
  const commit = async () => { await page.locator(`${view} .database-pending .database-button`, { hasText: 'Commit' }).click(); await t.settle(waiting, (text) => text === ''); };
  const discard = async () => { await page.locator(`${view} .database-pending .database-button`, { hasText: 'Discard' }).click(); await t.settle(waiting, (text) => text === ''); };
  const openDatabase = async () => {
    await (await t.reveal(file)).dblclick();
    await page.locator(`${view} .database-grid-host tbody tr`).first().waitFor({ timeout: 15000 });
  };
  await t.openProject('DbApp');

  await openDatabase();
  t.check('a database opens in its tab, its first table showing', await page.locator(`.editor-tab.active[data-path="${file}"]`).count() === 1
    && (await page.locator(`${view} .database-title`).innerText()) === 'players');
  const listed = (await page.locator(`${view} .database-item`).allInnerTexts()).map((text) => text.trim().replace(/\s+/g, ' '));
  t.check('its tables and views listed, with their rows counted', JSON.stringify(listed) === JSON.stringify(['SQL', 'New Table', 'players 250', 'settings 2', 'leaders']), listed);
  await t.eventually('rows a page at a time', async () => [await range(), await page.locator(`${view} .database-grid-host tbody tr`).count()], (value) => value[0] === '1–100 of 250' && value[1] === 100);
  t.check('a BLOB, NULL and a big integer said as they are', /BLOB · 4/.test(await cell(0, 4).innerText()) && await cell(1, 4).innerText() === 'NULL' && await cell(0, 5).innerText() === '9007199254740993');
  await page.locator(`${view} .database-button`, { hasText: 'Next' }).click();
  await t.eventually('Next shows the next page', async () => [await range(), await cell(0, 2).innerText()], (value) => value[0] === '101–200 of 250' && value[1] === 'player101');
  await page.locator(`${view} .database-button`, { hasText: 'Previous' }).click();
  await t.settle(range, (text) => text.startsWith('1–100'));
  await filter('score > 35 -- a note');
  await t.eventually('a condition filters the rows, a comment in it harmless', range, (text) => text === '1–6 of 6');
  await filter('nope = 1');
  await t.eventually('a bad condition says why', status, (text) => /no such column: nope/.test(text));
  await filter('');
  await t.settle(range, (text) => text === '1–100 of 250');

  // Changed in place, set to NULL: waiting until Commit.
  await cell(1, 2).dblclick();
  await page.fill(`${view} .database-cell-input`, 'renamed');
  await page.press(`${view} .database-cell-input`, 'Enter');
  await t.eventually('a value changed in place waits, not in the file yet', async () => ({ cell: await cell(1, 2).innerText(), file: inFile('SELECT name FROM players WHERE id = 2')[0].name, waiting: await waiting() }),
    (value) => value.cell === 'renamed' && value.file === 'player002' && value.waiting === '1 change not saved to game.db yet');
  await cell(2, 3).click({ button: 'right' });
  await t.contextItem('Set to NULL').click();
  await t.eventually('Set to NULL waits too', async () => ({ cell: await cell(2, 3).innerText(), file: inFile('SELECT score FROM players WHERE id = 3')[0].score, waiting: await waiting() }),
    (value) => value.cell === 'NULL' && value.file !== null && value.waiting === '2 changes not saved to game.db yet');
  await cell(3, 2).dblclick();
  await page.fill(`${view} .database-cell-input`, 'not this');
  await page.press(`${view} .database-cell-input`, 'Escape');
  await t.eventually('Escape leaves a value as it was', () => cell(3, 2).innerText(), (text) => text === 'player004');
  await commit();
  t.check('Commit writes them to the file, the bar gone', inFile('SELECT name FROM players WHERE id = 2')[0].name === 'renamed' && inFile('SELECT score FROM players WHERE id = 3')[0].score === null
    && await cell(1, 2).innerText() === 'renamed', inFile('SELECT name, score FROM players WHERE id IN (2, 3)'));

  // Added; refused when NOT NULL is not met.
  await page.locator(`${view} .database-button`, { hasText: 'Add Row' }).click();
  await page.locator(`${view} .database-new-row input`).nth(2).fill('42');
  await page.locator(`${view} .database-new-row .database-button`, { hasText: 'Save' }).click();
  await t.eventually('a row NOT NULL refuses says why, nothing waiting', status, (text) => /NOT NULL constraint failed: players.name/.test(text));
  await page.locator(`${view} .database-new-row input`).nth(1).fill('newcomer');
  await page.locator(`${view} .database-new-row input`).nth(2).fill('99');
  await page.locator(`${view} .database-new-row .database-button`, { hasText: 'Save' }).click();
  await t.eventually('Add Row adds one, waiting', async () => ({ status: await status(), range: await range(), waiting: await waiting(), file: inFile("SELECT * FROM players WHERE name = 'newcomer'").length }),
    (value) => value.status === 'Row added.' && value.range === '1–100 of 251' && value.file === 0 && value.waiting === '1 change not saved to game.db yet');
  await commit();
  const added = inFile("SELECT score, typeof(score) AS kind FROM players WHERE name = 'newcomer'");
  t.check('committed, its value as the column keeps it', added.length === 1 && added[0].score === 99 && added[0].kind === 'real', added);

  // Deleted after asking; Discard puts them back.
  await cell(0, 0).click();
  await cell(1, 0).click({ modifiers: ['Shift'] });
  t.check('rows chosen by their numbers', (await page.locator(`${view} .database-button.danger`).innerText()) === 'Delete Rows (2)');
  await page.locator(`${view} .database-button.danger`).click();
  t.check('deleting asks first', await question() === 'Delete 2 rows from players?', await question());
  await answer(true);
  await t.eventually('deleted, waiting', async () => [await range(), inFile('SELECT count(*) AS n FROM players')[0].n], (value) => value[0] === '1–100 of 249' && value[1] === 251);
  await discard();
  await t.eventually('Discard puts them back', async () => [await range(), await cell(0, 0).innerText(), inFile('SELECT count(*) AS n FROM players')[0].n], (value) => value[0] === '1–100 of 251' && value[1] === '1' && value[2] === 251);
  await page.locator(`${view} .database-button`, { hasText: 'Copy as CSV' }).click();
  const csv = await t.settle(() => page.evaluate(() => navigator.clipboard.readText()), (text) => text.length > 0);
  t.check('Copy as CSV', csv.split('\n')[0] === 'id,name,score,avatar,big' && csv.split('\n').length === 101, csv.slice(0, 120));

  // The console: a result per statement, stopping at an error.
  await page.locator(`${view} .database-action`, { hasText: 'SQL' }).click();
  await page.locator(`${view} .database-sql-editor .view-lines`).click();
  await page.keyboard.type("CREATE TABLE scores (who TEXT, points INTEGER);\nINSERT INTO scores VALUES ('ada', 3), ('linus', 5);\nSELECT who, points FROM scores ORDER BY points DESC;\nSELECT nope FROM scores;\nSELECT 'never';");
  await page.locator(`${view} .database-button`, { hasText: /^Run$/ }).click();
  const results = await t.settle(() => page.locator(`${view} .database-result-heading`).allInnerTexts(), (list) => list.length >= 4);
  t.check('the console runs each statement in turn, stopping at an error', results.length === 4 && /2 rows changed/.test(results[1]) && /2 rows/.test(results[2]) && /no such column: nope/.test(results[3]), results);
  t.check('with each result in a grid', JSON.stringify(await page.locator(`${view} .database-result`).nth(2).locator('tbody tr').allInnerTexts()) === JSON.stringify(['1\tlinus\t5', '2\tada\t3']),
    await page.locator(`${view} .database-result`).nth(2).locator('tbody tr').allInnerTexts());
  await t.eventually('the table it made is listed, the statements that wrote waiting', async () => ({ listed: await page.locator(`${view} .database-item`, { hasText: /^scores/ }).count(), waiting: await waiting() }),
    (value) => value.listed === 1 && value.waiting === '2 changes not saved to game.db yet');
  t.check('not in the file yet', inFile("SELECT name FROM sqlite_schema WHERE name = 'scores'").length === 0);

  // Closing the tab with changes waiting asks.
  await page.locator(`.editor-tab[data-path="${file}"] .tab-close`).click();
  const asked = await question();
  const labels = await page.locator('dialog.confirm-dialog[open] button').allInnerTexts();
  t.check('closing the tab with changes waiting asks, with Cancel too', asked === 'Save the changes to game.db before closing? Not saving discards them.' && JSON.stringify(labels) === JSON.stringify(['Cancel', 'Discard', 'Commit']), { asked, labels });
  await page.locator('dialog.confirm-dialog[open] button', { hasText: 'Cancel' }).click();
  await t.eventually('Cancel keeps the tab open, its changes waiting', async () => ({ tab: await page.locator(`.editor-tab[data-path="${file}"]`).count(), waiting: await waiting() }),
    (value) => value.tab === 1 && /^2 changes/.test(value.waiting));
  await page.locator(`.editor-tab[data-path="${file}"] .tab-close`).click();
  await question();
  await answer(false);
  await t.eventually('Discard closes it, the file as it was', () => page.locator(`.editor-tab[data-path="${file}"]`).count(), (count) => count === 0);
  t.check('no scores table in the file', inFile("SELECT name FROM sqlite_schema WHERE name = 'scores'").length === 0);
  await openDatabase();
  await cell(0, 2).dblclick();
  await page.fill(`${view} .database-cell-input`, 'kept');
  await page.press(`${view} .database-cell-input`, 'Enter');
  await t.settle(waiting, (text) => /^1 change/.test(text));
  await page.locator(`.editor-tab[data-path="${file}"] .tab-close`).click();
  await question();
  await answer(true);
  await t.eventually('Commit closes it, the file saved', async () => ({ tab: await page.locator(`.editor-tab[data-path="${file}"]`).count(), name: firstName() }), (value) => value.tab === 0 && value.name === 'kept');
});
