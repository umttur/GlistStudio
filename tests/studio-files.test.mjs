import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { codeStyleFor, parseStyle } from '../src/code-style.ts';
import { glistCodeStyle } from '../src/default-code-style.ts';
import { changedLines, codeLines, editsWithin } from '../src/format-lines.ts';
import { initializeStudio, openProjectAt, pluginDllFolders, stopGit, stopWatchingConfiguration, studio, systemFolders } from '../src/studio.ts';

// What the studio may write: the project, and the engine and the plugins the
// project names, which only build from an app. Run with jiti.
const root = mkdtempSync(path.join(tmpdir(), 'glist-files-'));
const write = (file, text) => {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), text);
};
const at = (file) => path.join(root, file);

try {
  write('GlistEngine/engine/core/gCore.h', '// core\n');
  write('glistplugins/gipDemo/src/gipDemo.h', '// demo\n');
  write('glistplugins/gipOther/src/gipOther.h', '// other\n');
  write('zbin/include/tool.h', '// tool\n');
  write('myglistapps/App/CMakeLists.txt', 'set(PLUGINS gipDemo)\n');
  write('myglistapps/App/src/main.cpp', 'int main() {}\n');
  symlinkSync(at('zbin/include/tool.h'), at('glistplugins/gipDemo/src/tool.h'));
  initializeStudio({
    send: () => undefined, trashItem: async () => undefined, showItemInFolder: () => undefined, openPath: async () => undefined,
    templateRoot: root, projectsDirectory: at('myglistapps'),
  });
  await openProjectAt(at('myglistapps/App'));

  await studio.writeFile(at('myglistapps/App/src/main.cpp'), 'int main() { return 0; }\n');
  assert.equal(readFileSync(at('myglistapps/App/src/main.cpp'), 'utf8'), 'int main() { return 0; }\n');
  await studio.writeFile(at('GlistEngine/engine/core/gCore.h'), '// core, edited\n');
  assert.equal(readFileSync(at('GlistEngine/engine/core/gCore.h'), 'utf8'), '// core, edited\n');
  await studio.writeFile(at('glistplugins/gipDemo/src/gipDemo.h'), '// demo, edited\n');
  assert.equal(readFileSync(at('glistplugins/gipDemo/src/gipDemo.h'), 'utf8'), '// demo, edited\n');
  // A file deleted behind the editor's back is written again.
  rmSync(at('glistplugins/gipDemo/src/gipDemo.h'));
  await studio.writeFile(at('glistplugins/gipDemo/src/gipDemo.h'), '// demo, again\n');
  assert.equal(readFileSync(at('glistplugins/gipDemo/src/gipDemo.h'), 'utf8'), '// demo, again\n');

  // Not a plugin the project names, the tools, a link out of a plugin, or the plugin folder itself.
  await assert.rejects(studio.writeFile(at('glistplugins/gipOther/src/gipOther.h'), 'x'));
  await assert.rejects(studio.writeFile(at('zbin/include/tool.h'), 'x'));
  await assert.rejects(studio.writeFile(at('glistplugins/gipDemo/src/tool.h'), 'x'));
  await assert.rejects(studio.writeFile(at('glistplugins/gipDemo/missing/new.h'), 'x'));
  assert.equal(readFileSync(at('zbin/include/tool.h'), 'utf8'), '// tool\n');
  assert.equal(readFileSync(at('glistplugins/gipOther/src/gipOther.h'), 'utf8'), '// other\n');

  // The DLL folders of the plugins the project names, the ones that exist, in the order named.
  write('glistplugins/gipDemo/libs/bin/demo.dll', '');
  write('glistplugins/gipDemo/prebuilts/bin/extra.dll', '');
  write('glistplugins/gipOther/libs/bin/other.dll', '');
  write('glistplugins/gipCairo/prebuilts/bin/cairo.dll', '');
  write('myglistapps/App/CMakeLists.txt', 'set(PLUGINS gipCairo gipDemo gipMissing)\n');
  assert.deepEqual(pluginDllFolders(at('myglistapps/App')), [
    at('glistplugins/gipCairo/prebuilts/bin'), at('glistplugins/gipDemo/libs/bin'), at('glistplugins/gipDemo/prebuilts/bin'),
  ]);
  write('myglistapps/App/CMakeLists.txt', 'set(PLUGINS)\n');
  assert.deepEqual(pluginDllFolders(at('myglistapps/App')), []);
  assert.deepEqual(pluginDllFolders(at('myglistapps/Missing')), []);

  // Settings > PATH: this computer's folders, then the ones added, which must be whole folders.
  const kept = await studio.setCustomPath([at('tools'), 'relative/tools', `${at('a')}${path.delimiter}${at('b')}`, at('tools/'), at('tools/../tools'), 7]);
  assert.deepEqual(kept, [at('tools')], 'only absolute folders without the separator, each once');
  write('tools/tool.txt', '');
  // Not the PATH the studio was started with: a folder only there is left out.
  write('os-only/tool.txt', '');
  const startedWith = process.env.PATH;
  process.env.PATH = [at('os-only'), startedWith].join(path.delimiter);
  const entries = await studio.pathEntries();
  process.env.PATH = startedWith;
  assert.equal(entries.some((entry) => entry.path === at('os-only')), false);
  assert.deepEqual(entries.filter((entry) => entry.source === 'system').map((entry) => entry.path), systemFolders());
  assert.ok(systemFolders().length > 0 && systemFolders().every((folder) => existsSync(folder)));
  assert.deepEqual(entries.slice(-1).map((entry) => [entry.path, entry.source, entry.exists]), [[at('tools'), 'custom', true]]);
  const top = path.parse(root).root;
  assert.deepEqual(await studio.setCustomPath([top]), [top], 'a root stays as it is');
  await studio.setCustomPath([at('missing')]);
  assert.deepEqual((await studio.pathEntries()).slice(-1).map((entry) => [entry.source, entry.exists]), [['custom', false]]);
  await studio.setCustomPath([]);
  assert.equal((await studio.pathEntries()).some((entry) => entry.source === 'custom'), false);

  // Dropped from the system's file manager: copied from anywhere into a project
  // folder, a taken name getting " - Copy", a folder with everything in it.
  write('Desktop/logo.png', 'png');
  write('Desktop/sprites/hero.png', 'hero');
  write('Desktop/sprites/enemies/bat.png', 'bat');
  mkdirSync(at('myglistapps/App/assets'), { recursive: true });
  write('myglistapps/App/assets/logo.png', 'old');
  const imported = await studio.importPaths([at('Desktop/logo.png'), at('Desktop/sprites')], at('myglistapps/App/assets'));
  assert.deepEqual(imported, [at('myglistapps/App/assets/logo - Copy.png'), at('myglistapps/App/assets/sprites')]);
  assert.equal(readFileSync(at('myglistapps/App/assets/logo.png'), 'utf8'), 'old');
  assert.equal(readFileSync(at('myglistapps/App/assets/logo - Copy.png'), 'utf8'), 'png');
  assert.equal(readFileSync(at('myglistapps/App/assets/sprites/enemies/bat.png'), 'utf8'), 'bat');
  // Into the project, the engine and the plugins it names, and a folder not into itself.
  assert.deepEqual(await studio.importPaths([at('Desktop/logo.png')], at('GlistEngine/engine/core')), [at('GlistEngine/engine/core/logo.png')]);
  await assert.rejects(studio.importPaths([at('Desktop/logo.png')], at('glistplugins/gipOther/src')));
  await assert.rejects(studio.importPaths([at('Desktop/logo.png')], at('zbin/include')));
  await assert.rejects(studio.importPaths([at('myglistapps/App/assets')], at('myglistapps/App/assets/sprites')));
  // From a browser, by content: the dropped folder renamed as a whole when its name is taken.
  const sent = await studio.importFiles(at('myglistapps/App/assets'), [
    { path: 'sprites/hero.png', data: Buffer.from('hero 2').toString('base64') },
    { path: 'sprites/enemies/bat.png', data: Buffer.from('bat 2').toString('base64') },
    { path: 'music.ogg', data: Buffer.from([0, 1, 2, 255]).toString('base64') },
  ]);
  assert.deepEqual(sent, [at('myglistapps/App/assets/sprites - Copy'), at('myglistapps/App/assets/music.ogg')]);
  assert.equal(readFileSync(at('myglistapps/App/assets/sprites - Copy/enemies/bat.png'), 'utf8'), 'bat 2');
  assert.deepEqual([...readFileSync(at('myglistapps/App/assets/music.ogg'))], [0, 1, 2, 255]);
  await assert.rejects(studio.importFiles(at('myglistapps/App/assets'), [{ path: '../escape.txt', data: '' }]));

  // Files and folders of the engine and the plugins are made, renamed, moved and
  // deleted as the project's are; only the project's CMakeLists.txt is kept in step.
  const cmake = 'set(PLUGINS gipDemo)\nset(GlistApp_SOURCES\n\t${APP_DIR}/src/main.cpp\n\t${APP_DIR}/src/leaving.cpp\n)\nset(GlistApp_HEADERS\n)\n';
  write('myglistapps/App/CMakeLists.txt', cmake);
  write('myglistapps/App/src/leaving.cpp', '');
  const cmakeNow = () => readFileSync(at('myglistapps/App/CMakeLists.txt'), 'utf8');
  assert.ok((await studio.listDirectory(at('glistplugins/gipDemo'))).some((entry) => entry.name === 'src'));
  await assert.rejects(studio.listDirectory(at('glistplugins/gipOther')));
  assert.equal(await studio.createFile(at('GlistEngine/engine/core'), 'gNew.cpp'), at('GlistEngine/engine/core/gNew.cpp'));
  assert.equal(await studio.createDirectory(at('glistplugins/gipDemo'), 'assets'), at('glistplugins/gipDemo/assets'));
  const made = await studio.createCppClass(at('glistplugins/gipDemo/src'), 'gipHelper');
  assert.match(readFileSync(made.header, 'utf8'), /#ifndef SRC_GIPHELPER_H_/);
  assert.equal(await studio.renameEntry(at('GlistEngine/engine/core/gNew.cpp'), 'gNewer.cpp'), at('GlistEngine/engine/core/gNewer.cpp'));
  assert.equal(await studio.moveEntry(at('glistplugins/gipDemo/src/gipHelper.cpp'), at('glistplugins/gipDemo/assets')), at('glistplugins/gipDemo/assets/gipHelper.cpp'));
  assert.equal(cmakeNow(), cmake);
  // Across the project's edge, a file leaves its CMakeLists.txt or joins it.
  await studio.moveEntry(at('myglistapps/App/src/leaving.cpp'), at('GlistEngine/engine/core'));
  assert.ok(!cmakeNow().includes('leaving.cpp'));
  await studio.moveEntry(at('GlistEngine/engine/core/gNewer.cpp'), at('myglistapps/App/src'));
  assert.ok(cmakeNow().includes('${APP_DIR}/src/gNewer.cpp'));
  // Their own folders stay where they are, and so does what is not named.
  for (const folder of ['GlistEngine', 'glistplugins/gipDemo', 'myglistapps/App']) {
    await assert.rejects(studio.deleteEntry(at(folder)), /cannot be renamed, moved or deleted/);
    await assert.rejects(studio.renameEntry(at(folder), 'Other'), /cannot be renamed, moved or deleted/);
  }
  await assert.rejects(studio.moveEntry(at('glistplugins/gipDemo'), at('GlistEngine')), /cannot be renamed, moved or deleted/);
  await assert.rejects(studio.createFile(at('glistplugins/gipOther/src'), 'x.h'));
  await assert.rejects(studio.moveEntry(at('glistplugins/gipOther/src/gipOther.h'), at('glistplugins/gipDemo/src')));
  await assert.rejects(studio.deleteEntry(at('zbin/include/tool.h')));
} finally {
  rmSync(root, { recursive: true, force: true });
}

// The .clang-format a file follows, for the editor's indentation and format on save.

// The predefined styles' values, and the file's own on top.
assert.deepEqual(parseStyle(''), { useTab: false, indentWidth: 2, tabWidth: 8, columnLimit: 80, disabled: false });
assert.deepEqual(parseStyle('BasedOnStyle: Microsoft'), { useTab: false, indentWidth: 4, tabWidth: 4, columnLimit: 120, disabled: false });
assert.deepEqual(parseStyle([
  '# Glist style',
  'BasedOnStyle: WebKit',
  'UseTab: ForIndentation   # tabs, aligned with spaces',
  'IndentWidth: 4',
  "TabWidth: '4'",
  'BraceWrapping:',
  '  AfterClass: true',
  '  IndentWidth: 9',
].join('\n')), { useTab: true, indentWidth: 4, tabWidth: 4, columnLimit: 0, disabled: false });
assert.equal(parseStyle('UseTab: Never').useTab, false);
assert.equal(parseStyle('UseTab: false').useTab, false);
assert.equal(parseStyle('UseTab: Always').useTab, true);
assert.equal(parseStyle('DisableFormat: true').disabled, true);
// One document for every language, and C++'s own on top; others are not C++'s.
assert.deepEqual(parseStyle([
  'IndentWidth: 3', '---', 'Language: JavaScript', 'IndentWidth: 7', '---', 'Language: Cpp', 'ColumnLimit: 100', '...',
].join('\n')), { useTab: false, indentWidth: 3, tabWidth: 8, columnLimit: 100, disabled: false });

const styleRoot = mkdtempSync(path.join(tmpdir(), 'glist-style-'));
try {
  const place = (relative, contents) => {
    mkdirSync(path.dirname(path.join(styleRoot, relative)), { recursive: true });
    writeFileSync(path.join(styleRoot, relative), contents);
  };
  place('App/.clang-format', 'BasedOnStyle: LLVM\nUseTab: Always\nIndentWidth: 4\nTabWidth: 4\nColumnLimit: 100\n');
  place('App/src/gCanvas.cpp', '');
  place('App/src/third/_clang-format', 'BasedOnStyle: InheritParentConfig\nColumnLimit: 70\n');
  place('App/src/third/lib.h', '');
  // The nearest one counts, from the file's own folder up.
  assert.deepEqual(await codeStyleFor(path.join(styleRoot, 'App', 'src', 'gCanvas.cpp')), {
    file: path.join(styleRoot, 'App', '.clang-format'), useTab: true, indentWidth: 4, tabWidth: 4, columnLimit: 100, disabled: false,
  });
  // InheritParentConfig starts from the one further up.
  assert.deepEqual(await codeStyleFor(path.join(styleRoot, 'App', 'src', 'third', 'lib.h')), {
    file: path.join(styleRoot, 'App', 'src', 'third', '_clang-format'), useTab: true, indentWidth: 4, tabWidth: 4, columnLimit: 70, disabled: false,
  });
  place('Other/main.cpp', '');
  const outside = await codeStyleFor(path.join(styleRoot, 'Other', 'main.cpp'));
  // None above it here, unless the machine has one further up.
  assert.ok(outside === null || !outside.file.startsWith(styleRoot));
  // Glist Studio's own, given as built in, for a file with none above it: Glist Engine's tabs, 4 wide.
  place('Studio/code-style/.clang-format', glistCodeStyle);
  const builtIn = path.join(styleRoot, 'Studio', 'code-style', '.clang-format');
  if (outside === null) {
    assert.deepEqual(await codeStyleFor(path.join(styleRoot, 'Other', 'main.cpp'), builtIn), {
      useTab: true, indentWidth: 4, tabWidth: 4, columnLimit: 0, disabled: false, file: builtIn, builtIn: true,
    });
  }
  // A file's own .clang-format still comes first.
  assert.equal((await codeStyleFor(path.join(styleRoot, 'App', 'src', 'gCanvas.cpp'), builtIn))?.builtIn, undefined);
  assert.match(glistCodeStyle, /^SpaceBeforeParens: Never$/m);
  assert.match(glistCodeStyle, /^UseTab: Always$/m);
} finally {
  rmSync(styleRoot, { recursive: true, force: true });
}

// Reformat File: the whole text or some lines, #include lines left out.
{
  const text = '#include "b.h"\n#include "a.h"\n\nint  f( ){\n  return 1;\n}\n';
  assert.deepEqual(codeLines(text), [{ start: 3, end: 7 }]);
  assert.deepEqual(codeLines(text, 4, 5), [{ start: 4, end: 5 }]);
  assert.deepEqual(codeLines(text, 1, 2), []);
  assert.deepEqual(codeLines('int a;\n#include "x.h"\nint b;', 1, 99), [{ start: 1, end: 1 }, { start: 3, end: 3 }]);
}

// Format on save for the lines changed since the last save.
{
  const saved = ['#include "b.h"', '#include "a.h"', '', 'void f() {', '    if (x)  y = 1;', '\tz = 2;', '}', ''].join('\n');
  // Nothing changed, nothing to format.
  assert.deepEqual(changedLines(saved, saved), []);
  // One line typed into.
  assert.deepEqual(changedLines(saved, saved.replace('\tz = 2;', '\tz =  3;')), [{ start: 6, end: 6 }]);
  // Lines added together are one range.
  assert.deepEqual(changedLines(saved, saved.replace('\tz = 2;', '\tz = 2;\n  w=1;\n  v=2;')), [{ start: 7, end: 8 }]);
  // An #include changed is left out, so its block is never sorted.
  assert.deepEqual(changedLines(saved, saved.replace('#include "a.h"', '#include "c.h"')), []);
  assert.deepEqual(changedLines(saved, saved.replace('#include "a.h"\n', '#include "a.h"\nint g;\n#include "c.h"\nint h;\n')), [{ start: 3, end: 3 }, { start: 5, end: 5 }]);
  // Lines only removed leave nothing.
  assert.deepEqual(changedLines(saved, saved.replace('\tz = 2;\n', '')), []);
  // A file never saved: every line but the #includes.
  assert.deepEqual(changedLines('', 'int a;\n#include "x.h"\nint b;'), [{ start: 1, end: 1 }, { start: 3, end: 3 }]);

  // Edits on the changed lines stay; others, and repeats, go.
  const edit = (startLineNumber, startColumn, endLineNumber, endColumn, text) => ({ range: { startLineNumber, startColumn, endLineNumber, endColumn }, text });
  const ranges = [{ start: 5, end: 5 }];
  assert.deepEqual(editsWithin([
    edit(5, 1, 5, 5, '\t'), // its indent
    edit(4, 11, 5, 1, '\n'), // the line break before it
    edit(5, 7, 5, 8, ''), // a space inside it
    edit(2, 1, 3, 1, ''), // an #include block sorted
    edit(6, 1, 6, 2, '    '), // a line nobody changed
    edit(5, 7, 5, 8, ''), // the same edit again, from another range
    edit(5, 7, 5, 9, ' '), // one overlapping another
  ], ranges), [edit(4, 11, 5, 1, '\n'), edit(5, 1, 5, 5, '\t'), edit(5, 7, 5, 8, '')]);
  // Two inserts at one place from two ranges: one.
  assert.deepEqual(editsWithin([edit(5, 1, 5, 1, '\t'), edit(5, 1, 5, 1, '\t')], ranges), [edit(5, 1, 5, 1, '\t')]);
}

// Opening a project started watching its git and its CMake files; those watchers
// would keep Node running on Windows once the tests are done.
stopGit();
stopWatchingConfiguration();
console.log('Studio file tests passed.');
