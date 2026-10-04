// SQLite's own files beside a database stay out of sight: while a change waits in a database's tab
// its -journal is on disk (git sees it) but neither the explorer nor the commit view lists it; a WAL
// database's -wal and -shm, there while it is open, neither; committed in the tab, the database
// itself is listed as changed. (gs-sqlite-side-files.mjs)
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { e2e, gitRepo, glistApp } from '../common.mjs';

await e2e({
  storage: { 'glist-studio-git': 'on' },
  setup: (w) => {
    const app = glistApp(w, 'SideApp');
    fs.mkdirSync(`${app}/assets`, { recursive: true });
    const make = (file, wal) => {
      const db = new DatabaseSync(file);
      if (wal) db.exec('PRAGMA journal_mode = WAL');
      db.exec("CREATE TABLE people(id INTEGER PRIMARY KEY, name TEXT); INSERT INTO people(name) VALUES ('ada'), ('linus');");
      db.close();
    };
    make(`${app}/assets/game.db`, false);
    make(`${app}/assets/wal.db`, true);
    gitRepo(w, app);
    // A change of the project's own, so the commit view's list is known to be read.
    fs.writeFileSync(`${app}/src/main.cpp`, 'int main() { return 1; }\n');
  },
}, async (t) => {
  const { page } = t;
  const app = t.project('SideApp');
  await t.openProject('SideApp');
  const view = '.readme-view:not([hidden])';
  const treeNames = () => page.locator('#file-tree .tree-row[data-path]').evaluateAll((rows) => rows.map((each) => each.dataset.path.split('/').pop()));
  // The commit view's list, once it has what git says now (shown again, it reads again).
  const commitNames = async (expected) => {
    await t.showView('commit');
    await page.locator('#commit-refresh').click();
    const names = await t.settle(() => page.locator('#commit-changes .change-row .change-name').allInnerTexts(), expected, 5000);
    await t.showView('explorer');
    return names;
  };
  const sideFiles = (names) => names.some((name) => /-journal|-wal|-shm/.test(name));

  // A change waiting in game.db's tab: its journal is on disk.
  await (await t.reveal(`${app}/assets/game.db`)).dblclick();
  await page.locator(`${view} .database-grid-host tbody tr`).first().waitFor({ timeout: 15000 });
  await page.locator(`${view} .database-grid-host tbody tr`).first().locator('td').nth(2).dblclick();
  await page.fill(`${view} .database-cell-input`, 'grace');
  await page.press(`${view} .database-cell-input`, 'Enter');
  await t.eventually('a change waits in the tab, its -journal on disk', async () => ({
    journal: fs.existsSync(`${app}/assets/game.db-journal`),
    pending: await page.locator(`${view} .database-pending:not([hidden])`).innerText().catch(() => ''),
  }), (value) => value.journal && /change/.test(value.pending));
  const gitSees = t.git(app, 'status', '--porcelain', '--untracked-files=all');
  t.check('git itself sees the journal', /game\.db-journal/.test(gitSees), gitSees);
  let names = await treeNames();
  t.check('the explorer does not list it', !names.includes('game.db-journal') && names.includes('game.db'), names);
  names = await commitNames((list) => list.includes('main.cpp'));
  t.check('nor does the commit view', names.includes('main.cpp') && !sideFiles(names), names);

  // A WAL database open in a tab: its -wal and -shm, out of sight too.
  await (await t.reveal(`${app}/assets/wal.db`)).dblclick();
  await page.locator(`${view} .database-grid-host tbody tr`).first().waitFor({ timeout: 15000 });
  await t.eventually('the WAL database open, its -wal and -shm on disk', () => fs.existsSync(`${app}/assets/wal.db-wal`) && fs.existsSync(`${app}/assets/wal.db-shm`), Boolean);
  names = await treeNames();
  t.check('the explorer lists neither', !names.some((name) => /wal\.db-(wal|shm)/.test(name)) && names.includes('wal.db'), names);
  names = await commitNames((list) => list.includes('main.cpp'));
  t.check('nor the commit view', names.includes('main.cpp') && !sideFiles(names), names);

  // Committed in game.db's tab: the database itself is listed as changed, as before.
  await page.locator(`.editor-tab[data-path="${app}/assets/game.db"]`).click();
  await page.locator(`${view} .database-pending button`, { hasText: 'Commit' }).click();
  await t.settle(() => fs.existsSync(`${app}/assets/game.db-journal`), (journal) => !journal);
  names = await commitNames((list) => list.includes('game.db'));
  t.check('committed, game.db is listed as changed', names.includes('game.db') && !sideFiles(names), names);
});
