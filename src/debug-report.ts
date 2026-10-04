import { copyText, showTextToCopy } from './clipboard';

// Help > Copy Debug Info, and Copy Details on an error notice: what someone
// fixing a problem asks first, as text to paste into an issue. Which Glist
// Studio this is and what it runs on, the engine and plugins, the window and
// its settings, the error with its stack, and the log's last lines. It is
// written in English in every language, for whoever reads the issue.
//
// Nothing personal or secret goes in: the home folder is written ~, git's name
// and email, mail addresses, tokens, passwords and keys are hidden, and what
// was typed, such as a commit message being written, is left out.

// An error notice, or an error nothing caught.
export interface ReportError {
  text: string;
  detail?: string;
  // An Error, or what the main process or the backend said of one.
  error?: unknown;
}

// The window as it is now, which renderer.ts knows.
export interface ReportWindow {
  project: string | null;
  zoom: number;
  theme: string;
  language: string;
}

export interface ReportFacts {
  time: string;
  // The app's main process, or the browser build's server; null when it did not answer.
  app: GlistDebugInfo | null;
  // Only in the browser build, whose page may be on another computer than the server.
  userAgent?: string;
  about: GlistAbout | null;
  window: ReportWindow;
  // Local storage's glist-studio- entries, as stored.
  settings: Array<[string, string]>;
  // Hidden wherever they appear: git's name and email.
  personal: string[];
  error?: ReportError;
  // The log's last lines (log-file.ts), made safe there already.
  log?: string[];
}

const hidden = '[hidden]';
const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A name that says its value is secret: GITHUB_TOKEN, password, api-key.
const secretName = /token|secret|passw(?:or)?d|passphrase|credential|api[_-]?key|private[_-]?key|access[_-]?key|auth|cookie/i;
// Tokens recognised by their shape: GitHub's, GitLab's, OpenAI's and Anthropic's, Slack's, AWS's, Google's, and JSON Web Tokens.
const tokenShapes = /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_\w{20,}|glpat-[\w-]{20,}|sk-[\w-]{20,}|xox[abprs]-[\w-]{10,}|AKIA[0-9A-Z]{16}|AIza[\w-]{30,}|eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,})/g;

// Text with the home folder written ~ and anything personal or secret in it hidden.
export const redactText = (text: string, home: string, personal: string[] = []): string => {
  let result = text.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, hidden);
  // Who signs in to a server, and with what, in an address; git's own SSH user is no one's.
  result = result.replace(/\b([a-z][a-z0-9+.-]*:\/\/)([^\s/@]+)@/gi, (match, scheme: string, user: string) => (user === 'git' ? match : `${scheme}${hidden}@`));
  const homes = home.replace(/[\\/]+$/, '').length < 3 ? [] : [...new Set([home, home.replace(/\\/g, '/'), encodeURI(home.replace(/\\/g, '/'))]
    .map((folder) => folder.replace(/[\\/]+$/, '')))];
  if (homes.length > 0) result = result.replace(new RegExp(`(?:${homes.map(escape).join('|')})(?![\\w.-])`, 'gi'), '~');
  personal.map((value) => value.trim()).filter((value) => value.length >= 3).forEach((value) => {
    result = result.replace(new RegExp(`(?<![\\w.+-])${escape(value)}(?![\\w-])`, 'gi'), hidden);
  });
  result = result.replace(tokenShapes, hidden).replace(/\bBearer\s+[\w.~+/=-]{8,}/gi, `Bearer ${hidden}`);
  // name=value and name: value where the name says it is secret; a file's line and column are not.
  result = result.replace(/([\w.-]*(?:token|secret|passw(?:or)?d|passphrase|credential|api[_-]?key|private[_-]?key|access[_-]?key|auth|cookie)[\w.-]*)("?\s*[:=]\s*"?)([^\s"'&,;]+)/gi,
    (match, name: string, between: string, value: string) => (/^[\d:]+$/.test(value) || value === hidden ? match : `${name}${between}${hidden}`));
  result = result.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}\b/gi, (address) => (address.startsWith('git@') ? address : hidden));
  // Long runs of letters and digits are keys, unless they are a commit's id.
  return result.replace(/[A-Za-z0-9+_=-]{32,}/g, (run) => (/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(run) || !/\d/.test(run) || !/[A-Za-z]/.test(run)
    ? run : hidden));
};

// Settings that hold what someone typed: only their length is told.
const typedSettings = /^glist-studio-(?:commit-message|run-arguments):/;
// Settings the studio keeps for itself, too long to help: only their size.
const bulkySettings = /^glist-studio-(?:session:|breakpoints:|custom-themes$)/;
// Fields of a stored setting that someone typed: Find in Files' last search, an environment variable's value.
const typedFields = new Set(['text', 'value']);

const shorten = (text: string, most = 300): string => (text.length > most ? `${text.slice(0, most)}… (${text.length} characters)` : text);

// A stored value's text made safe, field by field.
const redactStored = (value: unknown, scrub: (text: string) => string, field = ''): unknown => {
  if (typeof value === 'string') return value && (typedFields.has(field) || secretName.test(field)) ? hidden : scrub(value);
  if (Array.isArray(value)) return value.map((entry) => redactStored(entry, scrub, field));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([name, entry]) => [name, redactStored(entry, scrub, name)]));
  }
  return value;
};

// The studio's settings from local storage, each made safe to show, by name
// without the glist-studio- every one starts with.
export const redactSettings = (entries: Array<[string, string]>, scrub: (text: string) => string): Array<[string, string]> => entries
  .filter(([key]) => key.startsWith('glist-studio-'))
  .map(([key, value]): [string, string] => {
    const name = scrub(key.slice('glist-studio-'.length));
    if (typedSettings.test(key)) return [name, `${hidden} (${value.length} characters)`];
    if (bulkySettings.test(key)) return [name, `left out (${value.length} characters)`];
    let stored: unknown;
    try { stored = JSON.parse(value); } catch { stored = value; }
    if (stored === null || typeof stored !== 'object') return [name, shorten(scrub(value))];
    return [name, shorten(JSON.stringify(redactStored(stored, scrub)))];
  })
  .sort(([left], [right]) => left.localeCompare(right));

// Errors that are no fault: Monaco cancels its own work by throwing Canceled,
// a cancelled request rejects with AbortError, Chromium reports a
// ResizeObserver that needed more than a frame, and a script from elsewhere
// fails without saying how.
export const ignorableError = (error: unknown, message: string): boolean => {
  const name = error && typeof error === 'object' ? (error as { name?: unknown }).name : undefined;
  return name === 'Canceled' || name === 'AbortError' || /^(?:Uncaught )?(?:Error: )?Canceled$/.test(message)
    || /ResizeObserver loop/.test(message) || (!error && /^Script error\.?$/.test(message));
};

// What a notice says of an error: the first line of its message. Monaco throws
// errors again with the whole stack in their message.
export const errorMessage = (error: unknown, fallback = ''): string => {
  const message = typeof error === 'string' ? error
    : error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string' ? (error as { message: string }).message
      : fallback || String(error);
  return shorten(message.trim().split('\n')[0] || fallback, 200);
};

const fence = (text: string): string[] => ['```text', text.replace(/\s+$/, ''), '```'];
const systemNames: Record<string, string> = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' };

// The report as text: headings, name: value lines, and stacks in fenced blocks.
export const formatReport = (facts: ReportFacts): string => {
  const scrub = (text: string): string => redactText(text, facts.app?.home ?? '', facts.personal);
  const lines: string[] = ['## Glist Studio debug report', ''];
  const section = (title: string, rows: Array<[string, string | null | undefined]>, more: string[] = []): void => {
    const shown = rows.filter((row): row is [string, string] => Boolean(row[1]));
    if (shown.length === 0 && more.length === 0) return;
    lines.push(`### ${title}`, ...shown.map(([name, value]) => `${name}: ${value}`), ...more, '');
  };

  if (facts.error) {
    const { text, detail, error } = facts.error;
    const said = error && typeof error === 'object' ? error as { stack?: unknown; message?: unknown; source?: unknown } : null;
    const stack = typeof said?.stack === 'string' && said.stack.trim() ? said.stack : null;
    const message = typeof error === 'string' ? error : typeof said?.message === 'string' ? said.message : null;
    const where = said?.source === 'main' ? 'main process' : said?.source === 'backend' ? 'backend' : null;
    const multiline = Boolean(detail?.includes('\n'));
    section('Error', [
      ['message', scrub(text)],
      ['detail', detail && !multiline ? scrub(detail) : null],
      ['where', where],
      ['error', !stack && message && message !== detail ? scrub(message) : null],
    ], [...(multiline && detail ? ['detail:', ...fence(scrub(detail))] : []), ...(stack ? ['stack:', ...fence(scrub(stack))] : [])]);
  }

  const app = facts.app;
  const about = facts.about;
  const build = facts.userAgent ? 'browser build' : app ? `app, ${app.packaged ? 'packaged' : 'not packaged (run from source)'}` : null;
  section('Glist Studio', [
    ['version', app?.version ?? about?.version ?? 'unknown'],
    ['commit', app?.commit ?? about?.head?.commit ?? 'unknown'],
    ['branch', about?.head?.branch],
    ['build', build],
    ['time', facts.time],
  ]);

  if (facts.userAgent) section('Browser', [['user agent', facts.userAgent]]);
  const system: Array<[string, string | null | undefined]> = app ? [
    ['os', `${systemNames[app.platform] ?? app.platform}${app.systemVersion ? ` ${app.systemVersion}` : ''}`],
    ['platform', app.platform],
    ['arch', app.arch],
    ['os release', app.release],
    ['electron', app.versions.electron],
    ['chromium', app.versions.chrome],
    ['node', app.versions.node],
    ['v8', app.versions.v8],
  ] : (about?.runtime ?? []).map(({ name, version }): [string, string] => [name.toLowerCase(), version]);
  // The browser build's backend runs on the server, which may be another computer than the browser's.
  section(facts.userAgent ? 'Server' : 'System', system.length > 0 ? system : [['state', 'did not answer']]);

  const view = facts.window;
  section('Window', [
    ['project', view.project ? scrub(view.project) : 'none'],
    ['zoom', `${view.zoom}%`],
    ['theme', view.theme],
    ['language', view.language],
  ]);

  section('Glist Engine and plugins', about ? about.repositories.map((repository): [string, string] => {
    const location = scrub(repository.location);
    if (!repository.found) return [repository.name, `not found (${location})`];
    if (!repository.head) return [repository.name, `not a Git checkout (${location})`];
    return [repository.name, `${repository.head.branch ?? 'no branch'} ${repository.head.commit ?? 'no commit'} (${location})`];
  }) : [['state', 'the backend did not answer']]);

  const settings = redactSettings(facts.settings, scrub);
  section('Settings', settings.length > 0 ? settings : [['state', 'none saved']]);
  if (facts.log?.length) lines.push('### Log', ...fence(facts.log.map((line) => shorten(scrub(line), 400)).join('\n')), '');
  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
};

let readWindow: () => ReportWindow = () => ({ project: null, zoom: 100, theme: '', language: '' });
// renderer.ts says how to read the window's state.
export const setReportWindow = (read: () => ReportWindow): void => { readWindow = read; };

// A call's answer, or null when it fails or takes more than three seconds: a
// report is wanted most when something has stopped answering.
const ask = <T>(call: () => Promise<T>): Promise<T | null> => Promise.race([
  Promise.resolve().then(call).catch((): null => null),
  new Promise<null>((resolve) => { window.setTimeout(() => resolve(null), 3000); }),
]);

// The report as of now, with the error when there is one.
export const debugReport = async (error?: ReportError): Promise<string> => {
  const [app, about, identity, log] = await Promise.all([
    ask(() => window.glistAPI.debugInfo()), ask(() => window.glistAPI.aboutInfo()), ask(() => window.glistAPI.gitIdentity()),
    ask(() => window.glistAPI.logTail()),
  ]);
  const settings: Array<[string, string]> = [];
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index) ?? '';
      if (key.startsWith('glist-studio-')) settings.push([key, window.localStorage.getItem(key) ?? '']);
    }
  } catch { /* Storage may be unavailable. */ }
  return formatReport({
    time: new Date().toISOString(),
    app,
    ...(window.glistFiles ? {} : { userAgent: navigator.userAgent }),
    about,
    window: readWindow(),
    settings,
    personal: identity ? [identity.name, identity.email, identity.suggestedName ?? ''] : [],
    ...(error ? { error } : {}),
    ...(Array.isArray(log) ? { log } : {}),
  });
};

// The report, put on the clipboard; if it will not take it, shown to be
// copied by hand, and false.
export const copyReport = async (error?: ReportError): Promise<boolean> => {
  const report = await debugReport(error);
  try {
    await copyText(report);
    return true;
  } catch {
    showTextToCopy(report);
    return false;
  }
};
