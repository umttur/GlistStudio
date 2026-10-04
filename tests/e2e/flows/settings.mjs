// Settings and the studio's dropdowns: the language (the interface and Monaco's words follow at
// once), the caret's style from a dropdown on both sides of a split, smooth caret and scrolling,
// the minimap and word wrap, Reduce motion, a theme, the explorer's hidden folders; all kept after a
// reload; Graphics hidden in the browser build; a dropdown's menu by keyboard. (gs-editor-settings.mjs,
// gs-more-settings.mjs, gs-settings-select.mjs, gs-french.mjs)
import { e2e, glistApp } from '../common.mjs';

const long = `int counting(int total) {\n${Array.from({ length: 120 }, (_, index) => `\ttotal += ${index}; // ${'a long comment that goes on and on past the edge of the editor, '.repeat(2)}`).join('\n')}\n\treturn total;\n}\n`;

await e2e({
  viewport: { width: 1280, height: 800 },
  setup: (w) => { glistApp(w, 'SettingsApp', { 'src/long.cpp': long, '_build/marker.txt': 'built\n', 'cmake-build-debug/x.txt': 'x\n', '.vscode/settings.json': '{}\n' }); },
}, async (t) => {
  const { page } = t;
  const app = t.project('SettingsApp');
  await t.openProject('SettingsApp');
  const settings = async (name) => {
    if (!(await page.locator('#settings-dialog[open]').count())) await page.click('#open-settings');
    await page.locator(`.settings-tab[data-page="${name}"]`).click();
  };
  const close = async () => { await page.click('#settings-close'); await page.locator('#settings-dialog[open]').waitFor({ state: 'detached' }).catch(() => undefined); };
  const rows = () => page.locator('#file-tree .tree-row .tree-label').allInnerTexts();

  // The language: the interface follows at once.
  await settings('general');
  await t.choose('#settings-language + .select-button', 'Türkçe');
  await t.eventually('Türkçe: the interface follows at once', () => page.locator('.menu-button[data-menu="file"]').innerText(), (text) => text === 'Dosya');
  t.check('Settings too', await page.locator('.settings-tab[data-page="editor"]').innerText() === 'Düzenleyici', await page.locator('.settings-tab[data-page="editor"]').innerText());
  await t.choose('#settings-language + .select-button', 'English');
  await t.eventually('and back to English', () => page.locator('.menu-button[data-menu="file"]').innerText(), (text) => text === 'File');
  t.check('General keeps Graphics hidden in the browser build', await page.locator('#graphics-settings').isHidden());
  await close();

  const names = await rows();
  t.check('_build, cmake-build-* and .vscode are hidden by default', !names.includes('_build') && !names.includes('cmake-build-debug') && !names.includes('.vscode') && names.includes('src'), names);
  await t.openFile(`${app}/src/long.cpp`);
  // Monaco names the caret's style and smooth movement on its cursor layer.
  const carets = () => page.locator('.editor-group:not([hidden]) .cursors-layer').evaluateAll((layers) => layers.map((layer) => layer.className));
  const minimapShown = () => page.locator('#editor-host .minimap').evaluate((node) => getComputedStyle(node).display !== 'none' && node.getBoundingClientRect().width > 0).catch(() => false);
  const codeRows = () => page.locator('#editor-host .view-line').evaluateAll((lines) => lines.filter((line) => /^\s*(total|int|return|\})/.test(line.textContent.replace(/ /g, ' '))).length);
  await t.eventually('by default a line caret that moves smoothly', carets, (layers) => layers.length === 1 && /cursor-line-style/.test(layers[0]) && /cursor-smooth-caret-animation/.test(layers[0]));
  t.check('the minimap shows by default', await t.settle(minimapShown, Boolean, 3000));
  await page.locator('.editor-tab', { hasText: 'long.cpp' }).click({ button: 'right' });
  await t.contextItem('Split Right').click();
  await t.settle(carets, (layers) => layers.length === 2);
  const unwrapped = await codeRows();

  await settings('editor');
  t.check('the Editor page: caret, smooth caret and scrolling on, word wrap off, minimap and sticky scroll on', await page.locator('.settings-page[data-page="editor"] #caret-style').count() === 1
    && await page.locator('#smooth-caret').isChecked() && await page.locator('#smooth-scrolling').isChecked()
    && !(await page.locator('#word-wrap').isChecked()) && await page.locator('#show-minimap').isChecked() && await page.locator('#sticky-scroll').isChecked());
  await t.choose('#caret-style + .select-button', 'Block');
  await page.locator('#smooth-caret').uncheck();
  await page.locator('#word-wrap').check();
  await page.locator('#show-minimap').uncheck();
  await close();
  await t.eventually('a block caret that jumps, on both sides of the split', carets, (layers) => layers.length === 2 && layers.every((layer) => /cursor-block-style/.test(layer) && !/cursor-smooth-caret-animation/.test(layer)));
  await page.locator('.editor-group').nth(0).locator('.view-lines').click();
  await t.eventually('wrapping, a long line takes more than one row', codeRows, (count) => count < unwrapped);
  t.check('the minimap goes', !(await minimapShown()));

  // A dropdown by keyboard: its button opens the menu, the arrows and Enter choose.
  await settings('editor');
  await page.locator('#caret-style + .select-button').focus();
  await page.keyboard.press('ArrowDown');
  await page.locator('.context-menu:not([hidden])').waitFor();
  const choices = await page.locator('.context-menu:not([hidden]) .context-item').allInnerTexts();
  t.check('a dropdown opens its choices in the studio\'s menu, the chosen one ticked', choices.map((text) => text.trim()).join('|') === 'Line|Block|Underline'
    && await page.locator('.context-menu:not([hidden]) .context-item.checked').innerText() === 'Block', choices);
  await page.locator('.context-menu:not([hidden]) .context-item', { hasText: 'Underline' }).click();
  t.check('choosing sets the select', await page.locator('#caret-style').inputValue() === 'underline' && await page.locator('#caret-style + .select-button').innerText() === 'Underline');

  await settings('appearance');
  const background = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ui-bg').trim());
  const dark = await background();
  await page.locator('.theme-card', { hasText: 'Gruvbox Light' }).click();
  await t.eventually('a theme changes the colours at once', background, (color) => color !== dark);
  await page.locator('#reduce-motion').check();
  await settings('general');
  const list = await page.locator('#hidden-folders').inputValue();
  await page.locator('#hidden-folders').fill(list.replace(/,\s*\.vscode/, ''));
  await page.locator('#hidden-folders').press('Enter');
  await page.locator('#hidden-folders').evaluate((input) => input.dispatchEvent(new Event('change')));
  await close();
  t.check('Reduce motion marks the page', await page.evaluate(() => document.documentElement.hasAttribute('data-reduce-motion')));
  await t.eventually('.vscode shows once it leaves the hidden folders; _build stays hidden', rows, (list) => list.includes('.vscode') && !list.includes('_build'));
  const light = await background();

  await t.load();
  await t.openProject('SettingsApp');
  await settings('editor');
  const kept = [await page.locator('#caret-style').inputValue(), await page.locator('#smooth-caret').isChecked(), await page.locator('#word-wrap').isChecked(), await page.locator('#show-minimap').isChecked()];
  t.check('kept after a reload', JSON.stringify(kept) === '["underline",false,true,false]', kept);
  await close();
  t.check('the theme and Reduce motion too', await background() === light && await page.evaluate(() => document.documentElement.hasAttribute('data-reduce-motion')));
  t.check('and the hidden folders', (await rows()).includes('.vscode'));
});
