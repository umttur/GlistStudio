// The explorer's file operations: New File (added to CMakeLists.txt), Rename (CMakeLists.txt and
// the open tab follow), Delete asking in the studio's own dialog (Escape and Cancel keep the file,
// OK and Enter delete it, never a native dialog), and dragging files: onto a folder (its tab and
// CMakeLists.txt follow, open folders stay open), not a folder into itself, not over a file of the
// same name. (gs-confirm.mjs, gs-explorer-move.mjs, gs-notices.mjs)
import fs from 'node:fs';
import { docEnd, e2e, glistApp, mod } from '../common.mjs';

await e2e({
  init: () => { window.nativeDialogs = 0; window.confirm = () => { window.nativeDialogs += 1; return false; }; },
  setup: (w) => {
    glistApp(w, 'FilesApp', {
      'src/extra.cpp': 'int extra() { return 1; }\n',
      'src/other.cpp': 'int other() { return 2; }\n',
      'src/helper.cpp': 'int helper() { return 3; }\n',
      'src/menu/menu.cpp': 'int menu() { return 4; }\n',
      'lib/helper.h': '#pragma once\n',
      'lib/main.cpp': 'int elsewhere() { return 5; }\n',
    });
    const cmake = `${w.projects}/FilesApp/CMakeLists.txt`;
    fs.writeFileSync(cmake, fs.readFileSync(cmake, 'utf8').replace('\t${APP_DIR}/src/gCanvas.cpp\n', '\t${APP_DIR}/src/gCanvas.cpp\n\t${APP_DIR}/src/helper.cpp\n'));
  },
}, async (t) => {
  const { page } = t;
  const app = t.project('FilesApp');
  const cmake = () => t.read(`${app}/CMakeLists.txt`);
  const notices = () => page.locator('.notice .notice-text').allInnerTexts();
  const question = page.locator('dialog.confirm-dialog[open]');
  await t.openProject('FilesApp');

  // New File in src: made, listed in CMakeLists.txt, opened.
  await (await t.reveal(`${app}/src/main.cpp`));
  await page.locator(`#file-tree .tree-row[data-path="${app}/src"]`).click({ button: 'right' });
  await t.contextItem('New').hover();
  await page.locator('.context-menu:not([hidden]) .context-item:visible', { hasText: 'New File' }).click();
  await page.fill('#input-dialog-value', 'added.cpp');
  await page.keyboard.press('Enter');
  await t.eventually('New File makes the file', () => fs.existsSync(`${app}/src/added.cpp`), Boolean);
  await t.eventually('and lists it in CMakeLists.txt', cmake, (text) => text.includes('${APP_DIR}/src/added.cpp'));

  // Rename: CMakeLists.txt and the open tab follow.
  await t.openFile(`${app}/src/gCanvas.cpp`);
  await page.locator(`#file-tree .tree-row[data-path="${app}/src/gCanvas.cpp"]`).click({ button: 'right' });
  await t.contextItem('Rename').click();
  await page.fill('#input-dialog-value', 'Canvas.cpp');
  await page.keyboard.press('Enter');
  await t.eventually('Rename renames the file', () => fs.existsSync(`${app}/src/Canvas.cpp`) && !fs.existsSync(`${app}/src/gCanvas.cpp`), Boolean);
  await t.eventually('CMakeLists.txt follows it', cmake, (text) => text.includes('${APP_DIR}/src/Canvas.cpp') && !text.includes('src/gCanvas.cpp'));
  await t.eventually('and so does its tab', () => page.locator(`.editor-tab[data-path="${app}/src/Canvas.cpp"]`).count(), (count) => count === 1);

  // Delete asks in the studio's own dialog.
  const askToDelete = async (name) => {
    await page.locator(`#file-tree .tree-row[data-path="${app}/src/${name}"]`).click();
    await page.keyboard.press('Delete');
    await question.waitFor();
  };
  await askToDelete('extra.cpp');
  t.check('deleting a file asks in the studio\'s own dialog', /extra\.cpp/.test(await question.innerText()));
  await page.keyboard.press('Escape');
  await question.waitFor({ state: 'hidden' });
  t.check('Escape answers no: the file stays', fs.existsSync(`${app}/src/extra.cpp`));
  await askToDelete('extra.cpp');
  await question.locator('button:not(.primary)').click();
  await question.waitFor({ state: 'hidden' });
  t.check('Cancel answers no too', fs.existsSync(`${app}/src/extra.cpp`));
  await askToDelete('extra.cpp');
  await question.locator('button.primary').click();
  await t.eventually('OK deletes it', () => fs.existsSync(`${app}/src/extra.cpp`), (exists) => !exists);
  await askToDelete('other.cpp');
  await page.keyboard.press('Enter');
  await t.eventually('Enter answers OK', () => fs.existsSync(`${app}/src/other.cpp`), (exists) => !exists);
  await page.keyboard.press(`${mod}+Shift+F`);
  await page.locator('dialog.find-in-files[open] .find-input').waitFor();
  await page.keyboard.type('typed after a question');
  t.check('typing reaches a text box straight after', await page.evaluate(() => document.activeElement?.value) === 'typed after a question');
  await page.keyboard.press('Escape');

  // Dragging: a file onto another folder.
  const row = (relative) => page.locator(`#file-tree .tree-row[data-path="${app}/${relative}"]`);
  await (await t.reveal(`${app}/src/menu/menu.cpp`));
  t.check('the project\'s rows can be dragged', await row('src/main.cpp').getAttribute('draggable') === 'true');
  await row('src/helper.cpp').dragTo(row('lib'));
  await t.eventually('a file dragged onto a folder is moved there', () => fs.existsSync(`${app}/lib/helper.cpp`) && !fs.existsSync(`${app}/src/helper.cpp`), Boolean);
  await t.eventually('CMakeLists.txt follows it', cmake, (text) => text.includes('${APP_DIR}/lib/helper.cpp'));
  await t.eventually('the open folders stay open', () => row('src/menu/menu.cpp').count(), (count) => count === 1);
  await t.eventually('it says so', notices, (texts) => texts.some((text) => /helper\.cpp moved into lib/.test(text)));
  // An open file: its tab follows, and saving writes the new place.
  await t.openFile(`${app}/src/main.cpp`);
  await row('src/main.cpp').dragTo(row('src/menu'));
  await t.eventually('an open file moves, and its tab follows', () => page.locator(`.editor-tab.active[data-path="${app}/src/menu/main.cpp"]`).count(), (count) => count === 1);
  await page.locator('#editor-host .view-lines').first().click();
  await page.keyboard.press(docEnd);
  await page.keyboard.type('\n// moved');
  await page.keyboard.press(`${mod}+s`);
  await t.eventually('saving writes the new place', () => (fs.existsSync(`${app}/src/menu/main.cpp`) ? t.read(`${app}/src/menu/main.cpp`) : ''), (text) => text.includes('// moved') && !fs.existsSync(`${app}/src/main.cpp`));
  // A folder into its own subfolder, or over a file of the same name: refused.
  await row('src').dragTo(row('src/menu'));
  await page.waitForTimeout(300);
  t.check('a folder does not go into itself', fs.existsSync(`${app}/src/menu/menu.cpp`) && !fs.existsSync(`${app}/src/menu/src`));
  await row('src/menu/main.cpp').dragTo(row('lib'));
  await t.eventually('a file does not go over one of the same name, and it says why', notices, (texts) => texts.some((text) => /Could not move/.test(text)));
  t.check('both files are as they were', fs.existsSync(`${app}/src/menu/main.cpp`) && t.read(`${app}/lib/main.cpp`).includes('elsewhere'));
  t.check('no native dialog', await page.evaluate(() => window.nativeDialogs) === 0);
});
