// Editor tabs: opened from the explorer, the last in front; switching shows each file with its
// cursor where it was; dragging reorders; typing marks a tab unsaved and closing it saves it
// without asking, the neighbour coming to the front; a diff tab; a renamed file keeps its tab
// and a deleted one loses it; a middle click closes a tab and pastes nothing; with none left,
// the welcome. (gs-tabs.mjs, gs-tab-middle.mjs)
import { docEnd, e2e, gitRepo, glistApp, writeFiles } from '../common.mjs';

await e2e({
  storage: { 'glist-studio-git': 'on' },
  init: () => {
    window.middle = [];
    document.addEventListener('mouseup', (event) => { if (event.button === 1) window.middle.push([event.target.closest('.editor-tab') ? 'tab' : 'editor', event.defaultPrevented]); });
  },
  setup: (w) => {
    const app = gitRepo(w, glistApp(w, 'TabsApp'));
    writeFiles(app, { 'src/untracked.h': '#pragma once\n// not in git yet\n' });
  },
}, async (t) => {
  const { page } = t;
  const app = t.project('TabsApp');
  await t.openProject('TabsApp');
  const tabs = () => page.evaluate(() => [...document.querySelectorAll('#editor-tabs .editor-tab')].map((tab) => `${tab.querySelector('.tab-label').textContent}${tab.classList.contains('active') ? '*' : ''}`));
  const same = (expected) => (value) => JSON.stringify(value) === JSON.stringify(expected);
  const firstLine = async () => (await t.editorText()).split('\n')[0];
  const tab = (name) => page.locator('#editor-tabs .editor-tab', { hasText: name });
  const cursorLine = () => page.evaluate(() => {
    const cursor = document.querySelector('#editor-host .cursors-layer .cursor');
    const lines = [...document.querySelectorAll('#editor-host .view-line')].sort((a, b) => parseFloat(a.style.top) - parseFloat(b.style.top));
    return lines.findIndex((node) => Math.abs(parseFloat(node.style.top) - parseFloat(cursor.style.top)) < 2) + 1;
  });

  await t.openFile(`${app}/src/gCanvas.cpp`);
  await t.openFile(`${app}/src/gCanvas.h`);
  await t.openFile(`${app}/CMakeLists.txt`);
  await t.eventually('three tabs, the last in front', tabs, same(['gCanvas.cpp', 'gCanvas.h', 'CMakeLists.txt*']));
  await t.eventually('the editor shows it', firstLine, (text) => text.startsWith('cmake_minimum_required'));

  // Where a tab was: its cursor comes back.
  await tab('gCanvas.cpp').click();
  await t.settle(firstLine, (text) => text.startsWith('#include'));
  await page.locator('#editor-host .view-lines').click();
  await page.keyboard.press(docEnd);
  const line = await t.settle(cursorLine, (value) => value > 1);
  await tab('gCanvas.h').click();
  await t.eventually('switching shows gCanvas.h', firstLine, (text) => text.startsWith('#pragma once'));
  await tab('gCanvas.cpp').click();
  await t.eventually('the cursor comes back where it was', cursorLine, (value) => value === line && line > 1);

  // Dragging reorders and leaves the front alone.
  await tab('CMakeLists.txt').dragTo(tab('gCanvas.cpp'), { targetPosition: { x: 5, y: 10 } });
  await t.eventually('dragging a tab reorders them', tabs, same(['CMakeLists.txt', 'gCanvas.cpp*', 'gCanvas.h']));

  // Typing marks it; closing saves it without asking, and the neighbour comes.
  await page.locator('#editor-host .view-lines').click();
  await page.keyboard.press(docEnd);
  await page.keyboard.type('\n// edit');
  await t.eventually('typing marks the tab unsaved', () => page.locator('#editor-tabs .editor-tab.active .dirty-dot.visible').count(), (count) => count === 1);
  await tab('gCanvas.cpp').locator('.tab-close').click();
  await t.eventually('closing it saves it, without asking', () => t.read(`${app}/src/gCanvas.cpp`), (text) => text.includes('// edit'));
  t.check('and asks nothing', await page.locator('dialog.confirm-dialog[open]').count() === 0);
  await t.eventually('the next one comes to the front', tabs, same(['CMakeLists.txt', 'gCanvas.h*']));
  await t.eventually('and is shown', firstLine, (text) => text.startsWith('#pragma once'));

  // A diff tab and back.
  await t.openFile(`${app}/src/gCanvas.cpp`);
  await t.menu('git', 'Show Diff');
  await t.eventually('Show Diff opens a diff tab', () => page.locator('#editor-tabs .editor-tab.diff.active').count(), (count) => count === 1);
  t.check('showing the diff view', await page.locator('#diff-view:not([hidden])').count() === 1);
  await page.locator('#editor-tabs .editor-tab.diff .tab-close').click();
  await t.eventually('closing it shows the file again', () => page.locator('#diff-view[hidden]').count(), (count) => count === 1);

  // Rename and delete from the explorer.
  await t.openFile(`${app}/src/untracked.h`);
  await (await t.reveal(`${app}/src/untracked.h`)).click({ button: 'right' });
  await t.contextItem('Rename').click();
  await page.fill('#input-dialog-value', 'renamed.h');
  await page.keyboard.press('Enter');
  await t.eventually('a renamed file keeps its tab', tabs, (list) => list.includes('renamed.h*'));
  await (await t.reveal(`${app}/src/renamed.h`)).click({ button: 'right' });
  await page.locator('.context-menu:not([hidden]) .context-item.danger').click();
  await t.confirm();
  await t.eventually('a deleted file loses its tab', tabs, (list) => !list.some((name) => name.startsWith('renamed.h')));

  // A middle click on a tab closes it; its release is cancelled, so Linux pastes no selection.
  await page.locator('#editor-host .view-lines').click();
  await page.locator('#editor-host .view-lines').click({ button: 'middle' });
  await tab('gCanvas.cpp').click({ button: 'middle' });
  await t.eventually('a middle click on a tab closes it', () => tab('gCanvas.cpp').count(), (count) => count === 0);
  const middle = await page.evaluate(() => window.middle);
  t.check('its release is cancelled, so nothing is pasted', JSON.stringify(middle.find(([where]) => where === 'tab')) === '["tab",true]', middle);
  t.check('in the editor a middle click is left as it was', JSON.stringify(middle.find(([where]) => where === 'editor')) === '["editor",false]', middle);

  // All closed: the welcome.
  while (await page.locator('#editor-tabs .editor-tab').count()) await page.locator('#editor-tabs .editor-tab .tab-close').first().click();
  await t.eventually('the welcome once no tab is left', () => page.locator('#welcome:not([hidden])').count(), (count) => count === 1);
});
