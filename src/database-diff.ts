import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';
import { cellOf } from './database';
import { quoteName } from './database-sql';

// A SQLite database compared between two versions, for the diff of a .db file
// (database-diff-page.ts): the tables and views added, removed or changed,
// their SQL before and after, and the rows added, removed or changed. SQLite
// does the comparing, both versions attached to one connection, so a big table
// is counted where it is, never loaded; only the first rows that differ cross
// to the window, as the database tab shows values: big integers as text, a
// BLOB as its size.
//
// Nothing is written to either version, nor beside it: a commit's version is a
// copy of our own in a folder of our own, and the file on disk is opened so
// that SQLite makes no -wal or -shm next to it (see openingOf).

export const diffRows = 200;
// Longer text is cut, as the grid would cut it anyway.
const textLength = 2000;
const sqliteHeader = 'SQLite format 3\0';
const lfsPointer = 'version https://git-lfs';
// The versions' names on the connection: "base"."players" and "target"."players".
const schemas = { base: 'base', target: 'target' } as const;
type Side = keyof typeof schemas;

type Opening = { empty: true } | { problem: 'lfs' | 'notDatabase' } | { uri: string };

const uriOf = (file: string, options: string): string => `${pathToFileURL(file).href}?mode=ro${options ? `&${options}` : ''}`;
const sizeOf = (file: string): Promise<number | null> => fs.stat(file).then((stats) => stats.size, (): null => null);

// How to read a version without writing anything beside it. Read-only,
// SQLite still makes a WAL database's -wal and -shm, and leaves them, since
// taking them away is a write. So with no -wal, or an empty one, the file
// holds everything and is read just as it is (immutable). Writes waiting in a
// -wal are read through its -shm, without writing to that either. With no
// -shm, nothing has the database open, so it and its -wal are read from copies.
const openingOf = async (file: string, scratch: () => Promise<string>): Promise<Opening> => {
  const handle = await fs.open(file, 'r');
  let head: Buffer;
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(100), 0, 100, 0);
    head = buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
  // SQLite takes an empty file for an empty database.
  if (!head.length) return { empty: true };
  if (head.toString('latin1', 0, lfsPointer.length) === lfsPointer) return { problem: 'lfs' };
  if (head.toString('latin1', 0, sqliteHeader.length) !== sqliteHeader) return { problem: 'notDatabase' };
  const wal = await sizeOf(`${file}-wal`);
  // Bytes 18 and 19 are 2 in a database that uses a -wal.
  if (wal === null) return { uri: uriOf(file, head[18] === 2 || head[19] === 2 ? 'immutable=1' : '') };
  if (wal === 0) return { uri: uriOf(file, 'immutable=1') };
  if (await sizeOf(`${file}-shm`) !== null) return { uri: uriOf(file, 'readonly_shm=1') };
  const copy = path.join(await fs.mkdtemp(path.join(await scratch(), 'wal-')), 'database.db');
  await fs.copyFile(file, copy);
  await fs.copyFile(`${file}-wal`, `${copy}-wal`);
  return { uri: uriOf(copy, '') };
};

let sqlite: typeof import('node:sqlite') | null = null;

type Row = Record<string, unknown>;
const lower = (name: string): string => name.toLowerCase();
const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

interface Listed { name: string; kind: 'table' | 'view'; withoutRowid: boolean; sql: string | null }
interface Related { kind: 'index' | 'trigger'; name: string; table: string; sql: string | null }
interface Version { listed: Map<string, Listed>; related: Related[] }
// A table's columns as one version has it, its primary key's in key order.
interface Shape { columns: string[]; key: string[]; withoutRowid: boolean }
// A column as the rows show it, read from each version.
interface Shown { name: string; base: string; target: string }

// A row's number, by a name no column has taken.
const rowidName = (columns: string[]): string | null =>
  ['rowid', '_rowid_', 'oid'].find((name) => !columns.some((column) => lower(column) === name)) ?? null;

// A value as the window gets it: a BLOB by its size, long text cut.
const cell = (value: unknown, size: unknown): GlistDatabaseCell => {
  if (size !== null && size !== undefined) return { blob: Number(size) };
  const shown = cellOf(value);
  return typeof shown === 'string' && shown.length > textLength ? `${shown.slice(0, textLength)}…` : shown;
};
// What to select for a value: never a BLOB's bytes, nor all of a long text.
const valueOf = (expression: string): string =>
  `CASE typeof(${expression}) WHEN 'blob' THEN NULL WHEN 'text' THEN substr(${expression}, 1, ${textLength + 1}) ELSE ${expression} END`;
const sizeOfValue = (expression: string): string => `CASE typeof(${expression}) WHEN 'blob' THEN length(${expression}) END`;

const nothing: Version = { listed: new Map(), related: [] };

// Compares the databases in two files, either of which may be missing (null):
// the file was added, or deleted. scratch is a folder of the caller's for
// copies; without it one is made, and taken away.
export const compareDatabases = async (
  base: string | null,
  target: string | null,
  options: { scratch?: string; rows?: number; unavailable?: () => string } = {},
): Promise<GlistDatabaseDiff> => {
  const limit = options.rows ?? diffRows;
  let made: string | null = null;
  const scratch = async (): Promise<string> => {
    if (options.scratch) return options.scratch;
    made ??= await fs.mkdtemp(path.join(tmpdir(), 'glist-studio-db-diff-'));
    return made;
  };
  let database: DatabaseSync | null = null;
  try {
    const openings = { base: base === null ? null : await openingOf(base, scratch), target: target === null ? null : await openingOf(target, scratch) };
    const versionOf = (opening: Opening | null): GlistDatabaseDiffVersion =>
      (opening === null ? { missing: true } : 'problem' in opening ? { missing: false, problem: opening.problem } : { missing: false });
    const result: GlistDatabaseDiff = { base: versionOf(openings.base), target: versionOf(openings.target), tables: [], rowLimit: limit };
    if (result.base.problem || result.target.problem) return result;
    if (!sqlite) {
      try { sqlite = await import('node:sqlite'); } catch { throw new Error(options.unavailable?.() ?? 'SQLite is not available'); }
    }
    // Both versions on one connection of its own, read-only, waiting a moment
    // for a Glist app that is writing.
    const connection = new sqlite.DatabaseSync(':memory:', { timeout: 3000 });
    database = connection;
    const attached = new Set<Side>();
    (['base', 'target'] as const).forEach((side) => {
      const opening = openings[side];
      if (opening && 'uri' in opening) {
        connection.prepare(`ATTACH ? AS ${quoteName(schemas[side])}`).run(opening.uri);
        attached.add(side);
      }
    });
    const all = (sql: string, ...values: string[]): Row[] => connection.prepare(sql).all(...values) as Row[];
    const count = (sql: string): number => Number(connection.prepare(sql).get()?.n ?? 0);

    const versions = { base: nothing, target: nothing };
    (['base', 'target'] as const).forEach((side) => {
      if (!attached.has(side)) return;
      const schema = schemas[side];
      const sql = new Map(all(`SELECT type, name, tbl_name, sql FROM ${quoteName(schema)}.sqlite_schema WHERE name NOT LIKE 'sqlite\\_%' ESCAPE '\\'`)
        .map((row) => [`${String(row.type)}:${lower(String(row.name))}`, row]));
      const sqlOf = (type: string, name: string): string | null => {
        const text = sql.get(`${type}:${lower(name)}`)?.sql;
        return text === null || text === undefined ? null : String(text);
      };
      // A virtual table's own tables (an FTS index's) are left out: what
      // changed shows in the virtual table itself.
      const listed = all(`SELECT name, type, wr FROM pragma_table_list WHERE schema = ? AND type IN ('table', 'view', 'virtual')
        AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'`, schema).map((row): Listed => {
        const kind = row.type === 'view' ? 'view' : 'table';
        return { name: String(row.name), kind, withoutRowid: Number(row.wr) === 1, sql: sqlOf(kind, String(row.name)) };
      });
      versions[side] = {
        listed: new Map(listed.map((entry) => [`${entry.kind}:${lower(entry.name)}`, entry])),
        related: [...sql.values()].filter((row) => row.type === 'index' || row.type === 'trigger').map((row) => ({
          kind: row.type as 'index' | 'trigger', name: String(row.name), table: String(row.tbl_name), sql: row.sql === null ? null : String(row.sql),
        })),
      };
    });

    const shapeOf = (side: Side, table: string, withoutRowid: boolean): Shape => {
      const columns = all('SELECT name, pk FROM pragma_table_xinfo(?, ?) WHERE hidden IN (0, 2, 3) ORDER BY cid', table, schemas[side]);
      return {
        columns: columns.map((column) => String(column.name)),
        key: columns.filter((column) => Number(column.pk) > 0).sort((a, b) => Number(a.pk) - Number(b.pk)).map((column) => String(column.name)),
        withoutRowid,
      };
    };
    const tableName = (side: Side, name: string): string => `${quoteName(schemas[side])}.${quoteName(name)}`;

    // Rows of a table only one version has: all added, or all removed.
    const oneSide = (side: Side, name: string, shape: Shape): GlistDatabaseDiffRows => {
      const rowid = shape.withoutRowid ? null : rowidName(shape.columns);
      const match = shape.key.length ? 'key' : rowid ? 'rowid' : 'columns';
      const keys = match === 'key' ? shape.key : match === 'rowid' ? [rowid as string] : [];
      const columns = [...keys, ...shape.columns.filter((column) => !keys.includes(column))];
      const expression = (column: string): string => (match === 'rowid' && column === rowid ? `t.${column}` : `t.${quoteName(column)}`);
      const total = count(`SELECT count(*) AS n FROM ${tableName(side, name)}`);
      const select = connection.prepare(`SELECT ${columns.flatMap((column) => [valueOf(expression(column)), sizeOfValue(expression(column))]).join(', ')}
        FROM ${tableName(side, name)} AS t${keys.length ? ` ORDER BY ${keys.map(expression).join(', ')}` : ''} LIMIT ${limit}`);
      select.setReturnArrays(true);
      select.setReadBigInts(true);
      const cells = (select.all() as unknown as unknown[][]).map((row) => columns.map((_, index) => cell(row[index * 2], row[index * 2 + 1])));
      const added = side === 'target';
      return {
        match,
        columns,
        keyCount: keys.length,
        added: added ? total : 0,
        removed: added ? 0 : total,
        changed: 0,
        rows: cells.map((values): GlistDatabaseDiffRow => ({ state: added ? 'added' : 'removed', before: added ? null : values, after: added ? values : null, changed: [] })),
      };
    };

    // Rows of a table both versions have, compared on the columns both have:
    // matched by the primary key when it is the same in both, else by the row
    // number, else (a WITHOUT ROWID table whose key changed) by all of them.
    const bothSides = (beforeName: string, afterName: string, before: Shape, after: Shape): GlistDatabaseDiffRows => {
      const baseColumn = new Map(before.columns.map((column) => [lower(column), column]));
      const common = after.columns.filter((column) => baseColumn.has(lower(column)))
        .map((column): Shown => ({ name: column, base: quoteName(baseColumn.get(lower(column)) as string), target: quoteName(column) }));
      const sameKey = before.key.length > 0 && before.key.length === after.key.length && before.key.every((column, index) => lower(column) === lower(after.key[index]));
      const rowid = !before.withoutRowid && !after.withoutRowid ? rowidName([...before.columns, ...after.columns]) : null;
      const match = sameKey ? 'key' : rowid ? 'rowid' : 'columns';
      const keys: Shown[] = match === 'key' ? after.key.map((name) => common.find((column) => lower(column.name) === lower(name)) as Shown)
        : match === 'rowid' ? [{ name: rowid as string, base: rowid as string, target: rowid as string }] : [];
      const shown = [...keys, ...common.filter((column) => !keys.includes(column))];
      const o = tableName('base', beforeName);
      const n = tableName('target', afterName);
      const values = (side: 'o' | 'n' | null, column: Shown): string[] => (side
        ? [valueOf(`${side}.${side === 'o' ? column.base : column.target}`), sizeOfValue(`${side}.${side === 'o' ? column.base : column.target}`)] : ['NULL', 'NULL']);
      // Each cell before, after, and whether it differs, byte for byte: a text
      // column's collation could take 'a' and 'A' for the same.
      const differs = (column: Shown): string => `o.${column.base} IS NOT n.${column.target} COLLATE BINARY`;
      const cells = (before: 'o' | null, after: 'n' | null): string => shown.map((column) =>
        [...values(before, column), ...values(after, column), before && after ? `(${differs(column)})` : '0'].join(', ')).join(', ');
      if (match === 'columns' && !common.length) {
        // Nothing in common to compare: every row went, and every row came.
        return {
          match, columns: [], keyCount: 0, added: count(`SELECT count(*) AS n FROM ${n}`), removed: count(`SELECT count(*) AS n FROM ${o}`), changed: 0, rows: [],
        };
      }
      let counts: Row;
      let sql: string;
      if (match === 'columns') {
        const list = (side: 'base' | 'target'): string => common.map((column, index) => `${column[side]} AS "c${index}"`).join(', ');
        const gone = `SELECT ${list('base')} FROM ${o} EXCEPT SELECT ${list('target')} FROM ${n}`;
        const come = `SELECT ${list('target')} FROM ${n} EXCEPT SELECT ${list('base')} FROM ${o}`;
        counts = connection.prepare(`SELECT (SELECT count(*) FROM (${gone})) AS removed, (SELECT count(*) FROM (${come})) AS added, 0 AS changed`).get() as Row;
        // Each cell before and after, the side the row is not on left empty.
        const row = (went: boolean): string => common.map((_, index) => {
          const value = [valueOf(`"c${index}"`), sizeOfValue(`"c${index}"`)];
          return [...(went ? value : ['NULL', 'NULL']), ...(went ? ['NULL', 'NULL'] : value), '0'].join(', ');
        }).join(', ');
        sql = `SELECT 0 AS state, ${row(true)} FROM (${gone}) UNION ALL SELECT 1, ${row(false)} FROM (${come}) LIMIT ${limit}`;
      } else {
        const on = keys.map((column) => `o.${column.base} = n.${column.target}`).join(' AND ');
        const compared = match === 'key' ? shown : shown.slice(1);
        const changed = compared.length ? compared.map(differs).join(' OR ') : '0';
        const removed = `FROM ${o} AS o WHERE NOT EXISTS (SELECT 1 FROM ${n} AS n WHERE ${on})`;
        const added = `FROM ${n} AS n WHERE NOT EXISTS (SELECT 1 FROM ${o} AS o WHERE ${on})`;
        const both = `FROM ${o} AS o JOIN ${n} AS n ON ${on} WHERE ${changed}`;
        counts = connection.prepare(`SELECT (SELECT count(*) ${removed}) AS removed, (SELECT count(*) ${added}) AS added,
          (SELECT count(*) ${both}) AS changed`).get() as Row;
        const order = (side: 'o' | 'n'): string => keys.map((column, index) => `${side}.${side === 'o' ? column.base : column.target} AS "k${index}"`).join(', ');
        sql = `SELECT * FROM (
          SELECT 0 AS state, ${order('o')}, ${cells('o', null)} ${removed}
          UNION ALL SELECT 1, ${order('n')}, ${cells(null, 'n')} ${added}
          UNION ALL SELECT 2, ${order('n')}, ${cells('o', 'n')} ${both}
        ) ORDER BY ${keys.map((_, index) => `"k${index}"`).join(', ')} LIMIT ${limit}`;
      }
      const select = connection.prepare(sql);
      select.setReturnArrays(true);
      select.setReadBigInts(true);
      const skip = 1 + (match === 'columns' ? 0 : keys.length);
      const states = ['removed', 'added', 'changed'] as const;
      const rows = (select.all() as unknown as unknown[][]).map((row): GlistDatabaseDiffRow => {
        const state = states[Number(row[0])];
        const at = (index: number, offset: number): unknown => row[skip + index * 5 + offset];
        const before = state === 'added' ? null : shown.map((_, index) => cell(at(index, 0), at(index, 1)));
        const after = state === 'removed' ? null : shown.map((_, index) => cell(at(index, 2), at(index, 3)));
        const changed = state === 'changed' ? shown.map((_, index) => index).filter((index) => Number(at(index, 4)) === 1) : [];
        return { state, before, after, changed };
      });
      return {
        match,
        columns: shown.map((column) => column.name),
        keyCount: keys.length,
        added: Number(counts.added),
        removed: Number(counts.removed),
        changed: Number(counts.changed),
        rows,
      };
    };

    // Each table and view, by the name either version gives it.
    const names = new Map<string, { base?: Listed; target?: Listed }>();
    (['base', 'target'] as const).forEach((side) => versions[side].listed.forEach((entry, key) => {
      names.set(key, { ...names.get(key), [side]: entry });
    }));
    names.forEach(({ base: before, target: after }) => {
      const entry = (after ?? before) as Listed;
      const relatedOf = (version: Version): Related[] => version.related.filter((item) => lower(item.table) === lower(entry.name));
      const relatedBefore = relatedOf(versions.base);
      const relatedAfter = relatedOf(versions.target);
      const related = [...new Set([...relatedBefore, ...relatedAfter].map((item) => `${item.kind}:${lower(item.name)}`))].flatMap((key): GlistDatabaseDiffSql[] => {
        const was = relatedBefore.find((item) => `${item.kind}:${lower(item.name)}` === key);
        const now = relatedAfter.find((item) => `${item.kind}:${lower(item.name)}` === key);
        const sql = { before: was?.sql ?? null, after: now?.sql ?? null };
        return sql.before === sql.after ? [] : [{ kind: (now ?? was as Related).kind, name: (now ?? was as Related).name, ...sql }];
      }).sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
      const table: GlistDatabaseDiffTable = {
        name: entry.name,
        kind: entry.kind,
        state: !before ? 'added' : !after ? 'removed' : 'unchanged',
        before: before?.sql ?? null,
        after: after?.sql ?? null,
        related,
        addedColumns: [],
        removedColumns: [],
      };
      if (entry.kind === 'table') {
        try {
          const shapeBefore = before && shapeOf('base', before.name, before.withoutRowid);
          const shapeAfter = after && shapeOf('target', after.name, after.withoutRowid);
          if (shapeBefore && shapeAfter) {
            table.addedColumns = shapeAfter.columns.filter((column) => !shapeBefore.columns.some((other) => lower(other) === lower(column)));
            table.removedColumns = shapeBefore.columns.filter((column) => !shapeAfter.columns.some((other) => lower(other) === lower(column)));
            table.rows = bothSides((before as Listed).name, (after as Listed).name, shapeBefore, shapeAfter);
          } else if (shapeAfter) table.rows = oneSide('target', (after as Listed).name, shapeAfter);
          else if (shapeBefore) table.rows = oneSide('base', (before as Listed).name, shapeBefore);
        } catch (error) {
          table.error = message(error);
        }
      }
      const rows = table.rows;
      if (table.state === 'unchanged' && (table.before !== table.after || related.length || (rows && rows.added + rows.removed + rows.changed > 0))) {
        table.state = 'changed';
      }
      result.tables.push(table);
    });
    result.tables.sort((a, b) => (a.kind === b.kind ? lower(a.name).localeCompare(lower(b.name)) : a.kind === 'table' ? -1 : 1));
    return result;
  } finally {
    // Closed before anything is deleted: Windows deletes no file that is open.
    try { database?.close(); } catch { /* Already closed. */ }
    if (made) await fs.rm(made, { recursive: true, force: true });
  }
};

// A file's size and when it was last written, and its -wal's, where writes
// wait in a WAL database: which changes whenever what a diff of it reads does,
// told without reading it.
export const fileStamp = async (file: string): Promise<string> => {
  const stamp = (name: string): Promise<string> => fs.stat(name).then((stats) => `${stats.size}:${stats.mtimeMs}`, () => '-');
  return `${await stamp(file)}/${await stamp(`${file}-wal`)}`;
};

// Where the versions come from: the commits' from git, the one on disk from
// the project.
export interface DatabaseVersions {
  // The file as a commit has it, or null when the commit has no such file.
  blob(revision: string, filePath: string): Promise<Buffer | null>;
  // The file on disk, once known to be one the studio may read; null when there is none.
  working(filePath: string): Promise<string | null>;
  unavailable(): string;
  // Compares them; here, unless given (the backend's is in another process).
  compare?: typeof compareDatabases;
}

// A database between two commits, or a commit and the file on disk (target
// null); no base when the file is new, and from where a renamed file was at
// the base. A commit's version is copied to a folder of our own, taken away
// afterwards whatever happens. Git is asked for it whole: a file GitHub takes
// is under 100 MB.
export const diffDatabase = async (
  versions: DatabaseVersions,
  filePath: string,
  base: string | null,
  target: string | null,
  from?: string,
): Promise<GlistDatabaseDiff> => {
  const scratch = await fs.mkdtemp(path.join(tmpdir(), 'glist-studio-db-diff-'));
  try {
    const copy = async (revision: string, file: string, name: string): Promise<string | null> => {
      const blob = await versions.blob(revision, file);
      if (!blob) return null;
      const copied = path.join(scratch, name);
      await fs.writeFile(copied, blob);
      return copied;
    };
    const before = base === null ? null : await copy(base, from ?? filePath, 'base.db');
    const after = target === null ? await versions.working(filePath) : await copy(target, filePath, 'target.db');
    return await (versions.compare ?? compareDatabases)(before, after, { scratch, unavailable: versions.unavailable });
  } finally {
    await fs.rm(scratch, { recursive: true, force: true });
  }
};
