// The Terminal tab: a shell in the project with the studio's terminal type and its size, Ctrl+C,
// several terminals (New Terminal, the list switching between them, each with its own shell and
// screen, Close Terminal ending the one showing, a fresh one after the last), exit reported,
// Show in > Integrated Terminal at a folder, Ctrl+Shift+`, and Settings > Environment's shell
// for new terminals, kept across a reload. (gs-terminal.mjs, gs-terminals.mjs)
import { e2e, glistApp } from '../common.mjs';

await e2e({
  setup: (w) => { glistApp(w, 'ShellApp'); },
}, async (t) => {
  const { page } = t;
  const app = t.project('ShellApp');
  await t.openProject('ShellApp');
  const shown = '#terminal .terminal-instance:not([hidden])';
  const screen = async () => (await page.locator(`${shown} .xterm-rows`).innerText()).replace(/\u00a0/g, ' ');
  // Keys typed before the shell is there would be lost: wait for its prompt.
  const run = async (command) => {
    await t.settle(screen, (text) => /[$#] *$/m.test(text), 10000);
    await page.locator(`${shown} .xterm-helper-textarea`).focus();
    await page.keyboard.type(`${command}\n`);
  };
  // Runs a command and waits for what it prints.
  const answer = async (command, pattern, timeout = 10000) => {
    await run(command);
    const text = await t.settle(screen, (value) => pattern.test(value), timeout);
    return text.match(pattern);
  };
  const listed = () => page.locator('#terminal-select option').allInnerTexts();
  const alive = (pid) => { try { process.kill(Number(pid), 0); return true; } catch { return false; } };

  await page.locator('.output-tab[data-panel="terminal"]').click();
  await page.locator(`${shown} .xterm-rows`).waitFor();
  const cwd = await answer('echo "cwd=$(pwd)"', /^cwd=(\S+) *$/m);
  t.check('a shell starts in the project', cwd?.[1] === app, cwd?.[1]);
  const size = await answer('echo "term=$TERM/$TERM_PROGRAM size=$(tput cols)x$(tput lines)"', /term=(\S+) size=(\d+)x(\d+)/);
  const rows = await page.locator(`${shown} .xterm-rows > div`).count();
  t.check('the terminal type and its size reach the shell', size?.[1] === 'xterm-256color/GlistStudio' && Number(size?.[3]) === rows, `${size?.[0]}, ${rows} rows drawn`);
  t.check('with Close Terminal and the list beside the tab', JSON.stringify(await listed()) === '["Terminal 1"]' && await page.locator('#close-terminal').isVisible(), await listed());
  const firstPid = (await answer('echo pid-$$', /pid-(\d+)/))?.[1];
  await run('sleep 30');
  await page.waitForTimeout(300);
  await page.keyboard.press('Control+C');
  t.check('Ctrl+C interrupts a program', Boolean(await answer('echo after-interrupt', /^after-interrupt$/m, 4000)), (await screen()).slice(-300));

  await page.click('#new-terminal');
  await t.eventually('New Terminal opens a second and shows it', listed, (list) => JSON.stringify(list) === '["Terminal 1","Terminal 2"]');
  await page.locator(`${shown} .xterm-rows`).waitFor();
  await answer('echo two-$((2+2))', /two-4/);
  const secondPid = (await answer('echo pid-$$', /pid-(\d+)/))?.[1];
  t.check('with a shell and a screen of its own', secondPid && secondPid !== firstPid && !/after-interrupt/.test(await screen()), { firstPid, secondPid });
  await t.choose('#terminal-select + .select-button', 'Terminal 1');
  await t.eventually('the list switches back, the first as it was', screen, (text) => /after-interrupt/.test(text) && !/two-4/.test(text));
  t.check('and its shell still running', Boolean(await answer('echo still-$((3*3))', /still-9/)) && alive(firstPid));

  await page.click('#close-terminal');
  await t.confirm();
  await t.eventually('Close Terminal ends the one showing and shows another', async () => ({ list: await listed(), first: alive(firstPid), second: alive(secondPid) }),
    (value) => JSON.stringify(value.list) === '["Terminal 2"]' && !value.first && value.second, 8000);
  await run('exit');
  await t.eventually('a shell\'s exit is told', screen, (text) => /exited with code 0/.test(text));
  // Nothing runs in it now, so it does not ask.
  await page.click('#close-terminal');
  await t.eventually('closing the last leaves a fresh one', listed, (list) => JSON.stringify(list) === '["Terminal 1"]');
  t.check('which runs a shell', Boolean(await answer('echo fresh-$((4+4))', /fresh-8/)), (await screen()).slice(-200));

  // Show in > Integrated Terminal: one of its own, at the folder.
  await page.locator(`#file-tree .tree-row[data-path="${app}/src"]`).click({ button: 'right' });
  await t.contextItem('Show in').hover();
  await page.locator('.context-menu:not([hidden]) .context-item:visible', { hasText: 'Integrated Terminal' }).click();
  await t.eventually('Integrated Terminal opens a terminal of its own', listed, (list) => list.length === 2);
  t.check('at the folder', Boolean(await answer('pwd', new RegExp(`^${app}/src *$`, 'm'))), (await screen()).slice(-200));

  // Ctrl+Shift+` from the editor: another, the Terminal tab showing it.
  await page.locator('.output-tab[data-panel="output"]').click();
  t.check('the Output tab does not show the list', !(await page.locator('#close-terminal').isVisible()));
  await page.keyboard.press('Control+Shift+Backquote');
  await t.eventually('Ctrl+Shift+` opens another and shows it', async () => ({ list: await listed(), tab: await page.locator('.output-tab.active[data-panel="terminal"]').count() }),
    (value) => value.list.length === 3 && value.tab === 1);

  // Settings > Environment: the shell new terminals start.
  await page.click('#open-settings');
  await page.locator('.settings-tab[data-page="environment"]').click();
  const choices = await page.locator('#terminal-shell option').evaluateAll((options) => options.map((option) => [option.value, option.textContent]));
  t.check('Environment lists the shells, the default named', choices[0]?.[0] === '' && /^Default \(bash\)$/.test(choices[0]?.[1]) && choices.some(([value]) => value === '/bin/sh'), choices);
  await t.choose('#terminal-shell + .select-button', 'sh');
  await page.locator('#settings-close').click();
  await page.click('#new-terminal');
  await page.locator(`${shown} .xterm-rows`).waitFor();
  t.check('a new terminal starts it', Boolean(await answer('ps -p $$ -o comm=', /^-?(\/bin\/)?sh *$/m)), (await screen()).slice(-200));
  await t.load();
  t.check('kept across a reload', await page.locator('#terminal-shell').inputValue() === '/bin/sh');
});
