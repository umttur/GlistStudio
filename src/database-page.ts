// eslint-disable-next-line import/no-unresolved
import * as monaco from 'monaco-editor/editor/editor.api';
import { copyText } from './clipboard';
import { confirmDialog } from './confirm-dialog';
import { createTableSql, quoteName, type NewColumn } from './database-sql';
import { showMenu } from './context-menu';
import { getLanguage, t } from './localization';

// A SQLite database in a tab of its own (database.ts does the work): its
// tables and views beside it; a table's rows a page at a time, sorted, filtered
// with an SQL condition, changed in place, added and deleted; what it is made
// of; SQL typed and run; and new tables made from a form that shows their SQL.
// Changes wait to be committed to the file, or discarded, from a bar over it.

export interface DatabasePage {
  name: string;
  // Read on each call: a renamed file's tab goes on with its new path.
  path: string;
  // A new name for a table, asked as renaming a file is.
  askName(initial: string): Promise<string | null>;
  error?: string;
  // What waits to be committed, as last heard: closing the tab asks about it.
  pending?: GlistDatabasePending;
  // Ends a query that runs long, asking first: every database open goes with it.
  stop(): void;
}

type Shown = { kind: 'table'; name: string; view: 'data' | 'structure' } | { kind: 'sql' } | { kind: 'new' };

// What was typed in each database's SQL console, kept while the studio runs.
const consoles = new Map<string, string>();

// The tabs drawn, each told when what waits to be committed changes, so that a
// database shown on both sides says the same on each.
const drawn = new Set<{ page: DatabasePage; changed(ended: boolean): void }>();
const heard = (page: DatabasePage, pending: GlistDatabasePending): void => {
  const ended = Boolean(page.pending?.open) && !pending.open;
  page.pending = pending;
  drawn.forEach((each) => { if (each.page === page) each.changed(ended); });
};

export const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => {
  const made = document.createElement(tag);
  if (className) made.className = className;
  if (text) made.textContent = text;
  return made;
};
export const button = (label: string, className = 'database-button'): HTMLButtonElement => {
  const made = make('button', className, label);
  made.type = 'button';
  return made;
};
export const numbers = (): Intl.NumberFormat => new Intl.NumberFormat(getLanguage());
const bytes = (size: number): string => {
  const [unit, value] = size >= 1024 * 1024 ? ['megabyte', size / 1024 / 1024] : size >= 1024 ? ['kilobyte', size / 1024] : ['byte', size];
  return new Intl.NumberFormat(getLanguage(), { style: 'unit', unit, maximumFractionDigits: 1 }).format(value as number);
};
type Words = Parameters<typeof t>[0];
export const words = (key: Words, values: Record<string, string | number>): string =>
  Object.entries(values).reduce((text, [name, value]) => text.replace(`{${name}}`, typeof value === 'number' ? numbers().format(value) : value), t(key));
// "1 row", "3 rows", as the language counts.
export const counted = (one: Words, many: Words, values: Record<string, string | number> & { count: number }): string =>
  words(new Intl.PluralRules(getLanguage()).select(values.count) === 'one' ? one : many, values);
// Rows as counted (database.ts), only so far: "100,000+" past that.
const rowCount = (count: number, more: boolean): string => (more ? words('databaseCountMore', { count }) : numbers().format(count));
// Offered while something has run this long.
export const stopAfter = 3000;
const isBlob = (value: GlistDatabaseCell): value is { blob: number } => value !== null && typeof value === 'object';
const plain = (value: GlistDatabaseCell): string => (value === null ? '' : isBlob(value) ? `BLOB ${value.blob}` : String(value));
const csvField = (value: GlistDatabaseCell): string => {
  const text = plain(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

// A grid of values: NULL and BLOBs said as such, numbers to the right.
export const cellView = (value: GlistDatabaseCell): HTMLTableCellElement => {
  const cell = make('td');
  if (value === null) cell.append(make('span', 'database-null', 'NULL'));
  else if (isBlob(value)) cell.append(make('span', 'database-blob', `BLOB · ${bytes(value.blob)}`));
  else {
    cell.textContent = String(value).length > 300 ? `${String(value).slice(0, 300)}…` : String(value);
    if (typeof value === 'number') cell.classList.add('database-number');
    if (String(value).length > 60) cell.title = String(value).slice(0, 2000);
  }
  return cell;
};

// SQL coloured as the editor colours it, with plain spaces where Monaco writes
// non-breaking ones, so that copied it still runs.
export const colored = (sql: string): Promise<string> => monaco.editor.colorize(sql, 'sql', {}).then((html) => html.replace(/&nbsp;|&#160;|\u00a0/g, ' '));

const resultGrid = (columns: string[], rows: GlistDatabaseCell[][]): HTMLTableElement => {
  const table = make('table', 'database-grid');
  const head = make('tr');
  head.append(make('th', 'database-row-number', '#'), ...columns.map((column) => make('th', '', column)));
  table.createTHead().append(head);
  const body = table.createTBody();
  rows.forEach((row, index) => {
    const line = make('tr');
    line.append(make('td', 'database-row-number', String(index + 1)), ...row.map(cellView));
    body.append(line);
  });
  return table;
};

export const renderDatabasePage = (target: HTMLElement, page: DatabasePage): { dispose(): void } => {
  const api = window.glistAPI;
  let disposed = false;
  let schema: GlistDatabaseSchema | null = null;
  let shown: Shown = { kind: 'sql' };
  let editor: monaco.editor.IStandaloneCodeEditor | null = null;
  const view = make('div', 'database-view');
  const list = make('aside', 'database-list');
  const main = make('section', 'database-main');
  view.append(list, main);
  target.replaceChildren(view);

  const status = make('div', 'database-status');
  const say = (text: string, error = false): void => {
    status.textContent = text;
    status.classList.toggle('error', error);
  };
  const message = (error: unknown): string => (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']*': (?:Error: )?/, '');
  const leaveEditor = (): void => {
    if (editor) consoles.set(page.path, editor.getValue());
    editor?.dispose();
    editor = null;
  };

  const renderList = (): void => {
    const tables = schema?.tables.filter((table) => table.kind === 'table') ?? [];
    const views = schema?.tables.filter((table) => table.kind === 'view') ?? [];
    const group = (title: string, entries: GlistDatabaseTable[]): HTMLElement[] => (entries.length ? [
      make('div', 'database-list-heading', title),
      ...entries.map((table) => {
        const item = button('', 'database-item');
        item.append(make('span', 'database-item-name', table.name), make('span', 'database-item-count', table.rows === null ? '' : rowCount(table.rows, table.moreRows)));
        item.classList.toggle('active', shown.kind === 'table' && shown.name === table.name);
        item.title = table.name;
        item.addEventListener('click', () => show({ kind: 'table', name: table.name, view: shown.kind === 'table' ? shown.view : 'data' }));
        return item;
      }),
    ] : []);
    const actions = make('div', 'database-list-actions');
    const sql = button(t('databaseSql'), 'database-item database-action');
    sql.classList.toggle('active', shown.kind === 'sql');
    sql.addEventListener('click', () => show({ kind: 'sql' }));
    actions.append(sql);
    if (!schema?.readOnly) {
      const creating = button(t('databaseNewTable'), 'database-item database-action');
      creating.classList.toggle('active', shown.kind === 'new');
      creating.addEventListener('click', () => show({ kind: 'new' }));
      actions.append(creating);
    }
    const facts = make('div', 'database-facts', [schema ? `SQLite ${schema.version}` : '', schema?.readOnly ? t('databaseReadOnly') : ''].filter(Boolean).join(' · '));
    list.replaceChildren(actions, ...group(t('databaseTables'), tables), ...group(t('databaseViews'), views),
      ...(schema && !schema.tables.length ? [make('p', 'database-empty', t('databaseEmpty'))] : []), facts);
  };

  // Changes not committed yet, said in a bar over the tab, with Commit to write
  // them to the file and Discard to undo them.
  const pendingBar = make('div', 'database-pending');
  const pendingText = make('span', 'database-pending-text');
  const discard = button(t('databaseDiscard'));
  const commit = button(t('databaseCommit'), 'database-button primary');
  pendingBar.append(pendingText, discard, commit);
  const drawPending = (): void => {
    const pending = page.pending;
    pendingBar.hidden = !pending?.open;
    pendingText.classList.remove('error');
    if (!pending?.open) return;
    pendingText.textContent = pending.changes
      ? counted('databasePendingOne', 'databasePending', { count: pending.changes, name: page.name })
      : words('databasePendingOpen', { name: page.name });
  };
  const finish = async (save: boolean): Promise<void> => {
    commit.disabled = true;
    discard.disabled = true;
    try {
      heard(page, await (save ? api.databaseCommit(page.path) : api.databaseDiscard(page.path)));
    } catch (error) {
      pendingText.textContent = message(error);
      pendingText.classList.add('error');
    }
    commit.disabled = false;
    discard.disabled = false;
  };
  commit.addEventListener('click', () => { void finish(true); });
  discard.addEventListener('click', () => { void finish(false); });

  const reloadSchema = async (): Promise<void> => {
    schema = await api.databaseSchema(page.path);
    if (disposed) return;
    heard(page, schema.pending);
    if (shown.kind === 'table' && !schema.tables.some((table) => shown.kind === 'table' && table.name === shown.name)) shown = { kind: 'sql' };
    renderList();
  };

  // A table's or view's rows.
  const rowsState = { offset: 0, orderBy: '', descending: false, where: '', selected: new Set<number>(), scroll: null as { top: number; left: number } | null };
  const renderData = async (table: GlistDatabaseTable): Promise<void> => {
    const editable = table.kind === 'table' && !schema?.readOnly;
    const toolbar = make('div', 'database-toolbar');
    const filter = make('input', 'database-filter');
    filter.type = 'text';
    filter.spellcheck = false;
    filter.placeholder = t('databaseFilter');
    filter.value = rowsState.where;
    const refresh = button(t('databaseRefresh'));
    const add = button(t('databaseAddRow'));
    const remove = button(t('databaseDeleteRows'), 'database-button danger');
    const copy = button(t('databaseCopyCsv'));
    toolbar.append(filter, refresh, ...(editable ? [add, remove] : []), copy);
    const host = make('div', 'database-grid-host');
    const pager = make('div', 'database-pager');
    main.append(toolbar, status, host, pager);
    let data: GlistDatabaseRows;
    try {
      data = await api.databaseRows(page.path, table.name, { offset: rowsState.offset, orderBy: rowsState.orderBy, descending: rowsState.descending, where: rowsState.where });
    } catch (error) {
      say(message(error), true);
      filter.focus();
      filter.addEventListener('keydown', (event) => { if (event.key === 'Enter') { rowsState.where = filter.value; rowsState.offset = 0; void show(shown); } });
      return;
    }
    if (disposed) return;
    const columns = table.columns;
    const grid = make('table', 'database-grid');
    const head = make('tr');
    head.append(make('th', 'database-row-number', '#'));
    data.columns.forEach((name) => {
      const header = make('th', 'database-sortable', name);
      const column = columns.find((each) => each.name === name);
      header.title = [column?.type, column?.primaryKey ? t('databasePrimaryKey') : '', column?.notNull ? 'NOT NULL' : ''].filter(Boolean).join(' · ');
      if (rowsState.orderBy === name) header.dataset.sort = rowsState.descending ? 'descending' : 'ascending';
      header.addEventListener('click', () => {
        if (rowsState.orderBy !== name) Object.assign(rowsState, { orderBy: name, descending: false });
        else if (!rowsState.descending) rowsState.descending = true;
        else Object.assign(rowsState, { orderBy: '', descending: false });
        void show(shown);
      });
      head.append(header);
    });
    grid.createTHead().append(head);
    const body = grid.createTBody();
    const keyOf = (index: number): GlistDatabaseCell[] | null => data.keys?.[index] ?? null;
    // Drawn again after a change, where it was scrolled to: a row changed far
    // down stays in sight.
    const redraw = (): Promise<void> => {
      rowsState.scroll = { top: host.scrollTop, left: host.scrollLeft };
      return show(shown);
    };
    const update = async (index: number, column: string, value: string | null): Promise<void> => {
      const key = keyOf(index);
      if (!key) return;
      try {
        heard(page, (await api.databaseEdit(page.path, { kind: 'update', table: table.name, key, column, value })).pending);
        await redraw();
      } catch (error) { say(message(error), true); }
    };
    const deleteRows = async (indices: number[]): Promise<void> => {
      const keys = indices.map(keyOf).filter((key): key is GlistDatabaseCell[] => key !== null);
      if (!keys.length || !(await confirmDialog(counted('databaseConfirmDeleteOne', 'databaseConfirmDelete', { count: keys.length, table: table.name })))) return;
      try {
        await api.databaseEdit(page.path, { kind: 'delete', table: table.name, keys });
        rowsState.selected.clear();
        await reloadSchema();
        await redraw();
      } catch (error) { say(message(error), true); }
    };
    const startEditing = (cell: HTMLTableCellElement, index: number, column: string): void => {
      const value = data.rows[index][data.columns.indexOf(column)];
      if (isBlob(value)) return;
      const input = make('input', 'database-cell-input');
      input.value = value === null ? '' : String(value);
      input.placeholder = value === null ? 'NULL' : '';
      cell.replaceChildren(input);
      cell.classList.add('editing');
      input.focus();
      input.select();
      let finished = false;
      const finish = (save: boolean): void => {
        if (finished) return;
        finished = true;
        if (save && input.value !== (value === null ? '' : String(value))) void update(index, column, input.value);
        else cell.replaceWith(rowCell(index, column));
      };
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') { event.preventDefault(); finish(true); }
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(false); }
      });
      input.addEventListener('blur', () => finish(true));
    };
    const rowCell = (index: number, column: string): HTMLTableCellElement => {
      const value = data.rows[index][data.columns.indexOf(column)];
      const cell = cellView(value);
      if (editable && !isBlob(value)) {
        cell.classList.add('database-editable');
        cell.addEventListener('dblclick', () => startEditing(cell, index, column));
      }
      cell.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        showMenu(event, [
          { label: t('databaseCopyValue'), run: () => { void copyText(plain(value)); } },
          ...(editable ? [
            { label: t('databaseEditValue'), run: () => startEditing(cell, index, column), disabled: isBlob(value) },
            { label: t('databaseSetNull'), run: () => { void update(index, column, null); }, disabled: value === null },
            'separator' as const,
            { label: t('databaseDeleteRow'), run: () => { void deleteRows([index]); }, danger: true },
          ] : []),
        ]);
      });
      return cell;
    };
    let anchor = -1;
    const markSelection = (): void => {
      [...body.rows].forEach((line, index) => line.classList.toggle('selected', rowsState.selected.has(index)));
      remove.disabled = rowsState.selected.size === 0;
      remove.textContent = rowsState.selected.size ? `${t('databaseDeleteRows')} (${rowsState.selected.size})` : t('databaseDeleteRows');
    };
    data.rows.forEach((_, index) => {
      const line = make('tr');
      const number = make('td', 'database-row-number', numbers().format(data.offset + index + 1));
      number.addEventListener('click', (event) => {
        if (event.shiftKey && anchor >= 0) {
          for (let each = Math.min(anchor, index); each <= Math.max(anchor, index); each++) rowsState.selected.add(each);
        } else if (rowsState.selected.has(index)) rowsState.selected.delete(index);
        else rowsState.selected.add(index);
        anchor = index;
        markSelection();
      });
      line.append(number, ...data.columns.map((column) => rowCell(index, column)));
      body.append(line);
    });
    host.append(grid);
    if (rowsState.scroll) {
      host.scrollTop = rowsState.scroll.top;
      host.scrollLeft = rowsState.scroll.left;
      rowsState.scroll = null;
    }
    if (!data.rows.length) host.append(make('p', 'database-empty', t('databaseNoRows')));
    markSelection();

    // A new row, typed in a line of its own at the top.
    add.addEventListener('click', () => {
      if (body.querySelector('.database-new-row')) return;
      const line = make('tr', 'database-new-row');
      const inputs = data.columns.map((name) => {
        const column = columns.find((each) => each.name === name);
        const input = make('input', 'database-cell-input');
        const rowid = column && column.primaryKey === 1 && /^INTEGER$/i.test(column.type) && columns.filter((each) => each.primaryKey > 0).length === 1;
        input.placeholder = rowid ? t('databaseAuto') : column?.defaultValue ?? 'NULL';
        input.dataset.column = name;
        const cell = make('td');
        cell.append(input);
        return cell;
      });
      const save = button(t('databaseSaveRow'), 'database-button primary');
      const cancel = button(t('databaseCancel'));
      const actions = make('td', 'database-row-number');
      actions.append(save, cancel);
      line.append(actions, ...inputs);
      body.prepend(line);
      line.querySelector('input')?.focus();
      cancel.addEventListener('click', () => line.remove());
      const submit = async (): Promise<void> => {
        const values: Record<string, string> = {};
        line.querySelectorAll<HTMLInputElement>('input').forEach((input) => { if (input.value !== '') values[input.dataset.column] = input.value; });
        try {
          await api.databaseEdit(page.path, { kind: 'insert', table: table.name, values });
          await reloadSchema();
          await redraw();
          say(t('databaseRowAdded'));
        } catch (error) { say(message(error), true); }
      };
      save.addEventListener('click', () => { void submit(); });
      line.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') { event.preventDefault(); void submit(); }
        if (event.key === 'Escape') { event.preventDefault(); line.remove(); }
      });
    });
    remove.addEventListener('click', () => { void deleteRows([...rowsState.selected].sort((a, b) => a - b)); });
    refresh.addEventListener('click', () => { void reloadSchema().then(redraw); });
    copy.addEventListener('click', () => {
      void copyText([data.columns.map((name) => csvField(name)), ...data.rows.map((row) => row.map(csvField))]
        .map((row) => row.join(',')).join('\n'));
    });
    filter.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { rowsState.where = filter.value; rowsState.offset = 0; rowsState.selected.clear(); void show(shown); }
    });
    const range = data.total ? words('databaseRange', { from: data.offset + 1, to: data.offset + data.rows.length, total: rowCount(data.total, data.moreRows) }) : '';
    const previous = button(t('databasePrevious'));
    const next = button(t('databaseNext'));
    previous.disabled = data.offset === 0;
    next.disabled = !data.moreRows && data.offset + data.rows.length >= data.total;
    previous.addEventListener('click', () => { rowsState.offset = Math.max(0, data.offset - data.pageSize); rowsState.selected.clear(); void show(shown); });
    next.addEventListener('click', () => { rowsState.offset = data.offset + data.pageSize; rowsState.selected.clear(); void show(shown); });
    pager.append(make('span', 'database-range', range), previous, next);
  };

  // What a table is made of, and renaming or dropping it.
  const renderStructure = async (table: GlistDatabaseTable): Promise<void> => {
    const box = make('div', 'database-structure');
    const columns = make('table', 'database-grid');
    const head = make('tr');
    head.append(...[t('databaseColumn'), t('databaseType'), t('databasePrimaryKey'), t('databaseNotNull'), t('databaseDefault')].map((title) => make('th', '', title)));
    columns.createTHead().append(head);
    const body = columns.createTBody();
    table.columns.forEach((column) => {
      const line = make('tr');
      line.append(make('td', '', column.name), make('td', '', column.type), make('td', '', column.primaryKey ? '✓' : ''), make('td', '', column.notNull ? '✓' : ''));
      line.append(column.defaultValue === null ? cellView(null) : make('td', '', column.defaultValue));
      body.append(line);
    });
    box.append(columns);
    const section = (title: string, lines: string[]): void => {
      if (!lines.length) return;
      box.append(make('h3', 'database-section', title), ...lines.map((line) => make('div', 'database-line', line)));
    };
    section(t('databaseIndexes'), table.indexes.map((index) => `${index.name}${index.unique ? ' · UNIQUE' : ''} — ${index.columns.join(', ')}`));
    section(t('databaseForeignKeys'), table.foreignKeys.map((key) => `${key.from} → ${key.table}(${key.to})`));
    section(t('databaseTriggers'), (schema?.triggers ?? []).filter((trigger) => trigger.table === table.name).map((trigger) => trigger.name));
    box.append(make('h3', 'database-section', t('databaseCreateSql')));
    const sql = make('pre', 'database-sql');
    sql.textContent = table.sql;
    void colored(table.sql).then((html) => { if (!disposed) sql.innerHTML = html; });
    box.append(sql);
    if (!schema?.readOnly) {
      const actions = make('div', 'database-toolbar');
      const rename = button(t('databaseRenameTable'));
      const drop = button(table.kind === 'view' ? t('databaseDropView') : t('databaseDropTable'), 'database-button danger');
      if (table.kind === 'table') actions.append(rename);
      actions.append(drop);
      rename.addEventListener('click', () => {
        void page.askName(table.name).then(async (name) => {
          if (!name || name === table.name) return;
          const [result] = await api.databaseQuery(page.path, `ALTER TABLE ${quoteName(table.name)} RENAME TO ${quoteName(name)};`);
          if ('error' in result) { say(result.error, true); return; }
          await reloadSchema();
          await show({ kind: 'table', name, view: 'structure' });
        });
      });
      drop.addEventListener('click', () => {
        void confirmDialog(words('databaseConfirmDrop', { table: table.name })).then(async (sure) => {
          if (!sure) return;
          const [result] = await api.databaseQuery(page.path, `DROP ${table.kind === 'view' ? 'VIEW' : 'TABLE'} ${quoteName(table.name)};`);
          if ('error' in result) { say(result.error, true); return; }
          await reloadSchema();
          await show({ kind: 'sql' });
        });
      });
      main.append(actions);
    }
    main.append(status, box);
  };

  // SQL as typed, and what each statement gave.
  const renderSql = (): void => {
    const toolbar = make('div', 'database-toolbar');
    const run = button(t('databaseRun'), 'database-button primary');
    const hint = make('span', 'database-hint', t('databaseRunHint'));
    // Offered once a run takes long; apart from Run, so that a second click
    // on Run cannot land on it.
    const running = make('span', 'database-running');
    const stop = button(t('databaseStop'), 'database-button danger');
    running.append(make('span', 'database-hint', t('databaseStillRunning')), stop);
    running.hidden = true;
    stop.addEventListener('click', () => page.stop());
    toolbar.append(run, hint, running);
    const editorHost = make('div', 'database-sql-editor');
    const results = make('div', 'database-results');
    main.append(toolbar, editorHost, results);
    const font = getComputedStyle(document.documentElement);
    editor = monaco.editor.create(editorHost, {
      value: consoles.get(page.path) ?? '',
      language: 'sql',
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontFamily: font.getPropertyValue('--font-code').trim() || undefined,
      fontSize: Number.parseFloat(font.getPropertyValue('--font-code-size')) || 13,
      lineNumbersMinChars: 3,
      wordWrap: 'on',
    });
    const execute = async (): Promise<void> => {
      if (!editor) return;
      const selection = editor.getSelection();
      const chosen = selection && !selection.isEmpty() ? editor.getModel()?.getValueInRange(selection) : editor.getValue();
      if (!chosen?.trim()) return;
      consoles.set(page.path, editor.getValue());
      run.disabled = true;
      const slow = window.setTimeout(() => {
        hint.hidden = true;
        running.hidden = false;
      }, stopAfter);
      let outcome: GlistDatabaseResult[];
      try { outcome = await api.databaseQuery(page.path, chosen); } catch (error) { outcome = [{ sql: chosen, error: message(error) }]; }
      window.clearTimeout(slow);
      run.disabled = false;
      hint.hidden = false;
      running.hidden = true;
      if (disposed) return;
      results.replaceChildren(...outcome.map((result) => {
        const block = make('div', 'database-result');
        const heading = make('div', `database-result-heading${'error' in result ? ' error' : ''}`);
        const first = result.sql.split('\n')[0];
        heading.append(make('span', 'database-result-mark', 'error' in result ? '✕' : '✓'), make('code', 'database-result-sql', first.length > 120 ? `${first.slice(0, 120)}…` : first));
        if ('error' in result) heading.append(make('span', 'database-result-error', result.error));
        else if ('columns' in result) heading.append(make('span', 'database-result-meta', `${counted('databaseRowsResultOne', 'databaseRowsResult', { count: result.rows.length })} · ${result.milliseconds} ms`));
        else heading.append(make('span', 'database-result-meta', `${counted('databaseChangedResultOne', 'databaseChangedResult', { count: result.changes })} · ${result.milliseconds} ms`));
        block.append(heading);
        if ('columns' in result) {
          block.append(resultGrid(result.columns, result.rows));
          if (result.truncated) block.append(make('p', 'database-empty', words('databaseTruncated', { count: result.rows.length })));
        }
        return block;
      }));
      // A statement may have made, changed or dropped a table.
      await reloadSchema().catch((): undefined => undefined);
    };
    run.addEventListener('click', () => { void execute(); });
    // Ctrl+Enter everywhere, and Cmd+Enter on a Mac too.
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => { void execute(); });
    editor.addCommand(monaco.KeyMod.WinCtrl | monaco.KeyCode.Enter, () => { void execute(); });
    editor.focus();
  };

  // A new table from a form, its SQL shown as it is made.
  const renderNew = (): void => {
    const form = make('div', 'database-new');
    const nameLabel = make('label', 'database-new-label', t('databaseTableName'));
    const name = make('input', 'database-new-name');
    name.type = 'text';
    name.spellcheck = false;
    nameLabel.append(name);
    const grid = make('table', 'database-grid database-new-columns');
    const head = make('tr');
    head.append(...[t('databaseColumn'), t('databaseType'), t('databasePrimaryKey'), t('databaseNotNull'), t('databaseUnique'), t('databaseDefault'), ''].map((title) => make('th', '', title)));
    grid.createTHead().append(head);
    const body = grid.createTBody();
    const types = make('datalist');
    types.id = `database-types-${Math.random().toString(36).slice(2)}`;
    types.append(...['INTEGER', 'TEXT', 'REAL', 'BLOB', 'NUMERIC'].map((type) => new Option(type)));
    const preview = make('pre', 'database-sql');
    const read = (): NewColumn[] => [...body.rows].map((line) => {
      const [columnName, type, defaultValue] = [...line.querySelectorAll<HTMLInputElement>('input[type="text"]')].map((input) => input.value);
      const [primaryKey, notNull, unique] = [...line.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].map((input) => input.checked);
      return { name: columnName, type, defaultValue, primaryKey, notNull, unique };
    });
    let drawn = 0;
    const update = (): void => {
      const sql = createTableSql(name.value || 'new_table', read());
      const ticket = ++drawn;
      preview.textContent = sql;
      void colored(sql).then((html) => { if (ticket === drawn && !disposed) preview.innerHTML = html; });
    };
    const addColumn = (column: Partial<NewColumn> = {}): void => {
      const line = make('tr');
      const text = (value = '', list?: string): HTMLTableCellElement => {
        const input = make('input', 'database-cell-input');
        input.type = 'text';
        input.spellcheck = false;
        input.value = value;
        if (list) input.setAttribute('list', list);
        const cell = make('td');
        cell.append(input);
        return cell;
      };
      const check = (on = false): HTMLTableCellElement => {
        const input = make('input');
        input.type = 'checkbox';
        input.checked = on;
        const cell = make('td', 'database-check');
        cell.append(input);
        return cell;
      };
      const remove = button('×', 'database-button database-remove');
      remove.title = t('databaseRemoveColumn');
      remove.addEventListener('click', () => { line.remove(); update(); });
      const removeCell = make('td');
      removeCell.append(remove);
      line.append(text(column.name), text(column.type ?? 'TEXT', types.id), check(column.primaryKey), check(column.notNull), check(column.unique), text(column.defaultValue), removeCell);
      body.append(line);
      update();
    };
    addColumn({ name: 'id', type: 'INTEGER', primaryKey: true });
    addColumn({ name: 'name', type: 'TEXT' });
    const more = button(t('databaseAddColumn'));
    more.addEventListener('click', () => { addColumn(); body.querySelector<HTMLInputElement>('tr:last-child input')?.focus(); });
    const create = button(t('databaseCreate'), 'database-button primary');
    const cancel = button(t('databaseCancel'));
    const actions = make('div', 'database-toolbar');
    actions.append(create, cancel);
    form.addEventListener('input', update);
    form.addEventListener('change', update);
    cancel.addEventListener('click', () => { void show({ kind: 'sql' }); });
    create.addEventListener('click', () => {
      if (!name.value.trim()) { name.focus(); return; }
      void api.databaseQuery(page.path, createTableSql(name.value, read())).then(async ([result]) => {
        if ('error' in result) { say(result.error, true); return; }
        await reloadSchema();
        await show({ kind: 'table', name: name.value.trim(), view: 'data' });
      });
    });
    form.append(nameLabel, grid, types, more, make('h3', 'database-section', 'SQL'), preview, actions);
    main.append(status, form);
    name.focus();
  };

  const show = async (next: Shown): Promise<void> => {
    if (next.kind !== 'table' || shown.kind !== 'table' || next.name !== shown.name) {
      Object.assign(rowsState, { offset: 0, orderBy: '', descending: false, where: '' });
      rowsState.selected.clear();
    }
    leaveEditor();
    shown = next;
    say('');
    renderList();
    main.replaceChildren(pendingBar);
    if (next.kind === 'sql') { renderSql(); return; }
    if (next.kind === 'new') { renderNew(); return; }
    const table = schema?.tables.find((each) => each.name === next.name);
    if (!table) return;
    const header = make('div', 'database-header');
    const tabs = make('div', 'database-tabs');
    (['data', 'structure'] as const).forEach((which) => {
      const tab = button(t(which === 'data' ? 'databaseData' : 'databaseStructure'), 'database-tab');
      tab.classList.toggle('active', next.view === which);
      tab.addEventListener('click', () => { void show({ ...next, view: which }); });
      tabs.append(tab);
    });
    header.append(make('h2', 'database-title', table.name), tabs);
    if (table.kind === 'view' || schema?.readOnly) header.append(make('span', 'database-badge', t('databaseReadOnly')));
    main.append(header);
    await (next.view === 'data' ? renderData(table) : renderStructure(table));
  };

  // After a commit or a discard, every side showing the tab reads again what
  // the file now holds; the console keeps its results.
  const listener = {
    page,
    changed: (ended: boolean): void => {
      drawPending();
      if (!ended) return;
      const showing = shown.kind;
      void reloadSchema().then(() => (showing === 'table' && !disposed ? show(shown) : undefined)).catch((): undefined => undefined);
    },
  };
  drawn.add(listener);
  drawPending();

  main.append(make('p', 'readme-status', t('databaseOpening')));
  void reloadSchema().then(() => {
    const first = schema?.tables[0];
    return show(first ? { kind: 'table', name: first.name, view: 'data' } : { kind: 'sql' });
  }).catch((error: unknown) => {
    if (disposed) return;
    const failed = make('p', 'readme-status', `${t('databaseFailed')}: ${message(error)}`);
    target.replaceChildren(failed);
  });

  return {
    dispose: () => {
      disposed = true;
      drawn.delete(listener);
      leaveEditor();
    },
  };
};
