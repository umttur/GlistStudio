// Eclipse's .project, .cproject and .settings (tracked, as Glist apps come with them) and clangd's
// .clangd are hidden in the explorer; changed, they are listed in the commit view but not ticked,
// so Commit takes only the project's own change; ticked, they go in too. (gs-hidden-files.mjs)
import { e2e, glistApp, gitRepo, writeFiles } from '../common.mjs';

await e2e({
  storage: { 'glist-studio-git': 'on' },
  setup: (w) => {
    const app = glistApp(w, 'HiddenApp', {
      '.project': '<projectDescription><name>HiddenApp</name></projectDescription>\n',
      '.cproject': '<cproject/>\n',
      '.settings/language.settings.xml': '<project/>\n',
    });
    gitRepo(w, app);
    // Changed since: the project's code, and the IDE files it does not need.
    writeFiles(app, {
      'src/main.cpp': 'int main() { return 1; }\n',
      '.project': '<projectDescription><name>Renamed</name></projectDescription>\n',
      '.cproject': '<cproject changed="yes"/>\n',
      '.settings/language.settings.xml': '<project changed="yes"/>\n',
      '.clangd': 'CompileFlags:\n  Add: [-Wall]\n',
    });
  },
}, async (t) => {
  const { page } = t;
  const app = t.project('HiddenApp');
  await t.openProject('HiddenApp');
  const rows = await page.locator('#file-tree .tree-row[data-path]').evaluateAll((all) => all.map((row) => row.dataset.path.split('/').pop()));
  t.check('the explorer hides .project, .cproject, .settings and .clangd', !rows.some((name) => ['.project', '.cproject', '.settings', '.clangd'].includes(name)) && rows.includes('src'), rows);

  await page.click('#commit-activity');
  const changes = () => page.locator('#commit-changes .change-row').evaluateAll((all) => all.map((row) => ({
    name: row.querySelector('.change-name')?.textContent, checked: row.querySelector('input[type="checkbox"]')?.checked ?? null, hidden: row.classList.contains('hidden-change'),
  })));
  const listed = await t.settle(changes, (list) => list.length >= 4);
  const byName = Object.fromEntries(listed.map((change) => [change.name, change]));
  t.check('the commit view lists them, the project\'s change ticked', byName['main.cpp']?.checked === true, listed);
  t.check('and the hidden ones not ticked', ['.project', '.cproject', 'language.settings.xml'].every((name) => byName[name]?.checked === false && byName[name]?.hidden), listed);
  t.check('the untracked .clangd not ticked either', byName['.clangd'] ? byName['.clangd'].checked === false : true, listed);

  const head = () => t.git(app, 'rev-parse', 'HEAD');
  let before = head();
  await page.fill('#commit-message', 'change main');
  await page.click('#commit-button');
  await t.settle(head, (now) => now !== before, 10000);
  const committed = t.git(app, 'show', '--name-only', '--format=', 'HEAD').split('\n').filter(Boolean);
  t.check('Commit takes only main.cpp', JSON.stringify(committed) === '["src/main.cpp"]', committed);
  const status = t.git(app, 'status', '--porcelain');
  t.check('the hidden files are still changed, not committed', /\.project/.test(status) && /\.cproject/.test(status), status);
  t.check('the commit is the workspace\'s author', t.git(app, 'log', '-1', '--format=%an <%ae>|%s') === 'Glist Studio Tests <tests@example.invalid>|change main', t.git(app, 'log', '-1', '--format=%an <%ae>|%s'));

  // Ticked on purpose, one goes in.
  const cproject = page.locator('#commit-changes .change-row', { hasText: '.cproject' }).locator('input[type="checkbox"]');
  await cproject.waitFor();
  await t.settle(() => page.locator('#commit-changes .change-row', { hasText: 'main.cpp' }).count(), (count) => count === 0);
  await cproject.check();
  before = head();
  await page.fill('#commit-message', 'keep the cproject');
  await page.click('#commit-button');
  await t.settle(head, (now) => now !== before, 10000);
  const second = t.git(app, 'show', '--name-only', '--format=', 'HEAD').split('\n').filter(Boolean);
  t.check('ticked on purpose, it is committed', JSON.stringify(second) === '[".cproject"]', second);
});
