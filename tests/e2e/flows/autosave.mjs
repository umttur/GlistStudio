// Saving: Ctrl+S; leaving the editor saves what was typed (for the explorer, the terminal or a
// tab's close button) but not within it (its Find box); leaving the window saves, coming back
// reads again a file changed on disk without overwriting unsaved changes; saving a file deleted
// on disk writes it again. (gs-autosave.mjs, gs-save-reload.mjs, gs-api.mjs)
import fs from 'node:fs';
import { docEnd, e2e, glistApp, mod } from '../common.mjs';

await e2e({
  viewport: { width: 1280, height: 800 },
  setup: (w) => { glistApp(w, 'SaveApp'); },
}, async (t) => {
  const { page } = t;
  const app = t.project('SaveApp');
  const main = `${app}/src/main.cpp`;
  const onDisk = (file = main) => t.read(file);
  const typeAtEnd = async (text) => {
    await page.locator('#editor-host .view-lines').first().click();
    await page.keyboard.press(docEnd);
    await page.keyboard.type(text);
  };
  const dirty = (name) => page.locator('.editor-tab', { hasText: name }).locator('.dirty-dot.visible').count();
  await t.openProject('SaveApp');
  await t.openFile(main);

  await typeAtEnd('\n// zero');
  await t.eventually('typing marks the tab unsaved', () => dirty('main.cpp'), (count) => count === 1);
  await page.keyboard.press(`${mod}+s`);
  await t.eventually('Ctrl+S saves it', () => onDisk(), (text) => text.includes('// zero'));
  await t.eventually('and the mark goes', () => dirty('main.cpp'), (count) => count === 0);

  await typeAtEnd(' // one');
  await page.keyboard.press(`${mod}+F`);
  await page.locator('#editor-host .find-widget.visible').waitFor();
  t.check('within the editor, its Find box, nothing is saved', !onDisk().includes('// one'));
  await page.keyboard.press('Escape');
  await page.locator(`#file-tree .tree-row[data-path="${app}/CMakeLists.txt"]`).click();
  await t.eventually('clicking the explorer saves it', () => onDisk(), (text) => text.includes('// one'));
  await typeAtEnd(' // two');
  await page.locator('.output-tab[data-panel="terminal"]').click();
  await t.eventually('going to the terminal saves it', () => onDisk(), (text) => text.includes('// two'));
  await page.locator('.editor-tab', { hasText: 'main.cpp' }).click();
  await typeAtEnd(' // three');
  await page.locator('.editor-tab', { hasText: 'main.cpp' }).locator('.tab-close').click();
  await t.eventually('closing its tab saves it and closes it', () => onDisk(), (text) => text.includes('// three'));
  t.check('without asking', await page.locator('.editor-tab', { hasText: 'main.cpp' }).count() === 0 && await page.locator('dialog.confirm-dialog[open]').count() === 0);

  // Leaving the window saves; coming back reads again what changed on disk, but not over unsaved changes.
  const canvas = `${app}/src/gCanvas.cpp`;
  await t.openFile(canvas);
  await typeAtEnd('\n// typed before leaving');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await t.eventually('leaving the window saves it', () => onDisk(canvas), (text) => text.includes('// typed before leaving'));
  const header = `${app}/src/gCanvas.h`;
  await t.openFile(header);
  fs.writeFileSync(header, onDisk(header).replace('int score = 0;', 'int score = 100;'));
  await t.openFile(main);
  await typeAtEnd('\n// mine, not saved');
  fs.writeFileSync(main, onDisk().replace('return 0;', 'return 7;'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.locator('.editor-tab', { hasText: 'gCanvas.h' }).click();
  await t.eventually('coming back reads again a file changed on disk', () => t.editorText(), (text) => text.includes('int score = 100;'));
  await page.locator('.editor-tab', { hasText: 'main.cpp' }).click();
  const mainText = await t.settle(() => t.editorText(), (text) => text.includes('main()'));
  t.check('but keeps unsaved changes', mainText.includes('// mine, not saved') && mainText.includes('return 0;'), mainText);

  // A file deleted on disk while its tab is open: saving writes it again.
  await page.locator('.editor-tab', { hasText: 'gCanvas.cpp' }).click();
  fs.rmSync(canvas);
  await typeAtEnd('\n// back again');
  await page.keyboard.press(`${mod}+s`);
  await t.eventually('saving a file deleted on disk writes it again', () => (fs.existsSync(canvas) ? onDisk(canvas) : ''), (text) => text.includes('// back again'));
});
