// The Git log: it starts on the current branch, other branches' commits only when All branches or
// that branch is picked, the choice kept on refresh, the current branch followed after a checkout;
// a commit's changed files, one opening its diff; Show History on a file lists only its commits.
// (gs-log-branch.mjs, gs-patches-setup.sh, gs-git.mjs)
import { e2e, git, glistApp, writeFiles } from '../common.mjs';

await e2e({
  storage: { 'glist-studio-git': 'on' },
  setup: (w) => {
    const app = glistApp(w, 'LogApp', { 'src/gCanvas.cpp': 'void setup() {\n\tint speed = 1;\n}\n' });
    git(w, app, 'init', '-q', '-b', 'main');
    git(w, app, 'add', '-A');
    git(w, app, 'commit', '-qm', 'Start');
    writeFiles(app, { 'score.txt': 'score\n' });
    git(w, app, 'add', '-A');
    git(w, app, 'commit', '-qm', 'Add score');
    git(w, app, 'checkout', '-qb', 'feature');
    writeFiles(app, { 'src/gCanvas.cpp': 'void setup() {\n\tint speed = 3;\n}\n' });
    git(w, app, 'commit', '-qam', 'Faster on feature');
    git(w, app, 'checkout', '-q', 'main');
    writeFiles(app, { 'src/gCanvas.cpp': 'void setup() {\n\tint speed = 2;\n}\n' });
    git(w, app, 'commit', '-qam', 'Faster on main');
  },
}, async (t) => {
  const { page } = t;
  const app = t.project('LogApp');
  await t.openProject('LogApp');
  // Opened before the project's repository is read, the log loads twice at once, and the
  // earlier load can leave the picker on All branches over the current branch's commits (a race
  // in GitLog.fillRefs, reported with this suite); the branch in the title bar says it was read.
  await page.locator('#git-branch-chip', { hasText: 'main' }).waitFor();
  await page.click('#git-tab');
  const tab = (name) => page.locator('button', { hasText: new RegExp(`^${name}$`) }).first();
  await tab('Log').click();
  const subjects = () => page.locator('.git-log .log-subject-text').allInnerTexts();
  const picked = () => page.locator('.git-log select.dressed-select').first().evaluate((select) => select.selectedOptions[0]?.textContent ?? '');
  const choose = (label) => t.choose('.git-log .select-button.git-select', label);

  await t.eventually('only main\'s commits at first', () => subjects().then((list) => list.join()), (list) => list === 'Faster on main,Add score,Start');
  t.check('the picker starts on Current branch', await picked() === 'Current branch', await picked());
  const options = await page.locator('.git-log select.dressed-select').first().locator('option').allInnerTexts();
  t.check('Current branch comes first, then All branches, never the bare word HEAD', options[0] === 'Current branch' && options[1] === 'All branches' && !options.includes('HEAD'), options);
  await choose('All branches');
  await t.eventually('All branches adds feature\'s commit', subjects, (list) => list.includes('Faster on feature') && list.includes('Faster on main'));
  await page.locator('.git-log button[title="Refresh"]').click();
  await t.settle(subjects, (list) => list.length === 4);
  t.check('refresh keeps All branches', await picked() === 'All branches', await picked());
  await choose('feature');
  await t.eventually('a branch picked shows its own commits', () => subjects().then((list) => list.join()), (list) => list === 'Faster on feature,Add score,Start');

  // A checkout elsewhere, then the log shown again and refreshed.
  await choose('Current branch');
  await t.settle(() => subjects().then((list) => list.join()), (list) => list === 'Faster on main,Add score,Start');
  t.git(app, 'checkout', '-q', 'feature');
  await tab('Branches').click();
  await tab('Log').click();
  await page.locator('.git-log button[title="Refresh"]').click();
  await t.eventually('after a checkout, Current branch follows it', () => subjects().then((list) => list.join()), (list) => list === 'Faster on feature,Add score,Start');
  t.check('and still says Current branch', await picked() === 'Current branch', await picked());
  t.git(app, 'checkout', '-q', 'main');
  await page.locator('.git-log button[title="Refresh"]').click();

  // A commit's files, and one's diff.
  await page.locator('.log-row', { hasText: 'Faster on main' }).first().click();
  const files = page.locator('.git-file-row', { hasText: 'gCanvas.cpp' }).first();
  await files.waitFor();
  t.check('a commit lists the files it changed', await page.locator('.git-file-row').count() === 1);
  await files.click();
  await t.eventually('a file of it opens its diff', () => page.locator('.diff-view:not([hidden]) .monaco-diff-editor').count(), (count) => count === 1);
  await t.eventually('which shows the commit\'s change', () => page.locator('.diff-view:not([hidden]) .monaco-diff-editor').innerText(), (text) => /speed = 1/.test(text.replace(/\u00a0/g, ' ')) && /speed = 2/.test(text.replace(/\u00a0/g, ' ')));

  // Show History on a file: only its commits.
  await t.showView('explorer');
  await (await t.reveal(`${app}/score.txt`)).click({ button: 'right' });
  await t.contextItem('Git').hover();
  await page.locator('.context-menu:not([hidden]) .context-item:visible', { hasText: 'Show History' }).click();
  await t.eventually('Show History lists only the file\'s commits', () => subjects().then((list) => list.join()), (list) => list === 'Add score');
  t.check('with the file named as the filter', await page.locator('.git-log .git-path-chip:not([hidden]), .git-log button[title="Clear the filter"]:not([hidden])').count() >= 1);
});
