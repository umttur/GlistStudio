import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cmakeInputs, hasGlistSourceLists, pluginsInCmake, synchronizeCmake } from '../src/cmake.ts';

const template = readFileSync(new URL('../glistapp-template/GlistApp/CMakeLists.txt', import.meta.url), 'utf8');
assert.equal(hasGlistSourceLists(template), true);

const added = synchronizeCmake(template, { kind: 'add', paths: ['src/NewClass.cpp', 'src/NewClass.h'] });
assert.match(added, /\$\{APP_DIR\}\/src\/NewClass\.cpp/);
assert.match(added, /\$\{APP_DIR\}\/src\/NewClass\.h/);
assert.equal(synchronizeCmake(added, { kind: 'add', paths: ['src/NewClass.cpp'] }), added);

const singleRemoved = synchronizeCmake(added, { kind: 'remove', path: 'src/NewClass.cpp' });
assert.doesNotMatch(singleRemoved, /\$\{APP_DIR\}\/src\/NewClass\.cpp/);
assert.match(singleRemoved, /\$\{APP_DIR\}\/src\/NewClass\.h/);
assert.match(singleRemoved, /\$\{APP_DIR\}\/src\/main\.cpp/);

const spaced = synchronizeCmake(template, { kind: 'add', paths: ['src/My File.cpp'] });
assert.match(spaced, /"\$\{APP_DIR\}\/src\/My File\.cpp"/);

const renamed = synchronizeCmake(added, { kind: 'rename', from: 'src/NewClass.cpp', to: 'src/RenamedClass.cpp' });
assert.doesNotMatch(renamed, /\$\{APP_DIR\}\/src\/NewClass\.cpp/);
assert.match(renamed, /\$\{APP_DIR\}\/src\/RenamedClass\.cpp/);

const folderRenamed = synchronizeCmake(renamed, { kind: 'rename', from: 'src', to: 'code' });
assert.match(folderRenamed, /\$\{APP_DIR\}\/code\/RenamedClass\.cpp/);
assert.match(folderRenamed, /\$\{APP_DIR\}\/code\/NewClass\.h/);

const removed = synchronizeCmake(folderRenamed, { kind: 'remove', path: 'code' });
assert.doesNotMatch(removed, /\$\{APP_DIR\}\/code\//);
assert.match(removed, /set\(GlistApp_SOURCES/);
assert.match(removed, /set\(GlistApp_HEADERS/);

const extensionChanged = synchronizeCmake(added, { kind: 'rename', from: 'src/NewClass.cpp', to: 'src/NewClass.hpp' });
assert.doesNotMatch(extensionChanged, /\$\{APP_DIR\}\/src\/NewClass\.cpp/);
assert.match(extensionChanged, /\$\{APP_DIR\}\/src\/NewClass\.hpp/);

const twoCases = synchronizeCmake(template, { kind: 'add', paths: ['src/Foo.cpp', 'src/foo.cpp'] }, true);
assert.match(twoCases, /\$\{APP_DIR\}\/src\/Foo\.cpp/);
assert.match(twoCases, /\$\{APP_DIR\}\/src\/foo\.cpp/);
const oneCaseRemoved = synchronizeCmake(twoCases, { kind: 'remove', path: 'src/Foo.cpp' }, true);
assert.doesNotMatch(oneCaseRemoved, /\$\{APP_DIR\}\/src\/Foo\.cpp/);
assert.match(oneCaseRemoved, /\$\{APP_DIR\}\/src\/foo\.cpp/);
assert.doesNotMatch(synchronizeCmake(twoCases, { kind: 'remove', path: 'src/Foo.cpp' }), /src\/foo\.cpp/i);

// Plugins an app uses, as the explorer lists them.
assert.deepEqual(pluginsInCmake(template), []);
assert.deepEqual(pluginsInCmake(`
set(PLUGINS gipBox2D "gipImGui";gipNetworking) # the physics and the UI
# set(PLUGINS gipCommentedOut)
if(ANDROID)
  list(APPEND PLUGINS gipAndroid gipBox2D)
endif()
list(APPEND OTHER_LIST notAPlugin)
set(PLUGINS_DIR \${TOP_DIR}/glistplugins)
set(PLUGINS \${EXTRA} ../escape)
`), ['gipBox2D', 'gipImGui', 'gipNetworking', 'gipAndroid']);


// What CMake read while configuring, from Makefile.cmake.
assert.deepEqual(cmakeInputs(`# CMAKE generated file: DO NOT EDIT!
set(CMAKE_DEPENDS_GENERATOR "Unix Makefiles")
set(CMAKE_MAKEFILE_DEPENDS
  "CMakeCache.txt"
  "/home/ada/dev/glist/GlistEngine/engine/CMakeLists.txt"
  "/home/ada/dev/glist/myglistapps/App/CMakeLists.txt"
  "CMakeFiles/4.4.3/CMakeSystem.cmake"
  )
set(CMAKE_MAKEFILE_OUTPUTS
  "Makefile"
  )`), ['CMakeCache.txt', '/home/ada/dev/glist/GlistEngine/engine/CMakeLists.txt', '/home/ada/dev/glist/myglistapps/App/CMakeLists.txt', 'CMakeFiles/4.4.3/CMakeSystem.cmake']);
assert.deepEqual(cmakeInputs(''), []);

console.log('CMake synchronization tests passed.');
