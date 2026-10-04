// Help > Repair IDE in the browser build, where the server is the backend: it finds the server
// answering; Reload the Window saves first and opens the project again with its tabs; with the
// server stopped, it says the page lost it and to start it again (npm run web). (gs-repair-web.mjs)
import { compileCommands, docEnd, e2e, glistApp, which } from '../common.mjs';

await e2e({
  pageErrors: false,
  setup: (w) => { compileCommands(glistApp(w, 'RepairApp'), ['src/main.cpp', 'src/gCanvas.cpp']); },
}, async (t) => {
  const { page } = t;
  const app = t.project('RepairApp');
  const source = `${app}/src/main.cpp`;
  await t.openProject('RepairApp');
  await t.openFile(source);
  await t.openFile(`${app}/src/gCanvas.h`);
  page.setDefaultTimeout(15000);
  const dialog = page.locator('dialog.repair-dialog[open]');
  const finished = () => page.waitForFunction(() => {
    const view = document.querySelector('dialog.repair-dialog[open]');
    return view && view.querySelector('.repair-summary')?.textContent && !view.querySelector('.repair-step.checking, .repair-step.waiting');
  }, null, { timeout: 60000 }).catch(() => undefined);
  const steps = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('dialog.repair-dialog[open] .repair-step')]
    .map((step) => [step.dataset.check, `${step.dataset.state}: ${[...step.querySelectorAll('.repair-message')].map((each) => each.textContent).join(' ')}`])));

  await t.menu('help', 'Repair IDE');
  await finished();
  let found = await steps();
  t.check('the page\'s Help menu opens Repair IDE; the server answers', found.backend === 'ok: The Glist Studio server is answering.', found);
  t.check('the other checks run against it', /^ok: /.test(found.processes) && /^skipped: Skipped: the Git tools are off/.test(found.git), found);
  t.check(which('clangd') ? 'clangd answers' : 'clangd is not there, and it says so', which('clangd') ? /^ok: /.test(found.clangd) : !/^ok: /.test(found.clangd), found.clangd);

  // Reload the Window: what was typed is saved, and the page opens its project again, with its tabs.
  await page.keyboard.press('Escape');
  await page.locator('.editor-tab', { hasText: 'gCanvas.h' }).click();
  await page.locator('#editor-host .view-lines').click();
  await page.keyboard.press(docEnd);
  await page.keyboard.type('\n// typed before the reload');
  await t.menu('help', 'Repair IDE');
  await finished();
  await page.evaluate(() => { window.beforeReload = true; });
  await dialog.locator('button.repair-reload').click();
  await t.eventually('Reload the Window: the page is new, the project open again with its tabs', async () => ({
    reloaded: await page.evaluate(() => window.beforeReload === undefined).catch(() => false),
    project: await page.locator('#project-root-label').innerText().catch(() => ''),
    tabs: await page.locator(`.editor-tab[data-path="${source}"], .editor-tab[data-path="${app}/src/gCanvas.h"]`).count(),
  }), (value) => value.reloaded && value.project === 'REPAIRAPP' && value.tabs === 2, 30000);
  // The editor drawn, its language and its worker loaded, before the server goes.
  await t.settle(() => page.locator('.editor-group.focused .view-lines span[class*="mtk"]:not(.mtk1)').count(), (count) => count > 0, 10000);
  t.check('what was typed was saved first', t.read(`${app}/src/gCanvas.h`).includes('// typed before the reload'));

  // The server stopped: the page says so, and what to do; it cannot start it. What the page could
  // not fetch from then on (a part of Monaco it loads when first needed) is not the studio's fault.
  t.check('no page errors while the server ran', t.errors.length === 0, t.errors);
  await t.server.stop();
  await t.menu('help', 'Repair IDE');
  await finished();
  found = await steps();
  t.check('with the server stopped: the page lost it, start it again', /^problem: This page lost its connection to the Glist Studio server\. Start the server again if it stopped \(npm run web\), then reload this page\.$/.test(found.backend), found.backend);
  t.check('and the rest that needs it is skipped', /^skipped: /.test(found.clangd) && /^skipped: /.test(found.processes), found);
  const afterStop = t.errors.filter((message) => !/Loading chunk .* failed|Failed to fetch dynamically imported module|^ErrorEvent$/.test(message));
  t.check('no other page errors after it stopped', afterStop.length === 0, afterStop);
});
