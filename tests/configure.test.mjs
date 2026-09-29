import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initializeStudio, openProjectAt, stopWatchingConfiguration, studio } from '../src/studio.ts';

// Configuring with real CMake, on a small project with no engine. Run with jiti.
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
} finally {
  stopWatchingConfiguration();
  rmSync(root, { recursive: true, force: true });
}

console.log('Configure tests passed.');
