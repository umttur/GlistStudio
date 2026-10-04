// A project opens as it was left: its tabs on each side, the one in front of each, the explorer's
// open folders, and where a file was scrolled to; a file gone since is left out. (gs-session.mjs)
import fs from 'node:fs';
import { e2e, glistApp } from '../common.mjs';

const long = Array.from({ length: 400 }, (_, index) => `int value${index + 1} = ${index + 1};`).join('\n');

await e2e({
  viewport: { width: 1280, height: 800 },
  setup: (w) => { glistApp(w, 'SessionApp', { 'src/long.cpp': `${long}\n` }); },
}, async (t) => {
  const { page } = t;
  const app = t.project('SessionApp');
  const sides = () => page.locator('.editor-group:not([hidden])').evaluateAll((groups) => groups.map((group) => ({
    tabs: [...group.querySelectorAll('.editor-tab')].map((tab) => tab.textContent.trim()),
    active: group.querySelector('.editor-tab.active')?.textContent.trim() ?? null,
  })));
  const topLine = () => page.locator('.editor-group').nth(1).locator('.line-numbers').first().innerText().catch(() => '');
  const reopen = async () => {
    await t.load();
    await t.openProject('SessionApp');
  };

  await t.openProject('SessionApp');
  await t.openFile(`${app}/src/main.cpp`);
  await t.openFile(`${app}/src/long.cpp`);
  await page.locator('.editor-tab', { hasText: 'long.cpp' }).click({ button: 'right' });
  await t.contextItem('Split Right').click();
  await page.locator('.editor-group').nth(1).locator('.view-lines').first().waitFor();
  // Scroll the right side's long.cpp well down.
  await page.locator('.editor-group').nth(1).locator('.view-lines').first().hover();
  for (let i = 0; i < 20; i += 1) await page.mouse.wheel(0, 60);
  // Until the scrolling (smooth, by default) has stopped.
  let scrolledTo = '';
  await t.settle(async () => { const before = scrolledTo; scrolledTo = await topLine(); return before === scrolledTo; }, (stopped) => stopped && Number(scrolledTo) > 10);
  await page.locator('.editor-group').first().locator('.editor-tab', { hasText: 'main.cpp' }).click();
  const left = await t.settle(sides, (value) => Boolean(value[0]?.active?.includes('main.cpp')));
  // The session is saved a moment after a change (glist-studio-session:<root>).
  await t.settle(() => page.evaluate((root) => JSON.parse(localStorage.getItem(`glist-studio-session:${root}`) ?? 'null'), app),
    (session) => session?.groups?.[0]?.active?.endsWith('main.cpp') && session.groups.length === 2);

  await reopen();
  await t.eventually('the tabs come back on their sides, the one in front of each too', sides, (value) => JSON.stringify(value) === JSON.stringify(left));
  t.check('the explorer\'s open folder too', await page.locator(`#file-tree .tree-row[data-path="${app}/src/long.cpp"]`).count() === 1);
  await t.eventually('and where the right side\'s file was scrolled to', topLine, (line) => Number(line) > 10 && line === scrolledTo);

  fs.rmSync(`${app}/src/main.cpp`);
  await reopen();
  await t.eventually('a file gone since is left out', sides, (value) => !JSON.stringify(value).includes('main.cpp') && JSON.stringify(value).includes('long.cpp'));
});
