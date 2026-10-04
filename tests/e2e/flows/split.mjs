// Two editors side by side: Split Right from a tab's menu, one file and one model on both sides,
// focus following a click, closing the last tab of a side, dragging a tab onto the editor's
// right half and back, Ctrl+\, Move to the Left Side, a diff on the side worked in with its
// toolbar, and the resizer between them. (gs-split.mjs)
import { docEnd, e2e, gitRepo, glistApp, mod } from '../common.mjs';

await e2e({
  storage: { 'glist-studio-git': 'on' },
  viewport: { width: 1600, height: 900 },
  setup: (w) => { gitRepo(w, glistApp(w, 'SplitApp')); },
}, async (t) => {
  const { page } = t;
  const app = t.project('SplitApp');
  await t.openProject('SplitApp');
  const groups = () => page.evaluate(() => [...document.querySelectorAll('.editor-group:not([hidden])')].map((group) => [...group.querySelectorAll('.editor-tab')]
    .map((tab) => `${tab.querySelector('.tab-label').textContent}${tab.classList.contains('active') ? '*' : ''}`).join(' ') + (group.classList.contains('focused') ? ' [focused]' : '')));
  const same = (expected) => (value) => JSON.stringify(value) === JSON.stringify(expected);
  const expect = (expected, name) => t.eventually(name, groups, same(expected));
  const text = (group) => page.evaluate((index) => (document.querySelectorAll('.editor-group')[index]?.querySelector('.editor-host .view-lines')?.innerText ?? '').replace(/\u00a0/g, ' '), group);
  const tabIn = (group, name) => page.locator('.editor-group').nth(group).locator('.editor-tab', { hasText: name });

  await t.openFile(`${app}/src/gCanvas.cpp`);
  await t.openFile(`${app}/src/gCanvas.h`);
  await expect(['gCanvas.cpp gCanvas.h* [focused]'], 'one side to start');
  t.check('no resizer with one side', await page.locator('.group-resizer:not([hidden])').count() === 0);

  // Split Right from the tab's menu: the same file on both sides.
  await tabIn(0, 'gCanvas.cpp').click({ button: 'right' });
  await t.contextItem('Split Right').click();
  await expect(['gCanvas.cpp gCanvas.h*', 'gCanvas.cpp* [focused]'], 'Split Right opens it on the right, leaving the left as it was');
  await t.eventually('the right editor shows it', () => text(1), (value) => value.includes('void gCanvas::setup'));
  await tabIn(0, 'gCanvas.cpp').click();
  await expect(['gCanvas.cpp* gCanvas.h [focused]', 'gCanvas.cpp*'], 'both sides show the same file');
  // Typing on the right shows on the left: one file, one model.
  await page.locator('.editor-group').nth(1).locator('.view-lines').click();
  await page.keyboard.press(docEnd);
  await page.keyboard.type('// typed on the right\n');
  await t.eventually('an edit on one side shows on the other', () => text(0), (value) => value.includes('typed on the right'));
  // Unsaved on both, or (when anything took the keys from the editor, which saves) saved on both.
  await t.eventually('both tabs show the same state, one file', async () => [
    await page.locator('.editor-group').nth(0).locator('.editor-tab.active .dirty-dot.visible').count(),
    await page.locator('.editor-group').nth(1).locator('.editor-tab.active .dirty-dot.visible').count(),
    t.read(`${app}/src/gCanvas.cpp`).includes('typed on the right'),
  ], (value) => same([1, 1, false])(value) || same([0, 0, true])(value));
  await page.locator('.editor-group').nth(0).locator('.view-lines').click();
  await expect(['gCanvas.cpp* gCanvas.h [focused]', 'gCanvas.cpp*'], 'a click moves the focus to the left');

  // Closing one of the file's two tabs leaves the file open; the right side goes with its last tab.
  await tabIn(1, 'gCanvas.cpp').locator('.tab-close').click();
  await expect(['gCanvas.cpp* gCanvas.h [focused]'], 'the right side goes with its last tab, without asking');
  t.check('the edit is still there on the left', (await text(0)).includes('typed on the right'));

  // Drag a tab onto the right half of the editor: a new side; and back.
  const stage = await page.locator('.editor-group').nth(0).locator('.editor-stage').boundingBox();
  await tabIn(0, 'gCanvas.h').dragTo(page.locator('.editor-group').nth(0).locator('.editor-stage'), { targetPosition: { x: stage.width * 0.8, y: stage.height / 2 } });
  await expect(['gCanvas.cpp*', 'gCanvas.h* [focused]'], 'dropped on the right half, a tab moves to a new side');
  t.check('no file path typed into the editor by the drop', !(await text(0)).includes('gCanvas.cpp') && (await text(1)).includes('class gCanvas'));
  await tabIn(1, 'gCanvas.h').dragTo(page.locator('.editor-group').nth(0).locator('.editor-stage'), { targetPosition: { x: 40, y: 80 } });
  await expect(['gCanvas.cpp gCanvas.h* [focused]'], 'dropped on the other side, it moves there and the empty side goes');

  // Ctrl+\ splits the tab in front; Move to the Left Side merges them.
  await page.locator('.editor-group').nth(0).locator('.view-lines').click();
  await page.keyboard.press(`${mod}+\\`);
  await expect(['gCanvas.cpp gCanvas.h*', 'gCanvas.h* [focused]'], 'Ctrl+\\ splits the tab in front');
  await tabIn(1, 'gCanvas.h').click({ button: 'right' });
  t.check('the right side offers Split Left', await t.contextItem('Split Left').count() === 1);
  await t.contextItem('Move to the Left Side').click();
  await expect(['gCanvas.cpp gCanvas.h* [focused]'], 'moving the last tab to the left leaves one side');

  // A diff on the right side.
  await tabIn(0, 'gCanvas.cpp').click();
  await page.keyboard.press(`${mod}+s`);
  await t.settle(() => t.read(`${app}/src/gCanvas.cpp`), (value) => value.includes('typed on the right'));
  await page.locator('.editor-group').nth(0).locator('.view-lines').click();
  await page.keyboard.press(`${mod}+\\`);
  await expect(['gCanvas.cpp* gCanvas.h', 'gCanvas.cpp* [focused]'], 'split again');
  await t.menu('git', 'Show Diff');
  await t.eventually('a diff opens on the side worked in', () => page.locator('.editor-group').nth(1).locator('.diff-view:not([hidden]) .monaco-diff-editor').count(), (count) => count === 1);
  t.check('the left side keeps its file', await page.locator('#diff-view[hidden]').count() === 1);
  const toolbar = page.locator('.editor-group').nth(1).locator('.diff-toolbar');
  t.check('the diff toolbar on the right has its buttons', await toolbar.locator('button svg.icon').count() === 5 && await toolbar.locator('button[data-diff="next"]').isVisible());
  await toolbar.locator('button[data-diff="layout"]').click();
  await t.eventually('its layout button switches to one column', () => page.locator('.editor-group').nth(1).locator('.monaco-diff-editor.side-by-side').count(), (count) => count === 0);
  await toolbar.locator('button[data-diff="layout"]').click();

  // The resizer between the sides.
  const resizer = await page.locator('.group-resizer').boundingBox();
  const before = (await page.locator('.editor-group').nth(0).boundingBox()).width;
  await page.mouse.move(resizer.x + 1, resizer.y + 100);
  await page.mouse.down();
  await page.mouse.move(resizer.x - 200, resizer.y + 100, { steps: 5 });
  await page.mouse.up();
  const after = (await page.locator('.editor-group').nth(0).boundingBox()).width;
  t.check('the resizer moves the split', after < before - 150, `${Math.round(before)} -> ${Math.round(after)}`);
});
