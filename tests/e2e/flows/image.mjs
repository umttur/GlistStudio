// Image files open as pictures, not as text: fitted to the tab with their size beneath, at their
// own size after a click; opened again, the same tab; an SVG too, its script not run; a broken one
// says so; one in the engine under Dependencies; the tab follows a rename and closes when the file
// is deleted. (gs-image.mjs)
import fs from 'node:fs';
import path from 'node:path';
import { e2e, glistApp, repo, writeFiles } from '../common.mjs';

await e2e({
  setup: (w) => {
    const app = glistApp(w, 'ImageApp', {
      'assets/shape.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="#e44"/><script>window.svgRan = true</script></svg>',
      'assets/broken.png': 'this is not a picture',
    });
    fs.copyFileSync(path.join(repo, 'assets', 'glistengine.png'), `${app}/assets/logo.png`);
    writeFiles(w.engine, { 'engine/core/gBaseCanvas.h': '#pragma once\n' });
    fs.mkdirSync(`${w.engine}/engine/icons`, { recursive: true });
    fs.copyFileSync(path.join(repo, 'assets', 'glistengine.png'), `${w.engine}/engine/icons/engine.png`);
  },
}, async (t) => {
  const { page, w } = t;
  const app = t.project('ImageApp');
  const view = '.readme-view:not([hidden])';
  const picture = () => page.locator(`${view} .image-picture`);
  const facts = () => page.locator(`${view} .image-facts`).innerText().catch(() => '');
  const drawn = () => picture().evaluate((image) => image.complete && image.naturalWidth > 0).catch(() => false);
  await t.openProject('ImageApp');

  await (await t.reveal(`${app}/assets/logo.png`)).dblclick();
  await t.eventually('a PNG opens as a picture in a tab', () => page.locator(`.editor-tab.active[data-path="${app}/assets/logo.png"]`).count(), (count) => count === 1);
  await t.eventually('drawn, not as text', drawn, Boolean);
  t.check('the text editor hidden', !(await page.locator('#editor-host').evaluate((host) => host.classList.contains('visible'))));
  await t.eventually('its size in pixels and bytes beneath', facts, (text) => /^\d+ × \d+ · [\d.,]+\s?(kB|KB|MB|bytes?)/.test(text));
  const stageActual = () => page.locator(`${view} .image-stage`).evaluate((stage) => stage.classList.contains('actual'));
  await picture().click();
  const actual = await t.settle(stageActual, Boolean, 2000);
  await picture().click();
  t.check('a click shows it at its own size, another fits it again', actual && !(await t.settle(stageActual, (value) => !value, 2000)));
  await (await t.reveal(`${app}/assets/logo.png`)).dblclick();
  t.check('opened again, the same tab', await page.locator(`.editor-tab[data-path="${app}/assets/logo.png"]`).count() === 1);

  await (await t.reveal(`${app}/assets/shape.svg`)).dblclick();
  await t.eventually('an SVG too', facts, (text) => /^40 × 30/.test(text));
  t.check('its script not run', !(await page.evaluate(() => Boolean(window.svgRan))));
  await (await t.reveal(`${app}/assets/broken.png`)).dblclick();
  await t.eventually('a broken one says it cannot be shown', () => page.locator(view).innerText(), (text) => /The image could not be shown/.test(text));

  // Renamed: its tab follows. Deleted: its tab closes.
  await (await t.reveal(`${app}/assets/logo.png`)).click();
  await page.keyboard.press('F2');
  await page.fill('#input-dialog-value', 'brand.png');
  await page.keyboard.press('Enter');
  await t.eventually('renamed, its tab follows', async () => [
    await page.locator(`.editor-tab[data-path="${app}/assets/brand.png"]`).count(),
    await page.locator(`.editor-tab[data-path="${app}/assets/logo.png"]`).count(),
  ], (counts) => counts[0] === 1 && counts[1] === 0);
  await page.locator(`.editor-tab[data-path="${app}/assets/brand.png"]`).click();
  await t.eventually('and still shows it', drawn, Boolean);
  await (await t.reveal(`${app}/assets/brand.png`)).click();
  await page.keyboard.press('Delete');
  await t.confirm();
  await t.eventually('deleted, its tab closes', async () => !fs.existsSync(`${app}/assets/brand.png`) && await page.locator(`.editor-tab[data-path="${app}/assets/brand.png"]`).count() === 0, Boolean);

  // One in the engine, under Dependencies.
  const engineRow = (dir) => page.locator(`#file-tree .tree-row[data-path="${dir}"]`).first();
  for (const dir of [w.engine, `${w.engine}/engine`, `${w.engine}/engine/icons`]) {
    await engineRow(dir).waitFor();
    if (!(await engineRow(dir).locator('.tree-arrow.expanded').count())) await engineRow(dir).locator('.tree-arrow').click();
  }
  await engineRow(`${w.engine}/engine/icons/engine.png`).dblclick();
  await t.eventually('one in the engine opens too', drawn, Boolean);
});
