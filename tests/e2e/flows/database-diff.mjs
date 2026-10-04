// A .db file's diff shows what changed in the database instead of "binary": from the commit view,
// changed tables with their counts, rows added and changed with the changed cells as they were and
// are, a WITHOUT ROWID table by its key; an untracked database all added; a .db that is not SQLite
// says so; a commit's file in History against the one before, a table added and one removed, a
// column added as a schema change; compared again by itself when the file changes, and Refresh.
// (gs-database-diff.mjs)
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import { e2e, git, glistApp } from '../common.mjs';

const sql = (file, text) => { const db = new DatabaseSync(file, { timeout: 5000 }); try { db.exec(text); } finally { db.close(); } };

await e2e({
  storage: { 'glist-studio-git': 'on' },
  setup: (w) => {
    const app = glistApp(w, 'DiffApp');
    fs.mkdirSync(`${app}/assets`, { recursive: true });
    const db = `${app}/assets/game.db`;
    sql(db, `
      CREATE TABLE players (id INTEGER PRIMARY KEY, name TEXT NOT NULL, score REAL, avatar BLOB);
      INSERT INTO players VALUES (1, 'ada', 10, x'0102'), (2, 'linus', 20, NULL), (3, 'grace', 30, NULL);
      WITH RECURSIVE n(i) AS (SELECT 4 UNION ALL SELECT i + 1 FROM n WHERE i < 300) INSERT INTO players SELECT i, 'player' || i, i, NULL FROM n;
      CREATE TABLE notes (body TEXT);
      INSERT INTO notes VALUES ('first'), ('second');
      CREATE TABLE settings (key TEXT PRIMARY KEY, value) WITHOUT ROWID;
      INSERT INTO settings VALUES ('volume', 7), ('lang', 'en');
      CREATE TABLE old_stuff (a);
      INSERT INTO old_stuff VALUES (1);
      CREATE TABLE stable (id INTEGER PRIMARY KEY, v);
      INSERT INTO stable VALUES (1, 'same');`);
    git(w, app, 'init', '-q', '-b', 'main');
    git(w, app, 'add', '-A');
    git(w, app, 'commit', '-q', '-m', 'first');
    // The second commit changes the schema and rows.
    sql(db, `
      ALTER TABLE players ADD COLUMN level INTEGER DEFAULT 1;
      UPDATE players SET score = 11 WHERE id = 1;
      DELETE FROM players WHERE id = 2;
      INSERT INTO players (id, name, score) VALUES (301, 'barbara', 5);
      DROP TABLE old_stuff;
      CREATE TABLE new_stuff (id INTEGER PRIMARY KEY, label TEXT);
      INSERT INTO new_stuff VALUES (1, 'shiny');`);
    git(w, app, 'add', '-A');
    git(w, app, 'commit', '-q', '-m', 'second');
    // Not committed: more rows changed than a table lists.
    sql(db, `
      UPDATE players SET name = 'GRACE', avatar = x'ff' WHERE id = 3;
      UPDATE players SET score = -score WHERE id BETWEEN 10 AND 260;
      UPDATE settings SET value = 9 WHERE key = 'volume';
      INSERT INTO notes VALUES ('third');`);
    fs.writeFileSync(`${app}/assets/notes.db`, 'Not a database, only notes that end in .db\n');
    sql(`${app}/assets/save.db`, "CREATE TABLE saves (slot INTEGER PRIMARY KEY, name TEXT); INSERT INTO saves VALUES (1, 'start'), (2, 'castle');");
  },
}, async (t) => {
  const { page } = t;
  const app = t.project('DiffApp');
  const DB = `${app}/assets/game.db`;
  const SAVE = `${app}/assets/save.db`;
  await t.openProject('DiffApp');
  await page.locator('#git-branch-chip', { hasText: 'main' }).waitFor();
  const view = '.readme-view:not([hidden]) .database-diff-view';
  const tabOf = (key) => page.locator(`.editor-tab[data-path="${key}"]`).first();
  const shown = () => page.locator(`${view} .database-diff-body, ${view} .database-diff-problem`).first().waitFor({ timeout: 15000 }).then(() => true, () => false);
  const activeKey = () => page.locator('.editor-tab.active').first().getAttribute('data-path');
  const versions = () => page.locator(`${view} .database-diff-versions`).innerText();
  // Each table listed: its name, state and counts, as the list says them.
  const listed = () => page.locator(`${view} .database-diff-item`).evaluateAll((items) => items.map((item) => `${item.querySelector('.database-item-name').textContent}|${[...item.classList].find((name) => ['added', 'removed', 'changed', 'unchanged'].includes(name))}|${item.querySelector('.database-diff-counts')?.textContent ?? ''}`));
  const title = () => page.locator(`${view} .database-title`).innerText().catch(() => '');
  const choose = async (name) => { await page.locator(`${view} .database-diff-item`, { hasText: new RegExp(`^${name}`) }).first().click(); await t.settle(title, (text) => text === name); };
  const rows = () => page.locator(`${view} .database-diff-grid tbody tr`);
  const cellText = (row, column) => rows().nth(row).locator('td').nth(column).innerText();
  const change = (name) => page.locator('#commit-changes .change-row', { hasText: name }).first();

  // From the commit view: the file on disk against the last commit.
  await page.click('#commit-activity');
  await change('game.db').click();
  t.check('the commit view opens the database diff', await shown(), await page.locator('.readme-view:not([hidden])').innerText().catch(() => 'no page'));
  t.check('in a tab keyed as a diff', await activeKey() === `diff:HEAD::${DB}`, await activeKey());
  // Diffs open in transient tabs; this one is kept, by a double click on the tab.
  await tabOf(`diff:HEAD::${DB}`).dblclick();
  t.check('named as text diffs are: last commit, your version', /^Last commit \([0-9a-f]{7}\)\s+→\s+Your version$/.test(await versions()), await versions());
  await t.eventually('changed tables listed with their counts, unchanged ones folded', listed, (list) => JSON.stringify(list) === JSON.stringify(['notes|changed|+1', 'players|changed|~252', 'settings|changed|~1']));
  t.check('the first changed table shown, matched by row number', await title() === 'notes' && /matched by their row number/.test(await page.locator(`${view} .database-diff-detail`).innerText()));
  await t.eventually('its added row in the added colour', async () => ({ rows: await rows().count(), kind: await rows().first().getAttribute('class').catch(() => ''), text: await cellText(0, 2).catch(() => '') }),
    (value) => value.rows === 1 && value.kind === 'database-diff-row added' && value.text === 'third');
  await choose('players');
  await t.eventually('at most 200 rows, and how many more', async () => ({ rows: await rows().count(), more: await page.locator(`${view} .database-diff-more`).innerText().catch(() => '') }),
    (value) => value.rows === 200 && /and 52 more rows/.test(value.more));
  t.check('a changed row shows its changed cells as they were and are', await cellText(0, 1) === '3' && /grace\s*→\s*GRACE/.test(await cellText(0, 2))
    && /NULL\s*→\s*BLOB · 1 byte/.test(await cellText(0, 4)) && await rows().nth(0).locator('td.database-diff-changed').count() === 2, await rows().nth(0).innerText());
  await choose('settings');
  t.check('a WITHOUT ROWID table by its key', /7\s*→\s*9/.test(await cellText(0, 2)) && await page.locator(`${view} th.database-diff-key`).innerText() === 'key');

  // An untracked database: every table added. A file that is not SQLite says so.
  await change('save.db').click();
  t.check('an untracked database opens its diff too', await shown() && await activeKey() === `diff:HEAD::${SAVE}`, await activeKey());
  await t.eventually('every table added, all its rows with it', async () => ({ list: await listed(), rows: await rows().count() }), (value) => JSON.stringify(value.list) === '["saves|added|"]' && value.rows === 2);
  await change('notes.db').click();
  await shown();
  await t.eventually('a .db that is not SQLite says so', () => page.locator(`${view} .database-diff-problem`).innerText().catch(() => ''), (text) => text === 'Your version: not a SQLite database.');

  // A commit's file in History: one commit against the one before.
  await page.click('#git-tab');
  await page.locator('button', { hasText: /^Log$/ }).first().click();
  await page.locator('.log-row', { hasText: 'second' }).first().click();
  await page.locator('.git-file-row', { hasText: 'game.db' }).first().click();
  const [first, second] = [t.git(app, 'rev-parse', 'HEAD~1'), t.git(app, 'rev-parse', 'HEAD')];
  await t.eventually('History opens the database diff between the commits', activeKey, (key) => key === `diff:${first}:${second}:${DB}`);
  await shown();
  t.check('named by the two commits', await versions() === `Commit ${first.slice(0, 7)}  →  Commit ${second.slice(0, 7)}`, await versions());
  await t.eventually('a table added, one removed, one changed', listed, (list) => JSON.stringify(list) === JSON.stringify(['new_stuff|added|', 'old_stuff|removed|', 'players|changed|+1−1~1']));
  await choose('players');
  const detail = await t.settle(() => page.locator(`${view} .database-diff-detail`).innerText(), (text) => /Columns added/.test(text));
  t.check('a column added is a schema change, its SQL before and after', /Columns added: level/.test(detail) && await page.locator(`${view} .database-diff-line.added`).count() >= 1, detail.slice(0, 400));
  t.check('removed and added rows in their colours', await page.locator(`${view} tr.database-diff-row.removed`).count() === 1 && await page.locator(`${view} tr.database-diff-row.added`).count() === 1);

  // By itself after a change to the file from outside; Refresh when asked.
  await tabOf(`diff:HEAD::${DB}`).click();
  await shown();
  await t.settle(listed, (list) => list.length === 3);
  sql(DB, "INSERT INTO new_stuff VALUES (2, 'fresh'); DELETE FROM notes WHERE body = 'first';");
  const fresh = ['new_stuff|changed|+1', 'notes|changed|+1−1', 'players|changed|~252', 'settings|changed|~1'];
  await t.eventually('a change from outside is compared by itself', () => listed().then((list) => list.slice(0, 4)), (list) => JSON.stringify(list) === JSON.stringify(fresh), 10000);
  sql(DB, "INSERT INTO new_stuff VALUES (3, 'more');");
  await page.locator(`${view} .database-diff-header button[title="Refresh"]`).click();
  await t.eventually('Refresh compares again', listed, (list) => list.includes('new_stuff|changed|+2'));
});
