// Transient tabs, as IntelliJ's and VS Code's preview tabs: a Find in Files or Search Everywhere
// result and every git diff open in an italic tab that takes the place of the side's transient one
// and closes when the side switches to another tab; a file open to stay is only brought forward; an
// edit, a double click on the tab or opening it again from the explorer keeps it; Split Right keeps
// it; one transient tab per side; it does not come back with the session. Go to Definition and build
// errors (which need clangd and a compiler) stay in gs-transient-tabs.mjs. (gs-transient-tabs.mjs)
import { DatabaseSync } from 'node:sqlite';
import { e2e, git, glistApp, mod, writeFiles } from '../common.mjs';

await e2e({
  storage: { 'glist-studio-git': 'on' },
  setup: (w) => {
    const app = glistApp(w, 'TabsApp', {
      'src/shapes.h': '#pragma once\n\nstruct Shape {\n  int sides = 3;\n  int corners() const;\n};\n',
      'src/shapes.cpp': '#include "shapes.h"\n\nint Shape::corners() const { return sides; }\n',
      'src/finder.cpp': '// The needle_token is only here.\nint finder() { return 1; }\n',
      'src/tabs/enemy_spawn_wave_controller.cpp': 'int enemy() { return 1; }\n',
      'src/tabs/player_inventory_drag_and_drop.cpp': 'int inventory() { return 2; }\n',
      'src/tabs/background_music_crossfade_player.cpp': 'int music() { return 3; }\n',
      'src/tabs/save_game_slot_serializer.cpp': 'int save() { return 4; }\n',
    });
    const db = new DatabaseSync(`${app}/scores.db`);
    db.exec("CREATE TABLE scores (id INTEGER PRIMARY KEY, name TEXT, score INTEGER); INSERT INTO scores (name, score) VALUES ('ada', 10), ('bo', 20);");
    db.close();
    git(w, app, 'init', '-q', '-b', 'main');
    git(w, app, 'add', '-A');
    git(w, app, 'commit', '-q', '-m', 'first');
    writeFiles(app, { 'src/shapes.cpp': '#include "shapes.h"\n\n// As many corners as sides.\nint Shape::corners() const { return sides; }\n' });
    git(w, app, 'commit', '-q', '-am', 'second');
    // Changes waiting to be committed.
    writeFiles(app, {
      'src/main.cpp': '#include "gCanvas.h"\n\n// Draws a canvas.\nint main() {\n\tgCanvas canvas;\n\tcanvas.setup();\n\treturn 0;\n}\n',
      'src/shapes.h': '#pragma once\n\n// A shape with sides.\nstruct Shape {\n  int sides = 3;\n  int corners() const;\n};\n',
    });
    const changed = new DatabaseSync(`${app}/scores.db`);
    changed.exec("UPDATE scores SET score = 30 WHERE name = 'bo'");
    changed.close();
  },
}, async (t) => {
  const { page } = t;
  const app = t.project('TabsApp');
  await t.openProject('TabsApp');
  await page.locator('#git-branch-chip', { hasText: 'main' }).waitFor();
  const group = (side) => page.locator('.editor-group').nth(side);
  // Each side's tabs: ~ transient, * in front.
  const sides = () => page.locator('.editor-group:not([hidden])').evaluateAll((groups) => groups.map((each) => [...each.querySelectorAll('.editor-tab')]
    .map((tab) => `${tab.classList.contains('transient') ? '~' : ''}${tab.querySelector('.tab-label').textContent}${tab.classList.contains('active') ? '*' : ''}`).join(' ')));
  const same = (expected) => (value) => JSON.stringify(value) === JSON.stringify(expected);
  const expect = (expected, name, ms) => t.eventually(name, sides, same(expected), ms);
  const tab = (name, side = 0) => group(side).locator('.editor-tab', { has: page.locator('.tab-label', { hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) }).first();
  const fontStyle = (name, side = 0) => tab(name, side).locator('.tab-label').evaluate((label) => getComputedStyle(label).fontStyle);
  const findInFiles = async (text) => {
    await page.keyboard.press(`${mod}+Shift+F`);
    await page.locator('dialog.find-in-files[open] .find-input').fill(text);
    await page.waitForFunction((typed) => {
      const status = document.querySelector('.find-status')?.textContent ?? '';
      return document.querySelector('.find-input').value === typed && document.querySelector('.find-row') && status && !status.endsWith('...');
    }, text, { timeout: 10000 });
    await page.locator('.find-row').first().dblclick();
    await page.locator('dialog.find-in-files[open]').waitFor({ state: 'detached' }).catch(() => undefined);
  };
  const tap = async () => { await page.keyboard.down('Shift'); await page.keyboard.up('Shift'); };
  const searchEverywhere = async (text, wanted = text) => {
    await tap(); await page.waitForTimeout(60); await tap();
    await page.waitForSelector('dialog.search-everywhere[open]');
    await page.fill('.search-everywhere .command-palette-input', text);
    await page.waitForFunction((name) => [...document.querySelectorAll('.search-everywhere .search-row')].some((row) => row.textContent.includes(name)), wanted, { timeout: 8000 });
    await page.locator('.search-everywhere .search-row', { hasText: wanted }).first().click();
  };
  const change = (name) => page.locator('#commit-changes .change-row', { hasText: name }).first();
  const diffTabs = () => page.locator('.editor-tab[data-path^="diff:"]').evaluateAll((tabs) => tabs.map((each) => `${each.classList.contains('transient') ? '~' : ''}${each.dataset.path.replace(/^.*\//, '')}${each.classList.contains('active') ? '*' : ''}`));

  // Opened from the explorer: to stay, upright.
  await t.openFile(`${app}/src/main.cpp`);
  await t.openFile(`${app}/CMakeLists.txt`);
  await expect(['main.cpp CMakeLists.txt*'], 'a double click in the explorer opens tabs to stay');
  t.check('their names are upright', await fontStyle('main.cpp') === 'normal');

  // Find in Files: transient, in italics, with a hint.
  await findInFiles('needle_token');
  await expect(['main.cpp CMakeLists.txt ~finder.cpp*'], 'a Find in Files result opens transient, in front');
  t.check('its name in italics', await fontStyle('finder.cpp') === 'italic', await fontStyle('finder.cpp'));
  t.check('its tooltip says how to keep it', /Double-click to keep it open/.test(await tab('finder.cpp').getAttribute('title')), await tab('finder.cpp').getAttribute('title'));
  await searchEverywhere('shapes.cpp');
  await expect(['main.cpp CMakeLists.txt ~shapes.cpp*'], 'a Search Everywhere file takes the transient one\'s place');
  await tab('main.cpp').click();
  await expect(['main.cpp* CMakeLists.txt'], 'switching to another tab closes the transient one');
  await tab('CMakeLists.txt').click();
  await searchEverywhere('main.cpp');
  await expect(['main.cpp* CMakeLists.txt'], 'a file open to stay is brought to the front as it is');

  // Every git diff: the commit view's changes, one after another in one tab; History's.
  await page.click('#commit-activity');
  await change('main.cpp').click();
  await t.eventually('a change in the commit view opens its diff transient', diffTabs, same(['~main.cpp*']));
  await change('shapes.h').click();
  await t.eventually('the next change takes its place', diffTabs, same(['~shapes.h*']));
  await change('scores.db').click();
  await t.eventually('a database\'s diff too', diffTabs, same(['~scores.db*']));
  await page.click('#git-tab');
  await page.locator('#git-panel button', { hasText: /^Log$/ }).first().click();
  await page.locator('.log-row', { hasText: 'second' }).first().click();
  await page.locator('.git-file-row', { hasText: 'shapes.cpp' }).first().click();
  await t.eventually('a commit\'s file in History opens transient, in the place of the last diff', diffTabs, same(['~shapes.cpp*']));
  await tab('main.cpp').click();
  await t.eventually('leaving the diff closes it', diffTabs, same([]));
  await t.showView('explorer');

  // Kept by an edit, by a double click on its name, by opening it again from the explorer.
  await findInFiles('needle_token');
  await expect(['main.cpp CMakeLists.txt ~finder.cpp*'], 'transient before the edit');
  await group(0).locator('.view-lines').click();
  await page.keyboard.press(`${mod}+ArrowUp`);
  await page.keyboard.type('// kept\n');
  await expect(['main.cpp CMakeLists.txt finder.cpp*'], 'an edit keeps it');
  t.check('upright once kept', await fontStyle('finder.cpp') === 'normal');
  await searchEverywhere('shapes.cpp');
  await expect(['main.cpp CMakeLists.txt finder.cpp ~shapes.cpp*'], 'transient before the double click');
  await tab('shapes.cpp').dblclick();
  await expect(['main.cpp CMakeLists.txt finder.cpp shapes.cpp*'], 'a double click on its name keeps it');
  await searchEverywhere('shapes.h');
  await expect(['main.cpp CMakeLists.txt finder.cpp shapes.cpp ~shapes.h*'], 'transient before the explorer');
  await (await t.reveal(`${app}/src/shapes.h`)).dblclick();
  await expect(['main.cpp CMakeLists.txt finder.cpp shapes.cpp shapes.h*'], 'a double click in the explorer keeps it, in one tab');

  // Split Right keeps it on both sides; one transient tab per side.
  await searchEverywhere('enemy_spawn', 'enemy_spawn_wave_controller.cpp');
  await tab('enemy_spawn_wave_controller.cpp').click({ button: 'right' });
  await t.contextItem('Split Right').click();
  await expect(['main.cpp CMakeLists.txt finder.cpp shapes.cpp shapes.h enemy_spawn_wave_controller.cpp*', 'enemy_spawn_wave_controller.cpp*'], 'Split Right keeps it, on both sides');
  await searchEverywhere('player_inventory', 'player_inventory_drag_and_drop.cpp');
  await tab('main.cpp').click();
  await searchEverywhere('background_music', 'background_music_crossfade_player.cpp');
  await expect(['main.cpp CMakeLists.txt finder.cpp shapes.cpp shapes.h enemy_spawn_wave_controller.cpp ~background_music_crossfade_player.cpp*', 'enemy_spawn_wave_controller.cpp ~player_inventory_drag_and_drop.cpp*'], 'each side has its own transient tab');
  t.check('in italics on the right too', await fontStyle('player_inventory_drag_and_drop.cpp', 1) === 'italic');

  // Not saved with the session: reopened, the kept tabs come back and the transient ones do not.
  // Saved a moment after the last change, the transient tabs left out and their neighbours in front.
  await t.settle(() => page.evaluate((root) => JSON.parse(localStorage.getItem(`glist-studio-session:${root}`) ?? 'null'), app),
    (session) => session?.groups?.length === 2 && session.groups.every((each) => each.active?.endsWith('enemy_spawn_wave_controller.cpp')));
  await t.load();
  await t.openProject('TabsApp');
  await expect(['main.cpp CMakeLists.txt finder.cpp shapes.cpp shapes.h enemy_spawn_wave_controller.cpp*', 'enemy_spawn_wave_controller.cpp*'],
    'reopened, the kept tabs come back and the transient ones do not; the tab beside each is in front', 8000);
});
