// The Commit view: changes listed by group, Commit with a message, Amend, Commit and Push to the
// branch's remote; Stash Changes from a group and from a file's menu, Rollback All and Delete New
// Files; the Stashes tab's Apply and Apply and Delete; Drop Commit only for commits not pushed.
// (gs-git-sidebar.mjs, gs-hidden-files.mjs, gs-busy.mjs)
import fs from 'node:fs';
import path from 'node:path';
import { e2e, git, gitRepo, glistApp, writeFiles } from '../common.mjs';

await e2e({
  storage: { 'glist-studio-git': 'on' },
  setup: (w) => {
    const app = gitRepo(w, glistApp(w, 'CommitApp', { 'score.txt': 'score\n' }), 'Start');
    writeFiles(app, { 'src/gCanvas.cpp': '// on main\n' });
    git(w, app, 'commit', '-qam', 'Faster on main');
    // Pushed: Start; not pushed: Faster on main.
    const remote = path.join(w.root, 'remote.git');
    git(w, w.root, 'init', '-q', '--bare', remote);
    git(w, app, 'remote', 'add', 'origin', remote);
    git(w, app, 'push', '-q', 'origin', 'HEAD~1:refs/heads/main');
    git(w, app, 'fetch', '-q', 'origin');
    git(w, app, 'branch', '-q', '--set-upstream-to', 'origin/main');
  },
}, async (t) => {
  const { page, w } = t;
  const app = t.project('CommitApp');
  const remote = path.join(w.root, 'remote.git');
  const status = () => t.git(app, 'status', '--porcelain');
  const subjects = (where = app, ref = 'HEAD') => t.git(where, 'log', '--format=%s', ref).split('\n');
  const menuItems = () => page.locator('.context-menu:not([hidden]) .context-item').allInnerTexts();
  const changeNames = () => page.locator('#commit-changes .change-row .change-name').allInnerTexts();
  const tab = (name) => page.locator('button', { hasText: new RegExp(`^${name}$`) }).first();
  await t.openProject('CommitApp');
  await page.click('#commit-activity');

  // Changes listed, committed with a message.
  writeFiles(app, { 'src/main.cpp': 'int main() { return 1; }\n', 'fresh.txt': 'fresh\n' });
  await page.locator('#commit-refresh').click();
  await t.eventually('the commit view lists a changed file and a new one', changeNames, (names) => names.includes('main.cpp') && names.includes('fresh.txt'));
  await page.locator('#commit-changes .change-row', { hasText: 'fresh.txt' }).locator('input[type="checkbox"]').uncheck();
  await page.fill('#commit-message', 'Return one');
  await page.click('#commit-button');
  await t.eventually('Commit commits the ticked files with the message', () => subjects()[0], (subject) => subject === 'Return one');
  t.check('and only those', t.git(app, 'show', '--name-only', '--format=', 'HEAD') === 'src/main.cpp' && status() === '?? fresh.txt', status());
  await t.eventually('the message box empties', () => page.locator('#commit-message').inputValue(), (value) => value === '');

  // Amend: the last commit again, with its message.
  writeFiles(app, { 'src/main.cpp': 'int main() { return 2; }\n' });
  await page.locator('#commit-refresh').click();
  await t.settle(changeNames, (names) => names.includes('main.cpp'));
  await page.locator('#commit-amend').check();
  await t.eventually('Amend brings back the last message', () => page.locator('#commit-message').inputValue(), (value) => value === 'Return one');
  await page.fill('#commit-message', 'Return two');
  await page.click('#commit-button');
  await t.eventually('Amend replaces the last commit', () => subjects().slice(0, 2).join(), (value) => value === 'Return two,Faster on main');

  // Commit and Push: on to the branch's remote.
  writeFiles(app, { 'score.txt': 'score 1\n' });
  await page.locator('#commit-refresh').click();
  await t.settle(changeNames, (names) => names.includes('score.txt'));
  if (await page.locator('#commit-amend').isChecked()) await page.locator('#commit-amend').uncheck();
  await page.fill('#commit-message', 'Score one');
  await page.click('#commit-push-button');
  const push = page.locator('.git-dialog[open]');
  await push.waitFor();
  t.check('Commit and Push commits, then shows the commits to push', /main to origin/.test(await push.innerText()) && /Score one[\s\S]*Return two[\s\S]*Faster on main/.test(await push.innerText()), await push.innerText());
  await push.locator('button.primary').click();
  await t.eventually('Push pushes them to the remote', () => subjects(remote, 'main')[0], (subject) => subject === 'Score one', 15000);

  // Stash Changes on the Changes group, for those files only.
  writeFiles(app, { 'src/gCanvas.cpp': '// seven\n', 'score.txt': 'score 2\n' });
  await page.locator('#commit-refresh').click();
  await t.settle(changeNames, (names) => names.includes('gCanvas.cpp') && names.includes('score.txt'));
  await page.locator('.change-group', { hasText: 'Changes' }).first().click({ button: 'right' });
  const groupItems = await menuItems();
  t.check('the Changes group offers Stash and Rollback All', groupItems.includes('Stash Changes...') && groupItems.includes('Rollback All...'), groupItems);
  await t.contextItem('Stash Changes...').click();
  await page.locator('.git-dialog[open] input[type="text"]').first().fill('from the sidebar');
  await page.locator('.git-dialog[open] button.primary').click();
  await t.eventually('the group\'s files are stashed, the new file left', () => ({ status: status(), stashes: t.git(app, 'stash', 'list') }),
    (value) => value.status === '?? fresh.txt' && /from the sidebar/.test(value.stashes));
  // One file from its own menu.
  writeFiles(app, { 'score.txt': 'score 3\n', 'src/gCanvas.cpp': '// eight\n' });
  await page.locator('#commit-refresh').click();
  await t.settle(changeNames, (names) => names.includes('gCanvas.cpp') && names.includes('score.txt'));
  await page.locator('.change-row', { hasText: 'score.txt' }).first().click({ button: 'right' });
  await t.contextItem('Stash Changes...').click();
  await page.locator('.git-dialog[open] button.primary').click();
  await t.eventually('one file stashed from its own menu', () => status().split('\n').join(','), (value) => value === ' M src/gCanvas.cpp,?? fresh.txt' || value === 'M src/gCanvas.cpp,?? fresh.txt');
  // Taking changes back, and new files to the trash, from the groups.
  await t.settle(changeNames, (names) => !names.includes('score.txt'));
  await page.locator('.change-group', { hasText: 'Changes' }).first().click({ button: 'right' });
  await t.contextItem('Rollback All...').click();
  await t.confirm();
  await t.settle(status, (value) => value === '?? fresh.txt');
  await t.settle(changeNames, (names) => !names.includes('gCanvas.cpp'));
  await page.locator('.change-group', { hasText: 'Unversioned' }).first().click({ button: 'right' });
  await t.contextItem('Delete New Files...').click();
  await t.confirm();
  await t.eventually('Rollback All and Delete New Files leave nothing changed', () => status() === '' && !fs.existsSync(`${app}/fresh.txt`), Boolean);

  // The Stashes tab.
  await page.click('#git-tab');
  await tab('Stashes').click();
  const firstStash = page.locator('.git-stashes .git-row').first();
  await firstStash.waitFor();
  const buttons = await firstStash.locator('.git-row-button').allInnerTexts();
  t.check('a stash\'s actions are in words', buttons.join('|') === 'Apply|Apply and Delete|Delete', buttons);
  const stashes = () => t.git(app, 'stash', 'list').split('\n').filter(Boolean).length;
  const before = stashes();
  await firstStash.locator('.git-row-button', { hasText: 'Apply and Delete' }).click();
  await t.eventually('Apply and Delete applies it and removes it', () => stashes() === before - 1 && /score 3/.test(t.read(`${app}/score.txt`)), Boolean);
  t.git(app, 'checkout', '-q', '--', '.');
  await page.locator('.git-stashes .git-row').first().locator('.git-row-button', { hasText: /^Apply$/ }).click();
  await t.eventually('Apply keeps the stash', () => stashes() === before - 1 && status() !== '', Boolean);
  t.git(app, 'checkout', '-q', '--', '.');

  // Drop Commit: for the branch's commits not pushed, and not for pushed ones.
  writeFiles(app, { 'score.txt': 'score 4\n' });
  t.git(app, 'commit', '-qam', 'Not pushed');
  // Shown for the first time, the log reads the branch.
  await tab('Log').click();
  await page.locator('.log-row', { hasText: 'Not pushed' }).first().waitFor();
  await page.locator('.log-row', { hasText: 'Score one' }).first().click({ button: 'right' });
  t.check('a pushed commit has no Drop Commit', !(await menuItems()).includes('Drop Commit'), await menuItems());
  await page.keyboard.press('Escape');
  await page.locator('.log-row', { hasText: 'Not pushed' }).first().click({ button: 'right' });
  t.check('one not pushed has it', (await menuItems()).includes('Drop Commit'), await menuItems());
  await t.contextItem('Drop Commit').click();
  await t.confirm().catch(() => undefined);
  await t.eventually('dropped: gone from the branch', () => subjects()[0], (subject) => subject === 'Score one');
  await t.eventually('and from the log', () => page.locator('.log-row', { hasText: 'Not pushed' }).count(), (count) => count === 0);
});
