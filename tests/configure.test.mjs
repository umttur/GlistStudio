import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initializeStudio, openProjectAt, stopWatchingConfiguration, studio } from '../src/studio.ts';

// Configuring with real CMake, on a small project with no engine. Run with jiti.
// On Windows the studio builds only with Glist's own CMake and clang (zbin's),
// which the Glist installer brings, never the system's; without them, as on a
// CI runner, there is no cmake to start (spawn cmake ENOENT), so the test is
// left out there.
if (process.platform === 'win32' && !process.env.GLIST_ZBIN_TESTS) {
  console.log('Configure tests skipped: Glist\'s Windows toolchain (zbin) is not here.');
  process.exit(0);
}
const root = mkdtempSync(path.join(tmpdir(), 'glist-configure-'));
const apps = path.join(root, 'myglistapps');
const cmake = (name, extra = '') => `cmake_minimum_required(VERSION 3.10)\nproject(${name} CXX)\n${extra}add_executable(${name} main.cpp)\n`;
const makeApp = (name) => {
  const folder = path.join(apps, name);
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, 'CMakeLists.txt'), cmake(name));
  writeFileSync(path.join(folder, 'main.cpp'), 'int main() { return 0; }\n');
  return folder;
};
const sent = [];
const configured = () => sent.filter(([channel]) => channel === 'build:configured').map(([, payload]) => payload);
const output = () => sent.filter(([channel]) => channel === 'build:output').map(([, text]) => text).join('');
const told = () => sent.filter(([channel]) => channel === 'clangd:compile-commands').length;
const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const until = async (test, ms = 30000) => {
  for (const start = Date.now(); Date.now() - start < ms; await wait(200)) if (test()) return true;
  return false;
};
const cacheHome = (folder) => /^CMAKE_HOME_DIRECTORY:INTERNAL=(.*)$/m.exec(readFileSync(path.join(folder, '_build', 'Release', 'CMakeCache.txt'), 'utf8'))[1];

try {
  initializeStudio({
    send: (channel, payload) => sent.push([channel, payload]),
    trashItem: async () => undefined, showItemInFolder: () => undefined, openPath: async () => undefined,
    templateRoot: root, projectsDirectory: apps,
  });
  await studio.setAutoConfigure(true);

  // Built once, then three quick edits configure once, a moment after the last.
  const app = makeApp('App');
  await openProjectAt(app);
  const built = await studio.buildProject();
  assert.equal(built.success, true, built.message);
  // New compile commands restart clangd, which indexes them, so it is told once make is done.
  assert.equal(told(), 1);
  assert.ok(sent.findIndex(([channel]) => channel === 'clangd:compile-commands') > sent.findLastIndex(([channel]) => channel === 'build:output'));
  await wait(500);
  for (const version of [1, 2, 3]) {
    writeFileSync(path.join(app, 'CMakeLists.txt'), cmake('App', `add_compile_definitions(VERSION_SEEN=${version})\n`));
    await wait(150);
  }
  assert.ok(await until(() => configured().length === 1), 'configured after the edits');
  assert.equal(configured()[0].success, true);
  await wait(3000);
  assert.equal(configured().length, 1, 'configured once, not once per edit');
  assert.equal(told(), 2, 'new flags restart clangd');
  assert.match(readFileSync(path.join(app, '_build', 'Release', 'CMakeCache.txt'), 'utf8'), /./);

  // Written again with the same text: nothing to configure.
  writeFileSync(path.join(app, 'CMakeLists.txt'), readFileSync(path.join(app, 'CMakeLists.txt'), 'utf8'));
  await wait(3500);
  assert.equal(configured().length, 1, 'an unchanged file configures nothing');

  // A broken CMakeLists.txt says so.
  writeFileSync(path.join(app, 'CMakeLists.txt'), `${cmake('App')}this_is_not_cmake(\n`);
  assert.ok(await until(() => configured().length === 2));
  assert.equal(configured()[1].success, false);
  assert.equal(told(), 2, 'a failed configure leaves the compile commands as they were');

  // Turned off, changes are left alone.
  await studio.setAutoConfigure(false);
  writeFileSync(path.join(app, 'CMakeLists.txt'), cmake('App'));
  await wait(3500);
  assert.equal(configured().length, 2, 'off, nothing configures');
  await studio.setAutoConfigure(true);

  // A copied project's build folder was made for the original, so it is made again.
  const copy = path.join(apps, 'Copy');
  cpSync(app, copy, { recursive: true });
  await openProjectAt(copy);
  sent.length = 0;
  const rebuilt = await studio.buildProject();
  assert.equal(rebuilt.success, true, rebuilt.message);
  assert.match(output(), /was made for/);
  assert.equal(path.resolve(cacheHome(copy)), path.resolve(copy));
  assert.equal(path.resolve(cacheHome(app)), path.resolve(app), 'the original is left alone');

  // A build folder that is a link out of the project is never deleted.
  const linked = makeApp('Linked');
  const outside = path.join(root, 'outside');
  mkdirSync(path.join(outside, 'Release'), { recursive: true });
  writeFileSync(path.join(outside, 'Release', 'CMakeCache.txt'), 'CMAKE_HOME_DIRECTORY:INTERNAL=/somewhere/else\n');
  symlinkSync(outside, path.join(linked, '_build'));
  await openProjectAt(linked);
  await studio.buildProject();
  assert.ok(existsSync(path.join(outside, 'Release', 'CMakeCache.txt')), 'the linked folder is kept');

  // Targets, as CMake describes them: the app first, then the rest, each built, run or refused on its own.
  const multi = path.join(apps, 'Multi');
  mkdirSync(multi, { recursive: true });
  writeFileSync(path.join(multi, 'CMakeLists.txt'), `cmake_minimum_required(VERSION 3.14)\nproject(Multi CXX)
add_executable(Multi main.cpp)\nadd_executable(Tool tool.cpp)\nadd_executable(Echo echo.cpp)\nadd_library(Shapes STATIC shapes.cpp)
add_custom_target(Step COMMAND \${CMAKE_COMMAND} -E echo step)\n`);
  writeFileSync(path.join(multi, 'main.cpp'), 'int main() { return 0; }\n');
  writeFileSync(path.join(multi, 'tool.cpp'), '#include <cstdio>\nint main() { std::puts("the tool ran"); return 0; }\n');
  writeFileSync(path.join(multi, 'shapes.cpp'), 'int area() { return 4; }\n');
  writeFileSync(path.join(multi, 'echo.cpp'), '#include <cstdio>\n#include <cstdlib>\nint main(int count, char** args) {\n  for (int i = 1; i < count; i++) std::printf("[%s]", args[i]);\n  const char* value = std::getenv("GLIST_TEST");\n  std::printf(" GLIST_TEST=%s\\n", value ? value : "(none)");\n  return 0;\n}\n');
  // Configured before targets were asked for: the list configures once to have them.
  execFileSync('cmake', ['-S', multi, '-B', path.join(multi, '_build', 'Release'), '-DCMAKE_BUILD_TYPE=Release'], { stdio: 'ignore' });
  await openProjectAt(multi);
  const targets = await studio.listTargets();
  assert.deepEqual(targets.map((target) => [target.name, target.type, target.group, target.app]), [
    ['Multi', 'executable', 'project', true], ['Echo', 'executable', 'project', false], ['Shapes', 'library', 'project', false],
    ['Step', 'utility', 'project', false], ['Tool', 'executable', 'project', false],
  ]);
  assert.equal(targets.find((target) => target.name === 'Tool').artifact, path.join(multi, '_build', 'Release', 'Tool'));
  // Only the chosen target is built, and Run starts its program.
  await studio.setTarget('Tool');
  sent.length = 0;
  const ran = await studio.runProject();
  assert.equal(ran.success, true, ran.message);
  assert.ok(await until(() => sent.some(([channel, text]) => channel === 'run:output' && String(text).includes('the tool ran'))));
  assert.equal(existsSync(path.join(multi, '_build', 'Release', 'Multi')), false, 'the app was not built');
  // A library is built, but there is nothing to run.
  await studio.setTarget('Shapes');
  assert.equal((await studio.buildProject()).success, true);
  assert.match((await studio.runProject()).message, /Shapes is not a program/);
  // Settings' program arguments and environment variables reach the program.
  assert.deepEqual(await studio.setCustomEnvironment([
    { name: 'PATH', value: '/nowhere' }, { name: '1BAD', value: 'x' }, { name: 'GLIST_TEST', value: 'first' }, { name: 'GLIST_TEST', value: 'from settings' },
  ]), [{ name: 'GLIST_TEST', value: 'from settings' }], 'PATH and bad names are refused, and the last of a name wins');
  assert.deepEqual(await studio.setRunArguments(['hello world', 'x']), ['hello world', 'x']);
  await studio.setTarget('Echo');
  sent.length = 0;
  assert.equal((await studio.runProject()).success, true);
  assert.ok(await until(() => sent.some(([channel, text]) => channel === 'run:output' && String(text).includes('[hello world][x] GLIST_TEST=from settings'))),
    sent.filter(([channel]) => channel === 'run:output').map(([, text]) => text).join(''));
  await studio.setCustomEnvironment([]);
  await studio.setRunArguments([]);

  // A name that could pass for an option is refused, which leaves nothing chosen: everything is built.
  await studio.setTarget('--target=Tool');
  assert.equal((await studio.buildProject()).success, true);
  assert.ok(existsSync(path.join(multi, '_build', 'Release', 'Multi')));
} finally {
  stopWatchingConfiguration();
  rmSync(root, { recursive: true, force: true });
}

console.log('Configure tests passed.');
