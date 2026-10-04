// A file's diff, and Open File from it: scrolled, the first line in sight sits at the same height
// in the file, the cursor on it; with a line clicked, that line at its height; from a commit's diff,
// the same line in the file as it is now, though lines were added above it since. Rollback from
// the diff's toolbar takes the change back. (gs-diff-open-file.mjs)
import { e2e, git, glistApp, writeFiles } from '../common.mjs';

const lines = (count, change = {}) => `${Array.from({ length: count }, (_, index) => change[index + 1] ?? `int value${index + 1} = ${index + 1};`).join('\n')}\n`;

await e2e({
  // Scrolling at once, so that where a line sits on screen is known when it is read.
  storage: { 'glist-studio-git': 'on', 'glist-studio-diff-inline': 'off', 'glist-studio-editor': JSON.stringify({ smoothScrolling: false }) },
  setup: (w) => {
    const app = glistApp(w, 'DiffApp', { 'src/main.cpp': lines(300) });
    git(w, app, 'init', '-q', '-b', 'main');
    git(w, app, 'add', '-A');
    git(w, app, 'commit', '-qm', 'first');
    writeFiles(app, { 'src/main.cpp': lines(300, { 250: 'int value250 = 2500; // changed in second' }) });
    git(w, app, 'commit', '-qam', 'second');
    // Not committed: seven lines added at the top, and one changed further down.
    writeFiles(app, { 'src/main.cpp': `${Array.from({ length: 7 }, (_, index) => `// added ${index + 1}`).join('\n')}\n${lines(300, { 250: 'int value250 = 2500; // changed in second', 200: 'int value200 = 0; // changed now' })}` });
  },
}, async (t) => {
  const { page } = t;
  const app = t.project('DiffApp');
  await t.openProject('DiffApp');
  await page.locator('#git-branch-chip', { hasText: 'main' }).waitFor();
  const diffSide = '.diff-view:not([hidden]) .monaco-diff-editor .editor.modified';
  const fileEditor = '#editor-host .monaco-editor';
  // Each line in sight: its number, its text and its height on screen.
  const inSight = (editor) => page.evaluate((selector) => {
    const root = document.querySelector(selector);
    if (!root) return [];
    const box = root.querySelector('.lines-content')?.closest('.overflow-guard')?.getBoundingClientRect() ?? root.getBoundingClientRect();
    const texts = [...root.querySelectorAll('.view-line')].map((line) => ({ top: Math.round(line.getBoundingClientRect().top), text: line.textContent.replace(/\u00a0/g, ' ') }));
    return [...root.querySelectorAll('.line-numbers')].map((number) => {
      const top = Math.round(number.getBoundingClientRect().top);
      return { line: Number(number.textContent), top, text: texts.find((each) => Math.abs(each.top - top) <= 1)?.text ?? '' };
    }).filter((each) => each.top >= box.top - 1 && each.top < box.bottom && each.line > 0).sort((a, b) => a.top - b.top);
  }, editor);
  // The line at a height on screen, once the editor has stopped moving.
  const at = async (editor, top) => (await t.settle(() => inSight(editor).then((list) => list.find((each) => Math.abs(each.top - top) <= 3)), Boolean, 3000));
  const cursorLine = () => page.locator(`${fileEditor} .line-numbers.active-line-number`).first().innerText().then(Number).catch(() => 0);
  const stable = async (editor) => {
    let last = '';
    await t.settle(async () => { const before = last; last = JSON.stringify((await inSight(editor))[0]); return before === last; }, Boolean, 3000);
  };
  // A diff moves to its first change once it is computed (not always, for one whose contents come
  // after it is shown), and scrolling before that is undone: shown, and still for a moment.
  const settled = async (text) => {
    await t.settle(() => inSight(diffSide), (list) => list.some((each) => each.text.includes(text)) && list.length > 10);
    let last = '';
    let since = Date.now();
    await t.settle(async () => {
      const now = JSON.stringify((await inSight(diffSide))[0]);
      if (now !== last) { last = now; since = Date.now(); }
      return Date.now() - since;
    }, (quiet) => quiet >= 700, 4000);
  };
  const computed = () => page.locator(`${diffSide} .line-insert`).first().waitFor();
  // Scrolled by pages, as Cmd+PageDown (Alt+PageDown elsewhere) does, which leaves the cursor where it was.
  const scrollDiff = async (pages) => {
    const box = await page.locator(diffSide).boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + 12);
    for (let turned = 0; turned < pages; turned += 1) await page.keyboard.press(process.platform === 'darwin' ? 'Meta+PageDown' : 'Alt+PageDown');
    await stable(diffSide);
  };
  const openFile = async () => {
    await page.click('#diff-open');
    await page.locator('#diff-view[hidden]').waitFor({ state: 'attached' });
    await stable(fileEditor);
  };

  // 1. The working diff, scrolled without a click: the first line in sight, at its height.
  await page.click('#commit-activity');
  await page.locator('#commit-changes .change-row', { hasText: 'main.cpp' }).first().click();
  await page.locator(diffSide).waitFor();
  await t.eventually('a changed file\'s row opens its diff', () => page.locator('.diff-view:not([hidden]) .monaco-diff-editor').innerText(), (text) => text.replace(/\u00a0/g, ' ').includes('// added 1'));
  await computed();
  await scrollDiff(5);
  let anchor = (await inSight(diffSide))[0];
  t.check('the diff scrolled down the file first, the cursor out of sight', anchor?.line > 10, anchor);
  await openFile();
  let landed = await at(fileEditor, anchor?.top ?? -100);
  t.check('scrolled, Open File puts the first line in sight at the same height', anchor && landed && landed.line === anchor.line && landed.text === anchor.text, { anchor, landed });
  await t.eventually('with the cursor on it', cursorLine, (line) => line === anchor?.line);

  // 2. A line clicked in the diff, lower on screen: that line, at its height. (The diff was a
  // transient tab, which the file took the place of.)
  t.check('the diff\'s transient tab gave its place to the file', await page.locator('.editor-tab.diff').count() === 0);
  await page.locator('#commit-changes .change-row', { hasText: 'main.cpp' }).first().click();
  await page.locator(diffSide).waitFor();
  await t.settle(() => inSight(diffSide), (list) => list[0]?.text === '// added 1');
  await computed();
  await scrollDiff(2);
  const shown = await inSight(diffSide);
  anchor = shown[Math.floor(shown.length * 0.6)];
  await page.mouse.click((await page.locator(diffSide).boundingBox()).x + 300, anchor.top + 8);
  await openFile();
  landed = await at(fileEditor, anchor.top);
  t.check('a line clicked in the diff: Open File puts it at the same height', landed && landed.line === anchor.line && landed.text === anchor.text, { anchor, landed });
  await t.eventually('the cursor on that line', cursorLine, (line) => line === anchor.line);

  // 3. A commit's diff (first to second), the file since grown by seven lines at the top.
  await page.click('#git-tab');
  await page.locator('button', { hasText: /^Log$/ }).first().click();
  await page.locator('.log-row', { hasText: 'second' }).first().click();
  await page.locator('.git-file-row', { hasText: 'main.cpp' }).first().click();
  await settled('value');
  await scrollDiff(8);
  anchor = (await inSight(diffSide))[0];
  await openFile();
  landed = await at(fileEditor, anchor?.top ?? -100);
  t.check('from a commit\'s diff, the same line in the file as it is now, at the same height', anchor && landed && landed.text === anchor.text && landed.line === anchor.line + 7, { anchor, landed });

  // Rollback from the working diff's toolbar.
  await page.click('#commit-activity').catch(() => undefined);
  await t.showView('commit');
  await page.locator('#commit-changes .change-row', { hasText: 'main.cpp' }).first().click();
  await page.locator('.diff-view:not([hidden]) #diff-rollback, .diff-view:not([hidden]) button[data-diff="rollback"]').first().click();
  await t.confirm();
  await t.eventually('Rollback in the diff takes the changes back', () => t.read(`${app}/src/main.cpp`), (text) => text === lines(300, { 250: 'int value250 = 2500; // changed in second' }));
});
