import { copyText, showTextToCopy } from './clipboard';
import { choiceDialog } from './confirm-dialog';
import { debugReport, ignorableError } from './debug-report';
import { icon, type IconName } from './icons';
import { languages } from './languages';
import { t, type TranslationKey } from './localization';
import { notify } from './notifications';
import { repairLog, repairSummary, runRepair, say, type RepairAction, type RepairCheck, type RepairMessage, type RepairResult, type RepairState, type RepairStep } from './repair-runner';
import type { StudioTerminal } from './terminal';

// Help > Repair IDE: checks what could be wrong with the studio, one thing
// after another, and fixes what it can: background work that stopped
// answering is started again, code help that stopped is started again, a lock
// Git left behind is removed, what the window shows running is made to match
// what runs. What it cannot fix, it says how to. At the end, Reload the Window
// starts the page afresh, the editor with it, and Copy Details gives the debug
// report with what Repair IDE found.

export interface RepairHost {
  projectRoot(): string | null;
  gitEnabled(): boolean;
  // Every changed file saved; false when one could not be.
  saveFiles(): Promise<boolean>;
  unsavedFiles(): boolean;
  // The names of databases with changes not committed yet, which live in the backend.
  pendingDatabases(): string[];
  // Commit or Discard asked for each; false for Cancel.
  settleDatabases(): Promise<boolean>;
  saveSession(): void;
  clangd: { answers(within: number): Promise<boolean | null> };
  restartClangd(): Promise<void>;
  // What the window shows running. Debugging: a program the debugger runs, past starting.
  processes(): { building: boolean; running: boolean; debugging: boolean; terminals: StudioTerminal[] };
  matchProcesses(building: boolean, running: boolean): void;
  stopDebugging(): Promise<void>;
  showView(view: 'engine' | 'plugins'): void;
  installGlist(): void;
  build(): void;
}

export interface Repair {
  open(): void;
  // Reload the Window, as from Repair IDE or Ctrl+R: null once it reloads, or
  // why it did not: changed files that could not be saved, or a database's
  // changes kept when asked.
  reload(): Promise<'unsaved' | 'kept' | null>;
  // A restart Repair IDE asked for is underway: the window's own notice of a new backend is not wanted.
  restarting(): boolean;
}

const wait = (milliseconds: number): Promise<void> => new Promise((resolve) => { window.setTimeout(resolve, milliseconds); });

// A call's answer, or an error once it has taken too long.
const within = <T>(call: Promise<T>, milliseconds: number): Promise<T> => Promise.race([
  call,
  wait(milliseconds).then((): never => { throw new Error(t('repairNoAnswer')); }),
]);

// Whether the backend answers: answered, silent past the time given, or failed,
// as a call does when the backend it went to stopped, or the browser build's
// page lost its server.
type Answer = 'answered' | 'silent' | 'failed';
const ping = (milliseconds: number): Promise<Answer> => Promise.race([
  window.glistAPI.ping().then((): Answer => 'answered', (): Answer => 'failed'),
  wait(milliseconds).then((): Answer => 'silent'),
]);

const fill = (key: TranslationKey, values: Record<string, string>): string =>
  Object.entries(values).reduce((text, [name, value]) => text.split(`{${name}}`).join(value), t(key));

const message = (key: TranslationKey, values?: Record<string, string>): RepairMessage => ({ key, ...(values ? { values } : {}) });
const result = (state: RepairResult['state'], messages: RepairMessage[], actions: RepairAction[] = []): RepairResult => ({ state, messages, actions });

// Settings kept as JSON, by name or by the start of it; one that no longer
// reads is left unused by the studio already, so removing it loses nothing.
const jsonSettings = ['agents', 'custom-path', 'custom-themes', 'editor', 'environment', 'find-in-files', 'fonts', 'git-protection'];
const jsonSettingGroups = ['breakpoints:', 'session:'];

const marks: Record<RepairState, IconName> = {
  waiting: 'circle-filled', checking: 'sync', ok: 'check', fixed: 'tools', problem: 'warning', skipped: 'circle-filled',
};

export const setUpRepair = (host: RepairHost): Repair => {
  let restartingNow = false;
  // The page starts afresh, Monaco with it, and opens its project again
  // (index.ts), its files saved and its session kept first. The backend stays,
  // and so would what the page started there: its shells and agent, which no
  // tab would show, and the debugger, so those end. Saving needs the backend;
  // one that does not answer would keep this waiting, so it is given 15 seconds.
  const reloadWindow = async (closing: () => void = () => undefined): Promise<'unsaved' | 'kept' | null> => {
    const saved = await within(host.saveFiles(), 15000).catch(() => false);
    if (!saved || host.unsavedFiles()) return 'unsaved';
    if (!(await host.settleDatabases())) return 'kept';
    host.saveSession();
    host.processes().terminals.filter((terminal) => /^(shell|agent)/.test(terminal.session)).forEach((terminal) => terminal.stop());
    await within(host.stopDebugging(), 5000).catch((): undefined => undefined);
    closing();
    await window.glistAPI.reloadWindow(host.projectRoot());
    return null;
  };
  // Backends that stopped by themselves since the window opened, which the
  // main process started again (index.ts).
  let restartedBefore = 0;
  window.glistAPI.onBackendRestarted(() => { if (!restartingNow) restartedBefore += 1; });
  // Errors thrown in the page since it loaded, which Reload the Window clears.
  let pageErrors = 0;
  window.addEventListener('error', (event) => { if (!ignorableError(event.error, event.message)) pageErrors += 1; });

  let dialog: HTMLDialogElement | null = null;

  const open = (): void => {
    if (dialog?.open) { dialog.focus(); return; }
    let steps: RepairStep[] = [];
    // What was done after the checks, for Copy Details.
    const later: RepairMessage[] = [];
    let running = false;
    let closed = false;

    const view = document.createElement('dialog');
    view.className = 'studio-dialog repair-dialog';
    dialog = view;
    const heading = Object.assign(document.createElement('h2'), { textContent: t('repairIde') });
    const intro = Object.assign(document.createElement('p'), { className: 'repair-intro', textContent: t('repairIntro') });
    const list = Object.assign(document.createElement('ol'), { className: 'repair-steps' });
    const summary = Object.assign(document.createElement('p'), { className: 'repair-summary' });
    summary.setAttribute('role', 'status');
    const button = (key: TranslationKey, className = ''): HTMLButtonElement => Object.assign(document.createElement('button'), { type: 'button', className, textContent: t(key) });
    const copy = button('copyDetails', 'dialog-action-left repair-copy');
    const again = button('repairRunAgain', 'repair-again');
    const reload = button('repairReload', 'repair-reload');
    const close = button('close', 'primary repair-close');
    const actions = Object.assign(document.createElement('div'), { className: 'dialog-actions' });
    actions.append(copy, again, reload, close);
    view.append(heading, intro, list, summary, actions);

    const render = (): void => {
      list.replaceChildren(...steps.map((step) => {
        const row = Object.assign(document.createElement('li'), { className: `repair-step ${step.state}` });
        row.dataset.check = step.id;
        row.dataset.state = step.state;
        const mark = Object.assign(document.createElement('span'), { className: 'repair-mark' });
        mark.append(icon(marks[step.state]));
        const body = Object.assign(document.createElement('div'), { className: 'repair-body' });
        const title = Object.assign(document.createElement('p'), { className: 'repair-title', textContent: t(step.title as TranslationKey) });
        body.append(title);
        const words = step.state === 'checking' && step.messages.length === 0 ? [t('repairChecking')]
          : step.messages.map((each) => say(each, word));
        words.forEach((text) => body.append(Object.assign(document.createElement('p'), { className: 'repair-message', textContent: text })));
        if (step.actions.length > 0 && step.state !== 'checking') {
          const buttons = Object.assign(document.createElement('div'), { className: 'repair-actions' });
          buttons.append(...step.actions.map((action) => {
            // Not while checks run: they would draw over what it does.
            const each = Object.assign(document.createElement('button'), { type: 'button', textContent: t(action.key as TranslationKey), disabled: running });
            each.addEventListener('click', () => action.run());
            return each;
          }));
          body.append(buttons);
        }
        row.append(mark, body);
        return row;
      }));
      const done = !running && steps.length > 0;
      summary.textContent = done ? say(repairSummary(steps), word) : '';
      again.disabled = running;
      reload.disabled = running;
      copy.disabled = running;
      // A page that went wrong is best started afresh: Reload the Window has the keys then.
      const pageBroken = steps.some((step) => step.id === 'editor' && step.state === 'problem');
      reload.classList.toggle('primary', done && pageBroken);
      close.classList.toggle('primary', !(done && pageBroken));
    };

    const update = (id: string, change: Partial<RepairStep>): void => {
      steps = steps.map((step) => (step.id === id ? { ...step, ...change } : step));
      render();
    };

    // Code help's index deleted and built again, for when it shows wrong
    // errors or cannot find things: clangd indexes the project, the engine
    // and the plugins again in the background, which takes a few minutes.
    const rebuildIndex = async (): Promise<void> => {
      update('clangd', { state: 'checking', messages: [message('repairIndexRebuilding')] });
      try {
        await within(window.glistAPI.clearClangdIndex(), 15000);
        await within(host.restartClangd(), 30000);
        const answering = await host.clangd.answers(5000);
        const outcome = answering ? message('repairIndexRebuilt') : message('repairClangdFailed');
        later.push(outcome);
        update('clangd', { state: answering ? 'fixed' : 'problem', messages: [outcome], actions: [] });
      } catch (error) {
        update('clangd', { state: 'problem', messages: [message('repairCheckFailed', { error: error instanceof Error ? error.message : String(error) })], actions: [] });
      }
    };

    const checks = makeChecks(host, {
      rebuildIndex: () => { void rebuildIndex(); },
      restartedBefore: () => restartedBefore,
      pageErrors: () => pageErrors,
      restarting: (on) => { restartingNow = on; },
    });

    const run = async (): Promise<void> => {
      running = true;
      later.length = 0;
      steps = [];
      render();
      steps = await runRepair(checks, (now) => { steps = now; if (!closed) render(); }, () => closed);
      running = false;
      // What it found and did, into the log, in English as Copy Details has it.
      repairLog(steps, languages.en.interface, '').split('\n').filter((line) => /^(?:- |summary: )/.test(line))
        .forEach((line) => { window.glistAPI.writeLog('info', `Repair IDE ${line.replace(/^- /, '')}`).catch((): undefined => undefined); });
      if (!closed) render();
    };

    let copyTimer = 0;
    copy.addEventListener('click', () => {
      void (async () => {
        const report = `${await debugReport()}\n${repairLog(steps, languages.en.interface, new Date().toISOString(), later)}`;
        let label = t('copied');
        try { await copyText(report); } catch { showTextToCopy(report); label = t('copyDetailsFailed'); }
        copy.textContent = label;
        window.clearTimeout(copyTimer);
        copyTimer = window.setTimeout(() => { copy.textContent = t('copyDetails'); }, 2000);
      })();
    });
    again.addEventListener('click', () => { void run(); });
    reload.addEventListener('click', () => {
      void (async () => {
        reload.disabled = true;
        summary.textContent = t('repairReloading');
        const kept = await reloadWindow(() => view.close());
        if (kept === 'unsaved') {
          summary.textContent = t('repairReloadUnsaved');
          reload.disabled = false;
        } else if (kept === 'kept') render();
      })();
    });
    close.addEventListener('click', () => view.close());
    view.addEventListener('close', () => {
      closed = true;
      view.remove();
      if (dialog === view) dialog = null;
    });
    document.body.append(view);
    view.showModal();
    close.focus();
    void run();
  };

  // A backend that stops answering is told of, with Repair IDE: every half
  // minute while the window is in view it is asked, and given a quarter
  // minute. Told once until it answers again.
  let told = false;
  const beat = async (): Promise<void> => {
    if (!document.hidden && !dialog) {
      const answer = await ping(15000);
      if (answer === 'silent' && !told && !dialog) {
        told = true;
        notify({ text: t('repairNotAnswering'), kind: 'error', actions: [{ label: t('repairIde'), run: open }] });
      } else if (answer === 'answered') told = false;
    }
    window.setTimeout(() => { void beat(); }, 30000);
  };
  window.setTimeout(() => { void beat(); }, 30000);

  return { open, reload: () => reloadWindow(), restarting: () => restartingNow };
};

// The words on screen, in the language in use.
const word = (key: string): string => t(key as TranslationKey);

interface CheckHelpers {
  rebuildIndex(): void;
  restartedBefore(): number;
  pageErrors(): number;
  restarting(on: boolean): void;
}

// Whether clangd answers. Started a moment ago, as with a new backend, the
// window may still be setting it up: it is given a while for that first.
const settled = async (clangd: RepairHost['clangd']): Promise<boolean | null> => {
  for (let tries = 0; ; tries += 1) {
    const answer = await clangd.answers(5000);
    if (answer !== null || tries >= 20) return answer;
    await wait(500);
  }
};

const backendAnswers = (found: ReadonlyMap<string, RepairResult>): boolean => {
  const state = found.get('backend')?.state;
  return state === 'ok' || state === 'fixed';
};
const skipped = (key: TranslationKey): RepairResult => result('skipped', [message(key)]);
const noProject = (): RepairResult => skipped('repairSkippedProject');
const noBackend = (): RepairResult => skipped('repairSkippedBackend');

const makeChecks = (host: RepairHost, helpers: CheckHelpers): RepairCheck[] => [
  // Background work: the backend each window has, or the browser build's server.
  {
    id: 'backend',
    title: 'repairBackend',
    run: async (_found, doing) => {
      const app = Boolean(window.glistFiles);
      let answer = await ping(5000);
      if (answer === 'answered') {
        return result('ok', [message(helpers.restartedBefore() > 0 ? 'repairBackendRestartedBefore' : app ? 'repairBackendOk' : 'repairServerOk')]);
      }
      if (!app) return result('problem', [message(answer === 'failed' ? 'repairServerGone' : 'repairServerSilent')]);
      // Stopped just now: the main process is starting another.
      if (answer === 'failed') {
        doing(message('repairBackendWaiting'));
        answer = await ping(30000);
        if (answer === 'answered') return result('fixed', [message('repairBackendStartedAgain')]);
      }
      // Not answering, as when something it does never lets go, such as a
      // long database query: ended from the main process and started again.
      // Changes waiting in databases live in it and go with it, so it asks.
      const waiting = host.pendingDatabases();
      if (waiting.length > 0) {
        const chosen = await choiceDialog(fill('repairRestartLosesDatabase', { name: waiting.join(', ') }), [
          { value: 'restart', label: t('repairRestart'), primary: true },
        ]);
        if (chosen !== 'restart') return result('problem', [message('repairBackendKept', { name: waiting.join(', ') })]);
      }
      doing(message('repairBackendRestarting'));
      helpers.restarting(true);
      let answering = false;
      try { answering = await window.glistAPI.restartBackend(); } finally { helpers.restarting(false); }
      if (!answering) return result('problem', [message('repairBackendRestartFailed')]);
      const messages = [message('repairBackendRestarted')];
      // Files changed meanwhile could not be saved while it was stuck: now they can.
      if (host.unsavedFiles()) messages.push(message(await within(host.saveFiles(), 15000).catch(() => false) ? 'repairFilesSaved' : 'repairFilesNotSaved'));
      if (waiting.length > 0) messages.push(message('databaseChangesLost', { name: waiting.join(', ') }));
      return result('fixed', messages);
    },
  },
  // Code help: clangd, which the backend runs and the window speaks to.
  {
    id: 'clangd',
    title: 'repairClangd',
    run: async (found, doing) => {
      if (!backendAnswers(found)) return noBackend();
      if (!host.projectRoot()) return noProject();
      const state = await within(window.glistAPI.repairState(), 10000);
      const rebuild: RepairAction = { key: 'repairRebuildIndex', run: helpers.rebuildIndex };
      const build: RepairAction[] = state.compileCommands ? [] : [{ key: 'build', run: host.build }];
      const unbuilt = state.compileCommands ? [] : [message('repairClangdNoBuild')];
      if (state.clangd && await settled(host.clangd) === true) {
        return result(unbuilt.length > 0 ? 'problem' : 'ok', [message('repairClangdOk'), ...unbuilt], [...build, rebuild]);
      }
      // Running without answering, it may be stuck on its index: started
      // again with a fresh one. Stopped, it is only started again.
      const stuck = state.clangd;
      doing(message('repairClangdRestarting'));
      if (stuck) await within(window.glistAPI.clearClangdIndex(), 15000);
      await within(host.restartClangd(), 30000);
      if (await host.clangd.answers(5000) !== true) return result('problem', [message('repairClangdFailed')]);
      return result('fixed', [message(stuck ? 'repairClangdStuck' : 'repairClangdRestarted'), ...unbuilt], [...build, rebuild]);
    },
  },
  // Git: a lock left behind stops every Git action. Only with the Git tools on.
  {
    id: 'git',
    title: 'repairGit',
    run: async (found) => {
      if (!host.gitEnabled()) return skipped('repairGitOff');
      if (!backendAnswers(found)) return noBackend();
      if (!host.projectRoot()) return noProject();
      const git = await within(window.glistAPI.repairGit(true), 30000);
      if (!git.installed) return result('problem', [message('repairGitMissing')]);
      if (git.locks.length === 0) return result('ok', [message('repairGitOk')]);
      const keys: Record<GlistRepairLock['state'], TranslationKey> = {
        removed: 'repairGitRemoved', stale: 'repairGitStale', busy: 'repairGitBusy', recent: 'repairGitRecent', failed: 'repairGitFailed',
      };
      // Both of a repository's locks say the same, once.
      const messages = git.locks.map((lock) => message(keys[lock.state], { name: lock.repository, error: lock.message ?? '' }))
        .filter((each, index, all) => all.findIndex((other) => JSON.stringify(other) === JSON.stringify(each)) === index);
      return result(git.locks.every((lock) => lock.state === 'removed') ? 'fixed' : 'problem', messages);
    },
  },
  // Builds, runs, the debugger and terminals: as the window shows them, or as they are.
  {
    id: 'processes',
    title: 'repairProcesses',
    run: async (found) => {
      if (!backendAnswers(found)) return noBackend();
      const state = await within(window.glistAPI.repairState(), 10000);
      const shown = host.processes();
      const messages: RepairMessage[] = [];
      if (shown.building !== state.building) messages.push(message(state.building ? 'repairBuildFound' : 'repairBuildTidied'));
      if (shown.running !== state.running) messages.push(message(state.running ? 'repairRunFound' : 'repairRunTidied'));
      if (shown.building !== state.building || shown.running !== state.running) host.matchProcesses(state.building, state.running);
      if (shown.debugging && !state.debugging) {
        await host.stopDebugging();
        messages.push(message('repairDebugTidied'));
      }
      // A terminal the window takes for running whose program is gone shows it ended.
      const ended = shown.terminals.filter((terminal) => terminal.started && !state.terminals.includes(terminal.session));
      ended.forEach((terminal) => terminal.ended());
      if (ended.length > 0) messages.push(message('repairTerminalEnded'));
      // A shell or agent no terminal shows any more is ended. The installer is left alone.
      const unseen = state.terminals.filter((session) => /^(shell|agent)/.test(session)
        && !shown.terminals.some((terminal) => terminal.session === session && terminal.alive));
      for (const session of unseen) await within(window.glistAPI.stopTerminal(session as GlistTerminalSession), 5000);
      if (unseen.length > 0) messages.push(message('repairShellEnded'));
      return messages.length > 0 ? result('fixed', messages) : result('ok', [message('repairProcessesOk')]);
    },
  },
  // Glist Engine and the plugins the project names, where the build looks for them.
  {
    id: 'glist',
    title: 'repairGlist',
    run: async (found) => {
      if (!backendAnswers(found)) return noBackend();
      if (!host.projectRoot()) {
        const status = await within(window.glistAPI.glistStatus(), 10000);
        return status.installed ? result('ok', [message('repairGlistInstalled')])
          : result('problem', [message('glistMissing')], [{ key: 'installGlist', run: host.installGlist }]);
      }
      const dependencies = await within(window.glistAPI.listDependencies(), 10000);
      const engine = dependencies.find((entry) => entry.kind === 'engine' && !entry.exists);
      const plugins = dependencies.filter((entry) => entry.kind === 'plugin' && !entry.exists).map((entry) => entry.name);
      if (!engine && plugins.length === 0) return result('ok', [message('repairGlistOk')]);
      return result('problem', [
        ...(engine ? [message('repairEngineMissing', { path: engine.path })] : []),
        ...(plugins.length > 0 ? [message('repairPluginsMissing', { name: plugins.join(', ') })] : []),
      ], [
        ...(engine ? [{ key: 'repairShowEngine', run: () => host.showView('engine') }] : []),
        ...(plugins.length > 0 ? [{ key: 'repairShowPlugins', run: () => host.showView('plugins') }] : []),
      ]);
    },
  },
  // Saved settings: one that no longer reads is reset, and storage that takes nothing is told of.
  {
    id: 'settings',
    title: 'repairSettings',
    run: async () => {
      const reset: string[] = [];
      try {
        const keys = Array.from({ length: window.localStorage.length }, (_unused, index) => window.localStorage.key(index) ?? '');
        for (const key of keys) {
          if (!key.startsWith('glist-studio-')) continue;
          const name = key.slice('glist-studio-'.length);
          if (!jsonSettings.includes(name) && !jsonSettingGroups.some((group) => name.startsWith(group))) continue;
          try { JSON.parse(window.localStorage.getItem(key) ?? 'null'); } catch {
            window.localStorage.removeItem(key);
            reset.push(name.split(':')[0]);
          }
        }
        window.localStorage.setItem('glist-studio-repair-check', '1');
        window.localStorage.removeItem('glist-studio-repair-check');
      } catch {
        return result('problem', [message('repairStorageBroken')]);
      }
      return reset.length > 0 ? result('fixed', [message('repairSettingsReset', { name: [...new Set(reset)].join(', ') })])
        : result('ok', [message('repairSettingsOk')]);
    },
  },
  // The editor and the page around it: errors thrown in it since it loaded
  // call for Reload the Window, which has the keys then.
  {
    id: 'editor',
    title: 'repairEditor',
    run: async () => result(helpers.pageErrors() > 0 ? 'problem' : 'ok', [message(helpers.pageErrors() > 0 ? 'repairEditorErrors' : 'repairEditorOk')]),
  },
];
