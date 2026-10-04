// Open Project lists the projects in myglistapps, by name until one is opened and then the most
// recently opened first; its search box narrows the list and Enter opens the first match; the
// arrow keys move through it; Browse opens any folder by its path; New Project makes a project
// from the template and opens it. (gs-project-picker.mjs, gs-newproj.mjs)
import fs from 'node:fs';
import path from 'node:path';
import { e2e, glistApp } from '../common.mjs';

await e2e({
  setup: (w) => {
    for (const name of ['Bravo', 'Alpha', 'Charlie']) glistApp(w, name);
    glistApp({ ...w, projects: path.join(w.root, 'elsewhere') }, 'Delta');
  },
}, async (t) => {
  const { page, w } = t;
  const listed = () => page.$$eval('#project-list .project-item', (items) => items.map((item) => `${item.querySelector('.project-item-name').textContent}|${item.querySelector('.project-item-time').textContent}`));
  const label = (name) => page.locator('#project-root-label', { hasText: name.toUpperCase() }).waitFor().then(() => true, () => false);

  await page.click('#open-project');
  await page.waitForSelector('#open-project-dialog[open] .project-item');
  let list = await listed();
  t.check('the projects in myglistapps, by name while none was opened', list.map((entry) => entry.split('|')[0]).join() === 'Alpha,Bravo,Charlie'
    && list.every((entry) => entry.endsWith('Not opened yet')), list);
  t.check('the search box has focus', await page.evaluate(() => document.activeElement?.id === 'project-filter'));
  await page.click('.project-item:has-text("Charlie")');
  t.check('clicking one opens it', await label('Charlie'));
  await page.locator(`#file-tree .tree-row[data-path="${t.project('Charlie')}/src"]`).waitFor();
  t.check('its explorer lists its files', await page.locator(`#file-tree .tree-row[data-path="${t.project('Charlie')}/CMakeLists.txt"]`).count() === 1);

  await page.click('#open-project');
  await page.waitForSelector('#open-project-dialog[open] .project-item');
  await page.keyboard.type('brav');
  list = await t.settle(listed, (entries) => entries.length === 1);
  t.check('searching narrows the list', list.length === 1 && list[0].startsWith('Bravo'), list);
  await page.keyboard.press('Enter');
  t.check('Enter opens the first match', await label('Bravo'));

  await page.click('#open-project');
  await page.waitForSelector('#open-project-dialog[open] .project-item');
  list = await listed();
  t.check('the most recently opened come first', list[0].startsWith('Bravo|Opened') && list[1].startsWith('Charlie|Opened') && list[2].startsWith('Alpha|Not opened'), list);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  t.check('the arrow keys move through the list', await page.evaluate(() => document.activeElement?.textContent?.startsWith('Charlie')));

  // The browser build asks for the folder's path (there is no folder picker for the server's disk).
  page.once('dialog', (dialog) => dialog.accept(path.join(w.root, 'elsewhere', 'Delta')));
  await page.click('#project-picker-browse');
  t.check('Browse opens a folder by its path', await label('Delta'));

  await page.click('#open-project');
  await page.click('#project-picker-new');
  t.check('New Project goes to the new project dialog', await page.locator('#new-project-dialog[open]').count() === 1);
  await page.selectOption('#project-template', 'GlistConsoleApp');
  await page.fill('#project-name-input', 'Echo');
  await page.locator('#new-project-form button[type="submit"]').click();
  t.check('Create makes the project and opens it', await label('Echo'));
  const made = path.join(w.projects, 'Echo');
  t.check('from the template, in myglistapps', fs.existsSync(path.join(made, 'CMakeLists.txt')) && fs.existsSync(path.join(made, 'src')), fs.existsSync(made) ? fs.readdirSync(made) : 'missing');
});
