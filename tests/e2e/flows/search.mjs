// Find in Files (Ctrl+Shift+F): matches in the project but not in .git, _build or binary files,
// Match Case, Whole Words, the engine and plugins, regular expressions (a broken one says so), the
// preview, Enter opening the file at the match, text not saved yet. Search Everywhere (double
// Shift, not Shift after a capital): files by letters in order, Tab to Files, commands, and
// name:line. Its clangd symbols are in clangd.mjs. (gs-search-setup.sh, gs-search.mjs)
import fs from 'node:fs';
import { docEnd, e2e, glistApp, mod, writeFiles } from '../common.mjs';

await e2e({
  setup: (w) => {
    const app = glistApp(w, 'SearchApp', {
      'CMakeLists.txt': 'cmake_minimum_required(VERSION 3.10.2)\nproject(SearchApp)\nset(PLUGINS gipDemo)\n',
      'src/gCanvas.h': '#pragma once\n#include "gBaseCanvas.h"\n#include "gImage.h"\n\nclass gCanvas : public gBaseCanvas {\npublic:\n\tvoid setup() override;\n\tvoid draw() override;\n\tvoid drawLogo(int x,\n\t              int y);\nprivate:\n\tgImage logo;\n\tint score = 0;\n};\n',
      'src/gCanvas.cpp': '#include "gCanvas.h"\n\nvoid gCanvas::setup() {\n\tlogo.load("logo.png");\n}\n\nvoid gCanvas::draw() {\n\tdrawLogo(10, 20);\n}\n\nvoid gCanvas::drawLogo(int x, int y) {\n\tlogo.draw(x, y);\n\tscore += 1;\n}\n',
      'src/GameCanvas.h': '#pragma once\n\n// Another canvas, for the ranking of files that match a little.\nclass GameCanvas {\npublic:\n\tint levelScore(int level);\n};\n',
      '.git/logo': 'logo in git\n',
      '_build/Release/logo.txt': 'logo in the build\n',
    });
    fs.mkdirSync(`${app}/assets`, { recursive: true });
    fs.writeFileSync(`${app}/assets/logo.png`, Buffer.from('\x89PNG\r\n\x1a\n\x00\x00logo', 'binary'));
    writeFiles(w.engine, {
      'engine/graphics/gImage.h': '#pragma once\n#include <string>\n\nclass gImage {\npublic:\n\tvoid load(const std::string& fullPath);\n\tvoid draw(int x, int y);\n\tint getWidth() const;\n};\n',
      'engine/core/gBaseCanvas.h': '#pragma once\n\nclass gBaseCanvas {\npublic:\n\tvirtual void setup() = 0;\n\tvirtual void draw() = 0;\n};\n',
    });
    writeFiles(w.plugins, { 'gipDemo/src/gipDemo.h': '#pragma once\n\nclass gipDemo {\npublic:\n\tvoid startDemo(int level);\n};\n' });
  },
}, async (t) => {
  const { page } = t;
  await t.openProject('SearchApp');

  // Find in Files.
  const findRows = () => page.locator('.find-row').evaluateAll((rows) => rows.map((row) => `${row.querySelector('.find-row-place').textContent.replace(/[-]/g, '').trim()}|${row.querySelector('mark').textContent}`));
  const findFor = async (text) => {
    await page.fill('.find-input', text);
    // Past the pause after typing, to the search's answer.
    await page.waitForFunction((typed) => {
      const status = document.querySelector('.find-status')?.textContent ?? '';
      return document.querySelector('.find-input').value === typed && status && !status.endsWith('...');
    }, text, { timeout: 10000 });
    await page.waitForTimeout(350);
    await page.waitForFunction(() => { const status = document.querySelector('.find-status')?.textContent ?? ''; return status && !status.endsWith('...'); }, null, { timeout: 10000 });
    return { rows: await findRows(), status: await page.locator('.find-status').innerText() };
  };
  await page.keyboard.press(`${mod}+Shift+F`);
  await page.locator('dialog.find-in-files[open]').waitFor();
  t.check('Ctrl+Shift+F opens Find in Files', true);
  let found = await findFor('logo');
  t.check('finds in the project, not in .git, _build or binary files',
    found.rows.join(',') === 'gCanvas.cpp 4|logo,gCanvas.cpp 4|logo,gCanvas.cpp 8|Logo,gCanvas.cpp 11|Logo,gCanvas.cpp 12|logo,gCanvas.h 9|Logo,gCanvas.h 12|logo', found.rows);
  t.check('says how many', /7 matches in 2 files/.test(found.status), found.status);
  await page.locator('.find-toggle').nth(0).click();
  found = await findFor('logo');
  t.check('Match Case', found.rows.length === 4 && !found.rows.some((row) => row.endsWith('Logo')), found.rows);
  await page.locator('.find-toggle').nth(1).click();
  found = await findFor('draw');
  t.check('Whole Words', found.rows.join(',') === 'gCanvas.cpp 7|draw,gCanvas.cpp 12|draw,gCanvas.h 8|draw', found.rows);
  await t.choose('.find-scope', 'In the project, engine and plugins');
  found = await findFor('draw');
  const places = await page.locator('.find-row-place').evaluateAll((rows) => rows.map((row) => row.title));
  t.check('with the engine and plugins', places.includes('GlistEngine/engine/graphics/gImage.h') && places.includes('GlistEngine/engine/core/gBaseCanvas.h'), places);
  await page.locator('.find-toggle').nth(0).click();
  await page.locator('.find-toggle').nth(1).click();
  await page.locator('.find-toggle').nth(2).click();
  found = await findFor('draw\\w+\\(');
  t.check('regular expressions', found.rows.length === 3 && found.rows.every((row) => row.endsWith('drawLogo(')), found.rows);
  found = await findFor('(');
  t.check('a broken regular expression says so', await page.locator('.find-status.error').count() === 1, found.status);
  await page.locator('.find-toggle').nth(2).click();
  await t.choose('.find-scope', 'In the project');
  await page.locator('.find-toggle').nth(0).click();
  found = await findFor('score');
  t.check('two matches of score', found.rows.join(',') === 'gCanvas.cpp 13|score,gCanvas.h 13|score', found.rows);
  await page.keyboard.press('ArrowDown');
  const preview = await t.settle(() => page.evaluate(() => ({
    title: document.querySelector('.find-preview-title')?.textContent,
    current: document.querySelectorAll('.find-preview-editor .find-preview-current').length,
    text: document.querySelector('.find-preview-editor .view-lines')?.textContent.replace(/\u00a0/g, ' ') ?? '',
  })), (value) => value.current === 1 && value.text.includes('int score'));
  t.check('the preview shows the chosen match', preview.title === 'SearchApp/src/gCanvas.h' && preview.current === 1 && preview.text.includes('int score = 0;'), preview);
  await page.keyboard.press('Enter');
  await t.eventually('Enter opens the file at the match', () => page.evaluate(() => ({
    tab: document.querySelector('.editor-group.focused .editor-tab.active')?.textContent,
    dialogs: document.querySelectorAll('dialog[open]').length,
  })), (value) => Boolean(value.tab?.includes('gCanvas.h')) && value.dialogs === 0);
  // The editor's text, not yet saved, is what is searched.
  await page.locator('#editor-host .view-line').first().click();
  await page.keyboard.press(docEnd);
  await page.keyboard.type('\n// zebraword');
  await page.keyboard.press(`${mod}+Shift+F`);
  found = await findFor('zebraword');
  t.check('finds text not saved yet', /^gCanvas\.h 1[56]\|zebraword$/.test(found.rows.join(',')), found.rows);
  await page.keyboard.press('Escape');

  // Search Everywhere.
  const tap = async () => { await page.keyboard.down('Shift'); await page.keyboard.up('Shift'); };
  const dialog = page.locator('dialog.search-everywhere[open]');
  await page.locator('#editor-host .view-line').first().click();
  await page.keyboard.press('Shift+A');
  await tap();
  await page.waitForTimeout(300);
  t.check('Shift after a capital letter does not open it', await dialog.count() === 0);
  await page.keyboard.press(`${mod}+z`);
  await tap();
  await page.waitForTimeout(80);
  await tap();
  await dialog.waitFor({ timeout: 3000 }).catch(() => undefined);
  t.check('double Shift opens Search Everywhere', await dialog.count() === 1);
  const everywhere = () => page.evaluate(() => [...document.querySelectorAll('#search-everywhere-list > *')].map((node) => {
    if (!node.classList.contains('search-row')) return `[${node.textContent}]`;
    return [...node.querySelectorAll('.search-name, .search-signature, .search-detail, .command-palette-category')].map((part) => part.textContent).filter(Boolean).join(' | ');
  }));
  await page.fill('.search-everywhere .command-palette-input', 'gcan');
  let items = await t.settle(everywhere, (list) => list.some((item) => item.startsWith('GameCanvas.h')));
  const at = (prefix) => items.findIndex((item) => item.startsWith(prefix));
  t.check('files by letters in order, the closest first', at('gCanvas.h') >= 0 && at('gCanvas.') < at('GameCanvas.h'), items);
  await page.keyboard.press('Tab');
  await t.eventually('Tab moves to Files', () => page.locator('.search-tab.active').innerText(), (text) => text === 'Files');
  items = await t.settle(everywhere, (list) => list.length > 0 && list.every((item) => /^\w+\.(h|cpp) \| /.test(item)));
  t.check('Files shows only files, the engine\'s too', items.length > 0 && items.every((item) => /^\w+\.(h|cpp) \| /.test(item)) && items.some((item) => item.includes('GlistEngine/')), items);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.fill('.search-everywhere .command-palette-input', 'build');
  await t.eventually('commands', everywhere, (list) => list.some((item) => item.startsWith('Build |')));
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+Tab');
  await page.fill('.search-everywhere .command-palette-input', 'main.cpp:5');
  await t.settle(everywhere, (list) => list.some((item) => item.startsWith('main.cpp')));
  await page.keyboard.press('Enter');
  await t.eventually('name:line opens the file at the line', () => page.evaluate(() => ({
    tab: document.querySelector('.editor-group.focused .editor-tab.active')?.textContent,
    line: [...document.querySelectorAll('.editor-group.focused .line-numbers.active-line-number')].map((node) => node.textContent).join(),
  })), (value) => Boolean(value.tab?.includes('main.cpp')) && value.line === '5');
});
