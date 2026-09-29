import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initializeStudio, openProjectAt, studio } from '../src/studio.ts';

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
const output = () => sent.filter(([channel]) => channel === 'build:output').map(([, text]) => text).join('');
const cacheHome = (folder) => /^CMAKE_HOME_DIRECTORY:INTERNAL=(.*)$/m.exec(readFileSync(path.join(folder, '_build', 'Release', 'CMakeCache.txt'), 'utf8'))[1];

try {
  initializeStudio({
    send: (channel, payload) => sent.push([channel, payload]),
    trashItem: async () => undefined, showItemInFolder: () => undefined, openPath: async () => undefined,
    templateRoot: root, projectsDirectory: apps,
  });
  const app = makeApp('App');
  await openProjectAt(app);
  const built = await studio.buildProject();
  assert.equal(built.success, true, built.message);

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
  rmSync(root, { recursive: true, force: true });
}

console.log('Configure tests passed.');
