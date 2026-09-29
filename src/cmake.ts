export type CmakeChange =
  | { kind: 'add'; paths: string[] }
  | { kind: 'remove'; path: string }
  | { kind: 'rename'; from: string; to: string };

type ListName = 'SOURCES' | 'HEADERS';

const listPattern = /(set\s*\(\s*GlistApp_(SOURCES|HEADERS)\b)([\s\S]*?)(\))/gi;
const entryPattern = /^(\s*)(?:"(\$\{APP_DIR\}\/[^"]+)"|(\$\{APP_DIR\}\/[^\s)#]+))([ \t]*(?:#.*)?)$/;

const normalize = (filePath: string): string => filePath.replace(/\\/g, '/').replace(/^\/+/, '');

const listFor = (filePath: string): ListName | null => {
  const extension = filePath.split('.').pop()?.toLowerCase();
  if (extension && ['c', 'cc', 'cpp', 'cxx'].includes(extension)) return 'SOURCES';
  if (extension && ['h', 'hh', 'hpp', 'hxx'].includes(extension)) return 'HEADERS';
  return null;
};

const entryPath = (line: string): string | null => {
  const match = line.match(entryPattern);
  return match ? normalize((match[2] ?? match[3]).slice('${APP_DIR}/'.length)) : null;
};

const matchingPath = (candidate: string, target: string, fold: (value: string) => string): boolean => {
  const foldedCandidate = fold(candidate);
  const foldedTarget = fold(target);
  return foldedCandidate === foldedTarget || foldedCandidate.startsWith(`${foldedTarget}/`);
};

const formatEntry = (relativePath: string): string => {
  const value = `\${APP_DIR}/${relativePath}`;
  return /\s/.test(value) ? `"${value}"` : value;
};

export const hasGlistSourceLists = (cmake: string): boolean => {
  const lists = [...cmake.matchAll(listPattern)].map((match) => match[2].toUpperCase());
  return lists.includes('SOURCES') && lists.includes('HEADERS');
};

// Paths compare without case unless caseSensitive, which suits Linux file systems.
export const synchronizeCmake = (cmake: string, change: CmakeChange, caseSensitive = false): string => {
  if (!hasGlistSourceLists(cmake)) return cmake;
  const fold = (value: string): string => (caseSensitive ? value : value.toLowerCase());
  const newline = cmake.includes('\r\n') ? '\r\n' : '\n';
  const additions: string[] = change.kind === 'add' ? change.paths.map(normalize) : [];

  let updated = cmake.replace(listPattern, (whole, start: string, list: string, body: string, end: string) => {
    const listName = list.toUpperCase() as ListName;
    const lines = body.split(/\r?\n/);
    const nextLines: string[] = [];
    lines.forEach((line) => {
      const relative = entryPath(line);
      if (!relative || change.kind === 'add') { nextLines.push(line); return; }
      if (change.kind === 'remove' && matchingPath(relative, normalize(change.path), fold)) return;
      if (change.kind === 'rename' && matchingPath(relative, normalize(change.from), fold)) {
        const oldRelative = normalize(change.from);
        const nextRelative = `${normalize(change.to)}${relative.slice(oldRelative.length)}`;
        if (listFor(nextRelative) !== listName) {
          additions.push(nextRelative);
          return;
        }
        const match = line.match(entryPattern);
        if (match) nextLines.push(`${match[1]}${formatEntry(nextRelative)}${match[4]}`);
        return;
      }
      nextLines.push(line);
    });
    return `${start}${nextLines.join(newline)}${end}`;
  });

  if (additions.length === 0) return updated;
  const existing = new Set<string>();
  [...updated.matchAll(listPattern)].forEach((block) => {
    block[3].split(/\r?\n/).forEach((line) => {
      const relative = entryPath(line);
      if (relative) existing.add(fold(relative));
    });
  });
  updated = updated.replace(listPattern, (whole, start: string, list: string, body: string, end: string) => {
    const listName = list.toUpperCase() as ListName;
    const pending = additions.filter((relative) => listFor(relative) === listName && !existing.has(fold(relative)));
    pending.forEach((relative) => existing.add(fold(relative)));
    if (pending.length === 0) return whole;
    const indent = body.split(/\r?\n/).map((line) => line.match(entryPattern)?.[1]).find((value) => value !== undefined) ?? '\t\t';
    const separator = body.endsWith(newline) ? '' : newline;
    return `${start}${body}${separator}${pending.map((relative) => `${indent}${formatEntry(relative)}`).join(newline)}${newline}${end}`;
  });
  return updated;
};

// The plugins an app uses, from set(PLUGINS ...) and list(APPEND PLUGINS ...)
// in its CMakeLists.txt, in order. The engine looks for each in glistplugins.
export const pluginsInCmake = (cmake: string): string[] => {
  const code = cmake.replace(/#[^\n]*/g, '');
  const names: string[] = [];
  for (const match of code.matchAll(/\b(?:set\s*\(\s*PLUGINS|list\s*\(\s*APPEND\s+PLUGINS)\b([^)]*)\)/gi)) {
    match[1].split(/[\s;"]+/)
      .filter((name) => /^[A-Za-z0-9_.-]+$/.test(name) && name !== '..' && !names.includes(name))
      .forEach((name) => names.push(name));
  }
  return names;
};

// The files CMake read while configuring, as its CMakeFiles/Makefile.cmake
// lists them. Relative ones are relative to the build folder.
export const cmakeInputs = (makefile: string): string[] => {
  const block = /set\(CMAKE_MAKEFILE_DEPENDS\s*([\s\S]*?)\)/.exec(makefile);
  return block ? [...block[1].matchAll(/"([^"]*)"/g)].map((match) => match[1]) : [];
};
