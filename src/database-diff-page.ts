import { button, cellView, colored, counted, make, numbers, stopAfter, words } from './database-page';
import { icon, type IconName } from './icons';
import { lineChanges } from './line-diff';
import { t, type TranslationKey } from './localization';

// A database compared between two versions, in a tab of its own (database-diff.ts
// compares): its tables and views beside it, each with what happened to it and
// the unchanged ones folded away; for the one chosen, its SQL before and after
// with the lines that differ marked, and its rows added, removed and changed,
// a changed cell as it was and as it is. Its toolbar is a text diff's: the
// previous and next changed table, open the database, put the file back.

export interface DatabaseDiffPage {
  name: string;
  // The versions compared, named as a text diff names them.
  left: string;
  right: string;
  diff?: GlistDatabaseDiff;
  error?: string;
  // Compares again; the tab is drawn again once it has.
  refresh(): Promise<void>;
  // Shown, after being hidden or drawn anew: compares again if what it
  // compared changed meanwhile.
  check(): void;
  // Whether the database's own tab has changes waiting to be committed, which
  // the file does not have yet. Asked each time the page is drawn, as the
  // toolbar's buttons are.
  waiting(): boolean;
  // The database's own tab, while its file is there.
  canOpen(): boolean;
  open(): void;
  // The file put back as the base has it, as a text diff's Rollback does: for
  // a diff against the file on disk, with changes git knows of.
  canRollback(): boolean;
  rollback(): void;
  // Ends a comparison that runs long, asking first: every database open goes with it.
  stop(): void;
  // The table or view shown, whether unchanged ones are listed, and where the
  // shown one's rows and the list were scrolled to, kept while the tab is open.
  chosen?: string;
  unchangedOpen?: boolean;
  scroll?: { table: string; top: number; left: number };
  listTop?: number;
}

const stateWords: Record<GlistDatabaseDiffState, TranslationKey> = {
  added: 'databaseDiffAdded', removed: 'databaseDiffRemoved', changed: 'databaseDiffChanged', unchanged: 'databaseDiffUnchanged',
};
const rowMarks = { added: '+', removed: '−', changed: '~' };
const keyOf = (table: GlistDatabaseDiffTable): string => `${table.kind}:${table.name}`;

// +3 −1 ~2, the counts there are.
const countsView = (rows: GlistDatabaseDiffRows): HTMLElement => {
  const counts = make('span', 'database-diff-counts');
  ([['added', rows.added], ['removed', rows.removed], ['changed', rows.changed]] as const).forEach(([state, count]) => {
    if (count) counts.append(make('span', `database-diff-count ${state}`, `${rowMarks[state]}${numbers().format(count)}`));
  });
  counts.title = words('databaseDiffCounts', { added: rows.added, removed: rows.removed, changed: rows.changed });
  return counts;
};

export const renderDatabaseDiffPage = (target: HTMLElement, page: DatabaseDiffPage): { dispose(): void } => {
  let disposed = false;
  const view = make('div', 'database-diff-view');
  const header = make('div', 'database-diff-header');
  const action = (name: IconName, title: string, run: () => void, className = ''): HTMLButtonElement => {
    const made = button('', `heading-action ${className}`.trim());
    made.title = title;
    made.append(icon(name));
    made.addEventListener('click', run);
    return made;
  };
  // Set once the tables are known.
  let step = (by: number): void => { void by; };
  const previous = action('arrow-up', t('databaseDiffPrevious'), () => step(-1));
  const next = action('arrow-down', t('databaseDiffNext'), () => step(1));
  const refresh = action('refresh', t('databaseRefresh'), () => {
    refresh.disabled = true;
    comparing();
    void page.refresh();
  });
  const open = action('go-to-file', t('databaseDiffOpen'), () => page.open());
  const rollback = action('discard', t('rollback'), () => page.rollback(), 'danger');
  open.disabled = !page.canOpen();
  rollback.hidden = !page.canRollback();
  [previous, next].forEach((each) => { each.disabled = true; });
  header.append(make('span', 'database-diff-name', page.name), make('span', 'database-diff-versions', page.diff ? `${page.left}  →  ${page.right}` : ''),
    make('span', 'database-diff-space'), previous, next, refresh, open, rollback);
  view.append(header);
  // Shown again, or drawn anew, it looks whether what it compared changed.
  const shown = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) page.check(); });
  shown.observe(view);
  let slow: number | undefined;
  const dispose = (): void => {
    disposed = true;
    shown.disconnect();
    window.clearTimeout(slow);
  };
  // The file as saved is what is compared; what waits in its tab is not in it.
  if (page.waiting()) {
    const waiting = make('div', 'database-pending database-diff-waiting');
    waiting.append(make('span', 'database-pending-text', words('databaseDiffWaiting', { name: page.name })));
    view.append(waiting);
  }
  target.replaceChildren(view);
  const status = (text: string, error = false): HTMLElement => {
    view.querySelector('.database-diff-status')?.remove();
    const line = make('p', `readme-status database-diff-status${error ? ' error' : ''}`, text);
    header.after(line);
    return line;
  };
  // Comparing, with Stop once it takes long; the page is drawn anew when done.
  const comparing = (): void => {
    const line = status(t('databaseDiffComparing'));
    window.clearTimeout(slow);
    slow = window.setTimeout(() => {
      const stop = button(t('databaseStop'), 'database-button danger');
      stop.addEventListener('click', () => page.stop());
      line.append(stop);
    }, stopAfter);
  };
  const { diff } = page;
  if (page.error) status(`${t('databaseDiffFailed')}: ${page.error}`, true);
  if (!diff) {
    if (!page.error) comparing();
    return { dispose };
  }

  // A version that is not a database it can read says so, and nothing is compared.
  const problems = ([[diff.base, page.left], [diff.target, page.right]] as const).flatMap(([version, label]) => (version.problem
    ? [words(version.problem === 'lfs' ? 'databaseDiffLfs' : 'databaseDiffNotDatabase', { version: label })] : []));
  if (problems.length) {
    problems.forEach((problem) => view.append(make('p', 'database-diff-problem', problem)));
    return { dispose };
  }

  const body = make('div', 'database-diff-body');
  const list = make('aside', 'database-list');
  const main = make('section', 'database-main');
  body.append(list, main);
  view.append(body);
  const differing = diff.tables.filter((table) => table.state !== 'unchanged');
  const unchanged = diff.tables.filter((table) => table.state === 'unchanged');
  // With nothing different, it says so, though an unchanged table can still be chosen from the list.
  if (!differing.length || !diff.tables.some((table) => keyOf(table) === page.chosen)) page.chosen = differing[0] ? keyOf(differing[0]) : undefined;

  // SQL before and after, side by side, the lines that differ marked.
  const sqlPair = (before: string | null, after: string | null): HTMLElement => {
    const [was, now] = [before, after].map((sql) => (sql ?? '').replace(/\r\n?/g, '\n'));
    const removed = new Set<number>();
    const added = new Set<number>();
    lineChanges(was, now).forEach((change) => {
      for (let line = 0; line < change.originalCount; line += 1) removed.add(change.originalStart - 1 + line);
      for (let line = 0; line < change.modifiedCount; line += 1) added.add(change.modifiedStart - 1 + line);
    });
    const side = (label: string, sql: string | null, text: string, marked: Set<number>, mark: 'removed' | 'added'): HTMLElement => {
      const box = make('div', 'database-diff-sql-side');
      box.append(make('div', 'database-diff-sql-label', label));
      if (sql === null) {
        box.append(make('p', 'database-diff-missing', t('diffMissing')));
        return box;
      }
      const lines = text.split('\n').map((line, index) => make('div', `database-diff-line${marked.has(index) ? ` ${mark}` : ''}`, line || ' '));
      const pre = make('pre', 'database-sql database-diff-sql');
      pre.append(...lines);
      box.append(pre);
      // Coloured as the editor colours SQL, a line at a time as Monaco gives them.
      void colored(text).then((html) => {
        const parts = html.split('<br/>');
        if (disposed || parts.length < lines.length) return;
        lines.forEach((line, index) => { if (parts[index]) line.innerHTML = parts[index]; });
      });
      return box;
    };
    const pair = make('div', 'database-diff-sql-pair');
    pair.append(side(t('databaseDiffBefore'), before, was, removed, 'removed'), side(t('databaseDiffAfter'), after, now, added, 'added'));
    return pair;
  };

  // Rows added and removed in their colours; a changed row's changed cells as
  // they were and as they are.
  const rowsGrid = (rows: GlistDatabaseDiffRows): HTMLTableElement => {
    const grid = make('table', 'database-grid database-diff-grid');
    const head = make('tr');
    head.append(make('th', 'database-row-number'), ...rows.columns.map((name, index) => make('th', index < rows.keyCount ? 'database-diff-key' : '', name)));
    grid.createTHead().append(head);
    const tbody = grid.createTBody();
    rows.rows.forEach((row) => {
      const line = make('tr', `database-diff-row ${row.state}`);
      const mark = make('td', 'database-row-number database-diff-mark', rowMarks[row.state]);
      mark.title = t(stateWords[row.state]);
      line.append(mark, ...rows.columns.map((_, index) => {
        const values = (row.after ?? row.before) as GlistDatabaseCell[];
        if (row.state !== 'changed' || !row.changed.includes(index)) return cellView(values[index]);
        const cell = make('td', 'database-diff-changed');
        const was = make('span', 'database-diff-old');
        const now = make('span', 'database-diff-new');
        was.append(...cellView((row.before as GlistDatabaseCell[])[index]).childNodes);
        now.append(...cellView((row.after as GlistDatabaseCell[])[index]).childNodes);
        cell.append(was, make('span', 'database-diff-arrow', '→'), now);
        cell.title = `${was.textContent} → ${now.textContent}`;
        return cell;
      }));
      tbody.append(line);
    });
    return grid;
  };

  const showTable = (table: GlistDatabaseDiffTable): void => {
    const title = make('div', 'database-header');
    title.append(make('h2', 'database-title', table.name), make('span', `database-badge database-diff-state ${table.state}`, t(stateWords[table.state])));
    if (table.rows) title.append(countsView(table.rows));
    const detail = make('div', 'database-diff-detail');
    const note = (text: string): void => { detail.append(make('p', 'database-diff-note', text)); };
    const section = (heading: string): void => { detail.append(make('h3', 'database-section', heading)); };
    if (table.before !== table.after || table.related.length) {
      section(t('databaseStructure'));
      if (table.addedColumns.length) note(words('databaseDiffColumnsAdded', { names: table.addedColumns.join(', ') }));
      if (table.removedColumns.length) note(words('databaseDiffColumnsRemoved', { names: table.removedColumns.join(', ') }));
      if (table.before !== table.after) detail.append(sqlPair(table.before, table.after));
      table.related.forEach((item) => {
        detail.append(make('div', 'database-diff-related', words(item.kind === 'index' ? 'databaseDiffIndex' : 'databaseDiffTrigger', { name: item.name })),
          sqlPair(item.before, item.after));
      });
    }
    if (table.rows || table.error) {
      section(t('databaseDiffRows'));
      const both = table.before !== null && table.after !== null;
      if (table.error) note(words('databaseDiffRowsError', { error: table.error }));
      else if (table.rows) {
        const { rows } = table;
        if (both && (table.addedColumns.length || table.removedColumns.length)) note(t('databaseDiffCommonColumns'));
        if (both && rows.match === 'rowid') note(t('databaseDiffByRowid'));
        if (both && rows.match === 'columns') note(t('databaseDiffByColumns'));
        if (rows.rows.length) detail.append(rowsGrid(rows));
        else detail.append(make('p', 'database-empty', t('databaseDiffRowsNone')));
        const more = rows.added + rows.removed + rows.changed - rows.rows.length;
        if (more > 0) detail.append(make('p', 'database-diff-more', counted('databaseDiffMoreOne', 'databaseDiffMore', { count: more })));
      }
    }
    main.replaceChildren(title, detail);
    // Compared again, it stays where it was.
    const key = keyOf(table);
    if (page.scroll?.table === key) Object.assign(detail, { scrollTop: page.scroll.top, scrollLeft: page.scroll.left });
    detail.addEventListener('scroll', () => { page.scroll = { table: key, top: detail.scrollTop, left: detail.scrollLeft }; });
  };

  const draw = (): void => {
    const item = (table: GlistDatabaseDiffTable): HTMLButtonElement => {
      const entry = button('', `database-item database-diff-item ${table.state}`);
      entry.append(make('span', 'database-item-name', table.name));
      if (table.state === 'changed' && table.rows && table.rows.added + table.rows.removed + table.rows.changed) entry.append(countsView(table.rows));
      else if (table.state !== 'unchanged') entry.append(make('span', `database-diff-state ${table.state}`, t(stateWords[table.state])));
      entry.title = `${table.name} · ${t(stateWords[table.state])}`;
      entry.classList.toggle('active', keyOf(table) === page.chosen);
      entry.addEventListener('click', () => { page.chosen = keyOf(table); draw(); });
      return entry;
    };
    const group = (heading: string, entries: GlistDatabaseDiffTable[]): HTMLElement[] =>
      (entries.length ? [make('div', 'database-list-heading', heading), ...entries.map(item)] : []);
    const folded: HTMLElement[] = [];
    if (unchanged.length) {
      const open = page.unchangedOpen || unchanged.some((table) => keyOf(table) === page.chosen);
      const toggle = button(words('databaseDiffUnchangedList', { count: unchanged.length }), 'database-list-heading database-diff-fold');
      toggle.classList.toggle('open', open);
      toggle.addEventListener('click', () => { page.unchangedOpen = !open; draw(); });
      folded.push(toggle, ...(open ? unchanged.map(item) : []));
    }
    list.replaceChildren(...group(t('databaseTables'), differing.filter((table) => table.kind === 'table')),
      ...group(t('databaseViews'), differing.filter((table) => table.kind === 'view')), ...folded);
    list.scrollTop = page.listTop ?? 0;
    const chosen = diff.tables.find((table) => keyOf(table) === page.chosen);
    if (chosen) showTable(chosen);
    else main.replaceChildren(make('p', 'database-empty database-diff-none', t('databaseDiffNone')));
  };
  list.addEventListener('scroll', () => { page.listTop = list.scrollTop; });
  // The previous or next table that changed, round from the last to the first.
  step = (by: number): void => {
    const at = differing.findIndex((table) => keyOf(table) === page.chosen);
    const index = at < 0 ? (by > 0 ? 0 : differing.length - 1) : (at + by + differing.length) % differing.length;
    page.chosen = keyOf(differing[index]);
    draw();
  };
  [previous, next].forEach((each) => { each.disabled = !differing.length; });
  draw();

  return { dispose };
};
