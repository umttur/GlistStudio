// Copy Details on error notices and Help > Copy Debug Info: a failed operation (Show In > the file
// manager, which the browser build cannot do) and errors nothing caught (thrown, rejected) each show
// a notice with Copy Details, once per message; the copied report has the error, its stack, Glist
// Studio's version and commit, the browser and the server, the window, the engine and the settings,
// with secrets and git's name and email hidden and the home folder as ~; Monaco's Canceled errors and
// ResizeObserver loops show nothing; a clipboard that refuses gets the report shown to copy by hand.
// (gs-error-details.mjs)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { e2e, glistApp, repo } from '../common.mjs';

const fromRepo = (...args) => { try { return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim(); } catch { return ''; } };
const commit = fromRepo('rev-parse', 'HEAD');
const branch = fromRepo('branch', '--show-current');
let project = '';
let home = '';

await e2e({
  clipboard: true,
  pageErrors: false,
  setup: (w) => {
    project = glistApp(w, 'ErrApp');
    home = w.home;
    fs.mkdirSync(`${w.engine}/engine`, { recursive: true });
  },
  // Secrets to be hidden: an environment variable's token, a commit message being written that has
  // an address in it, a search, and a PATH folder in the home folder.
  storage: (w) => ({
    'glist-studio-environment': JSON.stringify([{ name: 'GITHUB_TOKEN', value: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789' }, { name: 'CC', value: '/usr/bin/clang' }]),
    'glist-studio-find-in-files': JSON.stringify({ text: 'my private search', matchCase: false, wholeWords: false, regex: false, scope: 'project' }),
    [`glist-studio-commit-message:${w.projects}/ErrApp`]: 'wip, ask ada@example.org',
    'glist-studio-custom-path': JSON.stringify([`${w.home}/gs-error-details-bin`]),
  }),
}, async (t) => {
  const { page } = t;
  await t.openProject('ErrApp');
  await t.openFile(`${project}/src/main.cpp`);

  const notices = () => page.evaluate(() => [...document.querySelectorAll('.notice')].map((notice) => notice.innerText.replace(/\s+/g, ' ').trim()));
  t.check('opening a project and a file shows no unexpected error', !(await notices()).some((text) => text.includes('unexpected error')), await notices());
  const clipboard = () => page.evaluate(() => navigator.clipboard.readText());
  const copyFrom = async (notice) => {
    await page.evaluate(() => navigator.clipboard.writeText(''));
    const button = notice.locator('button.notice-copy');
    await button.click();
    const label = await t.settle(() => button.innerText(), (text) => text !== 'Copy Details', 8000);
    return { label, text: await clipboard() };
  };
  // Nothing personal or secret in a report.
  const clean = (text, what) => {
    const leaks = ['ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'ada@example.org', 'wip, ask', 'my private search', home, 'Glist Studio Tests', 'tests@example.invalid'].filter((secret) => secret && text.includes(secret));
    t.check(`${what}: nothing personal or secret`, leaks.length === 0, leaks);
    t.check(`${what}: environment names kept, values hidden`, text.includes('environment: [{"name":"GITHUB_TOKEN","value":"[hidden]"},{"name":"CC","value":"[hidden]"}]'), text.match(/environment: .*/)?.[0]);
    t.check(`${what}: the commit message being written only by length`, /commit-message:\S*ErrApp: \[hidden\] \(24 characters\)/.test(text), text.match(/commit-message.*/)?.[0]);
    t.check(`${what}: the home folder as ~`, text.includes('custom-path: ["~/gs-error-details-bin"]'), text.match(/custom-path.*/)?.[0]);
  };
  const facts = (text, what) => {
    t.check(`${what}: Glist Studio's version, commit and branch`, /### Glist Studio\nversion: \d+\.\d+\.\d+\n/.test(text) && text.includes(`commit: ${commit}`) && (!branch || text.includes(`branch: ${branch}`)), text.slice(0, 600));
    t.check(`${what}: the browser build, its user agent, the server`, text.includes('build: browser build') && /### Browser\nuser agent: Mozilla\/5\.0 .+HeadlessChrome/.test(text)
      && /### Server\nos: \w+\nplatform: \w+\narch: \w+\nos release: \S+\nnode: [\d.]+\nv8: /.test(text), text.match(/### Browser[\s\S]*?### Window/)?.[0]);
    t.check(`${what}: the window`, /### Window\nproject: \S*ErrApp\nzoom: 100%\ntheme: /.test(text) && text.includes('language: en'), text.match(/### Window[\s\S]*?\n\n/)?.[0]);
    t.check(`${what}: the engine`, /### Glist Engine and plugins\nGlistEngine: not a Git checkout \(~\/dev\/glist\/GlistEngine\)/.test(text), text.match(/### Glist Engine[\s\S]*?\n\n/)?.[0]);
    t.check(`${what}: settings by name`, /### Settings\n[\s\S]*language: en\n[\s\S]*star-prompt: done/.test(text), text.match(/### Settings[\s\S]*/)?.[0]);
  };

  // A failed operation: Show In > the file manager, which the browser build cannot do.
  await page.locator(`#file-tree .tree-row[data-path="${project}/src/main.cpp"]`).click({ button: 'right' });
  await page.locator('.context-menu .context-group', { hasText: 'Show In' }).hover();
  await page.locator('.context-submenu .context-item:visible').first().click();
  const failure = page.locator('.notice.error', { hasText: 'Could not open location' });
  await failure.waitFor({ timeout: 8000 }).catch(() => undefined);
  t.check('a failed operation shows an error notice with Copy Details', await failure.locator('button.notice-copy').count() === 1, await notices());
  let copied = await copyFrom(failure);
  t.check('Copy Details says Copied, and the notice stays', copied.label === 'Copied' && await failure.count() === 1, copied.label);
  await t.eventually('then Copy Details again', () => failure.locator('button.notice-copy').innerText(), (text) => text === 'Copy Details');
  t.check('the report starts with its title and the error', copied.text.startsWith('## Glist Studio debug report\n\n### Error\nmessage: Could not open location\ndetail: Not available in the browser.\n'), copied.text.slice(0, 300));
  t.check('the error\'s stack, in a fenced block', /stack:\n```text\nError: Not available in the browser\.\n\s+at .+\n[\s\S]*?```/.test(copied.text), copied.text.match(/stack:[\s\S]*?```[\s\S]*?```/)?.[0]);
  facts(copied.text, 'the failed operation');
  clean(copied.text, 'the failed operation');

  // Errors nothing caught: thrown, and rejected; each message once.
  await page.evaluate(() => { setTimeout(() => { throw new Error('boom from the page'); }); });
  const boom = page.locator('.notice.error', { hasText: 'boom from the page' });
  await boom.waitFor({ timeout: 5000 }).catch(() => undefined);
  t.check('a thrown error shows a notice', await boom.count() === 1 && /Glist Studio ran into an unexpected error/.test(await boom.innerText()), await notices());
  await page.evaluate(() => new Promise((resolve) => { setTimeout(() => { setTimeout(resolve, 300); throw new Error('boom from the page'); }); }));
  t.check('the same error again does not show again', await boom.count() === 1, await notices());
  copied = await copyFrom(boom);
  t.check('its report has the message and where it was thrown', copied.text.includes('message: Glist Studio ran into an unexpected error\ndetail: boom from the page\n')
    && /```text\nError: boom from the page\n\s+at /.test(copied.text), copied.text.slice(0, 500));
  await page.evaluate(() => { Promise.reject(new Error('rejected from the page')); });
  const rejected = page.locator('.notice.error', { hasText: 'rejected from the page' });
  await rejected.waitFor({ timeout: 5000 }).catch(() => undefined);
  t.check('a rejection nothing waited on shows a notice', await rejected.count() === 1, await notices());

  // No fault: Monaco's Canceled, thrown and rejected, and a ResizeObserver loop.
  const before = (await notices()).length;
  await page.evaluate(() => {
    const canceled = () => Object.assign(new Error('Canceled'), { name: 'Canceled' });
    setTimeout(() => { throw canceled(); });
    Promise.reject(canceled());
    window.dispatchEvent(new ErrorEvent('error', { message: 'ResizeObserver loop completed with undelivered notifications.' }));
  });
  // A marker error after them: once its notice shows, theirs would have too.
  await page.evaluate(() => { setTimeout(() => { throw new Error('marker after the harmless ones'); }, 50); });
  await page.locator('.notice.error', { hasText: 'marker after the harmless ones' }).waitFor({ timeout: 5000 }).catch(() => undefined);
  const after = await notices();
  t.check('Monaco\'s Canceled and ResizeObserver loops show nothing', after.length === before + 1 && !after.some((text) => /Canceled|ResizeObserver/.test(text)), after);

  // Help > Copy Debug Info: the same report, without an error.
  await page.evaluate(() => navigator.clipboard.writeText(''));
  await t.menu('help', 'Copy Debug Info');
  const copiedNotice = page.locator('.notice.success', { hasText: 'Debug info copied' });
  await copiedNotice.waitFor({ timeout: 8000 }).catch(() => undefined);
  t.check('Help > Copy Debug Info says it was copied', await copiedNotice.count() === 1, await notices());
  const info = await clipboard();
  t.check('Help\'s report has no error section', info.startsWith('## Glist Studio debug report\n\n### Glist Studio\n') && !info.includes('### Error'), info.slice(0, 200));
  facts(info, 'Help > Copy Debug Info');
  clean(info, 'Help > Copy Debug Info');

  // A clipboard that will not take it: the report shown to be copied by hand, chosen already.
  await page.evaluate(() => { navigator.clipboard.writeText = () => Promise.reject(new DOMException('Document is not focused.', 'NotAllowedError')); });
  await page.evaluate(() => { setTimeout(() => { throw new Error('boom from the page, again'); }); });
  const again = page.locator('.notice.error', { hasText: 'boom from the page, again' });
  await again.waitFor({ timeout: 5000 }).catch(() => undefined);
  await again.locator('button.notice-copy').click();
  const byHand = page.locator('dialog.copy-dialog[open]');
  await byHand.waitFor({ timeout: 6000 }).catch(() => undefined);
  const shownText = await byHand.locator('textarea').inputValue().catch(() => '');
  const chosen = await byHand.locator('textarea').evaluate((box) => box.selectionStart === 0 && box.selectionEnd === box.value.length && document.activeElement === box).catch(() => false);
  t.check('when the clipboard refuses, the report is shown to copy by hand, chosen', await byHand.count() === 1 && shownText.startsWith('## Glist Studio debug report') && /boom from the page, again/.test(shownText) && chosen,
    { open: await byHand.count(), start: shownText.slice(0, 40), chosen });
  t.check('and the button says it could not copy', await again.locator('button.notice-copy').innerText() === 'Could not copy');
  await byHand.locator('button', { hasText: 'Close' }).click();
  await t.eventually('Close closes it', () => page.locator('dialog.copy-dialog').count(), (count) => count === 0);

  const expected = ['boom from the page', 'rejected from the page', 'Canceled', 'marker after the harmless ones'];
  const others = t.errors.filter((message) => !expected.some((text) => message.includes(text)));
  t.check('no other page errors', others.length === 0, others);
});
