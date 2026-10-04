// What clangd brings, when it is installed (skipped otherwise): format on save of the lines changed
// only, by the project's .clang-format (if( with no space, as Glist's code is written), a function
// nobody touched left as it was, #includes never reordered, one Undo taking the formatting back;
// Go to Definition in another file, opening it transient; Search Everywhere's classes and
// functions, the engine's too. (gs-format-lines.mjs, gs-search.mjs, gs-transient-tabs.mjs)
import { e2e, glistApp, mod, which, writeFiles } from '../common.mjs';
import fs from 'node:fs';
import path from 'node:path';

const clangd = which('clangd');

await e2e({
  setup: (w, t) => {
    if (!clangd) t.skip('clangd is not installed');
    const app = glistApp(w, 'ClangdApp', {
      // Tabs 4 wide, as Glist's engine has it, and if( with no space.
      '.clang-format': 'BasedOnStyle: LLVM\nIndentWidth: 4\nTabWidth: 4\nUseTab: ForIndentation\nSpaceBeforeParens: Never\nSortIncludes: CaseSensitive\nColumnLimit: 0\n',
      'src/zeta.h': 'int zeta();\n',
      'src/alpha.h': 'int alpha();\n',
      'src/beta.h': 'int beta();\n',
      'src/main.cpp': '#include "zeta.h"\n#include "alpha.h"\n\nint  untouched( int a ){\n        return a+1;\n}\n\nvoid game() {\n\tint x = 0;\n\tif(x == 0) x = 1;\n}\n',
      'src/shapes.h': '#pragma once\n#include "gImage.h"\n\n// A shape with sides.\nclass Shape {\npublic:\n\tint corners() const;\n\tvoid drawLogo(int x, int y);\nprivate:\n\tgImage logo;\n\tint sides = 3;\n};\n',
      'src/shapes.cpp': '#include "shapes.h"\n\nint Shape::corners() const { return sides; }\n\nvoid Shape::drawLogo(int x, int y) { logo.draw(x, y); }\n',
      'src/use.cpp': '#include "shapes.h"\n\nint use() {\n\tShape triangle;\n\treturn triangle.corners();\n}\n',
    });
    writeFiles(w.engine, { 'engine/graphics/gImage.h': '#pragma once\n\nclass gImage {\npublic:\n\tvoid draw(int x, int y);\n\tint getWidth() const;\n};\n' });
    const build = path.join(app, '_build', 'Release');
    fs.mkdirSync(build, { recursive: true });
    const flags = `-std=c++17 -I${app}/src -I${w.engine}/engine/graphics`;
    fs.writeFileSync(path.join(build, 'compile_commands.json'), JSON.stringify(['main.cpp', 'shapes.cpp', 'use.cpp'].map((file) => ({
      directory: build, file: `${app}/src/${file}`, command: `clang++ ${flags} -c ${app}/src/${file}`,
    }))));
  },
}, async (t) => {
  const { page } = t;
  const app = t.project('ClangdApp');
  await t.openProject('ClangdApp');
  await t.eventually('clangd starts', () => page.locator('#output').innerText(), (text) => /clangd.* is running/.test(text), 20000);
  await t.openFile(`${app}/src/main.cpp`);
  const disk = () => t.read(`${app}/src/main.cpp`).split('\n');
  const shown = () => t.editorText().then((text) => text.split('\n'));
  // Replaces a line's whole text, as typed.
  const retype = async (lineText, text) => {
    const point = await page.evaluate((wanted) => {
      const line = [...document.querySelectorAll('#editor-host .view-line')].find((node) => node.textContent.replace(/ /g, ' ').includes(wanted));
      const rect = line.getBoundingClientRect();
      return { x: rect.left + 40, y: rect.top + rect.height / 2 };
    }, lineText);
    await page.mouse.click(point.x, point.y);
    await page.keyboard.press('End');
    await page.keyboard.press('Shift+Home');
    await page.keyboard.press('Shift+Home');
    await page.keyboard.type(text);
  };
  // Saved, formatted as it is written: the file changed and the tab's mark gone.
  const save = async () => {
    const before = t.read(`${app}/src/main.cpp`);
    await page.keyboard.press(`${mod}+s`);
    await t.settle(async () => t.read(`${app}/src/main.cpp`) !== before && (await page.locator('.editor-tab.active .dirty-dot.visible').count()) === 0, Boolean, 10000);
  };

  await retype('if(x == 0) x = 1;', '    if (x == 0)   x = 2;');
  await save();
  let lines = disk();
  t.check('format on save: the line typed into gets a tab, and if( as the .clang-format says', lines[9] === '\tif(x == 0) x = 2;', lines[9]);
  t.check('the function nobody touched stays as it was', lines[3] === 'int  untouched( int a ){' && lines[4] === '        return a+1;', lines.slice(3, 5));
  t.check('the #includes keep their order', lines[0] === '#include "zeta.h"' && lines[1] === '#include "alpha.h"', lines.slice(0, 2));
  await page.keyboard.press(`${mod}+z`);
  await t.eventually('one Undo takes the formatting back', () => shown().then((now) => now[9]), (line) => line === '    if (x == 0)   x = 2;');
  await page.keyboard.press(`${mod}+Shift+z`);
  await t.eventually('and Redo brings it again', () => shown().then((now) => now[9]), (line) => line === '    if(x == 0) x = 2;');
  await retype('#include "alpha.h"', '#include "beta.h"');
  await save();
  lines = disk();
  t.check('an #include changed is not reordered either', lines[0] === '#include "zeta.h"' && lines[1] === '#include "beta.h"', lines.slice(0, 2));

  // Go to Definition in another file: opened transient.
  await t.openFile(`${app}/src/use.cpp`);
  const wordAt = (lineText, word) => page.evaluate(([wantedLine, wantedWord]) => {
    const plain = (text) => text.replace(/ /g, ' ');
    const line = [...document.querySelectorAll('.editor-group.focused .editor-host .view-line')].find((node) => plain(node.textContent).includes(wantedLine));
    if (!line) return null;
    const range = document.createRange();
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = plain(node.textContent).indexOf(wantedWord);
      if (at >= 0) { range.setStart(node, at); range.setEnd(node, at + wantedWord.length); const box = range.getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; }
    }
    return null;
  }, [lineText, word]);
  const definition = () => page.locator(`.editor-tab.active.transient[data-path="${app}/src/shapes.h"]`).count();
  // clangd answers once it has read the file; until then F12 finds nothing.
  for (let attempt = 0; attempt < 20 && !(await definition()); attempt += 1) {
    const point = await wordAt('Shape triangle', 'Shape');
    if (point) { await page.mouse.click(point.x, point.y); await page.keyboard.press('F12'); }
    await t.settle(definition, Boolean, 1000);
  }
  t.check('Go to Definition opens the other file, transient', await definition() === 1);
  await t.eventually('at the class', () => page.locator('.editor-group.focused .line-numbers.active-line-number').first().innerText().catch(() => ''), (line) => line === '5');

  // Search Everywhere: classes and functions from clangd's index, the engine's too.
  const tap = async () => { await page.keyboard.down('Shift'); await page.keyboard.up('Shift'); };
  await tap(); await page.waitForTimeout(60); await tap();
  await page.locator('dialog.search-everywhere[open]').waitFor();
  const everywhere = () => page.evaluate(() => [...document.querySelectorAll('#search-everywhere-list .search-row')]
    .map((node) => [...node.querySelectorAll('.search-name, .search-signature, .search-detail')].map((part) => part.textContent).filter(Boolean).join(' | ')));
  await page.fill('.search-everywhere .command-palette-input', 'Shape');
  await t.eventually('classes, with what they are declared as', everywhere, (items) => items.some((item) => item.startsWith('Shape | class Shape')), 25000);
  await page.fill('.search-everywhere .command-palette-input', 'drawlogo');
  await t.eventually('functions with their parameters', everywhere, (items) => items.some((item) => /^drawLogo \| void (Shape::)?drawLogo\(int x, int y\)/.test(item)), 15000);
  await page.fill('.search-everywhere .command-palette-input', 'gImage');
  await t.eventually('the engine\'s classes too', everywhere, (items) => items.some((item) => item.startsWith('gImage | class gImage') && item.includes('gImage.h')), 15000);
  await page.keyboard.press('Escape');
});
